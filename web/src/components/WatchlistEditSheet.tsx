import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Save, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type {
  CardmarketWatchlistEntry,
  CardmarketWatchlistUpsertBody,
} from "../lib/types";

interface Props {
  /** Produkt-ID — egal ob Neu oder Edit. */
  idProduct: number;
  /** Anzeigename des Produkts (wird im Sheet-Header gezeigt). */
  productName: string;
  /** Existierender Eintrag, falls schon auf der Watchlist. null = Neu-Eintrag. */
  existing: CardmarketWatchlistEntry | null;
  onClose: () => void;
  onSaved: () => void;
}

export function WatchlistEditSheet({
  idProduct,
  productName,
  existing,
  onClose,
  onSaved,
}: Props) {
  const qc = useQueryClient();

  const [below, setBelow] = useState<string>(
    existing?.alertBelowTrend != null ? String(existing.alertBelowTrend) : "",
  );
  const [above, setAbove] = useState<string>(
    existing?.alertAboveTrend != null ? String(existing.alertAboveTrend) : "",
  );
  const [flip, setFlip] = useState<boolean>(existing?.alertOnSignalFlip ?? true);
  const [note, setNote] = useState<string>(existing?.note ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const body: CardmarketWatchlistUpsertBody = {
        idProduct,
        note: note.trim() ? note.trim() : null,
        alertBelowTrend: below.trim() ? Number(below) : null,
        alertAboveTrend: above.trim() ? Number(above) : null,
        alertOnSignalFlip: flip,
      };
      if (existing) {
        return api.patch(`/api/cardmarket/watchlist/${idProduct}`, body);
      }
      return api.post(`/api/cardmarket/watchlist`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cm-watchlist"] });
      qc.invalidateQueries({ queryKey: ["cm-product-watchlist", idProduct] });
      onSaved();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/cardmarket/watchlist/${idProduct}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cm-watchlist"] });
      qc.invalidateQueries({ queryKey: ["cm-product-watchlist", idProduct] });
      onSaved();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-md bg-white dark:bg-slate-900 rounded-t-xl md:rounded-xl border border-slate-200 dark:border-slate-800 max-h-[85vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {existing ? "Watchlist bearbeiten" : "Zur Watchlist hinzufügen"}
            </div>
            <div className="font-semibold text-sm leading-snug">{productName}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-500 block mb-1">
              Alert wenn trend unter
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">€</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={below}
                onChange={(e) => setBelow(e.target.value)}
                placeholder="z.B. 60.00"
                className="w-full pl-7 pr-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-slate-500 block mb-1">
              Alert wenn trend über
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">€</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={above}
                onChange={(e) => setAbove(e.target.value)}
                placeholder="z.B. 120.00"
                className="w-full pl-7 pr-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={flip}
              onChange={(e) => setFlip(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
            />
            <span className="text-sm">Alert bei Empfehlungs-Wechsel (z.B. AMBER → GREEN)</span>
          </label>

          <div>
            <label className="text-xs uppercase tracking-wide text-slate-500 block mb-1">
              Notiz (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="z.B. Warten auf SV151-Reprint"
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          {save.error && (
            <div className="rounded border border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              Speichern fehlgeschlagen.
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium disabled:opacity-50"
            >
              <Save size={14} />
              {existing ? "Speichern" : "Hinzufügen"}
            </button>
            {existing && (
              <button
                onClick={() => {
                  if (confirm(`"${productName}" von der Watchlist entfernen?`)) {
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-400 text-sm disabled:opacity-50"
              >
                <Trash2 size={14} />
                Entfernen
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
