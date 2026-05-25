import { ExternalLink } from "lucide-react";
import type { AppEvent } from "../lib/types";
import { ago, formatEur } from "../lib/format";
import { EventTypeBadge } from "./EventTypeBadge";

interface Props {
  event: AppEvent;
}

export function EventCard({ event }: Props) {
  const confidence = (event.detail as { confidence?: number })?.confidence;
  const previousPrice = (event.detail as { previousPrice?: number })?.previousPrice;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <div className="flex items-start gap-2 mb-1">
        <EventTypeBadge type={event.type} />
        <div className="text-xs text-slate-500 dark:text-slate-400 ml-auto">{ago(event.createdAt)}</div>
      </div>
      <div className="font-medium text-sm leading-snug">{event.listing.title}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-600 dark:text-slate-400">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{formatEur(event.listing.priceEur)}</span>
        {typeof previousPrice === "number" && (
          <span className="line-through opacity-60">{formatEur(previousPrice)}</span>
        )}
        <span>{event.listing.shopId}</span>
        {typeof confidence === "number" && (
          <span>Match {Math.round(confidence * 100)}%</span>
        )}
      </div>
      <a
        href={event.listing.url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-1 mt-2"
      >
        Zum Shop <ExternalLink size={11} />
      </a>
    </div>
  );
}
