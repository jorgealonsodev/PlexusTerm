import { ar } from "./ar";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { hi } from "./hi";
import { ja } from "./ja";
import { ko } from "./ko";
import { ptBR } from "./pt-BR";
import type { CatalogTree, KeyOf, Messages } from "./types";
import { zhCN } from "./zh-CN";

export type AppCatalog = Messages<typeof en>;
export type AppKey = KeyOf<typeof en>;

/** Every language's catalogue by locale code (S1); each one is checked against English by type. */
export const catalogs: Record<string, AppCatalog | CatalogTree> = {
  en,
  es,
  de,
  fr,
  ja,
  "pt-BR": ptBR,
  "zh-CN": zhCN,
  ko,
  ar,
  hi,
};
