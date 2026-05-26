import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  TrendingUp,
  X,
  Clock,
} from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type {
  CardmarketCategory,
  CardmarketExpansion,
  CardmarketProduct,
  CardmarketProductList,
  CardmarketSyncStatus,
} from "../lib/types";

type SortKey = "trend" | "low" | "avg" | "name" | "updatedAt";

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function formatEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "nie";
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = Math.round(diffMs / 3_600_000);
  if (h < 1) return "<1h";
  if (h < 24) return `vor ${h}h`;
  const d = Math.round(h / 24);
  return `vor ${d}d`;
}

export function CardmarketPage() {
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<number | "">("");
  const [expansion, setExpansion] = useState<number | "">("");
  const [sort, setSort] = useState<SortKey>("trend");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<CardmarketProduct | null>(null);

  const debouncedSearch = useDebounced(search, 300);

  // Reset to page 1 on any filter change.
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, category, expansion, sort, order]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (category) params.set("category", String(category));
    if (expansion) params.set("expansion", String(expansion));
    params.set("sort", sort);
    params.set("order", order);
    params.set("offset", String(offset));
    params.set("limit", String(PAGE_SIZE));
    return params.toString();
  }, [debouncedSearch, category, expansion, sort, order, offset]);

  const products = useQuery({
    queryKey: ["cm-products", queryString],
    queryFn: () => api.get<CardmarketProductList>(`/api/cardmarket/products?${queryString}`),
    placeholderData: (prev) => prev,
  });

  const categories = useQuery({
    queryKey: ["cm-categories"],
    queryFn: () => api.get<CardmarketCategory[]>("/api/cardmarket/categories"),
    staleTime: 60_000,
  });

  const expansions = useQuery({
    queryKey: ["cm-expansions"],
    queryFn: () => api.get<CardmarketExpansion[]>("/api/cardmarket/expansions"),
    staleTime: 60_000,
  });

  const syncStatus = useQuery({
    queryKey: ["cm-sync-status"],
    queryFn: () => api.get<CardmarketSyncStatus | null>("/api/cardmarket/sync-status"),
    refetchInterval: 30_000,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean; jobId: string }>("/api/admin/cardmarket/sync"),
    onSuccess: () => {
      // Backend job takes a few minutes — refresh status after a short delay.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["cm-sync-status"] });
        qc.invalidateQueries({ queryKey: ["cm-products"] });
        qc.invalidateQueries({ queryKey: ["cm-categories"] });
        qc.invalidateQueries({ queryKey: ["cm-expansions"] });
      }, 5_000);
    },
  });

  const total = products.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const results = products.data?.results ?? [];

  const handleSortClick = (key: SortKey) => {
    if (sort === key) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder(key === "name" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Cardmarket</h1>
          <SyncIndicator status={syncStatus.data ?? null} />
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium disabled:opacity-50"
          title="Lädt Files von Cardmarket S3 und importiert in DB. Dauert ~1-2 min."
        >
          <RefreshCw size={14} className={syncMutation.isPending ? "animate-spin" : ""} />
          Jetzt synchronisieren
        </button>
      </div>

      {syncMutation.isSuccess && (
        <div className="rounded border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          Sync läuft im Hintergrund — Daten erscheinen in ~1-2 min hier.
        </div>
      )}
      {syncStatus.data?.lastError && (
        <div className="rounded border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          Letzter Sync-Fehler: <code className="font-mono">{syncStatus.data.lastError}</code>
        </div>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Name suchen, z.B. "151 Elite Trainer Box" …'
          className="w-full pl-9 pr-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : "")}
          className="text-sm px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 max-w-[60vw]"
        >
          <option value="">Alle Kategorien ({categories.data?.reduce((s, c) => s + c.productCount, 0) ?? 0})</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.idCategory} value={c.idCategory}>
              {c.categoryName} ({c.productCount})
            </option>
          ))}
        </select>

        <select
          value={expansion}
          onChange={(e) => setExpansion(e.target.value ? Number(e.target.value) : "")}
          className="text-sm px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        >
          <option value="">Alle Expansions ({expansions.data?.length ?? 0})</option>
          {(expansions.data ?? []).map((e) => (
            <option key={e.idExpansion} value={e.idExpansion}>
              #{e.idExpansion} ({e.productCount})
            </option>
          ))}
        </select>

        <div className="hidden md:flex items-center gap-1 ml-auto text-xs text-slate-500">
          {total.toLocaleString("de-DE")} Treffer · Seite {currentPage}/{pageCount}
        </div>
      </div>

      {/* Active filter chips */}
      {(category || expansion || debouncedSearch) && (
        <div className="flex flex-wrap gap-1.5 -mt-2">
          {debouncedSearch && (
            <FilterChip onClear={() => setSearch("")}>"{debouncedSearch}"</FilterChip>
          )}
          {category && (
            <FilterChip onClear={() => setCategory("")}>
              {categories.data?.find((c) => c.idCategory === category)?.categoryName ?? `Kat. #${category}`}
            </FilterChip>
          )}
          {expansion && (
            <FilterChip onClear={() => setExpansion("")}>Expansion #{expansion}</FilterChip>
          )}
        </div>
      )}

      {/* Loading + Empty states */}
      {products.isLoading && results.length === 0 && (
        <div className="text-sm text-slate-500">Lade…</div>
      )}
      {!products.isLoading && total === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
          {syncStatus.data?.productsLastSync
            ? "Keine Treffer für deine Filter."
            : "Noch keine Daten — Click oben auf \"Jetzt synchronisieren\"."}
        </div>
      )}

      {/* Desktop table */}
      {total > 0 && (
        <div className="hidden md:block overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/40 text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <SortableTh active={sort === "name"} order={order} onClick={() => handleSortClick("name")}>
                  Name
                </SortableTh>
                <th className="px-3 py-2 text-left font-medium">Kategorie</th>
                <th className="px-3 py-2 text-center font-medium">Exp.</th>
                <SortableTh active={sort === "low"} order={order} onClick={() => handleSortClick("low")} align="right">
                  Low
                </SortableTh>
                <SortableTh active={sort === "avg"} order={order} onClick={() => handleSortClick("avg")} align="right">
                  Avg
                </SortableTh>
                <SortableTh active={sort === "trend"} order={order} onClick={() => handleSortClick("trend")} align="right">
                  Trend
                </SortableTh>
                <th className="px-3 py-2 text-right font-medium">Avg30</th>
              </tr>
            </thead>
            <tbody>
              {results.map((p) => (
                <tr
                  key={p.idProduct}
                  onClick={() => setSelectedProduct(p)}
                  className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                >
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-xs">{p.categoryName}</td>
                  <td className="px-3 py-2 text-center text-xs text-slate-500">{p.idExpansion || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEur(p.price?.low)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEur(p.price?.avg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatEur(p.price?.trend)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatEur(p.price?.avg30)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile cards */}
      {total > 0 && (
        <div className="md:hidden space-y-2">
          {results.map((p) => (
            <ProductCard key={p.idProduct} product={p} onClick={() => setSelectedProduct(p)} />
          ))}
        </div>
      )}

      {/* Mobile sort selector */}
      {total > 0 && (
        <div className="md:hidden flex items-center gap-2 text-xs">
          <span className="text-slate-500">Sortieren:</span>
          <select
            value={`${sort}:${order}`}
            onChange={(e) => {
              const [s, o] = e.target.value.split(":");
              setSort(s as SortKey);
              setOrder(o as "asc" | "desc");
            }}
            className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="trend:desc">Trend ↓</option>
            <option value="trend:asc">Trend ↑</option>
            <option value="low:asc">Low ↑</option>
            <option value="low:desc">Low ↓</option>
            <option value="avg:asc">Avg ↑</option>
            <option value="avg:desc">Avg ↓</option>
            <option value="name:asc">Name A-Z</option>
            <option value="name:desc">Name Z-A</option>
            <option value="updatedAt:desc">Zuletzt aktualisiert</option>
          </select>
          <div className="ml-auto text-slate-500">{total.toLocaleString("de-DE")} Treffer</div>
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-1.5 text-sm">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
          >
            <ChevronLeft size={14} /> Zurück
          </button>
          <span className="text-xs text-slate-500 px-2">
            Seite {currentPage} / {pageCount}
          </span>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={currentPage >= pageCount}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40"
          >
            Weiter <ChevronRight size={14} />
          </button>
        </div>
      )}

      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}

function SortableTh({
  children,
  active,
  order,
  onClick,
  align = "left",
}: {
  children: React.ReactNode;
  active: boolean;
  order: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      onClick={onClick}
      className={clsx(
        "px-3 py-2 font-medium cursor-pointer select-none",
        align === "right" ? "text-right" : "text-left",
        active && "text-slate-900 dark:text-slate-100",
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span className="text-[10px]">{order === "asc" ? "↑" : "↓"}</span>}
      </span>
    </th>
  );
}

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
      {children}
      <button onClick={onClear} className="hover:text-rose-600" aria-label="entfernen">
        <X size={12} />
      </button>
    </span>
  );
}

function ProductCard({ product, onClick }: { product: CardmarketProduct; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 active:bg-slate-50 dark:active:bg-slate-800/40"
    >
      <div className="font-medium text-sm leading-snug">{product.name}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
        <span>{product.categoryName}</span>
        {product.idExpansion > 0 && <span>· Exp #{product.idExpansion}</span>}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-xs tabular-nums">
        <PriceCell label="Low" v={product.price?.low} />
        <PriceCell label="Avg" v={product.price?.avg} />
        <PriceCell label="Trend" v={product.price?.trend} bold />
        <PriceCell label="Avg30" v={product.price?.avg30} muted />
      </div>
    </button>
  );
}

function PriceCell({
  label,
  v,
  bold = false,
  muted = false,
}: {
  label: string;
  v: number | null | undefined;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={clsx("text-[10px] uppercase tracking-wide", muted ? "text-slate-400" : "text-slate-500")}>{label}</div>
      <div className={clsx(bold ? "font-semibold" : "", muted ? "text-slate-400" : "")}>{formatEur(v)}</div>
    </div>
  );
}

function ProductDetailModal({ product, onClose }: { product: CardmarketProduct; onClose: () => void }) {
  const { price } = product;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-lg bg-white dark:bg-slate-900 rounded-t-xl md:rounded-xl border border-slate-200 dark:border-slate-800 max-h-[85vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-base leading-snug">{product.name}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              {product.categoryName} · ID {product.idProduct}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {price ? (
            <>
              <PriceGrid label="Aktuelle Preise" rows={[
                ["Low", price.low],
                ["Avg", price.avg],
                ["Trend", price.trend],
              ]} />
              <PriceGrid label="Durchschnitt" rows={[
                ["1 Tag", price.avg1],
                ["7 Tage", price.avg7],
                ["30 Tage", price.avg30],
              ]} />
              {(price.lowHolo != null || price.avgHolo != null || price.trendHolo != null) && (
                <PriceGrid label="Holo-Preise" rows={[
                  ["Low Holo", price.lowHolo],
                  ["Avg Holo", price.avgHolo],
                  ["Trend Holo", price.trendHolo],
                ]} />
              )}
            </>
          ) : (
            <div className="text-sm text-slate-500">Noch keine Preis-Daten zu diesem Produkt.</div>
          )}

          <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="inline-flex items-center gap-1">
              <TrendingUp size={11} /> Expansion #{product.idExpansion || "—"}
            </span>
            {product.dateAdded && (
              <span>CM-Listing: {new Date(product.dateAdded).toLocaleDateString("de-DE")}</span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> Importiert {formatRelative(product.importedAt)}
            </span>
          </div>

          <a
            href={`https://www.cardmarket.com/de/Pokemon/Products/Search?searchString=${encodeURIComponent(product.name)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink size={14} /> Auf cardmarket.com suchen
          </a>
        </div>
      </div>
    </div>
  );
}

function PriceGrid({ label, rows }: { label: string; rows: Array<[string, number | null]> }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">{label}</div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded border border-slate-200 dark:border-slate-800 p-2">
            <div className="text-[10px] text-slate-500 uppercase">{k}</div>
            <div className="font-medium tabular-nums">{formatEur(v)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncIndicator({ status }: { status: CardmarketSyncStatus | null }) {
  if (!status) {
    return <div className="text-xs text-slate-500 mt-0.5">Noch nie synchronisiert.</div>;
  }
  const productsCount = status.productsRecordCount ?? 0;
  const pricesCount = status.pricesRecordCount ?? 0;
  return (
    <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span>{productsCount.toLocaleString("de-DE")} Sealed-Produkte</span>
      <span>· {pricesCount.toLocaleString("de-DE")} Preise</span>
      <span>· Letzter Sync {formatRelative(status.pricesLastSync ?? status.productsLastSync)}</span>
      {status.pricesLastSourceAt && (
        <span className="text-slate-400">
          (CM-Daten vom {new Date(status.pricesLastSourceAt).toLocaleString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })})
        </span>
      )}
    </div>
  );
}
