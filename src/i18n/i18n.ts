import { useSyncExternalStore } from "react";
import { catalogs, type AppKey } from "./catalogs";
import type { CatalogTree, PluralForms, Vars } from "./types";

export type LocaleCode = "en" | "es" | "de" | "fr" | "ja" | "pt-BR" | "zh-CN" | "ko" | "ar" | "hi";

/** The interface languages (S1), each named in its own language. */
export const LOCALES: { code: LocaleCode; name: string; dir: "ltr" | "rtl" }[] = [
  { code: "en", name: "English", dir: "ltr" },
  { code: "es", name: "Español", dir: "ltr" },
  { code: "de", name: "Deutsch", dir: "ltr" },
  { code: "fr", name: "Français", dir: "ltr" },
  { code: "ja", name: "日本語", dir: "ltr" },
  { code: "pt-BR", name: "Português (Brasil)", dir: "ltr" },
  { code: "zh-CN", name: "简体中文", dir: "ltr" },
  { code: "ko", name: "한국어", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "hi", name: "हिन्दी", dir: "ltr" },
];

/** "system" follows the operating system's language (S3). */
export type LanguageSetting = "system" | LocaleCode;

export const isLanguageSetting = (value: unknown): value is LanguageSetting =>
  value === "system" || LOCALES.some((l) => l.code === value);

/** The language to show: the chosen one, else the first supported system language, else English. */
export function resolveLocale(setting: LanguageSetting, system: readonly string[]): LocaleCode {
  if (setting !== "system") return setting;
  for (const tag of system) {
    const lower = tag.toLowerCase();
    const base = lower.split("-")[0];
    if (base === "pt") return "pt-BR";
    if (base === "zh") return "zh-CN";
    const found = LOCALES.find((l) => l.code.toLowerCase() === base);
    if (found) return found.code;
  }
  return "en";
}

const isPlural = (value: unknown): value is PluralForms =>
  typeof value === "object" && value !== null && typeof (value as { other?: unknown }).other === "string";

const lookup = (tree: CatalogTree | undefined, key: string): string | PluralForms | undefined => {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" || isPlural(node) ? node : undefined;
};

const interpolate = (text: string, vars: Vars | undefined) =>
  vars ? text.replace(/\{(\w+)\}/g, (all, name: string) => (name in vars ? String(vars[name]) : all)) : text;

/**
 * Looks `key` up in the language's catalogue (English when it lacks it, the key itself last),
 * picks the plural form for `{count}` and fills in the `{name}` placeholders.
 */
export function createTranslator(trees: Record<string, CatalogTree>) {
  const rules = new Map<string, Intl.PluralRules>();
  return (locale: string, key: string, vars?: Vars): string => {
    const message = lookup(trees[locale], key) ?? lookup(trees.en, key);
    if (message === undefined) return key;
    if (typeof message === "string") return interpolate(message, vars);
    const count = Number(vars?.count ?? 0);
    const from = lookup(trees[locale], key) === message ? locale : "en";
    let rule = rules.get(from);
    if (!rule) rules.set(from, (rule = new Intl.PluralRules(from)));
    return interpolate(message[rule.select(count)] ?? message.other, vars);
  };
}

const translate = createTranslator(catalogs as unknown as Record<string, CatalogTree>);

let current: LocaleCode = "en";
const listeners = new Set<() => void>();

export const getLocale = () => current;

/** Switches the interface language and sets `<html lang dir>` (Arabic is right to left). */
export function setLocale(locale: LocaleCode) {
  const entry = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  if (typeof document !== "undefined") {
    document.documentElement.lang = entry.code;
    document.documentElement.dir = entry.dir;
  }
  if (entry.code === current) return;
  current = entry.code;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The text of `key` in the current language. Components use `useT()` so they re-render on a change. */
export const t = (key: AppKey, vars?: Vars) => translate(current, key, vars);

/** `t` for components: re-renders them when the language changes. */
export function useT() {
  useSyncExternalStore(subscribe, getLocale, getLocale);
  return t;
}

/** The system's preferred languages, most preferred first. */
export const systemLanguages = (): readonly string[] =>
  typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
