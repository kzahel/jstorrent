import { english } from "./messages-en.js";

// Chrome owns locale matching and English fallback. Named slots remain literal
// in messages.json; only this presentation helper substitutes their values.
export function t(key, values = {}) {
  const text = globalThis.chrome?.i18n?.getMessage?.(key) || english[key];
  if (typeof text !== "string") throw new Error(`Unknown extension message: ${key}`);
  return text.replace(/\{([a-z][a-z0-9_]*)\}/gu, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match);
}

export function errorText(text) {
  const key = Object.keys(english).find((name) => name.startsWith("worker_error_") && english[name] === text);
  return key ? t(key) : text;
}

export function localizeDocument(document) {
  const language = globalThis.chrome?.i18n?.getMessage?.("catalog_locale") || "en";
  document.documentElement.lang = language;
  document.documentElement.dir = globalThis.chrome?.i18n?.getMessage?.("catalog_direction") || "ltr";
  // Translate descendants first, then move the original nodes into named slots.
  // No translated markup, URLs or event-handler attributes enter the DOM.
  for (const element of [...document.querySelectorAll("[data-i18n]")].reverse()) {
    const slots = [...element.children];
    const text = t(element.dataset.i18n);
    const names = [...text.matchAll(/\{slot([1-9][0-9]*)\}/gu)].map((match) => Number(match[1]));
    if (names.length !== slots.length || new Set(names).size !== slots.length ||
        names.some((number) => number > slots.length)) {
      throw new Error(`Invalid DOM slots: ${element.dataset.i18n}`);
    }
    const nodes = [];
    let previous = 0;
    for (const match of text.matchAll(/\{slot([1-9][0-9]*)\}/gu)) {
      nodes.push(document.createTextNode(text.slice(previous, match.index)), slots[Number(match[1]) - 1]);
      previous = match.index + match[0].length;
    }
    nodes.push(document.createTextNode(text.slice(previous)));
    element.replaceChildren(...nodes);
  }
}
