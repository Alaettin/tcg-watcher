export type Arrow = "UP_STRONG" | "UP" | "FLAT" | "DOWN" | "DOWN_STRONG";

// 11 Klassifikationen aus cm.md §3 (Beschleunigung-Tabelle) + `unknown`
// Fallback für Sealed an Tag 0-6 ohne Snapshot-Historie.
export type MovementClass =
  | "accelerating"            // Δ30↑   Δ7↑↑  — Aufwärts-Momentum, FOMO-Falle möglich
  | "stable_uptrend"          // Δ30↑   Δ7↑   — sicherster Buy-Kontext
  | "stagnating_peak"         // Δ30↑   Δ7→   — Peak möglich, vorsichtig
  | "correction_in_uptrend"   // Δ30↑   Δ7↓   — klassisches Buy-the-Dip
  | "turning_up"              // Δ30→   Δ7↑   — frühes Aufwärts-Signal
  | "sideways"                // Δ30→   Δ7→   — kein Handlungsbedarf
  | "turning_down"            // Δ30→   Δ7↓   — frühes Abwärts-Signal
  | "bounce_in_downtrend"     // Δ30↓   Δ7↑   — meist falscher Hoffnungsfunke
  | "bottoming"               // Δ30↓   Δ7→   — abwarten, kann Buy werden
  | "stable_downtrend"        // Δ30↓   Δ7↓   — warten oder verkaufen
  | "capitulation"            // Δ30↓↓  Δ7↓   — warten auf Bodenbildung
  | "unknown";                // zu wenig Daten

export type Recommendation = "GREEN" | "AMBER" | "RED" | "NEUTRAL";

export interface SignalInput {
  /** Aktueller fairer Preis (CardmarketPrice.trend) */
  trend: number | null;
  /** Lifetime-Durchschnitt aller verkauften Einheiten (CardmarketPrice.avg) */
  avg: number | null;
  /** Niedrigstes aktives Listing (CardmarketPrice.low, condition-agnostisch) */
  low: number | null;
  /** CM-eigene Recency-Werte (Singles befüllt, Sealed null) */
  avg1?: number | null;
  avg7?: number | null;
  avg30?: number | null;
  /** Aus CardmarketPriceSnapshot ≤ 7 Tage alt — null wenn Historie zu jung */
  trend7dAgo: number | null;
  /** Aus CardmarketPriceSnapshot ≤ 30 Tage alt */
  trend30dAgo: number | null;
  /** Anzahl Snapshots gesamt für dieses Produkt */
  snapshotCount: number;
  /** (max-min)/median der trend-Werte der letzten 7 Tage. null wenn < 2 Snapshots */
  snapshotRangePct: number | null;
}

export interface SignalOutput {
  lScore: number | null;
  mScore: number | null;
  delta7: number | null;
  delta30: number | null;
  movementClass: MovementClass;
  recommendation: Recommendation;
  headline: string;
  /** Boolean-Flag aus M > 0.60-Regel, treibt Outlier-Warnung im Reasoning */
  suspicious: boolean;
  reasoningLines: string[];
  sampleQuality: number;
}

/**
 * Optionaler Set-Kontext aus CardmarketSetSignalDaily. Wird in den
 * Reasoning-Templates als zusätzliche Zeile verarbeitet.
 */
export interface SetContext {
  idExpansion: number;
  expansionName?: string | null;
  productCount: number;
  medianL: number | null;
  medianDelta7: number | null;
  volatilityDelta7: number | null;
}
