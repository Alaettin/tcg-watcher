import {
  LONG_HISTORY_MIN_SNAPSHOTS,
  RECENT_STABLE_MAX_RANGE_PCT,
  RECENT_STABLE_MIN_SNAPSHOTS,
  SAMPLE_QUALITY,
} from "./constants.js";
import type { SignalInput } from "./types.js";

/**
 * Sample-Quality nach cm.md §5.
 *
 *   0.5 wenn trend vorhanden, kein avg
 * + 0.2 wenn avg vorhanden
 * + 0.2 wenn ≥3 Snapshots in letzten 7 Tagen UND Range < 30% des trend-Median
 * + 0.1 wenn ≥10 Snapshots verfügbar (≥10 Tage Historie)
 *
 * Maximum 1.0, Minimum 0.0.
 */
export function computeSampleQuality(input: SignalInput): number {
  // trend muss überhaupt vorhanden sein, sonst macht Quality-Bewertung keinen Sinn.
  if (input.trend == null) return 0;

  let q = SAMPLE_QUALITY.TREND_ONLY;

  if (input.avg != null) {
    q += SAMPLE_QUALITY.HAS_AVG;
  }

  if (
    input.snapshotCount >= RECENT_STABLE_MIN_SNAPSHOTS &&
    input.snapshotRangePct != null &&
    input.snapshotRangePct < RECENT_STABLE_MAX_RANGE_PCT
  ) {
    q += SAMPLE_QUALITY.RECENT_STABLE;
  }

  if (input.snapshotCount >= LONG_HISTORY_MIN_SNAPSHOTS) {
    q += SAMPLE_QUALITY.LONG_HISTORY;
  }

  return Math.min(1, Math.max(0, q));
}
