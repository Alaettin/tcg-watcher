import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Eye } from "lucide-react";
import { api } from "../lib/api";
import { SignalBadge } from "../components/SignalBadge";
import { formatEur } from "../lib/cm";
import type { CardmarketBlacklistItem, CardmarketBlacklistListResponse } from "../lib/types";

export function CmBlacklistPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["cm-blacklist"],
    queryFn: () => api.get<CardmarketBlacklistListResponse>("/api/cardmarket/blacklist"),
  });

  const restore = useMutation({
    mutationFn: (idProduct: number) =>
      api.delete<void>(`/api/cardmarket/products/${idProduct}/blacklist`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cm-blacklist"] });
      // Listen sind jetzt wieder voller — Movers/Dashboard/Produkttabelle refetchen.
      qc.invalidateQueries({ queryKey: ["cm-movers"] });
      qc.invalidateQueries({ queryKey: ["cm-dashboard"] });
      qc.invalidateQueries({ queryKey: ["cm-signals-today"] });
    },
  });

  const items = list.data?.results ?? [];

  return (
    <div className="space-y-4">
      <div>
        <Link to="/cardmarket" className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
          <ChevronLeft size={12} /> Dashboard
        </Link>
        <div className="flex items-baseline justify-between mt-1">
          <h1 className="text-xl font-semibold">Blacklist</h1>
          <span className="text-xs text-slate-500">
            {items.length} ausgeblendet
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Diese Artikel erscheinen in keiner anderen Liste. Werte werden trotzdem täglich weiter gesammelt.
        </p>
      </div>

      {list.isLoading ? (
        <div className="text-sm text-slate-500">Lade…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500">
          Keine ausgeblendeten Artikel. Auf einer Produktseite den „Ausblenden"-Button drücken.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <BlacklistRow
              key={item.id}
              item={item}
              onRestore={() => restore.mutate(item.idProduct)}
              restoring={restore.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BlacklistRow({
  item,
  onRestore,
  restoring,
}: {
  item: CardmarketBlacklistItem;
  onRestore: () => void;
  restoring: boolean;
}) {
  const { product, price, signal } = item;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex items-center gap-3">
      <Link
        to={`/cardmarket/p/${product.idProduct}`}
        className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80"
      >
        {signal && <SignalBadge recommendation={signal.recommendation} size="sm" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{product.name}</div>
          <div className="text-[11px] text-slate-500 truncate">{product.categoryName}</div>
        </div>
        <div className="text-right text-xs tabular-nums shrink-0">
          <div className="font-medium text-sm">{formatEur(price.trend)}</div>
        </div>
      </Link>
      <button
        onClick={onRestore}
        disabled={restoring}
        className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        title="Wieder einblenden"
      >
        <Eye size={13} /> Einblenden
      </button>
    </div>
  );
}
