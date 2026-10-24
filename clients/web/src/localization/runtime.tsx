import {
  createIntl,
  createIntlCache,
  IntlProvider,
  type IntlShape,
  type FormatDateOptions,
  type FormatListOptions,
  type FormatNumberOptions,
  type MessageDescriptor,
  type MessageFormatElement,
  type PrimitiveType,
} from "react-intl";
import type { ReactNode } from "react";

import compiledEnglish from "./generated/en.json";

export type MessageId = keyof typeof compiledEnglish;
export type ProductLocale = "en" | "en-XA" | "ar-XB";
export type MessageValues = Readonly<Record<string, PrimitiveType>>;

let englishMessages = compiledEnglish as Record<MessageId, MessageFormatElement[]>;
const cache = createIntlCache();
const diagnostics = new Set<string>();
const catalogListeners = new Set<() => void>();
let current: LocaleState;

export interface LocaleState {
  readonly locale: ProductLocale;
  readonly direction: "ltr" | "rtl";
  readonly messages: Record<MessageId, MessageFormatElement[]>;
  readonly intl: IntlShape;
}

export function LocalizationProvider({ children }: { readonly children: ReactNode }) {
  applyDocumentLocale(current);
  return (
    <IntlProvider
      locale={current.locale}
      defaultLocale="en"
      messages={current.messages}
      onError={reportIntlError}
    >
      {children}
    </IntlProvider>
  );
}

export function message(id: MessageId, values?: MessageValues): string {
  if (!(id in englishMessages)) {
    reportMissing(id);
    return "Localized message unavailable";
  }
  return current.intl.formatMessage(
    { id } satisfies MessageDescriptor,
    values,
  );
}

export function formatNumber(
  value: number | bigint,
  options?: FormatNumberOptions,
): string {
  return current.intl.formatNumber(value, options);
}

export function formatDate(
  value: string | number | Date,
  options?: FormatDateOptions,
): string {
  return current.intl.formatDate(value, options);
}

export function formatList(
  values: readonly string[],
  options?: FormatListOptions,
): string {
  return current.intl.formatList(values, options);
}

export function resolveProductLocale(
  requested: readonly string[],
  allowTestLocales = false,
): ProductLocale {
  for (const candidate of requested) {
    let canonical: string;
    try {
      canonical = Intl.getCanonicalLocales(candidate)[0] ?? "";
    } catch {
      continue;
    }
    if (allowTestLocales && (canonical === "en-XA" || canonical === "ar-XB")) {
      return canonical;
    }
    if (canonical === "en" || canonical.startsWith("en-")) return "en";
  }
  return "en";
}

export function setProductLocaleForTest(locale: ProductLocale): () => void {
  const previous = current;
  current = createLocaleState([locale], true);
  return () => {
    current = previous;
    applyDocumentLocale(current);
  };
}

export function currentLocale(): ProductLocale {
  return current.locale;
}

export function localizeDocumentShell(): void {
  if (typeof document === "undefined") return;
  applyDocumentLocale(current);
  for (const element of document.querySelectorAll<HTMLElement>("[data-l10n-id]")) {
    const id = element.dataset.l10nId;
    if (id === undefined || !(id in englishMessages)) {
      reportMissing(id ?? "missing-data-l10n-id");
      continue;
    }
    element.textContent = message(id as MessageId);
  }
}

function preferredLocales(): readonly string[] {
  if (typeof navigator === "undefined") return ["en"];
  const parameters =
    typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search);
  const requestedTestLocale = parameters?.get("locale");
  const testLocalesEnabled = import.meta.env.VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES === "1";
  return requestedTestLocale !== null && requestedTestLocale !== undefined && testLocalesEnabled
    ? [requestedTestLocale, ...navigator.languages]
    : navigator.languages;
}

