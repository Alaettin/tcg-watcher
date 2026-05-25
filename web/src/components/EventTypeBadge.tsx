import clsx from "clsx";
import type { EventType } from "../lib/types";

const STYLES: Record<EventType, { label: string; cls: string }> = {
  NEW_LISTING: { label: "NEU", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  RESTOCK: { label: "RESTOCK", cls: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200" },
  PRICE_DROP: { label: "PREIS↓", cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
  RESALE_DEAL: { label: "RESALE", cls: "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-200" },
  WENT_OUT_OF_STOCK: { label: "AUSV.", cls: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200" },
};

export function EventTypeBadge({ type }: { type: EventType }) {
  const s = STYLES[type];
  return <span className={clsx("inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide", s.cls)}>{s.label}</span>;
}
