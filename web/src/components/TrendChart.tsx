import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import { formatEur } from "../lib/cm";
import type { CardmarketHistoryResponse } from "../lib/types";

type Range = "7d" | "30d" | "90d" | "all";

interface Props {
  idProduct: number;
  /** lifetime-avg-Linie als horizontale Referenz */
  avg?: number | null;
  /** L-Bands (cm.md §3) auf avg-Basis darstellen */
  showBands?: boolean;
}

const RANGES: Array<{ value: Range; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "all" },
];

export function TrendChart({ idProduct, avg, showBands = true }: Props) {
  const [range, setRange] = useState<Range>("30d");

  const history = useQuery({
    queryKey: ["cm-history", idProduct, range],
    queryFn: () =>
      api.get<CardmarketHistoryResponse>(`/api/cardmarket/products/${idProduct}/history?range=${range}`),
  });

  const points = history.data?.points ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wide text-slate-500">Preis-Verlauf</div>
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

      {history.isLoading && (
        <div className="h-48 flex items-center justify-center text-xs text-slate-500">Lade…</div>
      )}

      {!history.isLoading && points.length === 0 && (
        <div className="h-48 flex items-center justify-center text-xs text-slate-500 text-center px-4">
          Historie wächst — wir sammeln deine Daten täglich. Tag 7: Δ7 freigeschaltet. Tag 30: Δ30.
        </div>
      )}

      {points.length > 0 && (
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
              {avg != null && showBands && (
                <>
                  {/* L-Bands (cm.md §2.4): ±15% / ±5% Bänder relativ zum avg */}
                  <ReferenceLine y={avg * 1.20} stroke="var(--cm-red)" strokeDasharray="2 4" strokeOpacity={0.5} />
                  <ReferenceLine y={avg * 0.85} stroke="var(--cm-green)" strokeDasharray="2 4" strokeOpacity={0.5} />
                  <ReferenceLine y={avg} stroke="rgb(100,116,139)" strokeDasharray="4 4" strokeOpacity={0.6} />
                </>
              )}
              <Line
                type="monotone"
                dataKey="trend"
                name="trend"
                stroke="rgb(59, 130, 246)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="low"
                name="low"
                stroke="rgb(100,116,139)"
                strokeDasharray="4 2"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
