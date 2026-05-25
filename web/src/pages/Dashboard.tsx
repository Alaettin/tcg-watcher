import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Box, Loader2, Pause, Play, Radio, RefreshCw, Send, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api, useEventStream } from "../lib/api";
import { ago } from "../lib/format";
import type { CurrentlyRunning, HeartbeatSnapshot, RecentRun } from "../lib/types";

interface SchedulerStatus {
  paused: boolean;
  waiting: number;
  active: number;
  delayed: number;
}

export function DashboardPage() {
  const qc = useQueryClient();
  const [livePulse, setLivePulse] = useState(0);

  const heartbeat = useQuery({
    queryKey: ["heartbeat"],
    queryFn: () => api.get<HeartbeatSnapshot>("/api/heartbeat"),
    refetchInterval: 5_000,
  });

  const schedStatus = useQuery({
    queryKey: ["scheduler-status"],
    queryFn: () => api.get<SchedulerStatus>("/api/scheduler/status"),
    refetchInterval: 5_000,
  });

  useEventStream(() => {
    setLivePulse((n) => n + 1);
    qc.invalidateQueries({ queryKey: ["heartbeat"] });
  });

  const hb = heartbeat.data;

  return (
    <div className="space-y-6">
      <ControlBar status={schedStatus.data} onStatusChange={() => qc.invalidateQueries({ queryKey: ["scheduler-status"] })} />

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ShopHealthStat
          enabled={hb?.enabledCount ?? 0}
          online={hb?.onlineCount ?? 0}
          offline={hb?.offlineCount ?? 0}
          total={hb?.totalShopCount ?? 0}
        />
        <Stat label="Listings getrackt" value={hb?.listingCount ?? "—"} icon={<Box size={16} />} />
        <Stat label="Events 24h" value={hb?.totalEvents24h ?? "—"} icon={<Radio size={16} />} />
        <Stat
          label="Live-Stream"
          value={livePulse > 0 ? `${livePulse} Updates` : "wartet"}
          pulse={livePulse > 0}
          icon={<Radio size={16} />}
        />
      </section>

      <RunningSection runs={hb?.currentlyRunning ?? []} />

      <RecentRunsSection runs={hb?.recentRuns ?? []} />
    </div>
  );
}

