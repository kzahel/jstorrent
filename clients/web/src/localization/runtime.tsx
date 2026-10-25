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
import { useSyncExternalStore, type ReactNode } from "react";

import compiledEnglish from "./generated/en.json";

export type MessageId = keyof typeof compiledEnglish;
export type ProductLocale = "en" | "de" | "en-XA" | "ar-XB";
export type LanguagePreference = "system" | "en" | "de";
export interface DesktopLocaleSnapshot {
  readonly preference: LanguagePreference;
  readonly locale: "en" | "de";
  readonly availableLocales: readonly ("en" | "de")[];
}
export interface DesktopLanguageAuthority {
  save(preference: LanguagePreference): Promise<DesktopLocaleSnapshot>;
}
const LANGUAGE_KEY = "rstorrent.presentation.language";
const previewEnabled = import.meta.env.VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES === "1";
// Preview assets are compiled into the bundle, never fetched by language choice.
// A false build-time gate lets the release bundler remove the German data.
const previewCatalogs = import.meta.env.VITE_RSTORRENT_ENABLE_PREVIEW_LOCALES === "1"
  ? import.meta.glob("./generated/de.json", { eager: true, import: "default" })
  : {};
let germanMessages: Record<MessageId, MessageFormatElement[]> | undefined;
let languagePreference: LanguagePreference = "system";
let desktopAuthority: DesktopLanguageAuthority | undefined;
let desktopLocales: readonly ("en" | "de")[] | undefined;
let initialized = false;
let localeRequest = 0;
export type MessageValues = Readonly<Record<string, PrimitiveType>>;

let englishMessages = compiledEnglish as Record<MessageId, MessageFormatElement[]>;
const cache = createIntlCache();
const diagnostics = new Set<string>();
const catalogListeners = new Set<() => void>();
const shellText = new WeakMap<HTMLElement, string>();
let current: LocaleState;

export interface LocaleState {
  readonly locale: ProductLocale;
  readonly direction: "ltr" | "rtl";
  readonly messages: Record<MessageId, MessageFormatElement[]>;
  readonly intl: IntlShape;
}

export function LocalizationProvider({ children }: { readonly children: ReactNode }) {
  const state = useSyncExternalStore(onMessageCatalogReplaced, () => current, () => current);
  applyDocumentLocale(state);
  return (
    <IntlProvider
      locale={state.locale}
      defaultLocale="en"
      messages={state.messages}
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
    if ((previewEnabled || allowTestLocales) && (canonical === "de" || canonical.startsWith("de-"))) return "de";
    if (canonical === "en" || canonical.startsWith("en-")) return "en";
  }
  return "en";
}

export function setProductLocaleForTest(locale: ProductLocale): () => void {
  const previous = current;
  current = createLocaleState([locale], true);
  notifyLocale();
  return () => {
    current = previous;
    notifyLocale();
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
    // The live application owns a rate-bearing document title. Keep it until
    // its normal render applies newly formatted rates after the locale change.
    const previous = shellText.get(element);
    if (element.tagName === "TITLE" && previous !== undefined && element.textContent !== previous) continue;
    const text = message(id as MessageId);
    element.textContent = text;
    shellText.set(element, text);
  }
}

export function languagePreferenceSnapshot(): LanguagePreference { return languagePreference; }

export function availableProductLanguages(): readonly ("en" | "de")[] {
  const packaged: readonly ("en" | "de")[] = previewEnabled ? ["en", "de"] : ["en"];
  const nativeLocales = desktopLocales;
  return nativeLocales === undefined ? packaged : packaged.filter((tag) => nativeLocales.includes(tag));
}

export function useProductLocale(): ProductLocale {
  return useSyncExternalStore(onMessageCatalogReplaced, () => current, () => current).locale;
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function storedPreference(): LanguagePreference {
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_KEY);
    return stored === "en" || (stored === "de" && previewEnabled) ? stored : "system";
  } catch { return "system"; }
}

async function loadGerman(): Promise<void> {
  if (germanMessages !== undefined) return;
  const catalog = previewCatalogs["./generated/de.json"];
  if (catalog === undefined) throw new Error("German preview catalog is not packaged");
  germanMessages = catalog as Record<MessageId, MessageFormatElement[]>;
}

function notifyLocale(): void {
  diagnostics.clear();
  localizeDocumentShell();
  for (const listener of catalogListeners) listener();
}

