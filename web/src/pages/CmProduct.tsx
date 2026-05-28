import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Star, EyeOff, Eye } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { SignalHeadlinePill } from "../components/SignalBadge";
import { SignalCard } from "../components/SignalCard";
import { ReasoningList } from "../components/ReasoningList";
import { TrendChart } from "../components/TrendChart";
import { WatchlistEditSheet } from "../components/WatchlistEditSheet";
import { formatEur, formatPct, MOVEMENT_LABEL_DE } from "../lib/cm";
import type {
  CardmarketProductSignalResponse,
  CardmarketWatchlistEntry,
} from "../lib/types";

export function CmProductPage() {
  const { idProduct } = useParams<{ idProduct: string }>();
  const id = Number(idProduct);
  const qc = useQueryClient();
  const [watchlistSheetOpen, setWatchlistSheetOpen] = useState(false);

  const product = useQuery({
    queryKey: ["cm-product-signal", id],
    queryFn: () =>
      api.get<CardmarketProductSignalResponse>(`/api/cardmarket/products/${id}/signal`),
    enabled: Number.isFinite(id),
  });

  const watchlistEntry = useQuery({
    queryKey: ["cm-product-watchlist", id],
    queryFn: () =>
      api.get<CardmarketWatchlistEntry | null>(`/api/cardmarket/products/${id}/watchlist`),
    enabled: Number.isFinite(id),
  });

  const isBlacklisted = product.data?.blacklisted ?? false;
  const toggleBlacklist = useMutation({
    mutationFn: async () => {
      if (isBlacklisted) {
        await api.delete<void>(`/api/cardmarket/products/${id}/blacklist`);
      } else {
        await api.post<{ idProduct: number }>(`/api/cardmarket/products/${id}/blacklist`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cm-product-signal", id] });
      qc.invalidateQueries({ queryKey: ["cm-blacklist"] });
    },
  });

  if (!Number.isFinite(id)) {
    return <div className="text-sm text-slate-500">Ungültige Produkt-ID.</div>;
  }

  if (product.isLoading) {
    return <div className="text-sm text-slate-500">Lade…</div>;
  }

  if (!product.data) {
    return (
      <div>
        <Link to="/cardmarket" className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
          <ChevronLeft size={12} /> zurück
        </Link>
        <div className="mt-3 text-sm text-slate-500">Produkt nicht gefunden.</div>
      </div>
    );
  }

  const { product: p, signal, setContext } = product.data;
  const price = p.price;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <Link
            to="/cardmarket"
            className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1"
          >
            <ChevronLeft size={12} /> Dashboard
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleBlacklist.mutate()}
              disabled={toggleBlacklist.isPending}
              className={clsx(
                "text-xs inline-flex items-center gap-1 rounded px-2 py-1 disabled:opacity-50",
                isBlacklisted
                  ? "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800",
              )}
              title={
                isBlacklisted
                  ? "Wieder einblenden — Artikel erscheint wieder in den Listen"
                  : "Ausblenden — Artikel verschwindet aus allen Listen (Werte werden weiter gesammelt)"
              }
            >
              {isBlacklisted ? <Eye size={12} /> : <EyeOff size={12} />}
              {isBlacklisted ? "Eingeblendet lassen" : "Ausblenden"}
            </button>
            <button
              onClick={() => setWatchlistSheetOpen(true)}
              className={clsx(
                "text-xs inline-flex items-center gap-1 rounded px-2 py-1",
                watchlistEntry.data
                  ? "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800",
              )}
              title={watchlistEntry.data ? "Auf Watchlist — bearbeiten" : "Zur Watchlist hinzufügen"}
            >
              <Star size={12} fill={watchlistEntry.data ? "currentColor" : "none"} />
              {watchlistEntry.data ? "Auf Watchlist" : "Zur Watchlist"}
            </button>
          </div>
        </div>
        <h1 className="text-lg font-semibold mt-1 leading-snug">{p.name}</h1>
        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
          <span>{p.categoryName}</span>
          {p.idExpansion > 0 && (
            <Link
              to={`/cardmarket/sets/${p.idExpansion}`}
              className="hover:underline"
            >
              · {setContext?.name ?? `Set #${p.idExpansion}`}
              {setContext?.language && <span className="ml-1 text-slate-400">{setContext.language}</span>}
            </Link>
          )}
        </div>
        {signal && (
          <div className="mt-3">
            <SignalHeadlinePill recommendation={signal.recommendation} headline={signal.headline} />
          </div>
        )}
      </div>

      {/* Preis-Header */}
      <section className="flex items-end justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums">{formatEur(price?.trend ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">trend</div>
        </div>
        <div className="text-right">
          <div className="text-sm tabular-nums">low {formatEur(price?.low ?? null)}</div>
          <div className="text-xs text-slate-500 mt-0.5">{signal?.mScore != null && `${formatPct(signal.mScore)} unter trend`}</div>
        </div>
      </section>

      {/* Signal-Karten 2x2 (Mobile) / 4x1 (Desktop) */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SignalCard kind="L" value={signal?.lScore ?? null} contextValue={price?.avg ?? null} />
        <SignalCard kind="M" value={signal?.mScore ?? null} contextValue={price?.low ?? null} />
        <SignalCard kind="DELTA7" value={signal?.delta7 ?? null} />
        <SignalCard kind="DELTA30" value={signal?.delta30 ?? null} />
      </section>

      {/* Reasoning */}
      {signal && <ReasoningList lines={signal.reasoningLines} />}

      {/* Trend-Chart */}
      <section>
        <TrendChart idProduct={id} avg={price?.avg ?? null} showBands />
      </section>

      {/* Movement Class Detail */}
      {signal?.movementClass && (
        <div className="text-xs text-slate-500">
          Bewegungs-Charakter:{" "}
          <span className="text-slate-700 dark:text-slate-300 font-medium">
            {MOVEMENT_LABEL_DE[signal.movementClass]}
          </span>
          {signal.sampleQuality < 0.5 && (
            <span className="ml-2 italic text-slate-400">(dünne Datenbasis)</span>
          )}
        </div>
      )}

      {/* Set-Kontext */}
      {setContext && (
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Im Set</div>
          <div className="text-sm">
            <Link
              to={`/cardmarket/sets/${setContext.idExpansion}`}
              className="hover:underline"
            >
              {setContext.name ?? `Set ${setContext.idExpansion}`}
            </Link>
            <span className="text-slate-400"> · {setContext.productCount} Produkte</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Median L</div>
              <div className="font-medium tabular-nums">{formatPct(setContext.medianL)}</div>
            </div>
            <div>
              <div className="text-slate-500">Median Δ7</div>
              <div className="font-medium tabular-nums">{formatPct(setContext.medianDelta7)}</div>
            </div>
            <div>
              <div className="text-slate-500">Volatilität</div>
              <div className="font-medium tabular-nums">
                {setContext.volatilityDelta7 == null
                  ? "—"
                  : (setContext.volatilityDelta7 * 100).toFixed(1) + "%"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Externer Link */}
      <a
        href={`https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(p.name)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        <ExternalLink size={14} /> Auf cardmarket.com öffnen
      </a>

      {watchlistSheetOpen && (
        <WatchlistEditSheet
          idProduct={id}
          productName={p.name}
          existing={watchlistEntry.data ?? null}
          onClose={() => setWatchlistSheetOpen(false)}
          onSaved={() => setWatchlistSheetOpen(false)}
        />
      )}
    </div>
  );
}