function createLocaleState(
  requested: readonly string[],
  allowTestLocales = import.meta.env.VITE_RSTORRENT_ENABLE_PSEUDO_LOCALES === "1",
): LocaleState {
  const locale = resolveProductLocale(requested, allowTestLocales);
  const messages = Object.fromEntries(
    Object.entries(englishMessages).map(([id, elements]) => [
      id,
      locale === "en" ? elements : transformElements(elements, locale),
    ]),
  ) as Record<MessageId, MessageFormatElement[]>;
  return {
    locale,
    direction: locale === "ar-XB" ? "rtl" : "ltr",
    messages,
    intl: createIntl(
      {
        locale,
        defaultLocale: "en",
        messages,
        onError: reportIntlError,
      },
      cache,
    ),
  };
}

function transformElements(
  elements: MessageFormatElement[],
  locale: Exclude<ProductLocale, "en">,
): MessageFormatElement[] {
  return elements.map((element) => {
    if (element.type === 0) {
      return { ...element, value: pseudoLiteral(element.value, locale) };
    }
    if (element.type === 5 || element.type === 6) {
      return {
        ...element,
        options: Object.fromEntries(
          Object.entries(element.options).map(([key, option]) => [
            key,
            { ...option, value: transformElements(option.value, locale) },
          ]),
        ),
      };
    }
    if (element.type === 8) {
      return { ...element, children: transformElements(element.children, locale) };
    }
    return element;
  });
}

function pseudoLiteral(value: string, locale: Exclude<ProductLocale, "en">): string {
  if (value.trim() === "") return value;
  if (locale === "ar-XB") return `\u200f⟦${value}\u200f⟧`;
  const expanded = value.replace(/[A-Za-z]/g, (letter) => ACCENTS[letter] ?? letter);
  return `⟦${expanded} ···⟧`;
}

const ACCENTS: Readonly<Record<string, string>> = {
  A: "Å", B: "Ɓ", C: "Ç", D: "Ð", E: "Ē", F: "Ƒ", G: "Ģ", H: "Ħ",
  I: "Ī", J: "Ĵ", K: "Ķ", L: "Ŀ", M: "Ṁ", N: "Ń", O: "Ø", P: "Ƥ",
  Q: "Ǫ", R: "Ŗ", S: "Š", T: "Ŧ", U: "Ū", V: "Ṽ", W: "Ŵ", X: "Ẋ",
  Y: "Ÿ", Z: "Ž", a: "å", b: "ƀ", c: "ç", d: "ð", e: "ē", f: "ƒ",
  g: "ģ", h: "ħ", i: "ī", j: "ĵ", k: "ķ", l: "ŀ", m: "ṁ", n: "ń",
  o: "ø", p: "ƥ", q: "ǫ", r: "ŗ", s: "š", t: "ŧ", u: "ū", v: "ṽ",
  w: "ŵ", x: "ẋ", y: "ÿ", z: "ž",
};

current = createLocaleState(preferredLocales());

/**
 * Calls `listener` after the development server replaces the message catalog,
 * so the caller can render again. Returns the unsubscribe.
 */
export function onMessageCatalogReplaced(listener: () => void): () => void {
  catalogListeners.add(listener);
  return () => catalogListeners.delete(listener);
}

// Tactical 365: a copy edit swaps the catalog and re-renders instead of
// reloading the page. Strings computed at import keep their old text.
if (import.meta.hot) {
  import.meta.hot.accept("./generated/en.json", (module) => {
    if (module === undefined) return;
    englishMessages = (module as unknown as { default: typeof compiledEnglish })
      .default as Record<MessageId, MessageFormatElement[]>;
    current = createLocaleState([current.locale], true);
    diagnostics.clear();
    for (const listener of catalogListeners) listener();
  });
}

function applyDocumentLocale(state: LocaleState): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = state.locale;
  document.documentElement.dir = state.direction;
}

function reportMissing(id: string): void {
  if (diagnostics.has(id)) return;
  diagnostics.add(id);
  console.error(`Missing localized message: ${id}`);
}

function reportIntlError(error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  const identifier = /id: "([^"]+)"/.exec(text)?.[1] ?? "unknown";
  if (diagnostics.has(identifier)) return;
  diagnostics.add(identifier);
  console.error(`Localized message formatting failed: ${identifier}`);
}
