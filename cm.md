# Cardmarket Market-Intelligence Modul (`cm`)

**Eine Funktion der Plattform.** Eigenständiger Bereich, der Cardmarket-Bulk-Daten
in ein smartes Entscheidungs-Cockpit verwandelt. Beantwortet eine Frage:
**„Soll ich jetzt kaufen, warten, oder verkaufen?"**

Stack-agnostisch geschrieben. Stack-spezifische Implementierung (Routes,
ORM-Modelle, Components) entsteht im 2. Schritt aus dieser Spec heraus.

---

## 1 — Was die Funktion ist (und was sie nicht ist)

**Ist:** Ein persönliches Cockpit für **eine Person** (den Plattform-Eigentümer).
Tägliche Markt-Snapshot-Aufnahme von Cardmarket, Aggregation in vier
Kern-Signale, klartext-formulierte Empfehlungen, Watchlist mit Schwellwert-Alerts,
Set-Heatmap, Backtest-Modus.

**Ist nicht:** Live-Sniping (Sync ist 1×/Tag). Multi-User-SaaS. Shop-Listing-
Matcher (kommt später als separate Funktion). Auto-Trader.

**Datenfundament:** zwei tägliche JSON-Dumps von Cardmarket
(`products_nonsingles_6.json`, `price_guide_6.json`), Game-ID 6 = Pokémon.
Vollständige Datenmodell-Referenz in `cm-db.md`.

---

## 2 — Die Datenrealität, die das Design treibt

Bevor irgendein Feature gebaut wird: **diese drei Fakten sind nicht
verhandelbar** und prägen alle Algorithmen unten.

### 2.1 Sealed hat im Dump KEIN Recency-Signal

Die `avg1` / `avg7` / `avg30` Felder sind bei Sealed zu **100% null**. Bei
Singles dagegen nur zu ~17% null. Konsequenz:

- **Singles** haben ab Tag 0 vollwertige 1/7/30-Tage-Bewegungsanalyse
- **Sealed** hat ab Tag 0 nur Lifetime-Vergleich (`trend` vs `avg`). Echte
  Recency-Bewegung entsteht erst mit selbstgebauter Snapshot-Historie:
  Tag 7 = erstes 7d-Δ, Tag 30 = erstes 30d-Δ, Tag 90 = stabile Saisonalität.

Daraus folgt das Architektur-Prinzip: **alle Recency-Signale immer aus der
eigenen `cm_price_snapshot`-Tabelle ableiten** (sowohl Singles als auch
Sealed). Nicht aus CM's avg1/7/30. CM's Werte werden nur **gespeichert**
(für Backfill, Sanity-Check), aber die App rechnet selbst — damit die Logik
konsistent ist, egal ob Single oder Sealed, und damit du nach 60 Tagen
echte 60-Tage-Δs hast die CM gar nicht liefert.

### 2.2 `low` ist unzuverlässig

`low` ist der niedrigste aktive Listing-Preis, **unabhängig von Zustand**.
Ein einzelnes "Played"-Listing kann den low um >50% drücken. Beispiele aus
heutigen Daten: EX Power Keepers Booster Box mit `low €250` vs `trend €7.733`
— das ist kein Schnäppchen, das ist ein defektes Listing oder Falscheinstufung.

Konsequenz: `low` wird **als Signal nur mit Sanity-Guard** verwendet:
`(trend - low) / trend > 0.6` → klassifiziert als "verdächtig", nicht als
"kaufen".

### 2.3 Sets erscheinen mehrfach (Sprache, Edition)

Eine reale Expansion existiert pro Sprache als eigene `idExpansion`. 151 EN,
151 JP, 151 KR sind separate IDs. Die `expansions_6.json` (separate
CM-Datei) hat strukturierte Sprach-Info — dieses Modul lädt sie **einmalig
beim Setup** und cached sie als statisches Mapping. Ohne dieses Mapping
sind Sprach-bezogene Features (z.B. JP-EN-Arbitrage) Heuristik auf
Name-Suffix.

### 2.4 Verteilung der Signale (gemessen, nicht geraten)

Aus dem 2026-05-26-Dump (n = 3.715 Sealed mit avg+trend):

| Quantil | L = trend/avg - 1 |
|---|---|
| p10 | −27.9% (deutlich unter lifetime) |
| p50 | −0.2% (lifetime-fair) |
| p90 | +21.4% (deutlich über lifetime) |

Damit sind die **Default-Schwellwerte für L kalibriert**:
- `L < -0.15` → "historisch günstig" (trifft ~21% des Marktes)
- `L > +0.20` → "historisch teuer" (trifft ~11% des Marktes)

Diese sind als **Konstanten in der Engine konfigurierbar**, damit du sie
nachjustieren kannst, wenn dir die Trefferquote nicht passt.

---

## 3 — Die vier Kern-Signale

Jedes Produkt bekommt täglich vier Signal-Werte berechnet. Diese sind die
**alleinige Wahrheit der App** — alle UI-Elemente, Filter, Alerts, Sortierungen
basieren auf diesen vier.

