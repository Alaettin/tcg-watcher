// Alle Schwellwerte für die Cardmarket-Signal-Engine zentral hier (cm.md §14
// Regel 1: keine Magic Numbers im Code). Änderungen wirken nach
// recompute_signals, ohne dass CM neu gehittet werden muss.

// Signal L (Lifetime-Positionierung) — cm.md §3 + §2.4
// Kalibriert aus dem 2026-05-26 Dump (n=3715 Sealed): p10=-27.9%, p50=-0.2%,
// p90=+21.4%. `cheap` trifft ~21% des Marktes, `expensive` ~11%.
export const L_BANDS = {
  HISTORICALLY_CHEAP: -0.15,
  SLIGHTLY_BELOW: -0.05,
  SLIGHTLY_ABOVE: 0.05,
  HISTORICALLY_EXPENSIVE: 0.20,
} as const;

// Mindest-`avg`, ab dem L überhaupt berechnet wird (cm.md §3 edge case).
// Unter 1 € sind die Rundungs-Effekte zu groß für sinnvolle Quotienten.
export const L_MIN_AVG = 1.0;

// Signal M (Margin gegen Listing-Floor) — cm.md §3
export const M_BANDS = {
  SUSPICIOUS: 0.60,            // > 0.60 = Outlier-Listing, manuell prüfen
  OPPORTUNITY_MIN: 0.15,       // > 0.15 = potenzielle Gelegenheit
  LOW_TREND_RATIO_FLOOR: 0.4,  // zusätzlich: low > 0.4 * trend für valid opportunity
} as const;

// Δ7 — cm.md §3
export const DELTA7_BANDS = {
  STRONG_UP: 0.10,
  UP: 0.03,
  DOWN: -0.03,
  STRONG_DOWN: -0.10,
} as const;

// Δ30 — gedämpfter, langfristig (cm.md §3)
export const DELTA30_BANDS = {
  STRONG_UP: 0.15,
  UP: 0.05,
  DOWN: -0.05,
  STRONG_DOWN: -0.15,
} as const;

// Sample-Quality-Gewichte (cm.md §5)
export const SAMPLE_QUALITY = {
  TREND_ONLY: 0.5,        // trend vorhanden, kein avg
  HAS_AVG: 0.2,           // avg zusätzlich
  RECENT_STABLE: 0.2,     // ≥3 Snapshots in letzten 7 Tagen UND Range < 30 %
  LONG_HISTORY: 0.1,      // ≥10 Snapshots verfügbar
} as const;

export const RECENT_STABLE_MIN_SNAPSHOTS = 3;
export const RECENT_STABLE_MAX_RANGE_PCT = 0.30;
export const LONG_HISTORY_MIN_SNAPSHOTS = 10;

// "Set-Median weicht > X % von Produkt-L ab" → Set-Kontext-Zeile generieren
export const SET_CONTEXT_DEVIATION_THRESHOLD = 0.03;

// Sprach-Pendant nur erwähnen, wenn Preis-Differenz > 15 % (cm.md §4)
export const LANGUAGE_PENDANT_DEVIATION_THRESHOLD = 0.15;