async function applyPreference(preference: LanguagePreference, nativeLocale?: ProductLocale): Promise<void> {
  const request = ++localeRequest;
  const requested = nativeLocale === undefined
    ? preference === "system" ? preferredLocales() : [preference]
    : [nativeLocale];
  const locale = resolveProductLocale(requested);
  if (locale === "de") await loadGerman();
  if (request !== localeRequest) return;
  languagePreference = preference;
  current = createLocaleState(requested);
  notifyLocale();
}

/** Reads local UI preferences; never writes defaults or touches the engine. */
export async function initializeLocalization(): Promise<void> {
  if (initialized) return;
  const desktop = isDesktop();
  languagePreference = desktop ? "system" : storedPreference();
  // Native owns System negotiation. Its snapshot arrives before any app or
  // recovery screen; the browser shell stays English while that owner loads.
  await applyPreference(languagePreference, desktop ? "en" : undefined);
  initialized = true;
  if (typeof window !== "undefined") {
    window.addEventListener("languagechange", () => {
      if (!isDesktop() && languagePreference === "system") void applyPreference("system").catch(reportIntlError);
    });
    window.addEventListener("storage", (event) => {
      if (!isDesktop() && event.key === LANGUAGE_KEY) void applyPreference(storedPreference()).catch(reportIntlError);
    });
  }
}

export async function setLanguagePreference(preference: LanguagePreference): Promise<void> {
  if (preference !== "system" && !availableProductLanguages().includes(preference)) {
    throw new Error("Unsupported presentation language");
  }
  const desktop = isDesktop();
  const requested = preference === "system"
    ? desktop ? undefined : resolveProductLocale(preferredLocales()) : preference;
  if (requested === "de") await loadGerman();
  if (desktop) {
    if (desktopAuthority === undefined) throw new Error("Desktop language owner is unavailable");
    await applyDesktopLocaleSnapshot(await desktopAuthority.save(preference));
    return;
  }
  // A failed write leaves the current choice unchanged; a missing value means
  // follow future browser language changes rather than pinning today's locale.
  if (preference === "system") globalThis.localStorage.removeItem(LANGUAGE_KEY);
  else globalThis.localStorage.setItem(LANGUAGE_KEY, preference);
  await applyPreference(preference);
}

export async function bindDesktopLanguageAuthority(
  authority: DesktopLanguageAuthority,
  snapshot: DesktopLocaleSnapshot,
): Promise<void> {
  desktopAuthority = authority;
  await applyDesktopLocaleSnapshot(snapshot);
}

export async function applyDesktopLocaleSnapshot(snapshot: DesktopLocaleSnapshot): Promise<void> {
  if (!["system", "en", "de"].includes(snapshot.preference) || !["en", "de"].includes(snapshot.locale)
    || !Array.isArray(snapshot.availableLocales) || !snapshot.availableLocales.includes("en")) {
    throw new Error("Invalid desktop locale snapshot");
  }
  desktopLocales = snapshot.availableLocales.filter((tag) => tag === "en" || tag === "de");
  await applyPreference(snapshot.preference, snapshot.locale);
}

export async function loadProductLocaleForTest(locale: ProductLocale): Promise<() => void> {
  if (locale === "de") await loadGerman();
  return setProductLocaleForTest(locale);
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
      locale === "de" ? germanMessages?.[id as MessageId] ?? elements
        : locale === "en" ? elements : transformElements(elements, locale),
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
  locale: "en-XA" | "ar-XB",
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

function pseudoLiteral(value: string, locale: "en-XA" | "ar-XB"): string {
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

current = createLocaleState(isDesktop() ? ["en"] : preferredLocales());

/**
 * Calls `listener` after the locale or development catalog changes. The root
 * can render again while retaining navigation, component state and drafts.
 */
export function onMessageCatalogReplaced(listener: () => void): () => void {
  catalogListeners.add(listener);
  return () => catalogListeners.delete(listener);
}

// Tactical 365: a copy edit swaps the catalog and re-renders instead of
// reloading the page. Module-scope presentation labels use lazy getters.
if (import.meta.hot) {
  import.meta.hot.accept("./generated/en.json", (module) => {
    if (module === undefined) return;
    englishMessages = (module as unknown as { default: typeof compiledEnglish })
      .default as Record<MessageId, MessageFormatElement[]>;
    current = createLocaleState([current.locale], true);
    notifyLocale();
  });
  if (previewEnabled) import.meta.hot.accept("./generated/de.json", (module) => {
    if (module === undefined) return;
    germanMessages = (module as unknown as { default: Record<MessageId, MessageFormatElement[]> }).default;
    current = createLocaleState([current.locale], true);
    notifyLocale();
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
