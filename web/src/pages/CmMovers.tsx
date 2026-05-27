import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { MoverRow } from "../components/MoverRow";
import type { CardmarketCategory, CardmarketSignalListResponse } from "../lib/types";

type Tab = "risers" | "fallers" | "deals" | "volatile";

const TABS: Array<{ value: Tab; label: string }> = [
  { value: "risers", label: "Top Risers" },
  { value: "fallers", label: "Top Fallers" },
  { value: "deals", label: "Listing-Deals" },
  { value: "volatile", label: "Volatile" },
];

const PAGE_SIZE = 50;

export function CmMoversPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "risers";
  const [category, setCategory] = useState<number | "">("");
  const [offset, setOffset] = useState(0);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("tab", tab);
    if (category) sp.set("category", String(category));
    sp.set("limit", String(PAGE_SIZE));
    sp.set("offset", String(offset));
    return sp.toString();
  }, [tab, category, offset]);

  const movers = useQuery({
    queryKey: ["cm-movers", queryString],
    queryFn: () => api.get<CardmarketSignalListResponse>(`/api/cardmarket/movers?${queryString}`),
    placeholderData: (prev) => prev,
  });

  const categories = useQuery({
    queryKey: ["cm-categories"],
    queryFn: () => api.get<CardmarketCategory[]>("/api/cardmarket/categories"),
    staleTime: 60_000,
  });

  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(params);
    sp.set("tab", next);
    setParams(sp);
    setOffset(0);
  };

  const results = movers.data?.results ?? [];
  const total = movers.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/cardmarket" className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
          <ChevronLeft size={12} /> Dashboard
        </Link>
        <h1 className="text-xl font-semibold mt-1">Movers</h1>
      </div>

      {/* Sticky Tab-Switch */}
      <div className="sticky top-0 md:top-14 z-20 bg-slate-50 dark:bg-slate-950 -mx-3 md:mx-0 px-3 md:px-0 py-2">
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={clsx(
                "shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition",
                tab === t.value
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2 items-center">
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value ? Number(e.target.value) : "");
              setOffset(0);
            }}
            className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 max-w-[55vw]"
          >
            <option value="">Alle Kategorien</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.idCategory} value={c.idCategory}>
                {c.categoryName}
              </option>
            ))}
          </select>
          <div className="ml-auto text-[11px] text-slate-500">
            {total.toLocaleString("de-DE")} Treffer
          </div>
        </div>
      </div>

      {movers.isLoading && results.length === 0 ? (
        <div className="text-sm text-slate-500">Lade…</div>
      ) : results.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
          Keine Treffer. Versuch eine andere Kategorie oder warte auf den nächsten Sync.
        </div>
      ) : (
        <div className="space-y-1.5">
          {results.map((row) => (
            <MoverRow key={row.product.idProduct} row={row} compact />
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-sm disabled:opacity-40"
          >
            Zurück
          </button>
          <span className="text-xs text-slate-500">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} von {total.toLocaleString("de-DE")}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 text-sm disabled:opacity-40"
          >
            Weiter
          </button>
        </div>
      )}
    </div>
  );
}
