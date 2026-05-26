import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Loader2, Zap, Box } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { Shop, SetList, ShopFamily } from "../lib/types";
import { ago } from "../lib/format";

interface SettingsBag {
  defaultFastSetListId?: string | null;
  defaultSlowSetListId?: string | null;
}

export function ShopsPage() {
  const shops = useQuery({
    queryKey: ["shops"],
    queryFn: () => api.get<Shop[]>("/api/shops"),
  });

  const lists = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<SetList[]>("/api/lists"),
  });

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsBag>("/api/settings"),
  });

  const fastShops = (shops.data ?? []).filter((s) => s.family === "fast");
  const slowShops = (shops.data ?? []).filter((s) => s.family === "slow");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Shops</h1>
        <div className="text-xs text-slate-500 mt-0.5">
          Jeder Shop nutzt entweder den Family-Default oder eine eigene Liste (Override).
          Sets werden global in <a href="/watchlist" className="underline">Sets</a> verwaltet,
          Listen in <a href="/lists" className="underline">Listen</a>.
        </div>
      </div>

      <FamilySection
        family="fast"
        title="HTTP-Shops"
        subtitle="parallel · 3 Worker · schnelle Suche per API"
        icon={<Zap size={16} />}
        colorClass="text-amber-700 dark:text-amber-300"
        shops={fastShops}
        lists={lists.data ?? []}
        defaultListId={settings.data?.defaultFastSetListId ?? null}
      />

      <FamilySection
        family="slow"
        title="Playwright-Shops"
        subtitle="sequenziell · 1 Worker · Chromium-basiert"
        icon={<Box size={16} />}
        colorClass="text-purple-700 dark:text-purple-300"
        shops={slowShops}
        lists={lists.data ?? []}
        defaultListId={settings.data?.defaultSlowSetListId ?? null}
      />
    </div>
  );
}