### Signal L — Lifetime-Positionierung
**Verfügbar:** Tag 0 für alles
**Formel:** `L = trend / avg - 1`
**Bedeutung:** Wie weit weicht der aktuelle faire Preis vom historischen
Durchschnitt aller jemals verkauften Einheiten ab.
**Skala:**
- `L > +0.20` → historisch teuer (rot)
- `L > +0.05` → leicht über lifetime (amber)
- `-0.05 ≤ L ≤ +0.05` → lifetime-fair (grau)
- `L < -0.05` → leicht unter lifetime (hellgrün)
- `L < -0.15` → historisch günstig (grün)
**Edge cases:** `avg == null` oder `< 1.0` → Signal nicht berechenbar,
zeigt "n/a".

### Signal M — Margin gegen Listing-Floor
**Verfügbar:** Tag 0 für alles
**Formel:** `M = (trend - low) / trend`
**Bedeutung:** Wie viel Spielraum hat das aktuell günstigste Listing
gegenüber dem fairen Preis.
**Skala:**
- `M > 0.60` → **verdächtig** (Outlier-Listing wahrscheinlich, rot, manuell prüfen)
- `0.15 < M ≤ 0.60` UND `low > 0.4 × trend` → **Gelegenheit** (grün)
- `0 ≤ M ≤ 0.15` → normal (grau)
- `M < 0` (low > trend, kommt vor) → Listing über fair price (amber, ignorieren)
**Edge cases:** `low == null` → kein aktives Listing, Signal "n/a".

### Signal Δ7 — 7-Tage-Recency-Bewegung
**Verfügbar:** Tag 7+ für Sealed, Tag 0 für Singles (via CM avg7/avg1)
**Sealed-Formel:** `Δ7 = (trend_today - trend_7d_ago) / trend_7d_ago` aus
eigener Snapshot-Tabelle
**Singles-Formel (als Tag-0-Proxy bis eigene Historie steht):** `Δ7 ≈ (avg1 - avg7) / avg7`
**Bedeutung:** Aktuelle Wochen-Bewegung.
**Skala:**
- `Δ7 > +0.10` → stark steigend (grün-pfeil-hoch)
- `+0.03 < Δ7 ≤ +0.10` → steigend
- `-0.03 ≤ Δ7 ≤ +0.03` → seitwärts
- `-0.10 ≤ Δ7 < -0.03` → fallend
- `Δ7 < -0.10` → stark fallend (rot-pfeil-runter)

### Signal Δ30 — 30-Tage-Recency-Bewegung
**Verfügbar:** Tag 30+ für Sealed, Tag 0 für Singles (via CM avg30)
**Sealed-Formel:** `Δ30 = (trend_today - trend_30d_ago) / trend_30d_ago`
**Singles-Formel:** `Δ30 ≈ (avg1 - avg30) / avg30` als Proxy
**Skala:** Wie Δ7, aber Schwellwerte +/− 0.05 / 0.15 (langfristig dämpft).

### Abgeleitetes Signal "Beschleunigung" (kein eigenes Feld, nur Klassifikation)
Aus der Kombination Δ7 × Δ30 ergibt sich der **Bewegungs-Charakter**, der die
UI-Labels treibt:

| Δ30 | Δ7 | Klassifikation | Empfehlung-Hinweis |
|---|---|---|---|
| ↑ | ↑↑ | **beschleunigt** | Aufwärts-Momentum, FOMO-Falle möglich |
| ↑ | ↑ | **stabiler Aufwärtstrend** | sicherster Buy-Kontext |
| ↑ | → | **stagnierender Hochpunkt** | Peak möglich, vorsichtig |
| ↑ | ↓ | **Korrektur in Aufwärtstrend** | klassisches Buy-the-Dip |
| → | ↑ | **kehrt nach oben** | frühes Aufwärts-Signal |
| → | → | **seitwärts** | kein Handlungsbedarf |
| → | ↓ | **kehrt nach unten** | frühes Abwärts-Signal |
| ↓ | ↑ | **Bounce in Abwärtstrend** | meist falscher Hoffnungsfunke |
| ↓ | → | **Bodenbildung** | abwarten, kann Buy werden |
| ↓ | ↓ | **stabiler Abwärtstrend** | warten oder verkaufen |
| ↓↓ | ↓ | **Kapitulation** | warten auf Bodenbildung |

Diese Tabelle ist die Grundlage der Klartext-Empfehlungen in der UI.

---

## 4 — Die Empfehlungs-Engine

Die App **gibt keine Note** und keinen Score von 0–100. Statt dessen liefert
sie **drei strukturierte Ausgaben pro Produkt**:

1. **Ampel** (grün / amber / rot / grau-neutral)
2. **Headline** (max 5 Wörter Klartext: "Jetzt günstig", "Lokaler Peak", "Boden in Sicht", "Warten")
3. **Reasoning** (3–4 Aufzählungspunkte mit den konkreten Werten)

### Ampel-Regeln (kombiniert aus L, M, Bewegung)

