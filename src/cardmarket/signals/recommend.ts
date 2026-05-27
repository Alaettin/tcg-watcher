import { L_BANDS, M_BANDS } from "./constants.js";
import type { MovementClass, Recommendation } from "./types.js";

export interface RecommendationVerdict {
  recommendation: Recommendation;
  headline: string;
  /** M > 0.60 — Outlier-Warnung in Reasoning anhängen */
  suspicious: boolean;
}

/**
 * Ampel-Regelwerk aus cm.md §4. Erste passende Regel gewinnt.
 *
 * Vorrang: M > 0.60 (verdächtig) wird vor anderen Regeln geprüft, weil das
 * Outlier-Listing alle anderen Signale verfälschen kann. Bei `suspicious=true`
 * darf trotzdem GREEN/AMBER/RED kommen — die Listing-Warnung ist nur eine
 * Reasoning-Zeile, kein Override.
 */
export function recommend(
  l: number | null,
  m: number | null,
  movement: MovementClass,
): RecommendationVerdict {
  const suspicious = m != null && m > M_BANDS.SUSPICIOUS;

  // Cascade-Reihenfolge wie in cm.md §4 dokumentiert.

  if (
    l != null &&
    l < L_BANDS.HISTORICALLY_CHEAP &&
    (movement === "bottoming" ||
      movement === "turning_up" ||
      movement === "correction_in_uptrend")
  ) {
    return { recommendation: "GREEN", headline: "Jetzt günstig", suspicious };
  }

  if (
    l != null &&
    l < L_BANDS.SLIGHTLY_BELOW &&
    m != null &&
    m > M_BANDS.OPPORTUNITY_MIN &&
    m <= M_BANDS.SUSPICIOUS
  ) {
    return { recommendation: "GREEN", headline: "Listing-Gelegenheit", suspicious };
  }

  if (
    l != null &&
    l > L_BANDS.HISTORICALLY_EXPENSIVE &&
    (movement === "accelerating" ||
      movement === "stagnating_peak" ||
      movement === "turning_down")
  ) {
    return { recommendation: "RED", headline: "Lokaler Peak", suspicious };
  }

  if (movement === "capitulation" && (l == null || l > L_BANDS.HISTORICALLY_CHEAP)) {
    return { recommendation: "RED", headline: "Fällt weiter", suspicious };
  }

  if (
    movement === "stable_uptrend" &&
    l != null &&
    l >= L_BANDS.SLIGHTLY_BELOW &&
    l <= 0.15
  ) {
    return { recommendation: "AMBER", headline: "Steigt — kein Schnäppchen mehr", suspicious };
  }

  if (movement === "bottoming" && l != null && l < -0.10) {
    return { recommendation: "AMBER", headline: "Beobachten", suspicious };
  }

  if (suspicious) {
    return { recommendation: "AMBER", headline: "Listing prüfen", suspicious };
  }

  return { recommendation: "NEUTRAL", headline: "Marktneutral", suspicious };
}
