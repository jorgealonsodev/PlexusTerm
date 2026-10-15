/** A message with plural forms, picked with `Intl.PluralRules` from `{count}`; `other` is required. */
export type PluralForms = { other: string } & Partial<Record<Exclude<Intl.LDMLPluralRule, "other">, string>>;

/** A catalogue tree: strings, plural forms or nested groups. */
export interface CatalogTree {
  [key: string]: string | PluralForms | CatalogTree;
}

/**
 * The shape another language must give the English catalogue `T`: the same keys, any wording,
 * and its own plural forms. A missing key is a type error.
 */
export type Messages<T> = {
  [K in keyof T]: T[K] extends string ? string : T[K] extends { other: string } ? PluralForms : Messages<T[K]>;
};

/** Every key of a catalogue as a dotted path, e.g. "settings.language.label". */
export type KeyOf<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends { other: string }
      ? `${P}${K}`
      : KeyOf<T[K], `${P}${K}.`>;
}[keyof T & string];

export type Vars = Record<string, string | number>;
