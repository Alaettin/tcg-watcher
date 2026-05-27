import { Link } from "react-router-dom";
import clsx from "clsx";
import { SignalBadge } from "./SignalBadge";
import { arrowForDelta, formatEur, formatPct, recommendationColor } from "../lib/cm";
import type { CardmarketSignalSummary } from "../lib/types";

interface Props {
  row: CardmarketSignalSummary;
  compact?: boolean;
}

/**
 * Kompakte Zeile für Movers / Watchlist / Dashboard-Listen.
 * Mobile: gestapelt mit Ampel + Name + Preis-Block. Desktop: einzeilig.
 */
export function MoverRow({ row, compact }: Props) {
  const { product, price, recommendation, delta7, lScore, mScore, sampleQuality } = row;
  const arrow7 = arrowForDelta(delta7, false);
  const lowQuality = sampleQuality < 0.5;

  return (
    <Link
      to={`/cardmarket/p/${product.idProduct}`}
      className={clsx(
        "flex items-center gap-3 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40",
        compact ? "py-2" : "py-3",
        lowQuality && "opacity-70",
      )}
    >
      <SignalBadge recommendation={recommendation} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{product.name}</div>
        <div className="text-[11px] text-slate-500 truncate">{product.categoryName}</div>
      </div>
      <div className="shrink-0 text-right text-xs tabular-nums">
        <div className="font-medium text-sm">{formatEur(price.trend)}</div>
        <div className="flex items-center gap-2 justify-end mt-0.5">
          <span
            style={{
              color:
                delta7 == null || Math.abs(delta7) < 0.03
                  ? "rgb(100 116 139)"
                  : delta7 > 0
                  ? "var(--cm-green)"
                  : "var(--cm-red)",
            }}
          >
            {formatPct(delta7)} {arrow7}
          </span>
        </div>
      </div>
      <div className="hidden sm:flex shrink-0 flex-col text-right text-[11px] tabular-nums text-slate-500 w-16">
        <span>L {formatPct(lScore)}</span>
        <span>M {formatPct(mScore, { sign: false })}</span>
      </div>
      {lowQuality && (
        <span
          className="hidden md:inline text-[10px] text-slate-400 italic shrink-0"
          title={`Quality ${sampleQuality.toFixed(2)} — dünne Datenbasis`}
        >
          dünne Daten
        </span>
      )}
    </Link>
  );
}

/** Kachelvariante für Dashboard-Highlights — größer, mit Headline. */
export function HighlightCard({
  title,
  row,
}: {
  title: string;
  row: CardmarketSignalSummary | null;
}) {
  if (!row) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-4 text-center text-xs text-slate-400">
        {title}
        <div className="mt-2">Noch keine Daten</div>
      </div>
    );
  }
  const arrow = arrowForDelta(row.delta7, false);
  return (
    <Link
      to={`/cardmarket/p/${row.product.idProduct}`}
      className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hover:shadow-sm transition"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{title}</span>
        <SignalBadge recommendation={row.recommendation} size="sm" />
      </div>
      <div className="font-medium text-sm line-clamp-2 leading-snug min-h-[2.5em]">{row.product.name}</div>
      <div className="flex items-end justify-between mt-2">
        <span className="font-semibold tabular-nums">{formatEur(row.price.trend)}</span>
        <span
          className="text-sm tabular-nums"
          style={{ color: recommendationColor(row.recommendation) }}
        >
          {formatPct(row.delta7)} {arrow}
        </span>
      </div>
    </Link>
  );
}
