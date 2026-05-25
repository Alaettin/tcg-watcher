import clsx from "clsx";
import { ExternalLink } from "lucide-react";
import type { Shop } from "../lib/types";
import { ago } from "../lib/format";

interface Props {
  shop: Shop;
}

export function ShopStatusCard({ shop }: Props) {
  const dot = !shop.enabled
    ? "bg-slate-400"
    : shop.online
      ? "bg-emerald-500"
      : "bg-rose-500";

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{shop.displayName}</div>
          <div className="text-xs text-slate-500 truncate">{shop.id}</div>
        </div>
        <span className={clsx("h-2 w-2 rounded-full mt-1.5 shrink-0", dot)} title={shop.enabled ? (shop.online ? "online" : "stale") : "disabled"} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        <span title="Adapter-Typ">{shop.adapterType}</span>
        <span title="Polling-Intervall">{shop.pollIntervalSeconds}s</span>
        <span>letzte Run: {ago(shop.lastSuccessfulRun)}</span>
        <span title="Events letzte 24h">{shop.eventCount24h} Events 24h</span>
      </div>
      <a
        className="text-xs text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
        href={shop.baseUrl}
        target="_blank"
        rel="noreferrer"
      >
        {shop.baseUrl.replace(/^https?:\/\//, "")}
        <ExternalLink size={10} />
      </a>
    </div>
  );
}
