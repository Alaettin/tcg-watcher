import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ExternalLink, MapPin, Tag, Clock } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { OfflineDeal, OfflineRetailer } from "../lib/types";

export function ProspektePage() {
  const qc = useQueryClient();
  const [retailerFilter, setRetailerFilter] = useState<string>("");

  const deals = useQuery({
    queryKey: ["prospekte", retailerFilter],
    queryFn: () =>
      api.get<OfflineDeal[]>(
        retailerFilter ? `/api/prospekte?retailer=${encodeURIComponent(retailerFilter)}` : "/api/prospekte",
      ),
    refetchInterval: 30_000,
  });

  const retailers = useQuery({
    queryKey: ["prospekte-retailers"],
    queryFn: () => api.get<OfflineRetailer[]>("/api/prospekte/retailers"),
    refetchInterval: 60_000,
  });

  const trigger = useMutation({
    mutationFn: () => api.post<{ ok: boolean; jobId: string }>("/api/admin/prospekte/trigger"),
    onSuccess: () => {
      // Nach ~10s neu laden — gibt dem Backend Zeit den Poll abzuschließen
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["prospekte"] });
        qc.invalidateQueries({ queryKey: ["prospekte-retailers"] });
      }, 10_000);
    },
  });

  // Group by retailer
  const grouped = useMemo(() => {
    const map = new Map<string, OfflineDeal[]>();
    for (const d of deals.data ?? []) {
      const arr = map.get(d.retailerId) ?? [];
      arr.push(d);
      map.set(d.retailerId, arr);
    }
    return map;
  }, [deals.data]);

  const totalActive = deals.data?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Prospekte</h1>
          <div className="text-xs text-slate-500 mt-0.5">
            Pokemon-Treffer in deutschen Händler-Prospekten via marktguru. Täglicher Poll 07:00 MESZ. {totalActive} aktive Treffer.
          </div>
        </div>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium disabled:opacity-50"
        >
          <RefreshCw size={14} className={trigger.isPending ? "animate-spin" : ""} />
          Jetzt aktualisieren
        </button>
      </div>

      {trigger.isSuccess && (
        <div className="rounded border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          Poll läuft im Hintergrund — neue Deals tauchen in ~30s hier auf.
        </div>
      )}

      {/* Retailer-Filter-Chips */}
      {(retailers.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setRetailerFilter("")}
            className={clsx(
              "px-2.5 py-1 rounded text-xs font-medium",
              retailerFilter === ""
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
            )}
          >
            Alle ({totalActive})
          </button>
          {(retailers.data ?? [])
            .filter((r) => r.activeDealsCount > 0)
            .map((r) => (
              <button
                key={r.id}
                onClick={() => setRetailerFilter(r.id)}
                className={clsx(
                  "px-2.5 py-1 rounded text-xs font-medium",
                  retailerFilter === r.id
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
                )}
              >
                {r.displayName} ({r.activeDealsCount})
              </button>
            ))}
        </div>
      )}

      {deals.isLoading && <div className="text-sm text-slate-500">Lade Prospekte…</div>}

      {!deals.isLoading && totalActive === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500">
          Aktuell keine aktiven Pokemon-Treffer. Nächster Poll: morgen 07:00 MESZ — oder oben "Jetzt aktualisieren" klicken.
        </div>
      )}

      {[...grouped.entries()].map(([retailerId, deals]) => (
        <section key={retailerId} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
            {deals[0]?.retailerName ?? retailerId}
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              {deals.length}
            </span>
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {deals.map((d) => (
              <DealCard key={d.id} deal={d} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DealCard({ deal }: { deal: OfflineDeal }) {
  const now = Date.now();
  const validUntil = new Date(deal.validUntil).getTime();
  const hoursLeft = Math.max(0, Math.round((validUntil - now) / 3_600_000));
  const expiringSoon = hoursLeft > 0 && hoursLeft <= 48;
  const expired = validUntil < now;
  const hasDiscount = deal.originalPriceEur != null && deal.priceEur != null && deal.originalPriceEur > deal.priceEur;

  return (
    <div
      className={clsx(
        "rounded-lg border bg-white dark:bg-slate-900 p-3 flex flex-col gap-2",
        expired
          ? "border-slate-200 dark:border-slate-800 opacity-60"
          : expiringSoon
            ? "border-amber-300 dark:border-amber-700"
            : "border-slate-200 dark:border-slate-800",
      )}
    >
      {deal.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={deal.imageUrl}
          alt={deal.title}
          loading="lazy"
          className="w-full h-32 object-contain rounded bg-slate-50 dark:bg-slate-800"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm leading-snug">{deal.title}</div>
        {deal.brand && deal.brand !== "thisisnobrand123" && (
          <div className="text-[11px] text-slate-500 mt-0.5">{deal.brand}</div>
        )}
        {deal.category && (
          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
            <Tag size={11} /> {deal.category}
          </div>
        )}
      </div>

      {deal.priceEur != null && (
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold">
            {deal.priceEur.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
          </span>
          {hasDiscount && (
            <span className="text-xs text-slate-500 line-through">
              {deal.originalPriceEur!.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
            </span>
          )}
        </div>
      )}

      <div className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap">
        <Clock size={11} />
        <span>
          {new Date(deal.validFrom).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} –
          {" "}
          {new Date(deal.validUntil).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })}
        </span>
        {expiringSoon && !expired && (
          <span className="text-amber-700 dark:text-amber-300 font-medium">· noch {hoursLeft}h</span>
        )}
        {expired && <span className="text-slate-400 font-medium">· abgelaufen</span>}
      </div>

      {(deal.storeAddress || deal.storeCity || deal.postalCode) && (
        <div className="text-[11px] text-slate-500 flex items-start gap-1">
          <MapPin size={11} className="mt-0.5 shrink-0" />
          <span>
            {[deal.storeName, deal.storeAddress, deal.storeCity, deal.postalCode].filter(Boolean).join(", ")}
          </span>
        </div>
      )}

      {deal.sourceUrl && (
        <a
          href={deal.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
        >
          <ExternalLink size={11} /> Quelle (marktguru)
        </a>
      )}
    </div>
  );
}