```
Wenn (L < -0.15) UND Bewegung in {Bodenbildung, kehrt nach oben, Korrektur in Aufwärtstrend}:
  → GRÜN, Headline "Jetzt günstig"

Wenn (L < -0.05) UND M ∈ Gelegenheit:
  → GRÜN, Headline "Listing-Gelegenheit"

Wenn (L > +0.20) UND Bewegung in {beschleunigt, stagnierender Hochpunkt, kehrt nach unten}:
  → ROT, Headline "Lokaler Peak"

Wenn Bewegung == Kapitulation UND L > -0.15:
  → ROT, Headline "Fällt weiter"

Wenn Bewegung == stabiler Aufwärtstrend UND -0.05 ≤ L ≤ +0.15:
  → AMBER, Headline "Steigt — kein Schnäppchen mehr"

Wenn Bewegung == Bodenbildung UND L < -0.10:
  → AMBER, Headline "Beobachten"

Wenn M > 0.60:
  → AMBER, Headline "Listing prüfen" + Outlier-Warnung

Default:
  → GRAU, Headline "Marktneutral"
```

### Reasoning-Generator (deterministisch, kein LLM)

Für jeden Punkt im Reasoning eine Vorlage, in die die konkreten Werte eingesetzt
werden. Beispiel-Output:

```
🟢 Jetzt günstig — 151 Elite Trainer Box (EN)
• trend €68 liegt 17% unter lifetime-avg €82
• low €54 ist 21% unter trend — solides Listing-Fenster
• Δ7 +2%, Δ30 −4%: Korrektur in Aufwärtstrend
• Set-Median: dieses Set liegt 3% über lifetime, ETB ist relativ günstig
```

Die Wortwahl variiert leicht je nach Headline, damit's nicht roboterhaft wirkt.
Templates liegen als Strings in einem `reasoning_templates`-Objekt, zentral
editierbar.

### Sprach-Hinweis

Wenn das Produkt eine andere Sprachvariante hat, die mehr als 15% vom
aktuellen Produkt abweicht: zusätzliche Zeile im Reasoning:
`• JP-Pendant trendet €54 (-21% vs EN)` — als Inspiration, nicht als
direkter Buy.

---

## 5 — Datenbank-Schema

Tabellen-Definitionen sind generisch SQL-ish geschrieben, übersetzen sich auf
jedes ORM (Prisma, TypeORM, Drizzle, Django Models, …).

### `cm_product` — Spiegel von `products_nonsingles_6.json`
```
id_product           BIGINT PRIMARY KEY      -- entspricht CM idProduct
name                 TEXT NOT NULL
id_category          INT NOT NULL
category_name        TEXT NOT NULL
id_expansion         INT NOT NULL
expansion_name       TEXT                    -- aus expansions_6.json, nullable
language             TEXT                    -- aus expansions_6.json oder name-heuristik
date_added           TIMESTAMP NOT NULL
first_seen_at        TIMESTAMP NOT NULL DEFAULT now()
last_synced_at       TIMESTAMP NOT NULL

INDEX (id_expansion)
INDEX (id_category)
INDEX (name) -- für fuzzy-suche im UI
```

Bei jedem Sync: upsert nach `id_product`. Neue IDs landen mit
`first_seen_at = now()` → das ist die App-eigene "neu auf CM"-Metrik
(realistischer als `date_added`, das von CM gerne als 2007-01-01 gesetzt
wird).

### `cm_price_snapshot` — täglicher Append-Only Schnappschuss
```
id                   BIGSERIAL PRIMARY KEY
id_product           BIGINT NOT NULL FK
snapshot_date        DATE NOT NULL
low                  NUMERIC(10,2)
avg                  NUMERIC(10,2)
trend                NUMERIC(10,2)
avg1                 NUMERIC(10,2)            -- nur Singles befüllt
avg7                 NUMERIC(10,2)
avg30                NUMERIC(10,2)
created_at           TIMESTAMP NOT NULL DEFAULT now()

UNIQUE (id_product, snapshot_date)
INDEX (snapshot_date)
INDEX (id_product, snapshot_date DESC)
```

**Append-Only.** Nie überschreiben, nie löschen — das ist die selbstgebaute
Historie und der eigentliche Moat. Bei Disk-Sorgen nach 2 Jahren: aggregierte
Wochen-Snapshots für Daten > 1 Jahr behalten.

### `cm_signal` — vorberechnete Signale pro Produkt pro Tag
```
id_product           BIGINT NOT NULL FK
snapshot_date        DATE NOT NULL
l_score              NUMERIC(6,4)             -- Signal L
m_score              NUMERIC(6,4)             -- Signal M
delta_7              NUMERIC(6,4)             -- nullable (vor Tag 7 / Tag 0 ohne avg)
delta_30             NUMERIC(6,4)             -- nullable
movement_class       TEXT                     -- "beschleunigt", "stabiler_aufwärtstrend", ...
recommendation       TEXT                     -- "GREEN" | "AMBER" | "RED" | "NEUTRAL"
headline             TEXT                     -- "Jetzt günstig" etc.
reasoning_lines      JSONB                    -- array of strings
sample_quality       NUMERIC(3,2)             -- 0..1 (siehe unten)

PRIMARY KEY (id_product, snapshot_date)
INDEX (snapshot_date, recommendation)
INDEX (id_product, snapshot_date DESC)
```

