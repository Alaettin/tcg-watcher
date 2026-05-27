import clsx from "clsx";
import { arrowForDelta, formatEur, formatPct } from "../lib/cm";

export type SignalCardKind = "L" | "M" | "DELTA7" | "DELTA30";

interface Props {
  kind: SignalCardKind;
  value: number | null;
  /** Begleit-Wert (avg für L, low für M) zur Kontextualisierung. */
  contextValue?: number | null;
  /** Optional: kompakter Modus (z.B. für Listen-Zellen) */
  compact?: boolean;
}

const TITLES: Record<SignalCardKind, string> = {
  L: "L (Lifetime)",
  M: "M (Margin)",
  DELTA7: "Δ7",
  DELTA30: "Δ30",
};

const SUBTITLES: Record<SignalCardKind, string> = {
  L: "vs. lifetime-avg",
  M: "vs. trend",
  DELTA7: "7-Tage-Bewegung",
  DELTA30: "30-Tage-Bewegung",
};

/**
 * Eine der vier Signal-Karten in der 2x2-Anordnung auf dem Produkt-Detail
 * (cm.md §7.6). Color-Coding folgt der Wertelage: negativ-L = grün, etc.
 */
export function SignalCard({ kind, value, contextValue, compact }: Props) {
  const arrow = kind === "DELTA7" ? arrowForDelta(value, false) : kind === "DELTA30" ? arrowForDelta(value, true) : null;

  const color = colorFor(kind, value);

  return (
    <div
      className={clsx(
        "rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900",
        compact ? "p-2" : "p-3",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{TITLES[kind]}</div>
      <div
        className={clsx("font-semibold tabular-nums", compact ? "text-base" : "text-2xl mt-1")}
        style={{ color }}
      >
        {kind === "DELTA7" || kind === "DELTA30"
          ? `${formatPct(value)} ${arrow ?? ""}`
          : formatPct(value)}
      </div>
      <div className={clsx("text-xs text-slate-500", compact ? "" : "mt-1")}>{SUBTITLES[kind]}</div>
      {contextValue != null && (kind === "L" || kind === "M") && (
        <div className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
          {kind === "L" ? "avg" : "low"} {formatEur(contextValue)}
        </div>
      )}
    </div>
  );
}

function colorFor(kind: SignalCardKind, value: number | null): string {
  if (value == null) return "rgb(100 116 139)"; // slate-500

  if (kind === "L") {
    if (value < -0.15) return "var(--cm-green)";
    if (value < -0.05) return "var(--cm-green)";
    if (value > 0.20) return "var(--cm-red)";
    if (value > 0.05) return "var(--cm-amber)";
    return "rgb(100 116 139)";
  }
  if (kind === "M") {
    if (value > 0.60) return "var(--cm-red)";
    if (value > 0.15) return "var(--cm-green)";
    if (value < 0) return "var(--cm-amber)";
    return "rgb(100 116 139)";
  }
  // DELTA7/DELTA30
  if (value > 0.03) return "var(--cm-green)";
  if (value < -0.03) return "var(--cm-red)";
  return "rgb(100 116 139)";
}
