import clsx from "clsx";
import { recommendationColor, recommendationSoftBg } from "../lib/cm";
import type { CmRecommendation } from "../lib/types";

interface Props {
  recommendation: CmRecommendation;
  headline?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Ampel-Punkt + Klartext-Headline. Default-Size "md" → klein für Listen.
 * "lg" für Produkt-Detail-Header.
 */
export function SignalBadge({ recommendation, headline, size = "md", className }: Props) {
  const dot = size === "lg" ? "h-3 w-3" : size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";
  const text = size === "lg" ? "text-base font-semibold" : size === "md" ? "text-sm" : "text-xs";
  return (
    <span
      className={clsx("inline-flex items-center gap-2", className)}
      style={size === "lg" ? { backgroundColor: recommendationSoftBg(recommendation) } : undefined}
    >
      <span
        aria-hidden
        className={clsx("inline-block rounded-full shrink-0", dot)}
        style={{ backgroundColor: recommendationColor(recommendation) }}
      />
      {headline && (
        <span className={text} style={{ color: recommendationColor(recommendation) }}>
          {headline}
        </span>
      )}
    </span>
  );
}

/** Headline-Pill für den Produkt-Detail-Header (cm.md §7.6). */
export function SignalHeadlinePill({
  recommendation,
  headline,
}: {
  recommendation: CmRecommendation;
  headline: string;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
      style={{ backgroundColor: recommendationSoftBg(recommendation) }}
    >
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: recommendationColor(recommendation) }}
      />
      <span className="text-sm font-semibold" style={{ color: recommendationColor(recommendation) }}>
        {headline}
      </span>
    </div>
  );
}