Wird im täglichen Sync **nach** dem Snapshot-Insert berechnet, in einem
separaten Job-Step. So bleibt die Signal-Berechnung idempotent und kann
neu gerechnet werden ohne CM erneut zu hitten (z.B. wenn Schwellwerte
geändert werden).

### `cm_expansion` — Set-Mapping (statisches Lookup)
```
id_expansion         INT PRIMARY KEY
name                 TEXT NOT NULL
language             TEXT NOT NULL            -- "EN", "JP", "DE", "FR", "IT", "KR", "ZH", "PT"
release_date         DATE                     -- nullable, wenn von CM gepflegt
parent_expansion_id  INT                      -- FK auf sich selbst — links 151 JP -> 151 EN
INDEX (parent_expansion_id)
```

**Einmal-Setup:** `expansions_6.json` von CM einlesen, händisch oder per
Embedding-Match die Sprach-Geschwister-Beziehung (`parent_expansion_id`)
auflösen. Z.B.: 151 EN = canonical (parent=null), 151 JP und 151 KR
verweisen darauf. Damit funktioniert "Sprach-Pendant"-Feature.

### `cm_watchlist_item` — deine persönliche Watchlist
```
id                   BIGSERIAL PRIMARY KEY
id_product           BIGINT NOT NULL FK
note                 TEXT
added_at             TIMESTAMP NOT NULL DEFAULT now()
alert_below_trend    NUMERIC(10,2)            -- "warn if trend < X"
alert_above_trend    NUMERIC(10,2)            -- "warn if trend > Y"
alert_on_signal_flip BOOLEAN DEFAULT false    -- "warn wenn Empfehlung von rot/grau auf grün wechselt"
last_alert_sent_at   TIMESTAMP
```

Bewusst keine `user_id` — die Funktion ist single-user (du). Wenn die
Plattform schon Multi-User ist, einfach `user_id` ergänzen.

### `cm_sample_quality` — wie verlässlich ist das Signal?
Statt eigener Tabelle: Berechnung läuft in `cm_signal.sample_quality` mit ein.
Score 0..1:

```
sample_quality =
    0.5  wenn nur trend vorhanden, aber kein avg
  + 0.2  wenn avg vorhanden
  + 0.2  wenn ≥3 Snapshots in letzten 7 Tagen UND trend-Range < 30% des trend-Median
  + 0.1  wenn ≥10 Snapshots verfügbar (≥10 Tage Historie)
```

Niedriger Quality-Score → in UI gedimmt, Headlines mit "(dünne Daten)" suffix.

---

## 6 — Sync-Pipeline

Genau **ein Cron-Job, einmal pro Tag**, läuft 04:30 lokale Zeit (nach CM's
02:48-Regeneration + Puffer). Atomar und idempotent.

```
Step 1: download_products()
  GET https://downloads.s3.cardmarket.com/productCatalog/products_nonsingles_6.json
  → tmp-file, validate (size > 800kb, version == 1)

Step 2: download_prices()
  GET https://downloads.s3.cardmarket.com/productCatalog/price_guide_6.json
  → tmp-file, validate

Step 3: upsert_products()
  Für jedes Produkt: upsert nach id_product, set last_synced_at.
  Produkte die im Dump fehlen, aber in DB sind, behalten — werden nur
  nicht mehr aktualisiert (gelöschte CM-Listings passieren selten).

Step 4: insert_snapshots(today)
  Bulk-insert in cm_price_snapshot. Auf konflikt (gleicher tag) → skip.
  (Damit ist der Job re-runnable im Notfall.)

Step 5: compute_signals(today)
  Für jedes Produkt im Snapshot:
    - L, M aus heutigem Snapshot
    - Δ7 aus heutigem trend - Snapshot vor 7 Tagen (oder CM-avg7-Proxy für Singles)
    - Δ30 entsprechend
    - movement_class aus Δ7/Δ30 Tabelle
    - Ampel + Headline + Reasoning aus Regelwerk
    - sample_quality
  → bulk-insert in cm_signal.

Step 6: trigger_watchlist_alerts()
  Für jedes watchlist_item:
    - aktueller trend vs alert_below/above
    - signal-flip seit letztem run? (vergleich gestriger vs heutiger recommendation)
  → push an alert-channel (push-notification oder telegram je nach config)

Step 7: write_sync_log()
  Tabelle cm_sync_log(id, started_at, finished_at, products_count,
  snapshots_count, signals_count, alerts_sent, status, error_msg).
  → für UI-Anzeige "letzter Sync vor X Stunden, Status OK".
```

Bei Fehler in Step 1/2: alle weiteren Steps abbrechen, log "failed",
gestrige Daten bleiben gültig. Bei Fehler in Step 5: Snapshot ist drin,
Signale können nachgerechnet werden via Admin-Button.

---

