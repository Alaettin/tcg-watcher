import { Link } from "react-router-dom";
import { formatPct, heatmapColor } from "../lib/cm";
import type { CardmarketSetSummary } from "../lib/types";

interface Props {
  sets: CardmarketSetSummary[];
  emptyHint?: string;
}

/**
 * Uniform-Grid-Heatmap (cm.md §7.5). Eine Kachel pro Set, eingefärbt nach
 * Median-Δ7. Mobile 2-3 Spalten, Desktop bis 8. Kein D3, nur CSS-grid.
 */
export function SetHeatmap({ sets, emptyHint }: Props) {
  if (sets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
        {emptyHint ?? "Keine Sets im aktuellen Filter."}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
      {sets.map((s) => {
        const { bg, text } = heatmapColor(s.medianDelta7);
        return (
          <Link
            key={s.idExpansion}
            to={`/cardmarket/sets/${s.idExpansion}`}
            className="rounded p-2 min-h-[3.5rem] flex flex-col justify-between text-[10px] hover:ring-2 ring-slate-900 dark:ring-slate-100 transition"
            style={{ backgroundColor: bg, color: text }}
            title={`${s.name} · ${s.productCount} Produkte · Median-Δ7 ${formatPct(s.medianDelta7)}`}
          >
            <span className="font-medium leading-tight line-clamp-2">{s.name}</span>
            <span className="flex items-center justify-between tabular-nums opacity-90">
              <span>{s.productCount}</span>
              <span>{formatPct(s.medianDelta7)}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Horizontaler Stacked-Bar mit der Ampel-Verteilung in einem Set.
 * (cm.md §8 #4 — vereinfachte Version ohne Chart-Lib.)
 */
export function AmpelDistributionBar({
  distribution,
  showLabels = true,
}: {
  distribution: { GREEN: number; AMBER: number; RED: number; NEUTRAL: number };
  showLabels?: boolean;
}) {
  const total =
    distribution.GREEN + distribution.AMBER + distribution.RED + distribution.NEUTRAL;
  if (total === 0) {
    return <div className="text-xs text-slate-500">Keine Signale.</div>;
  }
  const pct = (n: number) => (n / total) * 100;
  const segs: Array<{ count: number; color: string; label: string }> = [
    { count: distribution.GREEN, color: "var(--cm-green)", label: "GREEN" },
    { count: distribution.AMBER, color: "var(--cm-amber)", label: "AMBER" },
    { count: distribution.RED, color: "var(--cm-red)", label: "RED" },
    { count: distribution.NEUTRAL, color: "rgb(148 163 184)", label: "NEUTRAL" },
  ];
  return (
    <div>
      <div className="h-2 flex rounded overflow-hidden bg-slate-100 dark:bg-slate-800">
        {segs.map((s) =>
          s.count === 0 ? null : (
            <div
              key={s.label}
              style={{ width: `${pct(s.count)}%`, backgroundColor: s.color }}
              title={`${s.label}: ${s.count} (${pct(s.count).toFixed(0)}%)`}
            />
          ),
        )}
      </div>
      {showLabels && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
          {segs.map((s) =>
            s.count === 0 ? null : (
              <span key={s.label} className="inline-flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded" style={{ backgroundColor: s.color }} />
                {s.label} {s.count}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
