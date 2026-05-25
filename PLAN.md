# PLAN.md — Pokémon 30th Anniversary Watch Bot

> Hyper-fokussierter Deal- und Restock-Bot für die Pokémon 30th-Anniversary-Produktlinie 2026. Überwacht deutsche und europäische Shops sowie Kleinanzeigen-Resale und benachrichtigt via Telegram in Sekunden.

---

## 1. Ziel & Scope

### Was der Bot macht
- Überwacht eine fest definierte **Watchlist von 30th-Anniversary-Produkten** auf relevanten Shops/Marktplätzen.
- Erkennt vier Event-Typen pro Produkt:
  1. **Pre-Order verfügbar** (Produkt erstmals listbar/vorbestellbar)
  2. **Restock zum UVP** (Produkt nach Sold-Out wieder verfügbar, Preis ≤ UVP-Schwelle)
  3. **Preisänderung nach unten** (Preis fällt um ≥ X % gegenüber zuletzt gesehenem)
  4. **Resale-Schnäppchen** (Kleinanzeigen-Inserate unter Marktpreis)
- Schickt strukturierte Telegram-Benachrichtigungen mit Direkt-Link, Preis, Shop, Event-Typ.
- Schaltet am Drop-Day (16.09.2026) automatisch in Hochfrequenz-Modus.

### Was der Bot **nicht** macht
- Kein Autobuy/Checkout-Bot (rechtlich grau, gegen ToS, lassen wir bewusst weg).
- Keine Einzelkarten-Überwachung (nur sealed Produkte aus der 30th-Linie).
- Kein generischer Pokémon-Tracker (TCG-Tracker macht das schon gut, wir sind fokussiert).
- Keine Web-UI im MVP (Telegram-Bot reicht als Interface — Befehle per `/list`, `/add`, `/threshold`).

### Erfolgsmetrik
- **Etappe 1 erfolgreich**, wenn du beim **19.06.2026** (First Partner Serie 2) den Drop in unter 60 Sekunden mitbekommst.
- **Etappe 2 erfolgreich**, wenn du am **16.09.2026** (30th Celebration) bei mindestens 3 deutschen Shops in den ersten 10 Sekunden gepingt wirst.

---

## 2. Watchlist (statisch konfiguriert, JSON-basiert)

`config/watchlist.json` enthält alle zu überwachenden Produkte. Struktur pro Produkt:

```json
{
  "id": "30th-celebration-display-de",
  "displayName": "30th Celebration Booster Display (DE)",
  "category": "display",
  "expectedReleaseDate": "2026-09-16",
  "uvpEur": 159.99,
  "uvpToleranceEur": 10,
  "searchTerms": [
    "30th Celebration Display",
    "30th Anniversary Display",
    "Jubiläum Display",
    "30 Jahre Pokemon Display",
    "Mega Expansion Pack 30th"
  ],
  "negativeTerms": ["Sleeve", "Münze", "Einzelkarte", "Promo"],
  "ean": null,
  "minResalePriceEur": null
}
```

Initiale Watchlist (Stand Mai 2026, basierend auf bekannten Releases):

| ID | Produkt | Release | UVP-Bereich |
|---|---|---|---|
| `pokemon-day-2026-collection` | Pokémon Day 2026 Collection (Pikachu Promo + Münze + 3 Booster) | 30.01.2026 (released) | ~25 € |
| `first-partner-collection-s1` | First Partner Illustration Collection Serie 1 (Kanto/Hoenn/Sinnoh) | 30.03.2026 (released) | ~35 € |
| `first-partner-collection-s2` | Erste Partner Illustrations-Kollektion Serie 2 (Johto/Einall/Galar) | **19.06.2026** | ~35 € |
| `30th-celebration-display-de` | 30th Celebration Booster Display DE | **16.09.2026** | ~160 € |
| `30th-celebration-booster-de` | 30th Celebration Einzelbooster DE | 16.09.2026 | ~5 € |
| `30th-celebration-etb-de` | 30th Celebration Elite Trainer Box DE (vermutet) | 16.09.2026 | ~50 € |
| `30th-celebration-premium-deck-espeon-umbreon` | Premium Deck Set Espeon & Umbreon | 16.09.2026 | TBD |
| `first-partner-collection-s3` | First Partner Serie 3 | Q4 2026 | ~35 € |
| `30th-celebration-card-sets` | 30th Celebration Card Sets | 16.10.2026 | TBD |