## 7 — UI-Architektur (mobile-first)

**Mobile First weil die App genauso gut auf dem Handy benutzbar sein muss
wie auf dem Desktop.** Snapshot-Daten reviewen im Bett ist ein realer
Use Case. Layout-Breakpoints: 360px (Phone) → 768px (Tablet) → 1024px+ (Desktop).

### 7.1 Navigation — fünf Screens

```
[ Dashboard ]  [ Movers ]  [ Watchlist ]  [ Sets ]  [ Produkt ]
```

Mobile: Bottom-Tab-Bar mit 4 Icons + Suche. Desktop: linke Sidebar.
**Kein Hamburger-Menü** — alles direkt erreichbar. Produkt-Screen wird per
Navigation/Tap geöffnet, nicht als Tab.

### 7.2 Screen 1 — Dashboard (Startseite)

Die "öffne die App morgens"-Ansicht. Klar strukturiert, jeder Block
beantwortet eine Frage.

**Block 1: Marktstimmung** (oben, voll-Breite)
- Eine einzelne Zahl: "Breitenindex" = `% aller Produkte mit Δ7 > 0`
- Klein darunter: Vergleich zu vor 7 Tagen ("+4pp")
- Kleine Sparkline: Breitenindex der letzten 30 Tage
- Wenn Index > 60% → "Markt steigt breit", < 40% → "Markt fällt breit", sonst → "gemischt"

**Block 2: Tageshighlights** (3 Karten nebeneinander auf Desktop, gestapelt auf Mobile)
- "Stärkster Aufstieg heute" → Produkt mit max(Δ7) wo sample_quality ≥ 0.5
- "Stärkster Fall heute" → Produkt mit min(Δ7) wo sample_quality ≥ 0.5
- "Größte Listing-Gelegenheit" → Produkt mit max(M) wo M ≤ 0.6 und sample_quality ≥ 0.5

Jede Karte: Produktname (1 Zeile, wenn länger truncate), trend€, Δ7%-Pfeil,
"View →" Tap-Target.

**Block 3: Watchlist-Vorschau**
Top 5 watchlist items sortiert nach absoluter Signal-Veränderung seit gestern.
Wenn leer: "Du hast noch keine Watchlist. Tipp: Tap auf das ★ bei einem
Produkt um es hinzuzufügen."

**Block 4: Set-Heatmap-Miniatur**
Ein 12×8-Grid (oder responsive Grid) wo jede Zelle ein Set ist, eingefärbt
nach Set-Median-Δ7. Tap auf Zelle → Set-Detail. Auf Mobile: scroll-bar
horizontal, 6 Reihen, scrollbar.

**Block 5: Letzter Sync**
Footer-Zeile: "Letzter Sync: vor 6h 23min · 4.840 Produkte · alles OK"
+ Manuell-Sync-Button (führt Step 1–7 außerplanmäßig aus, nur in Dev/Admin).

### 7.3 Screen 2 — Movers

Tabellen-Ansicht aller Produkte mit Filter. Wichtigster Bedien-Screen.

**Toolbar** (sticky-top auf scroll):
- **Tab-Switch:** [ Top Risers ] [ Top Fallers ] [ Listing-Deals ] [ Volatile ]
- **Filter-Dropdown:** Category (ETB, Booster, Display, Tin, etc.), Sprache, Preisbereich
- **Suchfeld** (filtert Produktnamen client-side)

**Liste:**
Jede Zeile: Ampel-Punkt (8px) · Name · trend€ · Δ7% (mit Pfeil) · L% · M%
Tap auf Zeile → Produkt-Detail. Long-Press auf Mobile → "Zur Watchlist hinzufügen"-Sheet.

**Sortierung:** der gewählte Tab bestimmt die Default-Sortierung. Spalten-Header
sind klickbar zum Re-Sortieren.

**Pagination:** Infinite scroll, Batch-Size 50.

### 7.4 Screen 3 — Watchlist

Dein persönlicher Fokus-Bereich.

**Header:**
- Anzahl Items
- "Heute insgesamt: +€X / -€X (Bewegung seit gestern)" — basiert auf
  trend-Δ pro Item
- Add-Button (öffnet Suchfeld)

**Liste:**
Wie Movers, aber zusätzlich rechts ein **Alert-Status-Icon**:
- 🔔 = aktive Alert-Schwelle gesetzt
- 🚨 = Alert getriggert seit letztem Sync
- ★ = nur beobachten

Swipe-Aktionen (Mobile):
- Swipe rechts → Markieren als "gelesen" (entfernt 🚨)
- Swipe links → Alert-Schwellen editieren (Bottom-Sheet)
- Long-Press → von Watchlist entfernen (mit confirm)

### 7.5 Screen 4 — Sets

