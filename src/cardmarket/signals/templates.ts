import {
  LANGUAGE_PENDANT_DEVIATION_THRESHOLD,
  SET_CONTEXT_DEVIATION_THRESHOLD,
} from "./constants.js";
import { arrowForDelta } from "./movement.js";
import type {
  MovementClass,
  Recommendation,
  SetContext,
  SignalInput,
  SignalOutput,
} from "./types.js";

const MOVEMENT_DE: Record<MovementClass, string> = {
  accelerating: "beschleunigtes Wachstum",
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
  unknown: "noch keine Recency-Daten",
};

function fmtEur(value: number | null | undefined): string {
  if (value == null) return "n/a";
  return `€${value.toFixed(2)}`;
}

function fmtPct(value: number | null | undefined, withSign = true): string {
  if (value == null) return "n/a";
  const sign = withSign ? (value >= 0 ? "+" : "") : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function fmtPctAbs(value: number | null | undefined): string {
  if (value == null) return "n/a";
  return `${Math.abs(value * 100).toFixed(0)}%`;
}

export interface ReasoningInput {
  input: SignalInput;
  signal: Pick<
    SignalOutput,
    "lScore" | "mScore" | "delta7" | "delta30" | "movementClass" | "recommendation" | "headline" | "suspicious"
  >;
  setContext?: SetContext | null;
  /** Optional: bestes Sprach-Geschwister (höchste Preisabweichung), für JP/KR-Pendant-Hinweis */
  languagePendant?: { language: string; trend: number; deviation: number } | null;
}

/**
 * Deterministisch zusammengesetzte 3-4 Bullet-Lines pro Produkt (cm.md §4).
 * Wortwahl variiert leicht je nach Empfehlung — nicht jedes Produkt mit gleicher
 * Empfehlung soll wortgleich lesen.
 */
export function buildReasoning(args: ReasoningInput): string[] {
  const { input, signal, setContext, languagePendant } = args;
  const lines: string[] = [];

  // Zeile 1 — fokussiert auf den dominanten Treiber der Headline.
  lines.push(buildPrimaryLine(args));

  // Zeile 2 — Listing-Floor-Kommentar (M).
  const lineM = buildMLine(input, signal);
  if (lineM) lines.push(lineM);

  // Zeile 3 — Bewegungs-Charakterisierung.
  lines.push(buildMovementLine(input, signal));

  // Zeile 4 — Set-Kontext (optional, nur wenn signifikant abweichend).
  if (setContext) {
    const setLine = buildSetContextLine(signal, setContext);
    if (setLine) lines.push(setLine);
  }

  // Zeile 5 — Sprach-Pendant (optional).
  if (languagePendant) {
    lines.push(buildLanguagePendantLine(languagePendant));
  }

  // Outlier-Warnung als zusätzliche Zeile bei jedem suspicious-Fall. Auch wenn
  // die Headline bereits "Listing prüfen" lautet, hilft die konkrete %-Zahl im
  // Reasoning beim manuellen Sichten der Listings.
  if (signal.suspicious) {
    lines.push(
      `low €${(input.low ?? 0).toFixed(2)} ist ${fmtPctAbs(signal.mScore)} unter trend — möglicherweise defektes Listing, manuell prüfen`,
    );
  }

  return lines;
}

function buildPrimaryLine(args: ReasoningInput): string {
  const { input, signal } = args;
  const headline: Recommendation = signal.recommendation;

  if (signal.lScore != null && input.avg != null && input.trend != null) {
    const direction = signal.lScore < 0 ? "unter" : "über";
    const accent =
      headline === "GREEN"
        ? "liegt"
        : headline === "RED"
        ? "thront bei"
        : "steht bei";
    return `trend ${fmtEur(input.trend)} ${accent} ${fmtPctAbs(signal.lScore)} ${direction} lifetime-avg ${fmtEur(input.avg)}`;
  }

  if (input.trend != null) {
    return `trend ${fmtEur(input.trend)} (kein historischer avg verfügbar)`;
  }
  return "Aktuell kein trend verfügbar — Signal eingeschränkt";
}

function buildMLine(input: SignalInput, signal: ReasoningInput["signal"]): string | null {
  if (signal.mScore == null || input.low == null || input.trend == null) return null;

  if (signal.suspicious) {
    // Outlier-Warnung wird durch die End-Zeile abgehandelt
    return null;
  }
  if (signal.mScore > 0.15) {
    return `low ${fmtEur(input.low)} ist ${fmtPctAbs(signal.mScore)} unter trend — solides Listing-Fenster`;
  }
  if (signal.mScore < 0) {
    return `low ${fmtEur(input.low)} liegt ${fmtPctAbs(signal.mScore)} über trend — kein günstiges Listing`;
  }
  return `low ${fmtEur(input.low)} liegt nahe trend (${fmtPct(signal.mScore)})`;
}

function buildMovementLine(input: SignalInput, signal: ReasoningInput["signal"]): string {
  const a7 = arrowForDelta(signal.delta7, false);
  const a30 = arrowForDelta(signal.delta30, true);
  const klass = MOVEMENT_DE[signal.movementClass];
  return `Δ7 ${fmtPct(signal.delta7)} ${a7}, Δ30 ${fmtPct(signal.delta30)} ${a30}: ${klass}`;
}

function buildSetContextLine(signal: ReasoningInput["signal"], setContext: SetContext): string | null {
  const medianL = setContext.medianL;
  if (medianL == null) return null;
  const setName = setContext.expansionName ?? `Set ${setContext.idExpansion}`;

  if (signal.lScore != null) {
    const diff = signal.lScore - medianL;
    if (Math.abs(diff) < SET_CONTEXT_DEVIATION_THRESHOLD) {
      // Produkt liegt auf Set-Median — keine extra Info wert.
      return `Set-Median: ${setName} liegt ${fmtPct(medianL)} über lifetime`;
    }
    const where =
      diff < 0 ? "relativ günstig" : "relativ teuer";
    return `Set-Median: ${setName} liegt ${fmtPct(medianL)} über lifetime, dieses Produkt ist ${where}`;
  }
  return `Set-Median: ${setName} liegt ${fmtPct(medianL)} über lifetime`;
}

function buildLanguagePendantLine(p: { language: string; trend: number; deviation: number }): string {
  if (Math.abs(p.deviation) < LANGUAGE_PENDANT_DEVIATION_THRESHOLD) {
    return `${p.language}-Pendant trendet ${fmtEur(p.trend)} (${fmtPct(p.deviation)} vs. dieses Produkt)`;
  }
  return `${p.language}-Pendant trendet ${fmtEur(p.trend)} (${fmtPct(p.deviation)} vs. dieses Produkt) — Inspiration`;
}
