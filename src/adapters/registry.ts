import type { Shop } from "@prisma/client";
import type { ShopAdapter } from "./ShopAdapter.js";
import { createShopifyAdapter } from "./shopify-generic.js";
import { createJtlAdapter } from "./jtl-generic.js";
import { createShopwareAdapter } from "./shopware-generic.js";
import { createSmythsAdapter } from "./smyths.js";
import { createMediaMarktAdapter } from "./mediamarkt.js";
import { createThaliaAdapter } from "./thalia.js";
import { createOttoAdapter } from "./otto.js";
import { createGalaxusAdapter } from "./galaxus.js";
import { createWixAdapter } from "./wix-generic.js";
import { createOxidAdapter } from "./oxid-generic.js";
import { createAlternateAdapter } from "./alternate.js";
import { createToysForFunAdapter } from "./toysforfun.js";

export function createAdapterForShop(shop: Shop): ShopAdapter | null {
  switch (shop.adapterType) {
    case "shopify":
      return createShopifyAdapter(shop.id, shop.baseUrl);
    case "jtl":
      return createJtlAdapter(shop.id, shop.baseUrl);
    case "shopware":
      return createShopwareAdapter(shop.id, shop.baseUrl);
    case "smyths":
      return createSmythsAdapter(shop.id);
    case "mediamarkt":
      return createMediaMarktAdapter(shop.id, shop.baseUrl);
    case "thalia":
      return createThaliaAdapter(shop.id);
    case "otto":
      return createOttoAdapter(shop.id);
    case "galaxus":
      return createGalaxusAdapter(shop.id);
    case "wix":
      return createWixAdapter(shop.id, shop.baseUrl);
    case "oxid":
      return createOxidAdapter(shop.id, shop.baseUrl);
    case "alternate":
      return createAlternateAdapter(shop.id);
    case "toysforfun":
      return createToysForFunAdapter(shop.id);
    case "playwright":
      // TODO: generic playwright adapter — for now, dedicated adapters per retailer
      return null;
    default:
      return null;
  }
}