Set-Übersicht. Treibt Strategie-Entscheidungen ("welches Sammler-Ökosystem
ist gerade heiß?").

**Layout:**
- **Heatmap-Hero** oben: alle Sets als farbcodierte Tiles (Größe ∝ Anzahl
  Produkte, Farbe = Set-Median-Δ7). Auf Mobile 2-spaltig vertikal scrollend.
- **Sortier-Tabs:** [ Heißeste ] [ Kälteste ] [ Volatilste ] [ Neueste ]
- **Set-Liste:** Name · Sprache · Anzahl Produkte · Median-L · Median-Δ7 · Volatilität (σ)

**Set-Detail (durch Tap):**
- Header: Name, Sprache, Release-Datum, Anzahl Produkte
- Aggregat-Chart: Set-Median-trend über Zeit (Linie, je länger die Historie
  desto schöner)
- Aufgeklappte Produkt-Liste, sortierbar nach Δ7

### 7.6 Screen 5 — Produkt-Detail

Das wichtigste Bedienelement der App. Mobile-First voll durchdacht.

**Above-the-fold (was ohne Scrollen sichtbar ist):**

```
←  ★                                  ⋮
[Bild-Platzhalter, falls keine Bilder verfügbar:
 großes Set-Logo + Category-Icon, farbig nach Ampel]

151 Elite Trainer Box (EN)
Pokémon Elite Trainer Boxes · 151 EN

🟢  Jetzt günstig

€68.00 trend                    (low €54)
                                          ↓21%
```

**Unten — Vier Signal-Karten** (2×2 Grid auf Mobile, 4×1 auf Desktop):

```
┌─ L (Lifetime) ──┐  ┌─ M (Margin) ────┐
│ −17%            │  │ +21%            │
│ unter lifetime  │  │ unter trend     │
│ avg €82         │  │ low €54         │
└─────────────────┘  └─────────────────┘
┌─ Δ7 ────────────┐  ┌─ Δ30 ───────────┐
│ +2.1% ↑         │  │ −4.3% ↓         │
│ steigend        │  │ Korrektur       │
└─────────────────┘  └─────────────────┘
```

Jede Karte tappbar → Bottom-Sheet mit Erklärung des Signals + Historie-Mini-Chart.

**Reasoning-Block:**
```
Warum diese Empfehlung
• trend €68 liegt 17% unter lifetime-avg €82
• low €54 ist 21% unter trend — solides Listing-Fenster
• Δ7 +2%, Δ30 −4%: Korrektur in Aufwärtstrend
• Set-Median: 151 EN liegt 3% über lifetime, ETB ist relativ günstig
```

**Trend-Chart (zentrales Element):**
- Liniendiagramm mit täglichen `trend`-Punkten
- 3 Zeitbereiche-Tabs: 7d · 30d · 90d · all
- Overlay-Optionen: `low`-Linie (gestrichelt), `avg`-Linie (horizontal),
  Bands für ±L-Schwellen
- Mobile: pinch-to-zoom, drag für Range-Selektion
- Bei wenig Historie (< 7 Tage): zeigt "Historie wächst — wir sammeln deine
  Daten täglich. Tag 7 freigeschaltet: Δ7. Tag 30: Δ30."

**Sprach-Pendants:**
Wenn das Produkt ein `parent_expansion_id`-Geschwister hat:
```
Sprach-Pendants
• 151 ETB JP  →  €54  (-21%)
• 151 ETB KR  →  €71  (+4%)
```
Tap → öffnet das jeweilige Produkt.

**Set-Kontext:**
```
Im Set "151 EN" (36 Produkte)
• Set-Median L: +3% — leicht über lifetime
• Set-Median Δ7: +0.8% — schwach steigend
• Dieses Produkt ist im Set: relativ günstig (P25)
```

**Watchlist-Aktion:**
Großer Button unten: [ ★ Zur Watchlist + Alert ]
Bei Tap: Bottom-Sheet mit:
- Alert wenn trend unter ___€
- Alert wenn trend über ___€
- Alert bei Empfehlungs-Wechsel (Toggle)
- Notizfeld (optional)

**Externer Link:**
[ Auf Cardmarket öffnen ↗ ] (öffnet `https://www.cardmarket.com/en/Pokemon/Products/Singles/{id_product}`
bzw. /Booster/, dynamisch je nach Kategorie)

### 7.7 Globale UI-Prinzipien

**Farb-Schema (Ampel):**
- Grün: Buy-Signal — `#1D9E75` (Light) / `#5DCAA5` (Dark)
- Amber: Vorsicht — `#BA7517` (Light) / `#EF9F27` (Dark)
- Rot: Sell/Warten — `#A32D2D` (Light) / `#E24B4A` (Dark)
- Grau: Neutral — Theme-default
- Hellgrün/hellrot für schwache Signale

**Typografie:**
- Hauptschrift: System-Sans
- Zahlen-Anzeigen (Preise, %): tabular-nums, monospace-feel ohne Mono-Font
- Hierarchie: 22px headlines, 16px body, 13px labels, 11px hints

**Mobile-Gesten (durchgängig):**
- Tap: navigieren
- Long-press: Kontext-Menü (Watchlist, Vergleich, Externes Link kopieren)
- Swipe (in Listen): schnelle Aktionen
- Pull-to-refresh auf Dashboard, Movers, Watchlist: triggert "show me what's new since last sync" Dialog, nicht den Cron-Sync selbst

**Empty States:**
Jeder Empty State erklärt **warum** leer und **wie befüllen**. Niemals nur
"keine Daten".

**Loading States:**
Skelett-UI, niemals Spinner-Mitte-Screen. Daten kommen meist schnell aus DB,
nur Charts können laden.

**Dark Mode:**
Komplette Unterstützung. Alle Farben über Theme-Variablen. Charts adaptieren
auf Hintergrund.

---

## 8 — Visualisierungs-Bibliothek

Charts sind **das** Differenzierungs-Element. Cheap-Charts ruinieren die App.

**Empfohlene Library:** Recharts (React-Stack), Chart.js (vanilla), oder
ECharts (am mächtigsten). Bei React mit shadcn/ui → Recharts. Bei Performance-
Wunsch bei großen Heatmaps → ECharts.

**Verwendete Chart-Typen:**

1. **Sparkline** — kompakte Mini-Linie ohne Achsen, im Dashboard für
   Marktstimmung. Höhe 24-32px.
2. **Line-Chart mit Range** — Produkt-Trend mit avg-Linie und L-Bands.
   Tooltip on hover/tap zeigt Datum + trend + low.
3. **Heatmap-Grid** — Sets-Übersicht. Tile-Größe proportional zu Anzahl
   Produkte, Farb-Encoding linear von Δ7-Min zu Δ7-Max via diverging
   colormap (Rot–Weiß–Grün).
4. **Stacked-Bar** (für Set-Detail) — Verteilung der Ampel-Klassifikationen
   im Set (wieviele Produkte grün/amber/rot).
5. **Kerze-light** (optional, Phase 4) — für Produkte mit ≥30 Tagen Historie:
   Wochenkerzen mit min/max/open/close des trend.

**Animation:**
Subtil. Fade-ins bei Tab-Wechsel (200ms), Stagger bei Listen-Erscheinen (50ms
pro Item bis Item 10, dann instant). **Keine** Bounce-Animations, **keine**
schwingenden Indikatoren — das ist ein professionelles Tool.

---

## 9 — Smartphone-Optimierungen

Mobile ist **first-class**, nicht responsive-add-on. Konkrete Regeln:

- **Tap-Targets:** alles ≥ 44×44pt. Listen-Zeilen ≥ 56px hoch.
- **Daumen-Reichweiten-Zone:** primäre Aktionen (Add-to-Watchlist, Filter
  öffnen) immer im unteren Drittel des Screens. Header ist statisch oder
  scroll-away, Bottom-Bar bleibt.
- **Schriftgrößen:** mindestens 14px Body auf Mobile. Tabellen verzichten
  bei < 400px Viewport-Breite auf weniger wichtige Spalten (M, Sprache
  collapsen in 2. Zeile).
- **Charts:** Touch-Interaktionen explizit gedacht. Lange Touch → Tooltip
  bleibt, kurzer Touch → Tap.
- **Offline-Toleranz:** Last-fetched-data ist in IndexedDB / LocalStorage
  gecacht. Bei Verbindungsverlust zeigt App letzten Stand mit Banner
  "offline, Stand 2h alt".
- **Installation als PWA:** Web-App-Manifest, Service-Worker, Add-to-
  Homescreen-Prompt nach 3. Visit.

---

## 10 — Klangloses Detail: Backtest & "Wäre ich"

Premium-Feature, freischalten ab Tag 30+ Historie.

**Use Case:** "Hätte ich vor 30 Tagen alle ETBs gekauft, die damals
GRÜN waren — wie hätte sich mein Portfolio entwickelt?"

**Implementierung:**
- Selector-UI: Zeitraum, Filter (Kategorie, Sprache, Empfehlung-Klasse)
- Engine läuft über `cm_signal`-Tabelle: nimm alle Produkte am Start-Datum
  mit `recommendation = "GREEN"`, "kaufe" je 1 Einheit zum `trend` von damals,
  "verkaufe" am End-Datum zum aktuellen `trend`.
- Ergebnis: Win-Rate, Avg-ROI, beste 5 Trades, schlechteste 5 Trades.
- Disclaimer: "Backtest ignoriert Fees, Versand, Verfügbarkeit. Realistisches
  Setup zieht ~10% ab."

**Strategie-Vergleich:**
Drei vordefinierte Strategien gleichzeitig backtesten:
- "Nur GREEN-Signale" (aggressive)
- "GREEN + sample_quality ≥ 0.8" (konservativ)
- "Buy-the-Dip" (nur Korrektur-in-Aufwärtstrend)
→ Tabelle nebeneinander, welche Strategie zu deinem Geschmack passt.

---

## 11 — Alerts & Push

Drei Alert-Mechanismen, alle zentral verwaltet:

1. **Schwellwert-Alerts** (in `cm_watchlist_item`): `alert_below_trend` /
   `alert_above_trend`. Trigger im Sync-Step 6.
2. **Signal-Flip-Alerts:** wenn ein Watchlist-Item gestern AMBER war und
   heute GREEN ist → Alert.
3. **Markt-Alerts (global):** wenn Breitenindex > 70% oder < 30%, wenn ein
   Set > 15% Median-Δ7 macht → optionale Push.

**Kanäle:**
- Push-Notification (PWA via Web-Push API, kostet nichts)
- Telegram-Bot (optional, ein Self-Hosted-Bot, ~150 Zeilen Code)
- E-Mail-Digest morgens (optional, Resend o.ä.)

**Anti-Spam:**
- Max 1 Alert pro Watchlist-Item pro 24h
- "Bündel-Mode": morgens nach Sync ein einziger Alert "Du hast 3 neue
  Signale" → öffnet App auf Watchlist-Screen mit gehighlighteten Items

---

## 12 — Roadmap in Phasen

Klare Reihenfolge, jeder Phase eigenständig nutzbar.

**Phase 1 — Foundation (2 Tage)**
- DB-Schema anlegen
- Sync-Cronjob (Step 1-4 + 7)
- Erstes Signal: nur L und M berechnen (Singles & Sealed)
- Basis-Dashboard mit "Listing-Gelegenheiten" und "Historisch günstig"-Listen
- Produkt-Detail-Screen ohne Charts (nur Signal-Karten + Reasoning)

→ **Tag 2 Mehrwert:** schon konkrete Buy-Vorschläge anhand L+M.

**Phase 2 — Intelligence (2 Tage)**
- Step 5: vollständige Signal-Engine mit movement_class und Ampel-Regelwerk
- Empfehlungs-Generator mit Reasoning-Templates
- Set-Kontext-Berechnung (Set-Median, Set-Volatilität)
- Movers-Screen
- Charts (Recharts) auf Produkt-Detail

→ **Tag 4 Mehrwert:** echte Klartext-Empfehlungen, Set-Übersicht.

**Phase 3 — Watchlist + Mobile-Polish (1-2 Tage)**
- Watchlist-Modell + UI
- Schwellwert-Alerts (Step 6)
- Mobile-Gesten (swipe, long-press, pull-to-refresh)
- PWA-Setup, Add-to-Homescreen, Service-Worker, Web-Push

→ **Tag 6 Mehrwert:** App "merkt sich" deine Favoriten und meldet sich.

**Phase 4 — Set-Tiefe + Heatmap (1 Tag)**
- Set-Detail-Screen mit aggregierten Charts
- Heatmap-Komponente
- Sprach-Pendant-Verknüpfung via `expansions_6.json`

→ **Tag 7 Mehrwert:** Strategie-Sicht aufs Meta.

**Phase 5 — Backtest + Voll-Polish (1-2 Tage)**
- Backtest-Engine + UI
- E-Mail-Digest (optional)
- Telegram-Bot (optional)
- Performance-Audit (Lazy-Loading, Virtual-Scrolling für lange Listen)

→ **Tag 9 Mehrwert:** Vertrauen ins Signal durch Historisierung.

**Gesamt: ~9 Werktage** für eine ausgereifte, smarte, mobile-first
Market-Intelligence-Funktion.

---

## 13 — Was diese cm.md absichtlich NICHT spezifiziert

- **Konkrete Routen/Endpoints** — Stack-spezifisch, im Implementierungs-Schritt
- **ORM-Code** — wird aus Schema-Tabellen oben 1:1 übersetzt
- **CSS/Components** — folgt UI-Architektur aus §7, aber konkrete Klassen
  in Tailwind/Style-System der Plattform
- **Auth/User-Management** — single-user; wenn nötig nachträglich `user_id`
  auf `cm_watchlist_item`
- **Shop-Listing-Matching** — eigene Funktion, später
- **Multi-Game-Support** (Magic, YuGiOh, Lorcana) — bewusst Pokémon-only,
  Game-ID 6 hardcoded; Erweiterung ist ein Schalter im Sync-Job

---

## 14 — Schlussregeln für die Implementierung

1. **Alle Schwellwerte sind Konstanten in einer einzigen `constants.ts` /
   `constants.py` Datei.** Niemand soll im Code-Review jemals "magic numbers"
   suchen müssen.
2. **Signal-Funktionen sind pure functions.** Input: ein paar Zahlen.
   Output: ein Signal. Damit unit-testbar ohne DB.
3. **Sync-Job loggt jeden Schritt** in `cm_sync_log`. Bei Problemen ist
   sofort sichtbar wo's hakt.
4. **Reasoning-Texte sind nicht in der DB**, sondern werden bei jedem Render
   neu zusammengesetzt aus `cm_signal.reasoning_lines` (JSONB-Array von
   String-Tokens). So sind Sprache-Updates ohne Daten-Migration möglich.
5. **Die App ist eine View auf die Daten, nicht der Speicher.** Wenn die DB
   weg ist, regeneriert ein neuer Sync alles bis auf die Historie. Watchlist
   und Snapshots sind die einzigen "wertvollen" Daten.
6. **Niemals Live-CM-Calls aus dem UI.** Alles geht über die eigene DB.
   Externe Links zu cardmarket.com sind ok, aber kein API-Aufruf zur Laufzeit.
