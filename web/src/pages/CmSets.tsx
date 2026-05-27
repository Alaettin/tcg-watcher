import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { SetHeatmap, AmpelDistributionBar } from "../components/SetHeatmap";
import { formatPct } from "../lib/cm";
import type { CardmarketSetListResponse, CardmarketSetSummary } from "../lib/types";

type Sort = "hottest" | "coldest" | "volatile" | "newest" | "name";

const TABS: Array<{ value: Sort; label: string }> = [
  { value: "hottest", label: "Heißeste" },
  { value: "coldest", label: "Kälteste" },
  { value: "volatile", label: "Volatilste" },
  { value: "newest", label: "Neueste" },
  { value: "name", label: "A-Z" },
];

export function CmSetsPage() {
  const qc = useQueryClient();
  const [sort, setSort] = useState<Sort>("hottest");
  const [minProducts, setMinProducts] = useState<number>(3);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("sort", sort);
    sp.set("minProducts", String(minProducts));
    return sp.toString();
  }, [sort, minProducts]);

  const list = useQuery({
    queryKey: ["cm-sets", queryString],
    queryFn: () => api.get<CardmarketSetListResponse>(`/api/cardmarket/sets?${queryString}`),
    placeholderData: (prev) => prev,
  });

  const scrape = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; scraped: number; written: number; parentsLinked: number }>(
        "/api/admin/cardmarket/scrape-expansions",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cm-sets"] }),
  });

  const sets = list.data?.results ?? [];

  return (
    <div className="space-y-4">
      <div>
        <Link to="/cardmarket" className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
          <ChevronLeft size={12} /> Dashboard
        </Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-xl font-semibold">Sets</h1>
          <button
            onClick={() => scrape.mutate()}
            disabled={scrape.isPending}
            title="Set-Namen + Sprach-Info von cardmarket.com aktualisieren"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-xs font-medium disabled:opacity-50"
          >
            <RefreshCw size={12} className={scrape.isPending ? "animate-spin" : ""} />
            Set-Namen aktualisieren
          </button>
        </div>
        {scrape.data && (
          <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
            Scrape ok — {scrape.data.scraped} Sets gefunden, {scrape.data.parentsLinked} Sprach-Pendants verknüpft.
          </div>
        )}
      </div>

      {/* Sortier-Tabs + Filter */}
      <div className="sticky top-0 md:top-14 z-20 bg-slate-50 dark:bg-slate-950 -mx-3 md:mx-0 px-3 md:px-0 py-2 space-y-2">
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setSort(t.value)}
              className={clsx(
                "shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition",
                sort === t.value
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={String(minProducts)}
            onChange={(e) => setMinProducts(Number(e.target.value))}
            className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="1">≥ 1 Produkt</option>
            <option value="3">≥ 3 Produkte</option>
            <option value="10">≥ 10 Produkte</option>
            <option value="30">≥ 30 Produkte</option>
          </select>
          <div className="ml-auto text-[11px] text-slate-500">
            {sets.length} Sets
          </div>
        </div>
      </div>

      {list.isLoading && sets.length === 0 ? (
        <div className="text-sm text-slate-500">Lade…</div>
      ) : (
        <>
          {/* Heatmap-Hero */}
          <section>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Heatmap (Median-Δ7)</div>
            <SetHeatmap sets={sets} emptyHint="Keine Sets im aktuellen Filter." />
          </section>

          {/* Liste */}
          <section>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Liste</div>
            <div className="space-y-1.5">
              {sets.map((s) => (
                <SetListRow key={s.idExpansion} s={s} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SetListRow({ s }: { s: CardmarketSetSummary }) {
  return (
    <Link
      to={`/cardmarket/sets/${s.idExpansion}`}
      className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{s.name}</div>
          <div className="text-[11px] text-slate-500">
            {s.productCount} Produkte
            {s.releaseDate && <> · Release {s.releaseDate}</>}
          </div>
        </div>
        <div className="text-right text-xs tabular-nums shrink-0 w-28">
          <div className="text-slate-500 text-[10px]">Median-Δ7</div>
          <div className="font-medium">{formatPct(s.medianDelta7)}</div>
        </div>
        <div className="hidden sm:block text-right text-xs tabular-nums shrink-0 w-24">
          <div className="text-slate-500 text-[10px]">Median-L</div>
          <div>{formatPct(s.medianL)}</div>
        </div>
      </div>
      <div className="mt-2">
        <AmpelDistributionBar distribution={s.ampelDistribution} showLabels={false} />
      </div>
    </Link>
  );
}
