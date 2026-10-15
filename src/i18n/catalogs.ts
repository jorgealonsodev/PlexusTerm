import { en } from "./en";
import type { CatalogTree, KeyOf, Messages } from "./types";

export type AppCatalog = Messages<typeof en>;
export type AppKey = KeyOf<typeof en>;

/** Every language's catalogue by locale code; English is complete by definition. */
export const catalogs: Record<string, AppCatalog | CatalogTree> = { en };
