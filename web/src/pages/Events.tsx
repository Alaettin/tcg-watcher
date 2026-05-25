import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, useEventStream } from "../lib/api";
import type { AppEvent, EventType, Shop } from "../lib/types";
import { EventCard } from "../components/EventCard";

const EVENT_TYPES: { v: EventType | ""; l: string }[] = [
  { v: "", l: "Alle Typen" },
  { v: "NEW_LISTING", l: "Neu" },
  { v: "RESTOCK", l: "Restock" },
  { v: "PRICE_DROP", l: "Preisdrop" },
  { v: "WENT_OUT_OF_STOCK", l: "Ausverkauft" },
  { v: "RESALE_DEAL", l: "Resale" },
];

export function EventsPage() {
  const qc = useQueryClient();
  const [type, setType] = useState<EventType | "">("");
  const [shopId, setShopId] = useState<string>("");

  const shops = useQuery({
    queryKey: ["shops"],
    queryFn: () => api.get<Shop[]>("/api/shops"),
  });

  const queryKey = useMemo(() => ["events", { type, shopId }], [type, shopId]);
  const events = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (type) params.set("type", type);
      if (shopId) params.set("shopId", shopId);
      return api.get<AppEvent[]>(`/api/events?${params}`);
    },
  });

  useEventStream(() => qc.invalidateQueries({ queryKey: ["events"] }));

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Events</h1>
      <div className="flex flex-wrap gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as EventType | "")} className="text-sm px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
          {EVENT_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        <select value={shopId} onChange={(e) => setShopId(e.target.value)} className="text-sm px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
          <option value="">Alle Shops</option>
          {shops.data?.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        </select>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {events.data?.map((e) => <EventCard key={e.id} event={e} />)}
        {events.data?.length === 0 && (
          <div className="text-sm text-slate-500 col-span-2 py-8 text-center">Keine Events gefunden.</div>
        )}
      </div>
    </div>
  );
}
