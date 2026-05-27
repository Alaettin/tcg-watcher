// Pure-Function-Layer für die vier Kern-Signale aus cm.md §3.
// Keine Seiteneffekte, kein I/O. Vollständig unit-testbar.

import { L_MIN_AVG } from "./constants.js";

/**
 * Signal L (Lifetime-Positionierung): `trend / avg - 1`.
 * cm.md §3 edge case: `avg == null` oder `< 1.0` → null.
 */
export function computeL(trend: number | null, avg: number | null): number | null {
  if (trend == null || avg == null) return null;
  if (avg < L_MIN_AVG) return null;
  return trend / avg - 1;
}

/**
 * Signal M (Margin gegen Listing-Floor): `(trend - low) / trend`.
 * cm.md §3 edge case: `low == null` → null. `trend <= 0` → null.
 * `M < 0` (low > trend) ist gültig und kommt vor (cm.md §3).
 */
export function computeM(trend: number | null, low: number | null): number | null {
  if (trend == null || low == null) return null;
  if (trend <= 0) return null;
  return (trend - low) / trend;
}

/**
 * Relative Veränderung: `(today - past) / past`. Generisch für Δ7/Δ30.
 * Edge case: `past <= 0` → null (Division/Sign-Problem).
 */
export function computeDelta(today: number | null, past: number | null): number | null {
  if (today == null || past == null) return null;
  if (past <= 0) return null;
  return (today - past) / past;
}

/**
 * Δ7 mit cm.md §3 Singles-Proxy-Fallback:
 *   1. Wenn Snapshot vor ≥7 Tagen vorhanden → exakte trend-Δ.
 *   2. Sonst (Sealed Tag 0-6 ODER Singles ohne Snapshot-Historie) → CM avg1/avg7-Proxy.
 *   3. Sonst null.
 */
export function resolveDelta7(
  trendToday: number | null,
  trend7dAgo: number | null,
  avg1: number | null | undefined,
  avg7: number | null | undefined,
): number | null {
  const exact = computeDelta(trendToday, trend7dAgo);
  if (exact != null) return exact;
  return computeDelta(avg1 ?? null, avg7 ?? null);
}

/**
 * Δ30 analog mit avg1/avg30-Proxy für Singles.
 */
export function resolveDelta30(
  trendToday: number | null,
  trend30dAgo: number | null,
  avg1: number | null | undefined,
  avg30: number | null | undefined,
): number | null {
  const exact = computeDelta(trendToday, trend30dAgo);
  if (exact != null) return exact;
  return computeDelta(avg1 ?? null, avg30 ?? null);
}
