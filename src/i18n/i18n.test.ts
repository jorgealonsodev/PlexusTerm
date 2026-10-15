// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createTranslator, getLocale, LOCALES, resolveLocale, setLocale, t } from "./i18n";

afterEach(() => setLocale("en"));

const catalog = {
  greet: "Hello {name}",
  nested: { deep: "Deep {a} and {a}" },
  files: { one: "{count} file", other: "{count} files" },
};
const spanish = {
  greet: "Hola {name}",
  nested: { deep: "Hondo {a} y {a}" },
  files: { one: "{count} archivo", other: "{count} archivos" },
};
const arabic = {
  greet: "مرحبا {name}",
  nested: { deep: "{a}" },
  files: { zero: "لا ملفات", one: "ملف واحد", two: "ملفان", few: "{count} ملفات", many: "{count} ملفًا", other: "{count} ملف" },
};

describe("createTranslator", () => {
  it("interpolates every {var} and reads nested keys", () => {
    const tr = createTranslator({ en: catalog, es: spanish });
    expect(tr("en", "greet", { name: "Ana" })).toBe("Hello Ana");
    expect(tr("es", "nested.deep", { a: 1 })).toBe("Hondo 1 y 1");
  });

  it("picks plural forms with the language's own rules", () => {
    const tr = createTranslator({ en: catalog, ar: arabic });
    expect(tr("en", "files", { count: 1 })).toBe("1 file");
    expect(tr("en", "files", { count: 3 })).toBe("3 files");
    expect(tr("ar", "files", { count: 0 })).toBe("لا ملفات");
    expect(tr("ar", "files", { count: 2 })).toBe("ملفان");
    expect(tr("ar", "files", { count: 5 })).toBe("5 ملفات");
    expect(tr("ar", "files", { count: 11 })).toBe("11 ملفًا");
  });

  it("falls back to English for a key a catalogue lacks, and to the key itself last", () => {
    const tr = createTranslator({ en: catalog, es: { greet: "Hola {name}" } });
    expect(tr("es", "nested.deep", { a: "x" })).toBe("Deep x and x");
    expect(tr("es", "missing.key")).toBe("missing.key");
  });

  it("leaves unknown placeholders as they are", () => {
    const tr = createTranslator({ en: catalog });
    expect(tr("en", "greet")).toBe("Hello {name}");
  });
});

describe("resolveLocale", () => {
  it("uses the chosen language, or the first supported system language, or English", () => {
    expect(resolveLocale("de", ["fr-FR"])).toBe("de");
    expect(resolveLocale("system", ["xx", "fr-CA", "es"])).toBe("fr");
    expect(resolveLocale("system", ["pt-PT"])).toBe("pt-BR");
    expect(resolveLocale("system", ["zh-TW", "zh"])).toBe("zh-CN");
    expect(resolveLocale("system", ["ja-JP"])).toBe("ja");
    expect(resolveLocale("system", ["sv-SE"])).toBe("en");
    expect(resolveLocale("system", [])).toBe("en");
  });
});

describe("the app locale", () => {
  it("lists the ten languages by their own names", () => {
    expect(LOCALES.map((l) => l.code)).toEqual(["en", "es", "de", "fr", "ja", "pt-BR", "zh-CN", "ko", "ar", "hi"]);
    expect(LOCALES.find((l) => l.code === "ja")!.name).toBe("日本語");
  });

  it("starts in English and sets <html lang> and dir, right to left only for Arabic", () => {
    expect(getLocale()).toBe("en");
    setLocale("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    setLocale("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("translates app keys in the current language", () => {
    expect(t("settings.language.system")).toBe("System");
  });
});
