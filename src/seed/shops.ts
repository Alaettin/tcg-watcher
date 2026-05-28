import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

interface ShopSeed {
  id: string;
  displayName: string;
  baseUrl: string;
  adapterType:
    | "shopify"
    | "jtl"
    | "shopware"
    | "smyths"
    | "mediamarkt"
    | "thalia"
    | "otto"
    | "galaxus"
    | "wix"
    | "oxid"
    | "alternate"
    | "toysforfun"
    | "ideeundspiel"
    | "playwright";
  enabled: boolean;
  pollIntervalSeconds?: number;
  dropDayIntervalSeconds?: number;
}

export const SHOP_SEEDS: ShopSeed[] = [
  {
    id: "primeprotector",
    displayName: "PrimeProtector (AT)",
    baseUrl: "https://primeprotector.at",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  {
    id: "cardsrfun",
    displayName: "Cards R Fun (DE)",
    baseUrl: "https://cardsrfun.de",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  {
    id: "card-corner",
    displayName: "Card-Corner (DE)",
    baseUrl: "https://www.card-corner.de",
    adapterType: "jtl",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "cardmex-shop",
    displayName: "CardMex Shop (DE)",
    baseUrl: "https://cardmex-shop.de",
    adapterType: "shopware",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "games-island",
    displayName: "Games-Island (EU)",
    baseUrl: "https://www.games-island.eu",
    adapterType: "shopware",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "comicplanet",
    displayName: "Comicplanet (DE)",
    baseUrl: "https://www.comicplanet.de",
    adapterType: "shopware",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "smyths-toys",
    displayName: "Smyths Toys (DE)",
    baseUrl: "https://www.smythstoys.com/de/de-de",
    adapterType: "smyths",
    enabled: false,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "mediamarkt",
    displayName: "MediaMarkt (DE)",
    baseUrl: "https://www.mediamarkt.de",
    adapterType: "mediamarkt",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "saturn",
    displayName: "Saturn (DE)",
    baseUrl: "https://www.saturn.de",
    adapterType: "mediamarkt",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "thalia",
    displayName: "Thalia (DE)",
    baseUrl: "https://www.thalia.de",
    adapterType: "thalia",
    enabled: true,
    pollIntervalSeconds: 600,
    dropDayIntervalSeconds: 60,
  },
  {
    id: "otto",
    displayName: "Otto (DE)",
    baseUrl: "https://www.otto.de",
    adapterType: "otto",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "galaxus",
    displayName: "Galaxus (CH/DE)",
    baseUrl: "https://www.galaxus.de",
    adapterType: "galaxus",
    enabled: true,
    pollIntervalSeconds: 600,
    dropDayIntervalSeconds: 60,
  },
  // Shopify TCG shops (user-curated list)
  {
    id: "deckshop",
    displayName: "Deckshop (DE)",
    baseUrl: "https://www.deckshop.de",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  {
    id: "godofcards",
    displayName: "God of Cards (DE)",
    baseUrl: "https://godofcards.com",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  {
    id: "opasladen",
    displayName: "Opas Laden (DE)",
    baseUrl: "https://opasladen.de",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "cardcosmos",
    displayName: "Cardcosmos (DE)",
    baseUrl: "https://cardcosmos.de",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  {
    id: "tcgviert",
    displayName: "TCG Viert (DE)",
    baseUrl: "https://tcgviert.com",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "deichcards",
    displayName: "Deichcards (DE)",
    baseUrl: "https://deichcards.de",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  {
    id: "geeksheaven",
    displayName: "Geeks Heaven (DE)",
    baseUrl: "https://geeksheaven.de",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  {
    id: "bayzing",
    displayName: "Bayzing (DE)",
    baseUrl: "https://bayzing.com",
    adapterType: "shopify",
    enabled: true,
    pollIntervalSeconds: 120,
    dropDayIntervalSeconds: 10,
  },
  // Shopware TCG shop
  {
    id: "jk-entertainment",
    displayName: "JK Entertainment (DE)",
    baseUrl: "https://jk-entertainment.de",
    adapterType: "shopware",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "einzigundartig",
    displayName: "EinzigundArtig (DE)",
    baseUrl: "https://www.einzigundartig.de",
    adapterType: "shopware",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "bb-spiele",
    displayName: "BB-Spiele (DE)",
    baseUrl: "https://www.bb-spiele.de",
    adapterType: "shopware",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "gate-to-the-games",
    displayName: "Gate to the Games (DE)",
    baseUrl: "https://www.gate-to-the-games.de",
    adapterType: "jtl",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "allgames4you",
    displayName: "AllGames4you (DE)",
    baseUrl: "https://www.allgames4you.de",
    adapterType: "jtl",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "pokesynek",
    displayName: "Pokesynek (DE)",
    baseUrl: "https://www.pokesynek.de",
    adapterType: "wix",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "zuris-shop",
    displayName: "Zuris-Shop (DE)",
    baseUrl: "https://www.zuris-shop.de",
    adapterType: "wix",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "trader-online",
    displayName: "Trader-Online (DE)",
    baseUrl: "https://trader-online.de",
    adapterType: "oxid",
    enabled: true,
    pollIntervalSeconds: 180,
    dropDayIntervalSeconds: 15,
  },
  {
    id: "alternate",
    displayName: "Alternate Sammelkarten (DE)",
    baseUrl: "https://www.alternate.de",
    adapterType: "alternate",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "toys-for-fun",
    displayName: "Toys for Fun (DE)",
    baseUrl: "https://www.toys-for-fun.com",
    adapterType: "toysforfun",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
  {
    id: "ideeundspiel",
    displayName: "idee+spiel (DE)",
    baseUrl: "https://www.ideeundspiel.com",
    adapterType: "ideeundspiel",
    enabled: true,
    pollIntervalSeconds: 300,
    dropDayIntervalSeconds: 30,
  },
];

export async function seedShops(): Promise<void> {
  for (const seed of SHOP_SEEDS) {
    await prisma.shop.upsert({
      where: { id: seed.id },
      create: {
        id: seed.id,
        displayName: seed.displayName,
        baseUrl: seed.baseUrl,
        adapterType: seed.adapterType,
        enabled: seed.enabled,
        pollIntervalSeconds: seed.pollIntervalSeconds ?? 120,
        dropDayIntervalSeconds: seed.dropDayIntervalSeconds ?? 10,
      },
      update: {
        displayName: seed.displayName,
        baseUrl: seed.baseUrl,
        adapterType: seed.adapterType,
        pollIntervalSeconds: seed.pollIntervalSeconds ?? 120,
        dropDayIntervalSeconds: seed.dropDayIntervalSeconds ?? 10,
      },
    });
  }
  logger.info({ count: SHOP_SEEDS.length }, "shops seeded");
}
