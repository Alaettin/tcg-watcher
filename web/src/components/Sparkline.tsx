import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

interface Props {
  data: Array<{ date: string; value: number | null }>;
  height?: number;
  color?: string;
}

/** Mini-Sparkline ohne Achsen-Labels, für Dashboard-Breitenindex. */
export function Sparkline({ data, height = 32, color = "rgb(59 130 246)" }: Props) {
  if (data.length === 0) return <div style={{ height }} />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
