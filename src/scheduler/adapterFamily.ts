import type { Shop } from "@prisma/client";

const PLAYWRIGHT_ADAPTERS = new Set([
  "mediamarkt",
  "thalia",
  "galaxus",
  "wix",
  "oxid",
  "alternate",
  "toysforfun",
  "smyths",
  "playwright",
]);

export type ShopFamily = "fast" | "slow";

export function familyOf(shop: Pick<Shop, "adapterType">): ShopFamily {
  return PLAYWRIGHT_ADAPTERS.has(shop.adapterType) ? "slow" : "fast";
}
