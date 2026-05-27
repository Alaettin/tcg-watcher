import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, TrendingUp, TrendingDown, Tag, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { HighlightCard, MoverRow } from "../components/MoverRow";
import { Sparkline } from "../components/Sparkline";
import type { CardmarketDashboardResponse } from "../lib/types";

function formatRelativeFromIso(iso: string | null | undefined): string {
  if (!iso) return "nie";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return `vor ${min}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h}h ${min % 60}min`;
  const d = Math.round(h / 24);
  return `vor ${d}d`;
}

function moodLabel(breadth: number | null): { label: string; color: string } {
  if (breadth == null) return { label: "Markt unbestimmt", color: "rgb(100 116 139)" };
  if (breadth > 60) return { label: "Markt steigt breit", color: "var(--cm-green)" };
  if (breadth < 40) return { label: "Markt fällt breit", color: "var(--cm-red)" };
  return { label: "gemischt", color: "var(--cm-amber)" };
}

export function CmDashboardPage() {
  const qc = useQueryClient();

  const dashboard = useQuery({
    queryKey: ["cm-dashboard"],
    queryFn: () => api.get<CardmarketDashboardResponse>("/api/cardmarket/dashboard"),
    refetchInterval: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean; jobId: string }>("/api/admin/cardmarket/sync"),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ["cm-dashboard"] }), 5_000);
    },
  });

  const data = dashboard.data;
  const breadth = data?.breadthIndex ?? null;
  const breadth7d = data?.breadthIndex7dAgo ?? null;
  const breadthDiff =
    breadth != null && breadth7d != null ? Math.round((breadth - breadth7d) * 10) / 10 : null;
  const mood = moodLabel(breadth);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Cardmarket</h1>
          <div className="text-xs text-slate-500 mt-0.5">
            Stand {data?.snapshotDate ?? "—"} ·{" "}
            <Link to="/cardmarket/movers" className="hover:underline">
              Movers ansehen
            </Link>{" "}
            ·{" "}
            <Link to="/cardmarket/products" className="hover:underline">
              alle Produkte
            </Link>
          </div>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncMutation.isPending ? "animate-spin" : ""} />
          Sync
        </button>
      </div>

      {/* Block 1: Marktstimmung */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wide text-slate-500">Marktstimmung</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-4xl font-semibold tabular-nums" style={{ color: mood.color }}>
                {breadth == null ? "—" : `${breadth}%`}
              </span>
              <span className="text-sm" style={{ color: mood.color }}>
                {mood.label}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Anteil Produkte mit Δ7&gt;0
              {breadthDiff != null && (
                <>
                  {" · "}
                  <span style={{ color: breadthDiff >= 0 ? "var(--cm-green)" : "var(--cm-red)" }}>
                    {breadthDiff >= 0 ? "+" : ""}
                    {breadthDiff}pp vs. vor 7 Tagen
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="w-32 sm:w-48 shrink-0">
            <Sparkline
              data={(data?.breadthIndexSparkline ?? []).map((p) => ({
                date: p.date,
                value: p.breadthIndex,
              }))}
              color={mood.color}
            />
          </div>
        </div>
      </section>

      {/* Block 2: Tageshighlights */}
      <section>
        <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">Tageshighlights</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <HighlightCard title="Stärkster Aufstieg" row={data?.highlights.topRiser ?? null} />
          <HighlightCard title="Stärkster Fall" row={data?.highlights.topFaller ?? null} />
          <HighlightCard title="Größte Listing-Gelegenheit" row={data?.highlights.biggestDeal ?? null} />
        </div>
      </section>

      {/* Block 3: Top-GREEN-Liste (ersetzt Watchlist in Phase 1+2) */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Heutige Top-GREEN-Signale
          </h2>
          <Link
            to="/cardmarket/movers"
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 inline-flex items-center gap-1"
          >
            alle <ChevronRight size={12} />
          </Link>
        </div>
        <div className="space-y-1.5">
          {(data?.topGreen ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
              Noch keine GREEN-Signale für heute. Komm nach dem nächsten Sync wieder.
            </div>
          ) : (
            data?.topGreen.map((row) => <MoverRow key={row.product.idProduct} row={row} compact />)
          )}
        </div>
      </section>

      {/* Block 4: Quick-Nav Tiles */}
      <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <QuickNav to="/cardmarket/movers?tab=risers" icon={TrendingUp} label="Top Risers" />
        <QuickNav to="/cardmarket/movers?tab=fallers" icon={TrendingDown} label="Top Fallers" />
        <QuickNav to="/cardmarket/movers?tab=deals" icon={Tag} label="Listing-Deals" />
      </section>

      {/* Block 5: Sync-Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 pt-3 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Letzter Sync {formatRelativeFromIso(data?.lastSyncLog?.startedAt)}
          {data?.lastSyncLog?.status === "ok" && (
            <span className="text-emerald-600 dark:text-emerald-400"> · ok</span>
          )}
          {data?.lastSyncLog?.status === "failed" && (
            <span className="text-rose-600 dark:text-rose-400"> · fehlgeschlagen</span>
          )}
        </span>
        {data?.lastSyncLog?.productsCount != null && (
          <span>· {data.lastSyncLog.productsCount.toLocaleString("de-DE")} Produkte</span>
        )}
        {data?.lastSyncLog?.signalsCount != null && (
          <span>· {data.lastSyncLog.signalsCount.toLocaleString("de-DE")} Signale</span>
        )}
        {data?.lastSyncLog?.durationMs != null && (
          <span>· Dauer {(data.lastSyncLog.durationMs / 1000).toFixed(0)}s</span>
        )}
      </footer>
    </div>
  );
}

function QuickNav({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof TrendingUp;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900",
        "p-3 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40",
      )}
    >
      <Icon size={20} className="text-slate-500" />
      <span className="font-medium text-sm">{label}</span>
      <ChevronRight size={14} className="ml-auto text-slate-400" />
    </Link>
  );
}
