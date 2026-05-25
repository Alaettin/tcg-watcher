# TCG-Watcher

Self-hosted Pokémon-TCG Deal- und Restock-Monitor. Überwacht ~20 deutsche und EU-Shops auf neue **sealed-Listings** (Display, ETB, Premium-Kollektion, Tin, Blister, Bundle) für die Karmesin-&-Purpur-Ära und das 30th-Anniversary-Sortiment. Pusht Events in Sekunden auf dein Handy via [ntfy.sh](https://ntfy.sh).

> **Persönlicher Gebrauch.** Kein Autobuy, kein Login-Scraping, nur öffentlich zugängliche Listings. Nutzt jede Shop-API/-Suche mit niedrigen Frequenzen und Stealth-Browser dort wo nötig. Du bist verantwortlich für die Einhaltung der ToS der Shops, die du beobachtest.

## Was kann es

- **Multi-Shop-Polling** alle 60s–10min (pro Adapter konfigurierbares Mindest-Intervall)
- **Set-basierte Watchlist** mit Toggle pro Set + Preset-Katalog für alle Karmesin-&-Purpur-Sets (SV1 → SV11.x) + 30th Anniversary
- **Variant-Detection** im Listing-Titel (Display/ETB/Booster/Premium/Tin/Blister/Bundle)
- **Event-Typen:** NEW_LISTING, RESTOCK, PRICE_DROP, WENT_OUT_OF_STOCK
- **Multi-Channel-Push** via ntfy.sh — beliebig viele Topics, alle bekommen alle Events
- **Live-Dashboard** mit aktuell-laufenden Shop-Jobs, letzten Run-Stats, Online/Stale-Health-Indicator
- **Cascade-Boost:** bei NEW_LISTING/RESTOCK fahren alle Shops für 10 Min auf Hochfrequenz
- **Drop-Day-Mode:** an offiziellen Release-Daten (16.09.2026 etc.) automatisch Hochfrequenz
- **Täglicher Heartbeat-Push** um 09:00 MESZ
- **Web-Controls:** Pause/Resume Scheduler, Reset DB, Heartbeat-Trigger, Playwright-Browser-Restart

## Architektur

```
┌───────────────────────────────────────────────────────────────┐
│  Node Process (npm run start)                                  │
│                                                                │
│  ┌─────────────┐   ┌─────────────┐   ┌────────────────────┐  │
│  │ BullMQ      │   │ Web Server  │   │ Notification Sink  │  │
│  │ Scheduler   │──→│ Express +   │   │ ntfy.sh +          │  │
│  │ + Workers   │   │ React UI    │   │ Logfile + SSE      │  │
│  └──────┬──────┘   └─────────────┘   └────────▲───────────┘  │
│         │                                       │              │
│         ▼                                       │              │
│  ┌─────────────────────────────────────────────┴───────────┐  │
│  │ Shop Adapters (Plugin-System pro Shop-Typ)              │  │
│  │  • Shopify   • JTL       • Shopware    • OXID           │  │
│  │  • Otto      • Galaxus   • Thalia      • MediaMarkt     │  │
│  │  • Wix       • Alternate • Toys-for-Fun                  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│         ┌─────────────────┐  ┌────────────────┐               │
│         │ Postgres        │  │ Redis (BullMQ) │               │
│         │ Set/Variant/    │  │                │               │
│         │ Listing/Event   │  │                │               │
│         └─────────────────┘  └────────────────┘               │
└───────────────────────────────────────────────────────────────┘
```

Quellcode-Layout (`src/`):

| Modul | Aufgabe |
|---|---|
| `adapters/` | Pro Shop-System ein Adapter, alle implementieren `ShopAdapter.search()` |
| `matcher/setMatcher.ts` | Token+Jaccard-Match Listing → Set + Kind-Keyword-Variant-Detection |
| `detector/eventDetector.ts` | Listing-State-Diff → NEW_LISTING/RESTOCK/PRICE_DROP/WENT_OUT_OF_STOCK |
| `scheduler/` | BullMQ-Queue + Drop-Day-Modus + Cascade-Boost + Adapter-Min-Intervals |
| `worker/runShop.ts` | adapter → match → detect → persist → notify Pipeline |
| `notify/` | ntfy-Multi-Channel, Heartbeat, In-Memory EventBus für SSE |
| `web/` | Express + Basic Auth + REST/SSE-Routes + serviert React-Bundle |
| `seed/` | Sets-Preset-Katalog, Shop-Seed, Default-Settings |
| `lib/` | Prisma-Client, Logger, Settings-Store |

Frontend (`web/`): Vite + React 18 + Tailwind + TanStack Query, mobile-tauglich, Live-Updates via Server-Sent Events.

## Setup

**Voraussetzungen:** Node.js ≥22, Docker (für Postgres + Redis), Windows oder Linux.

```bash
git clone https://github.com/Alaettin/TCG-Watcher.git
cd TCG-Watcher
cp .env.example .env
# .env: WEB_PASSWORD setzen (alles andere optional)

# Container starten
docker compose up -d

# Backend + Frontend Dependencies
npm install
npm --prefix web install

# DB-Migrationen
npx prisma migrate deploy
```

**Start (Windows):**
```bash
start.bat
```

**Start (manuell):**
```bash
npm run build       # baut Server + React-Frontend
npm run start       # Scheduler + WebApp auf :3000
```

Browser → http://localhost:3000 → Login mit `admin` / `<WEB_PASSWORD aus .env>`

## Erstkonfiguration im UI

1. **Settings → Push Channels** → "Channel hinzufügen" → Name eintippen → Topic-Generator klicken → "Test" drücken → ntfy-App empfängt Test-Push → Speichern
2. **Settings → Globale Negative-Terms** anschauen, ggf. Distraktoren ergänzen ("Tasse", "Schlüsselanhänger", etc.)
3. **Sets-Tab** → die Sets aktivieren die du tracken willst (z.B. "KP11 Mega Evolution Optimale Ordnung", "30th Anniversary"). Sets sind initial alle aus
4. **Shops-Tab** → ggf. Polling-Intervalle anpassen oder einzelne Shops deaktivieren
5. **Dashboard** → live mitschauen, Pause/Reset-Buttons im Notfall

## Implementierte Adapter

| Adapter | Tech | Shops |
|---|---|---|
| Shopify-Generic | HTTP `/search/suggest.json` | primeprotector, cardsrfun, deckshop, godofcards, opasladen, cardcosmos, tcgviert |
| JTL-Generic | HTTP + cheerio Schema.org-Microdata | card-corner, gate-to-the-games |
| Shopware-Generic | HTTP `/suggest` + cheerio | cardmex-shop, jk-entertainment |
| MediaMarkt-Stack | Playwright + Stealth | mediamarkt, saturn |
| Otto | HTTP + cheerio + JSON-LD | otto |
| Thalia | Playwright + Cookie-Accept | thalia |
| Galaxus | Playwright + Stealth | galaxus |
| Wix | Playwright + Cookie-Accept | pokesynek, zuris-shop |
| OXID | Playwright + Cloudflare-Bypass | trader-online |
| Alternate | Playwright Category-Page | alternate |
| Toys-for-Fun (Magento) | Playwright Brand-Page | toys-for-fun |

**Eigene Shops ergänzen:** neuen Adapter in `src/adapters/<name>.ts` implementieren (`ShopAdapter`-Interface), in `src/adapters/registry.ts` registrieren, im UI unter Shops → "Neuer Shop" anlegen.

## Production-Deploy

`Dockerfile` + `docker-compose.prod.yml` für Linux-VPS sind enthalten. Siehe Setup-Section im README — alles was du brauchst ist `cp .env.prod.example .env`, Passwörter setzen, `docker compose -f docker-compose.prod.yml up -d --build`. Port 3000 exponiert die WebApp (gerne hinter nginx/Caddy + TLS stellen).

## Erweitern

- **Neuer Adapter:** Interface `ShopAdapter` aus `src/adapters/ShopAdapter.ts` implementieren, in `registry.ts` einhängen
- **Neues Setting:** Key in `src/lib/settings.ts` ergänzen, Validator in `src/web/routes/settings.ts`
- **Neue Event-Logik:** `src/detector/eventDetector.ts`
- **Set-Preset:** `config/set-presets.json` ergänzen — wird beim nächsten Start nur geseeded wenn ID neu ist (kein Overwrite)

## Stack

Node 22 · TypeScript · Prisma 5 + Postgres 16 · BullMQ + Redis 7 · Express 5 · Playwright + Playwright-Extra + Stealth · Pino · Vite + React 18 + Tailwind + TanStack Query · ntfy.sh

## Disclaimer

- **Persönlicher Gebrauch.** Beachte die Terms of Service jedes Shops, den du beobachtest. Manche Shops blockieren Scraping ausdrücklich.
- **Kein Autobuy.** Bewusst nicht implementiert — rechtlich grau, gegen ToS, und nicht das Ziel dieses Projekts.
- **Keine Gewährleistung.** Drop-Listings können von Shops gelöscht werden oder eine kürzere Reaktionszeit haben als der nächste Poll. Es gibt keine Garantie dass du einen Drop "fängst".

## Lizenz

MIT — siehe [LICENSE](LICENSE).