function ControlBar({
  status,
  onStatusChange,
}: {
  status: SchedulerStatus | undefined;
  onStatusChange: () => void;
}) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const flash = (kind: "ok" | "err", text: string) => {
    setFeedback({ kind, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  const pause = useMutation({
    mutationFn: () => api.post("/api/scheduler/pause"),
    onSuccess: () => { onStatusChange(); flash("ok", "Scheduler pausiert"); },
    onError: (e) => flash("err", `Pause fehlgeschlagen: ${e}`),
  });
  const resume = useMutation({
    mutationFn: () => api.post("/api/scheduler/resume"),
    onSuccess: () => { onStatusChange(); flash("ok", "Scheduler gestartet"); },
    onError: (e) => flash("err", `Start fehlgeschlagen: ${e}`),
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ eventsDeleted: number; listingsDeleted: number }>("/api/admin/reset-listings-events"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["heartbeat"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      flash("ok", `Gelöscht: ${r.listingsDeleted} Listings, ${r.eventsDeleted} Events`);
    },
    onError: (e) => flash("err", `Reset fehlgeschlagen: ${e}`),
  });
  const heartbeat = useMutation({
    mutationFn: () => api.post("/api/admin/send-heartbeat"),
    onSuccess: () => flash("ok", "Heartbeat gesendet (an alle aktiven Channels)"),
    onError: (e) => flash("err", `Heartbeat fehlgeschlagen: ${e}`),
  });
  const restartBrowser = useMutation({
    mutationFn: () => api.post("/api/admin/restart-browser"),
    onSuccess: () => flash("ok", "Browser geschlossen — wird beim nächsten Playwright-Run neu gestartet"),
    onError: (e) => flash("err", `Browser-Restart fehlgeschlagen: ${e}`),
  });

  const isPaused = status?.paused ?? false;
  const busy = pause.isPending || resume.isPending || reset.isPending || heartbeat.isPending || restartBrowser.isPending;

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex flex-wrap items-center gap-2">
      {isPaused ? (
        <button
          onClick={() => resume.mutate()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
        >
          <Play size={14} /> Start
        </button>
      ) : (
        <button
          onClick={() => pause.mutate()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
        >
          <Pause size={14} /> Pause
        </button>
      )}

      <span className={clsx(
        "text-xs px-2 py-1 rounded font-medium",
        isPaused
          ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
          : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
      )}>
        {isPaused ? "PAUSIERT" : "LÄUFT"}
      </span>

      {status && (
        <span className="text-xs text-slate-500 mr-auto">
          {status.active} aktiv · {status.waiting} wartend · {status.delayed} delayed
        </span>
      )}

      <button
        onClick={() => heartbeat.mutate()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-100 dark:bg-slate-800 text-sm disabled:opacity-50"
      >
        <Send size={13} /> Heartbeat
      </button>

      <button
        onClick={() => restartBrowser.mutate()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-slate-100 dark:bg-slate-800 text-sm disabled:opacity-50"
      >
        <RefreshCw size={13} /> Browser
      </button>

      <button
        onClick={() => { if (confirm("Alle Listings und Events löschen? Sets, Shops und Settings bleiben.")) reset.mutate(); }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200 text-sm disabled:opacity-50"
      >
        <Trash2 size={13} /> Reset DB
      </button>

      {feedback && (
        <div className={clsx(
          "w-full text-xs mt-1 px-2 py-1 rounded",
          feedback.kind === "ok"
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200"
            : "bg-rose-50 text-rose-800 dark:bg-rose-900/20 dark:text-rose-200",
        )}>
          {feedback.text}
        </div>
      )}
    </section>
  );
}

function ShopHealthStat({
  enabled,
  online,
  offline,
  total,
}: {
  enabled: number;
  online: number;
  offline: number;
  total: number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 mb-1">
        <Activity size={16} />
        Shops
      </div>
      <div className="flex items-baseline gap-3">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 leading-tight">{online}</span>
          <span className="text-xs text-slate-500">online</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold text-rose-600 dark:text-rose-400 leading-tight">{offline}</span>
          <span className="text-xs text-slate-500">stale</span>
        </div>
      </div>
      <div className="text-xs text-slate-500 mt-0.5">
        von {enabled} aktiv ({total} total)
      </div>
    </div>
  );
}

function RunningSection({ runs }: { runs: CurrentlyRunning[] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-2">
        <span>Läuft gerade</span>
        {runs.length > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200">
            {runs.length}
          </span>
        )}
      </h2>
      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 px-3 py-4 text-sm text-slate-500">
          Alle idle — nächster Run nach Polling-Intervall.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {runs.map((r) => (
            <div
              key={r.shopId}
              className="rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50/60 dark:bg-blue-900/10 px-3 py-2.5 flex items-center gap-2"
            >
              <Loader2 size={16} className="animate-spin text-blue-700 dark:text-blue-300 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{r.displayName}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex gap-2">
                  <span>{r.adapterType}</span>
                  <span>läuft seit {Math.floor(r.elapsedMs / 1000)}s</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentRunsSection({ runs }: { runs: RecentRun[] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
        Letzte Runs
      </h2>

      {/* Desktop: table */}
      <div className="hidden md:block rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Shop</th>
              <th className="text-center px-2 py-2 font-medium w-8">Status</th>
              <th className="text-right px-2 py-2 font-medium">Vor</th>
              <th className="text-right px-2 py-2 font-medium">Dauer</th>
              <th className="text-right px-2 py-2 font-medium">Listings</th>
              <th className="text-right px-2 py-2 font-medium">Match</th>
              <th className="text-right px-3 py-2 font-medium">Events</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {runs.map((r) => (
              <tr key={r.shopId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.displayName}</div>
                  <div className="text-[11px] text-slate-500">{r.adapterType}</div>
                </td>
                <td className="text-center px-2 py-2">
                  <span
                    className={clsx(
                      "inline-block h-2 w-2 rounded-full",
                      r.online ? "bg-emerald-500" : "bg-rose-500",
                    )}
                    title={r.online ? "online" : "stale"}
                  />
                </td>
                <td className="text-right text-xs text-slate-600 dark:text-slate-400 px-2 py-2 tabular-nums">
                  {r.completedAt ? ago(r.completedAt).replace("vor ", "") : "—"}
                </td>
                <td className="text-right text-xs text-slate-600 dark:text-slate-400 px-2 py-2 tabular-nums">
                  {r.durationMs > 0 ? formatDuration(r.durationMs) : "—"}
                </td>
                <td className="text-right text-xs px-2 py-2 tabular-nums">{r.listingsFound}</td>
                <td className="text-right text-xs px-2 py-2 tabular-nums">{r.matched}</td>
                <td className="text-right text-xs px-3 py-2 tabular-nums">
                  <EventBadges events={r.events} newListings={r.newListings} restocks={r.restocks} />
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center px-3 py-6 text-sm text-slate-500">
                  Noch keine Runs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-2">
        {runs.map((r) => (
          <div
            key={r.shopId}
            className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
          >
            <div className="flex items-start gap-2">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full mt-1.5 shrink-0",
                  r.online ? "bg-emerald-500" : "bg-rose-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{r.displayName}</div>
                <div className="text-[11px] text-slate-500 flex gap-2 flex-wrap mt-0.5">
                  <span>{r.adapterType}</span>
                  <span>· {r.completedAt ? ago(r.completedAt) : "noch nie"}</span>
                  {r.durationMs > 0 && <span>· {formatDuration(r.durationMs)}</span>}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 flex gap-3">
                  <span>{r.listingsFound} listings</span>
                  <span>{r.matched} matched</span>
                  <EventBadges events={r.events} newListings={r.newListings} restocks={r.restocks} />
                </div>
              </div>
            </div>
          </div>
        ))}
        {runs.length === 0 && (
          <div className="text-sm text-slate-500 py-6 text-center">Noch keine Runs.</div>
        )}
      </div>
    </section>
  );
}

function EventBadges({
  events,
  newListings,
  restocks,
}: {
  events: number;
  newListings: number;
  restocks: number;
}) {
  if (events === 0) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <span className="inline-flex gap-1 items-center">
      {newListings > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
          +{newListings} NEW
        </span>
      )}
      {restocks > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200">
          +{restocks} RST
        </span>
      )}
      {events > newListings + restocks && (
        <span className="text-slate-500">+{events - newListings - restocks}</span>
      )}
    </span>
  );
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface StatProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  pulse?: boolean;
}

function Stat({ label, value, icon, pulse }: StatProps) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500 mb-1">
        <span className={pulse ? "animate-pulse text-emerald-500" : ""}>{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-semibold leading-tight">{value}</div>
    </div>
  );
}
