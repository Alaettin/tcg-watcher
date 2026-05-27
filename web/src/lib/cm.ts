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
