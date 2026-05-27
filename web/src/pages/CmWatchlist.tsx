import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, ChevronLeft, Pencil, Trash2, Star } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import { SignalBadge } from "../components/SignalBadge";
import { WatchlistEditSheet } from "../components/WatchlistEditSheet";
import { arrowForDelta, formatEur, formatPct, recommendationColor } from "../lib/cm";
import type { CardmarketWatchlistItem, CardmarketWatchlistListResponse } from "../lib/types";

function formatRelative(iso: string | null): string {
  if (!iso) return "nie";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return `vor ${min}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h}h`;
  return `vor ${Math.round(h / 24)}d`;
}

export function CmWatchlistPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CardmarketWatchlistItem | null>(null);

  const list = useQuery({
    queryKey: ["cm-watchlist"],
    queryFn: () => api.get<CardmarketWatchlistListResponse>("/api/cardmarket/watchlist"),
  });

  const removeMutation = useMutation({
    mutationFn: (idProduct: number) => api.delete<void>(`/api/cardmarket/watchlist/${idProduct}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cm-watchlist"] }),
  });

  const items = list.data?.results ?? [];

  return (
    <div className="space-y-4">
      <div>
        <Link to="/cardmarket" className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
          <ChevronLeft size={12} /> Dashboard
        </Link>
        <div className="flex items-baseline justify-between mt-1">
          <h1 className="text-xl font-semibold">Watchlist</h1>
          <span className="text-xs text-slate-500">
            {items.length} Produkt{items.length === 1 ? "" : "e"}
          </span>
        </div>
      </div>

      {list.isLoading ? (
        <div className="text-sm text-slate-500">Lade…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
          <div className="mb-2">Du hast noch keine Watchlist.</div>
          <div className="text-xs">
            Tipp: Auf einer Produkt-Detail-Seite{" "}
            <Star size={12} className="inline align-middle" /> drücken — oder den Movers-Screen scannen.
          </div>
          <Link
            to="/cardmarket/movers?tab=deals"
            className="inline-block mt-3 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm"
          >
            Listing-Deals durchstöbern
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <WatchlistRow
              key={item.id}
              item={item}
              onEdit={() => setEditing(item)}
              onRemove={() => {
                if (confirm(`"${item.product.name}" von der Watchlist entfernen?`)) {
                  removeMutation.mutate(item.idProduct);
                }
              }}
            />
          ))}
        </div>
      )}

      {editing && (
        <WatchlistEditSheet
          idProduct={editing.idProduct}
          productName={editing.product.name}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["cm-watchlist"] });
          }}
        />
      )}
    </div>
  );
}

interface RowProps {
  item: CardmarketWatchlistItem;
  onEdit: () => void;
  onRemove: () => void;
}

function WatchlistRow({ item, onEdit, onRemove }: RowProps) {
  const { product, price, signal } = item;
  const hasThreshold = item.alertBelowTrend != null || item.alertAboveTrend != null;
  const recentAlert =
    item.lastAlertSentAt &&
    Date.now() - new Date(item.lastAlertSentAt).getTime() < 24 * 60 * 60 * 1000;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <div className="flex items-center gap-3">
        <Link
          to={`/cardmarket/p/${product.idProduct}`}
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80"
        >
          {signal && <SignalBadge recommendation={signal.recommendation} size="sm" />}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{product.name}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {product.categoryName}
              {signal?.headline && (
                <>
                  {" · "}
                  <span style={{ color: recommendationColor(signal.recommendation) }}>
                    {signal.headline}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="text-right text-xs tabular-nums shrink-0">
            <div className="font-medium text-sm">{formatEur(price.trend)}</div>
            {signal?.delta7 != null && (
              <div
                style={{
                  color:
                    Math.abs(signal.delta7) < 0.03
                      ? "rgb(100 116 139)"
                      : signal.delta7 > 0
                      ? "var(--cm-green)"
                      : "var(--cm-red)",
                }}
              >
                {formatPct(signal.delta7)} {arrowForDelta(signal.delta7)}
              </div>
            )}
          </div>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            title="Schwellwerte bearbeiten"
            aria-label="Bearbeiten"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-500"
            title="Entfernen"
            aria-label="Entfernen"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Alert-Status-Zeile */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2">
        {hasThreshold ? (
          <span className="inline-flex items-center gap-1">
            <Bell size={11} className={clsx(recentAlert && "text-amber-500")} />
            {item.alertBelowTrend != null && (
              <span>
                Alert &lt; {formatEur(item.alertBelowTrend)}
              </span>
            )}
            {item.alertBelowTrend != null && item.alertAboveTrend != null && " · "}
            {item.alertAboveTrend != null && (
              <span>
                Alert &gt; {formatEur(item.alertAboveTrend)}
              </span>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-slate-400">
            <BellOff size={11} /> keine Schwelle
          </span>
        )}
        {item.alertOnSignalFlip && <span>· Signal-Flip aktiv</span>}
        {recentAlert && (
          <span className="text-amber-600 dark:text-amber-400">
            · 🚨 Alert {formatRelative(item.lastAlertSentAt)}
          </span>
        )}
      </div>
    </div>
  );
}