Watchlist ist via Telegram-Befehl `/add` erweiterbar — neue Produkte werden in derselben JSON-Datei persistiert.

---

## 3. Tech-Stack

- **Sprache:** TypeScript (Node.js 22 LTS)
- **Scraping:** Playwright (chromium, headless) + axios + cheerio
- **Scheduler:** BullMQ + Redis
- **DB:** PostgreSQL + Prisma
- **Notification:** Telegram Bot API (via `grammy` Library)
- **Hosting:** Hetzner CX22 (Ubuntu 24.04, ~5 €/Monat)
- **Logging:** pino + Logfile-Rotation
- **Proxies (optional, ab Etappe 3):** Residential Proxy für Kleinanzeigen (Bright Data Pay-as-you-go, ~10 €/Monat)

Bewusst **nicht** im Stack: kein Next.js (keine Web-UI nötig), kein Frontend-Framework, kein Vercel/Railway (Long-Running-Worker brauchen einen VPS).

---

## 4. Architektur

```
┌─────────────────────────────────────────────────────────────┐
│  WATCHLIST CONFIG (JSON, in DB synchronisiert)              │
│  - 30th Anniversary Produkte mit Suchbegriffen & UVP        │
└────────────────────┬────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  SCHEDULER (BullMQ, Redis)                                  │
│  - Pro Shop ein Job mit eigenem Intervall                   │
│  - Normal: 60–120s, Drop-Day-Modus: 5–10s                   │
│  - Cron-Schalter: am 16.09.2026 ab 08:00 MESZ → Hochfreq.   │
└────────────────────┬────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  SHOP ADAPTERS (Plugin-System, ein File pro Shop)           │
│  Interface: ShopAdapter.search(searchTerms) → Listing[]     │
│                                                              │
│  Etappe 1 (API/Shopify-Standard):                           │
│    ├── ebay.ts                (Browse API)                  │
│    ├── card-corner.de.ts      (Shopify)                     │
│    ├── cardmex-shop.de.ts     (Shopify)                     │
│    ├── primeprotector.at.ts   (Shopify)                     │
│    ├── cardsrfun.de.ts        (Shopify)                     │
│    ├── fantasywelt.de.ts      (Shopware 6)                  │
│    └── games-island.eu.ts     (Shopware 6)                  │
│                                                              │
│  Etappe 2 (Retail-Drops, JS-lastig):                        │
│    ├── mediamarkt.de.ts       (Playwright)                  │
│    ├── saturn.de.ts           (Playwright)                  │
│    ├── kaufland.de.ts         (Marketplace, Playwright)     │
│    ├── mueller.de.ts          (Playwright)                  │
│    ├── smyths-toys.de.ts      (Playwright)                  │
│    └── thalia.de.ts                                         │
│                                                              │
│  Etappe 3 (Resale):                                         │
│    └── kleinanzeigen.de.ts    (Playwright + Proxy)          │
└────────────────────┬────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  PRODUCT MATCHER                                            │
│  - Fuzzy-Match listing.title gegen watchlist.searchTerms    │
│  - negativeTerms filtern Falschtreffer                      │
│  - Optional: EAN-Match wenn vorhanden                       │
│  - Output: { listing, matchedProductId, confidence }        │
└────────────────────┬────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  EVENT DETECTOR (State-basiert)                             │
│  Vergleicht aktuelles Listing gegen letzten DB-State:       │
│    - was OUT_OF_STOCK → IN_STOCK   → "Restock"              │
│    - kein Eintrag      → IN_STOCK   → "Pre-Order/New"       │
│    - Preis fällt ≥ X%               → "Preisdrop"           │
│    - resale unter UVP × Faktor      → "Resale-Deal"         │
│  Dedup: gleicher Event nicht 2x in 6h                       │
└────────────────────┬────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  TELEGRAM NOTIFIER                                          │
│  Channels:                                                  │
│    🚨 #drop-alerts     (Pre-Order/Restock, max. Urgency)    │
│    💰 #deals           (Preisdrops, UVP-Schnäppchen)        │
│    🔄 #resale          (Kleinanzeigen-Funde)                │
│    🗒  #logs            (Nur für dich, Debug + Heartbeat)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Datenmodell (Prisma)

```prisma
model Product {
  id                    String   @id              // z.B. "30th-celebration-display-de"
  displayName           String
  category              String                    // "display" | "etb" | "booster" | "collection" | "deck"
  expectedReleaseDate   DateTime?
  uvpEur                Float?
  uvpToleranceEur       Float    @default(10)
  searchTerms           String[]                  // PostgreSQL array
  negativeTerms         String[]
  ean                   String?
  minResalePriceEur     Float?
  active                Boolean  @default(true)
  listings              Listing[]
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model Shop {
  id            String    @id                    // "ebay", "card-corner", "kleinanzeigen", ...
  displayName   String
  baseUrl       String
  adapterType   String                           // "shopify" | "shopware" | "playwright" | "api"
  enabled       Boolean   @default(true)
  pollIntervalSeconds Int @default(120)
  dropDayIntervalSeconds Int @default(10)
  listings      Listing[]
  lastSuccessfulRun DateTime?
}

model Listing {
  id              String        @id @default(cuid())
  productId       String
  shopId          String
  externalId      String                          // ID/URL im Shop
  url             String
  title           String
  priceEur        Float
  currency        String        @default("EUR")
  status          ListingStatus
  seenAt          DateTime      @default(now())
  product         Product       @relation(fields: [productId], references: [id])
  shop            Shop          @relation(fields: [shopId], references: [id])
  events          Event[]

  @@unique([shopId, externalId])
  @@index([productId, status])
  @@index([seenAt])
}

enum ListingStatus {
  IN_STOCK
  OUT_OF_STOCK
  PREORDER
  UNKNOWN
}

model Event {
  id          String     @id @default(cuid())
  listingId   String
  type        EventType
  detail      Json                                // { previousPrice, newPrice, statusChange, ... }
  notifiedAt  DateTime?
  createdAt   DateTime   @default(now())
  listing     Listing    @relation(fields: [listingId], references: [id])

  @@index([type, createdAt])
}

enum EventType {
  NEW_LISTING        // Pre-Order/erstes Auftauchen
  RESTOCK            // OUT_OF_STOCK → IN_STOCK
  PRICE_DROP         // Preis gefallen
  RESALE_DEAL        // Kleinanzeigen unter Schwelle
  WENT_OUT_OF_STOCK  // Nur Log, keine Push
}

model TelegramChat {
  chatId      String   @id
  subscriptions String[]                          // ["drop-alerts", "deals", "resale"]
  createdAt   DateTime @default(now())
}
```

---

## 6. Shop-Adapter-Interface

Jeder Adapter implementiert dasselbe Interface, damit neue Shops einfach ergänzt werden können:

```typescript
// src/adapters/ShopAdapter.ts
export interface RawListing {
  externalId: string;
  url: string;
  title: string;
  priceEur: number;
  status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'PREORDER' | 'UNKNOWN';
  rawData?: Record<string, unknown>;
}

export interface ShopAdapter {
  shopId: string;
  search(searchTerms: string[], negativeTerms?: string[]): Promise<RawListing[]>;
  isAvailable(): Promise<boolean>;        // Health-Check
}
```

Beispiel-Adapter für Shopify-Standard-Endpoint (`/search/suggest.json`):

```typescript
// src/adapters/shopify-generic.ts
export function createShopifyAdapter(shopId: string, baseUrl: string): ShopAdapter {
  return {
    shopId,
    async search(searchTerms) {
      const results: RawListing[] = [];
      for (const term of searchTerms) {
        const res = await fetch(`${baseUrl}/search/suggest.json?q=${encodeURIComponent(term)}&resources[type]=product&resources[limit]=10`);
        const data = await res.json();
        // ...normalisieren...
      }
      return dedupByExternalId(results);
    },
    async isAvailable() {
      const res = await fetch(`${baseUrl}/`, { method: 'HEAD' });
      return res.ok;
    }
  };
}
```

Adapter, die kein API haben (MediaMarkt, Müller etc.), bekommen einen Playwright-Adapter mit Seiten-spezifischen Selektoren.

---

## 7. Drop-Day-Modus

Statt zwei Stacks zu pflegen, wird der Polling-Intervall pro Shop dynamisch gesetzt:

```typescript
// src/scheduler/dropDay.ts
const DROP_DAYS = [
  { date: '2026-06-19', start: '08:00', end: '20:00', label: 'First Partner S2' },
  { date: '2026-09-16', start: '00:01', end: '23:59', label: '30th Celebration' },
  { date: '2026-10-16', start: '00:01', end: '23:59', label: 'Card Sets' },
];

function getCurrentInterval(shop: Shop): number {
  if (isWithinDropWindow(new Date())) {
    return shop.dropDayIntervalSeconds;
  }
  return shop.pollIntervalSeconds;
}
```

Zusätzlich: Bei einem erkannten `NEW_LISTING`-Event auf einem Shop wird **temporär ein Boost** ausgelöst — alle Shops fahren für 30 Minuten auf 10s-Intervall hoch, weil Drops oft kaskadieren.

---

## 8. Telegram-Bot Befehle

| Befehl | Wirkung |
|---|---|
| `/start` | Abo aller drei Channels |
| `/list` | Aktuelle Watchlist anzeigen |
| `/add <produktname>` | Produkt zur Watchlist hinzufügen (Wizard fragt UVP, Suchbegriffe) |
| `/remove <id>` | Produkt entfernen |
| `/threshold <id> <eur>` | UVP-Schwelle anpassen |
| `/mute <channel>` | Channel pausieren (drop-alerts/deals/resale) |
| `/unmute <channel>` | Wieder aktivieren |
| `/status` | Health: letzte erfolgreiche Runs pro Shop, Queue-Tiefe |
| `/test` | Testbenachrichtigung |

Nachrichtenformat (Beispiel `drop-alerts`):

```
🚨 NEW LISTING — 30th Celebration Display (DE)
🛒 card-corner.de
💶 159,99 €  (UVP: 159,99 €)
📦 Pre-Order, Lieferung ab 16.09.2026
🔗 https://card-corner.de/...
⏱  vor 4 Sekunden entdeckt
```

---

## 9. Etappen

### Etappe 1 — Foundation & Shopify-Welle  (1 Wochenende)
**Ziel:** End-to-end-Pipeline läuft. Telegram-Push funktioniert. 5 Shops via Shopify-Standard-API überwacht.

- [ ] Projekt-Setup: TS, Prisma, BullMQ, grammy
- [ ] DB-Migration aus dem Datenmodell
- [ ] `watchlist.json` mit allen bekannten 30th-Produkten
- [ ] Generischer Shopify-Adapter
- [ ] Adapter-Instanzen für: card-corner, cardmex, primeprotector, cardsrfun, fantasywelt
- [ ] eBay Browse API (mit Filter: Sofortkauf, EU-Versand, Sealed)
- [ ] Product Matcher (Token-basiert + negativeTerms-Filter)
- [ ] Event Detector mit Status-Diff-Logik
- [ ] Telegram-Bot mit `/start`, `/list`, `/status`
- [ ] Deployment auf Hetzner-VPS
- [ ] Heartbeat-Pings in `#logs` alle 30 min

**Acceptance:** Manueller Test — eines der bereits releaseten Produkte (Pokémon Day 2026 oder First Partner S1) wird in mindestens 3 Shops gefunden und korrekt gemeldet.

### Etappe 2 — Retail-Drops  (1 Wochenende)
**Ziel:** MediaMarkt, Saturn, Kaufland, Müller, Smyths, Thalia. Drop-Day-Modus aktiv.

- [ ] Playwright-Setup mit Stealth-Plugin
- [ ] Adapter pro Retailer mit shopspezifischen Selektoren
- [ ] User-Agent-Rotation, Wartezeiten randomisiert
- [ ] Drop-Day-Scheduler implementieren
- [ ] Cascade-Boost: Bei NEW_LISTING → 30min alle Shops auf Hochfreq.
- [ ] `/threshold` und `/add` Wizard im Bot

**Acceptance:** First Partner Serie 2 am 19.06.2026 wird bei MediaMarkt, Müller oder Saturn in unter 60s erkannt.

### Etappe 3 — Kleinanzeigen-Resale  (mehrere Tage)
**Ziel:** Vorbesteller, die ihre 30th-Anniversary-Slots abgeben, werden erkannt.

- [ ] Playwright-Adapter für kleinanzeigen.de
- [ ] Residential-Proxy-Integration (Bright Data)
- [ ] Standort-Filter: konfigurierbar (Default: ganz DE, alternativ Umkreis NRW)
- [ ] Resale-Schwelle: Preis < UVP × `resaleFactor` (Default 1.0 = nur unter UVP)
- [ ] Separater Channel `#resale` mit eigenem Throttling

**Acceptance:** Mindestens 3 echte Treffer pro Woche in der Test-Phase.

### Etappe 4 — Pre-Drop-Tuning (vor 16.09.2026)
**Ziel:** Sicherstellen, dass am Hauptdrop alles funktioniert.

- [ ] Generalprobe am 19.06.2026 (Serie 2) auswerten — Latenzen, False Positives, Misses
- [ ] Adapter-Selektoren refreshen (Shops ändern HTML)
- [ ] Backup-VPS aufsetzen (zweite Region) für Redundanz
- [ ] Telegram-Bot: Dry-Run-Modus für Drop-Tag testen
- [ ] Watchlist für 30th Celebration final pflegen, alle EANs eintragen sobald bekannt

---

## 10. Risiken & Mitigation

| Risiko | Mitigation |
|---|---|
| Shop-HTML ändert sich → Adapter bricht | Pro Adapter ein Smoke-Test, der mindestens 1 Produkt finden muss. Wenn 0 → Telegram-Alarm in `#logs`. |
| IP-Block bei Kleinanzeigen | Residential Proxy + niedrige Frequenz (alle 5 min reicht für Resale). |
| Cloudflare bei MediaMarkt | Playwright mit Stealth-Plugin + längere Wartezeiten + ggf. Proxy. |
| Falschpositive durch ähnliche Produktnamen | `negativeTerms` pflegen, EAN-Match wo möglich, Confidence-Score. |
| Notification-Flood am Drop-Day | Dedup pro Listing+Event-Typ in 6h-Fenster. Bei >50 Events/min → Aggregation. |
| Pokémon Company ToS / Rechtliches | Nur öffentlich zugängliche Listings, kein Login-Scraping, keine Autobuy-Funktion. Persönlicher Gebrauch. |

---

## 11. Out of Scope (bewusst)

- Web-UI / Dashboard (Telegram-Bot reicht)
- Mobile App (nutzt Telegram)
- Auto-Checkout / Auto-Buy
- Andere TCGs (Magic, Lorcana, One Piece) — wenn später, dann separate Watchlist
- Einzelkarten-Tracking (Cardmarket-API wäre der Weg, anderer Use Case)
- Multi-User-System mit Auth (nur du als User)

---

## 12. Erste Aktion für Claude Code

```
1. Lies diese PLAN.md vollständig.
2. Initialisiere ein TypeScript-Projekt unter /pokemon-30th-watcher mit
   den Dependencies aus Abschnitt 3.
3. Erstelle das Prisma-Schema aus Abschnitt 5 und generiere die erste Migration.
4. Erstelle config/watchlist.json mit allen Produkten aus Abschnitt 2.
5. Implementiere src/adapters/ShopAdapter.ts und den generischen
   shopify-generic.ts Adapter aus Abschnitt 6.
6. Stoppe und zeige mir den Stand, bevor du mit den konkreten Shop-Adaptern
   weitermachst — ich will die Shopify-Endpoints einmal manuell verifizieren.
```
