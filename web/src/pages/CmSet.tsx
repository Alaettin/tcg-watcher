import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft } from "lucide-react";
import { api } from "../lib/api";
import { MoverRow } from "../components/MoverRow";
import { AmpelDistributionBar } from "../components/SetHeatmap";
import { formatEur, formatPct } from "../lib/cm";
import type {
  CardmarketSetDetail,
  CardmarketSetHistoryResponse,
} from "../lib/types";

type Range = "7d" | "30d" | "90d" | "all";
const RANGES: Array<{ value: Range; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "all" },
];

export function CmSetPage() {
  const { idExpansion } = useParams<{ idExpansion: string }>();
  const id = Number(idExpansion);
  const [range, setRange] = useState<Range>("30d");

  const detail = useQuery({
    queryKey: ["cm-set-signal", id],
    queryFn: () => api.get<CardmarketSetDetail>(`/api/cardmarket/sets/${id}/signal`),
    enabled: Number.isFinite(id),
  });

  const history = useQuery({
    queryKey: ["cm-set-history", id, range],
    queryFn: () => api.get<CardmarketSetHistoryResponse>(`/api/cardmarket/sets/${id}/history?range=${range}`),
    enabled: Number.isFinite(id),
  });

  if (!Number.isFinite(id)) return <div className="text-sm text-slate-500">Ungültige Set-ID.</div>;
  if (detail.isLoading) return <div className="text-sm text-slate-500">Lade…</div>;
  if (!detail.data?.set) {
    return (
      <div>
        <Link to="/cardmarket/sets" className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
          <ChevronLeft size={12} /> Sets
        </Link>
        <div className="mt-3 text-sm text-slate-500">Set nicht gefunden oder noch keine Signal-Daten.</div>
      </div>
    );
  }

  const { set, products, ampelDistribution } = detail.data;
  const points = history.data?.points ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link to="/cardmarket/sets" className="text-xs text-slate-500 hover:underline inline-flex items-center gap-1">
          <ChevronLeft size={12} /> Sets
        </Link>
        <h1 className="text-xl font-semibold mt-1">
          {set.name ?? `Set ${set.idExpansion}`}
        </h1>
        <div className="text-xs text-slate-500 mt-0.5">
          {set.productCount} Produkte
          {set.releaseDate && <> · Release {set.releaseDate}</>}
        </div>
      </div>

      {/* Set-Signal-Kacheln */}
      <section className="grid grid-cols-3 gap-2">
        <SetStatTile label="Median-L" value={set.medianL} kind="pct" />
        <SetStatTile label="Median-Δ7" value={set.medianDelta7} kind="pct" />
        <SetStatTile label="Volatilität" value={set.volatilityDelta7} kind="pct-abs" />
      </section>

      {/* Ampel-Verteilung */}
      <section>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Ampel-Verteilung</div>
        <AmpelDistributionBar distribution={ampelDistribution} />
      </section>

      {/* Aggregat-Chart */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-wide text-slate-500">Median-trend über Zeit</div>
          <div className="flex gap-1 text-xs">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={
                  range === r.value
                    ? "px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {points.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-xs text-slate-500 text-center px-4">
            Noch keine Historie für dieses Set. Tag 7 zeigt die ersten Bewegungen.
          </div>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "rgb(100,116,139)" }}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgb(100,116,139)" }}
                  tickFormatter={(v: number) => `€${v.toFixed(0)}`}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: "12px",
                    backgroundColor: "rgba(15, 23, 42, 0.95)",
                    border: "none",
                    borderRadius: "6px",
                    color: "white",
                  }}
                  formatter={(v: number) => formatEur(v)}
                />
                <Line
                  type="monotone"
                  dataKey="medianTrend"
                  name="Median-trend"
                  stroke="rgb(59, 130, 246)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Produkt-Liste */}
      <section>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          Produkte ({products.length})
        </div>
        <div className="space-y-1.5">
          {products.map((p) => (
            <MoverRow key={p.product.idProduct} row={p} compact />
          ))}
        </div>
      </section>
    </div>
  );
}

function SetStatTile({
  label,
  value,
  kind,
}: {
  label: string;
  value: number | null;
  kind: "pct" | "pct-abs";
}) {
  const display =
    value == null
      ? "—"
      : kind === "pct-abs"
      ? `${(Math.abs(value) * 100).toFixed(1)}%`
      : formatPct(value);
  const color =
    value == null || kind === "pct-abs"
      ? "rgb(100 116 139)"
      : value > 0.03
      ? "var(--cm-green)"
      : value < -0.03
      ? "var(--cm-red)"
      : "rgb(100 116 139)";
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color }}>
        {display}
      </div>
    </div>
  );
}
