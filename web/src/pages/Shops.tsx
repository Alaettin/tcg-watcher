import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Loader2 } from "lucide-react";
import clsx from "clsx";
import { api } from "../lib/api";
import type { Shop } from "../lib/types";
import { ago } from "../lib/format";

export function ShopsPage() {
  const qc = useQueryClient();
  const shops = useQuery({
    queryKey: ["shops"],
    queryFn: () => api.get<Shop[]>("/api/shops"),
  });

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Shops</h1>
      <div className="grid gap-2">
        {shops.data?.map((shop) => (
          <ShopRow key={shop.id} shop={shop} onChanged={() => qc.invalidateQueries({ queryKey: ["shops"] })} />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  shop: Shop;
  onChanged: () => void;
}

function ShopRow({ shop, onChanged }: RowProps) {
  const [enabled, setEnabled] = useState(shop.enabled);
  const [pollSec, setPollSec] = useState(shop.pollIntervalSeconds);
  const [dropSec, setDropSec] = useState(shop.dropDayIntervalSeconds);
  const [triggerId, setTriggerId] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: (body: Partial<Pick<Shop, "enabled" | "pollIntervalSeconds" | "dropDayIntervalSeconds">>) =>
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
