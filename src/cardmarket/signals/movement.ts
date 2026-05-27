import { DELTA30_BANDS, DELTA7_BANDS } from "./constants.js";
import type { Arrow, MovementClass } from "./types.js";

interface DeltaBands {
  STRONG_UP: number;
  UP: number;
  DOWN: number;
  STRONG_DOWN: number;
}

/**
 * Klassifiziert ein Δ in 5 Stufen. Null wird zu FLAT, damit Sealed-Produkte
 * mit fehlender Historie nicht aus der Movement-Matrix herausfallen.
 */
function arrowFromDelta(delta: number | null, bands: DeltaBands): Arrow {
  if (delta == null) return "FLAT";
  if (delta >= bands.STRONG_UP) return "UP_STRONG";
  if (delta >= bands.UP) return "UP";
  if (delta > bands.DOWN) return "FLAT";
  if (delta > bands.STRONG_DOWN) return "DOWN";
  return "DOWN_STRONG";
}

// cm.md §3 Beschleunigung-Tabelle, 1:1 abgebildet. Key = "Δ30|Δ7".
// Δ30 wird vor dem Lookup auf 3 Stufen kollabiert (UP_STRONG/UP → UP), damit
// der Δ30-Pfeil das langfristige Vorzeichen beschreibt, der Δ7-Pfeil die
// Recency-Beschleunigung. `capitulation` ist die einzige Zelle die Δ30↓↓
// braucht, alle anderen Down-Zellen sind Δ30↓.
const MOVEMENT_MATRIX: Record<string, MovementClass> = {
  "UP|UP_STRONG":          "accelerating",
  "UP|UP":                 "stable_uptrend",
  "UP|FLAT":               "stagnating_peak",
  "UP|DOWN":               "correction_in_uptrend",
  "UP|DOWN_STRONG":        "correction_in_uptrend",
  "FLAT|UP_STRONG":        "turning_up",
  "FLAT|UP":               "turning_up",
  "FLAT|FLAT":             "sideways",
  "FLAT|DOWN":             "turning_down",
  "FLAT|DOWN_STRONG":      "turning_down",
  "DOWN|UP_STRONG":        "bounce_in_downtrend",
  "DOWN|UP":               "bounce_in_downtrend",
  "DOWN|FLAT":             "bottoming",
  "DOWN|DOWN":             "stable_downtrend",
  "DOWN|DOWN_STRONG":      "stable_downtrend",
  "DOWN_STRONG|DOWN":      "capitulation",
  "DOWN_STRONG|DOWN_STRONG": "capitulation",
  "DOWN_STRONG|FLAT":      "stable_downtrend",
  "DOWN_STRONG|UP":        "bounce_in_downtrend",
  "DOWN_STRONG|UP_STRONG": "bounce_in_downtrend",
};

/**
 * Δ7 + Δ30 → MovementClass nach cm.md §3.
 * Wenn beide null sind → `unknown` (Sealed Tag 0, kein Proxy verfügbar).
 */
export function classifyMovement(
  delta7: number | null,
  delta30: number | null,
): MovementClass {
  if (delta7 == null && delta30 == null) return "unknown";

  const a30Raw = arrowFromDelta(delta30, DELTA30_BANDS);
  const a7 = arrowFromDelta(delta7, DELTA7_BANDS);

  // Δ30 auf 3 Hauptstufen kollabieren — außer DOWN_STRONG, das nur für
  // `capitulation` relevant ist (cm.md §3 Tabelle).
  const a30 = a30Raw === "UP_STRONG" ? "UP" : a30Raw;

  return MOVEMENT_MATRIX[`${a30}|${a7}`] ?? "sideways";
}

/**
 * Hilfsfunktion für UI: Pfeil-Symbol zu MovementClass.
 * (Wird in den Reasoning-Templates und im Frontend genutzt.)
 */
export function arrowForDelta(delta: number | null, longTerm: boolean): "↑↑" | "↑" | "→" | "↓" | "↓↓" {
  const bands = longTerm ? DELTA30_BANDS : DELTA7_BANDS;
  const a = arrowFromDelta(delta, bands);
  switch (a) {
    case "UP_STRONG":   return "↑↑";
    case "UP":          return "↑";
    case "FLAT":        return "→";
    case "DOWN":        return "↓";
    case "DOWN_STRONG": return "↓↓";
  }
}
