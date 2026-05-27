// Shared helpers für alle Cardmarket-Signal-Komponenten.
// Formatter + Ampel-Klassen-Mapping zentral, nicht in jeder Component dupliziert.

import type { CmMovementClass, CmRecommendation } from "./types";

export function formatEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function formatPct(v: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string {
  if (v == null) return "—";
  const digits = opts.digits ?? 1;
  const sign = opts.sign !== false && v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(digits)}%`;
}

export function arrowForDelta(v: number | null | undefined, longTerm = false): "↑↑" | "↑" | "→" | "↓" | "↓↓" {
  if (v == null) return "→";
  const strong = longTerm ? 0.15 : 0.10;
  const weak = longTerm ? 0.05 : 0.03;
  if (v >= strong) return "↑↑";
  if (v >= weak) return "↑";
  if (v > -weak) return "→";
  if (v > -strong) return "↓";
  return "↓↓";
}

export function recommendationColor(rec: CmRecommendation): string {
  switch (rec) {
    case "GREEN":
      return "var(--cm-green)";
    case "AMBER":
      return "var(--cm-amber)";
    case "RED":
      return "var(--cm-red)";
    default:
      return "rgb(100 116 139)"; // slate-500
  }
}

export function recommendationSoftBg(rec: CmRecommendation): string {
  switch (rec) {
    case "GREEN":
      return "var(--cm-green-soft)";
    case "AMBER":
      return "var(--cm-amber-soft)";
    case "RED":
      return "var(--cm-red-soft)";
    default:
      return "transparent";
  }
}

/**
 * Diverging Heatmap-Farbe für eine Set-Median-Δ7. Linear mapped:
 *   -0.10 (= -10% in 7 Tagen) → satter Rot-Ton
 *    0     → neutrales Grau
 *   +0.10 → satter Grün-Ton
 * Werte außerhalb werden geclamped. Null → Slate (kein Signal).
 */
export function heatmapColor(delta7: number | null): { bg: string; text: string } {
  if (delta7 == null) return { bg: "rgb(148 163 184)", text: "rgb(15 23 42)" }; // slate-400
  const clamped = Math.max(-0.10, Math.min(0.10, delta7));
  const t = (clamped + 0.10) / 0.20; // 0..1
  // RGB-Interpolation: rot (220, 60, 60) → grau (220, 220, 220) → grün (50, 170, 100).
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const u = t * 2; // 0..1 from rot → grau
    r = 220;
    g = Math.round(60 + (220 - 60) * u);
    b = Math.round(60 + (220 - 60) * u);
  } else {
    const u = (t - 0.5) * 2; // 0..1 from grau → grün
    r = Math.round(220 + (50 - 220) * u);
    g = Math.round(220 + (170 - 220) * u);
    b = Math.round(220 + (100 - 220) * u);
  }
  // Kontrast: helle Mittelfelder kriegen dunklen Text, satte Ränder hellen.
  const isMid = Math.abs(t - 0.5) < 0.25;
  return {
    bg: `rgb(${r} ${g} ${b})`,
    text: isMid ? "rgb(15 23 42)" : "rgb(255 255 255)",
  };
}

export const MOVEMENT_LABEL_DE: Record<CmMovementClass, string> = {
  accelerating: "beschleunigt",
  stable_uptrend: "stabiler Aufwärtstrend",
  stagnating_peak: "Hochpunkt stagniert",
  correction_in_uptrend: "Korrektur in Aufwärtstrend",
  turning_up: "kehrt nach oben",
  sideways: "seitwärts",
  turning_down: "kehrt nach unten",
  bounce_in_downtrend: "Bounce in Abwärtstrend",
  bottoming: "Bodenbildung",
  stable_downtrend: "stabiler Abwärtstrend",
  capitulation: "Kapitulation",
  unknown: "keine Daten",
};