function FamilySection({
  family,
  title,
  subtitle,
  icon,
  colorClass,
  shops,
  lists,
  defaultListId,
}: {
  family: ShopFamily;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  colorClass: string;
  shops: Shop[];
  lists: SetList[];
  defaultListId: string | null;
}) {
  const qc = useQueryClient();

  const setDefaultMut = useMutation({
    mutationFn: (listId: string | null) => {
      const key = family === "fast" ? "defaultFastSetListId" : "defaultSlowSetListId";
      return api.put(`/api/settings/${key}`, { value: listId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["heartbeat"] });
      qc.invalidateQueries({ queryKey: ["shops"] });
    },
  });

  const defaultListName = lists.find((l) => l.id === defaultListId)?.name ?? "—";

  return (
    <section>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <h2 className={clsx("text-sm font-semibold uppercase tracking-wide flex items-center gap-1.5", colorClass)}>
          {icon}
          {title}
          <span className="text-slate-400 dark:text-slate-500 normal-case font-normal">
            · {shops.length}
          </span>
        </h2>
        <span className="text-xs text-slate-500">{subtitle}</span>
      </div>
      <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Default-Liste:</span>
        <select
          value={defaultListId ?? ""}
          onChange={(e) => setDefaultMut.mutate(e.target.value || null)}
          disabled={setDefaultMut.isPending}
          className="flex-1 max-w-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
        >
          <option value="">— keine — (Shops ohne Override werden geskippt)</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.itemCount} Sets)
            </option>
          ))}
        </select>
        <span className="text-[11px] text-slate-500 hidden md:inline">aktuell: {defaultListName}</span>
      </div>

      <div className="grid gap-2">
        {shops.map((shop) => (
          <ShopRow
            key={shop.id}
            shop={shop}
            lists={lists}
            defaultListId={defaultListId}
            onChanged={() => qc.invalidateQueries({ queryKey: ["shops"] })}
          />
        ))}
        {shops.length === 0 && (
          <div className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-4 text-center">
            Keine {title} aktiv.
          </div>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  shop: Shop;
  lists: SetList[];
  defaultListId: string | null;
  onChanged: () => void;
}

function ShopRow({ shop, lists, defaultListId, onChanged }: RowProps) {
  const [enabled, setEnabled] = useState(shop.enabled);
  const [pollSec, setPollSec] = useState(shop.pollIntervalSeconds);
  const [dropSec, setDropSec] = useState(shop.dropDayIntervalSeconds);
  const [triggerId, setTriggerId] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: (body: Partial<Pick<Shop, "enabled" | "pollIntervalSeconds" | "dropDayIntervalSeconds" | "setListId">>) =>
      api.patch<Shop>(`/api/shops/${shop.id}`, body),
    onSuccess: () => onChanged(),
  });

  const trigger = useMutation({
    mutationFn: () => api.post<{ jobId: string }>(`/api/shops/${shop.id}/trigger`),
    onSuccess: (r) => setTriggerId(r.jobId),
  });

  const dirty =
    enabled !== shop.enabled ||
    pollSec !== shop.pollIntervalSeconds ||
    dropSec !== shop.dropDayIntervalSeconds;

  const effectiveListId = shop.setListId ?? defaultListId;
  const effectiveListName = lists.find((l) => l.id === effectiveListId)?.name ?? "— keine —";
  const usingOverride = shop.setListId !== null;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <div className="flex flex-wrap items-center gap-3 gap-y-2">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              patch.mutate({ enabled: e.target.checked });
            }}
          />
          <span className="font-medium">{shop.displayName}</span>
        </label>
        <span className={clsx("h-2 w-2 rounded-full", !shop.enabled ? "bg-slate-400" : shop.online ? "bg-emerald-500" : "bg-rose-500")} />
        <span className="text-xs text-slate-500">{shop.adapterType}</span>
        <span className="text-xs text-slate-500">letzte: {ago(shop.lastSuccessfulRun)}</span>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending || !shop.enabled}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 disabled:opacity-50"
        >
          {trigger.isPending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Jetzt triggern
        </button>
      </div>
      {triggerId && (
        <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">Job {triggerId} enqueued</div>
      )}

      {/* Per-shop list assignment */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className="text-xs text-slate-500 shrink-0">Liste:</span>
        <select
          value={shop.setListId ?? ""}
          onChange={(e) => patch.mutate({ setListId: e.target.value || null })}
          disabled={patch.isPending}
          className={clsx(
            "flex-1 max-w-xs px-2 py-1 rounded border text-sm",
            usingOverride
              ? "border-blue-400 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20"
              : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900",
          )}
        >
          <option value="">Aus Default ({lists.find((l) => l.id === defaultListId)?.name ?? "—"})</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.itemCount} Sets)
            </option>
          ))}
        </select>
        <span className="text-[11px] text-slate-500">
          → effektiv: <span className="font-medium">{effectiveListName}</span>
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <NumberField
          label={`Poll-Intervall (s)`}
          value={pollSec}
          min={10}
          max={3600}
          onChange={setPollSec}
        />
        <NumberField
          label={`Drop-Day-Intervall (s)`}
          value={dropSec}
          min={5}
          max={600}
          onChange={setDropSec}
        />
      </div>
      {dirty && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => patch.mutate({ pollIntervalSeconds: pollSec, dropDayIntervalSeconds: dropSec })}
            className="text-xs px-3 py-1 rounded bg-blue-600 text-white"
          >
            Speichern
          </button>
          <button
            onClick={() => {
              setEnabled(shop.enabled);
              setPollSec(shop.pollIntervalSeconds);
              setDropSec(shop.dropDayIntervalSeconds);
            }}
            className="text-xs px-3 py-1 rounded bg-slate-200 dark:bg-slate-700"
          >
            Verwerfen
          </button>
        </div>
      )}
    </div>
  );
}

interface NumberProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}
function NumberField({ label, value, min, max, onChange }: NumberProps) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-slate-500 w-32 shrink-0">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
      />
    </label>
  );
}
