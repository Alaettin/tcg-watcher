import { computeL, computeM, resolveDelta30, resolveDelta7 } from "./compute.js";
import { classifyMovement } from "./movement.js";
import { computeSampleQuality } from "./quality.js";
import { recommend } from "./recommend.js";
import { buildReasoning } from "./templates.js";
import type { SetContext, SignalInput, SignalOutput } from "./types.js";

export * from "./types.js";
export {
  L_BANDS,
  L_MIN_AVG,
  M_BANDS,
  DELTA7_BANDS,
  DELTA30_BANDS,
  SAMPLE_QUALITY,
} from "./constants.js";
export { computeL, computeM, computeDelta, resolveDelta7, resolveDelta30 } from "./compute.js";
export { classifyMovement, arrowForDelta } from "./movement.js";
export { computeSampleQuality } from "./quality.js";
export { recommend } from "./recommend.js";
export { buildReasoning } from "./templates.js";

/**
 * Top-Level-Orchestrator. Nimmt alle Eingaben für ein Produkt entgegen und
 * liefert das vollständige Signal — pure function, ohne DB-Zugriff, damit
 * Step 5 der Sync-Pipeline batched + re-runnable bleibt.
 */
export function computeSignalForProduct(
  input: SignalInput,
  setContext?: SetContext | null,
  languagePendant?: { language: string; trend: number; deviation: number } | null,
): SignalOutput {
  const lScore = computeL(input.trend, input.avg);
  const mScore = computeM(input.trend, input.low);
  const delta7 = resolveDelta7(input.trend, input.trend7dAgo, input.avg1, input.avg7);
  const delta30 = resolveDelta30(input.trend, input.trend30dAgo, input.avg1, input.avg30);

  const movementClass = classifyMovement(delta7, delta30);
  const verdict = recommend(lScore, mScore, movementClass);
  const sampleQuality = computeSampleQuality(input);

  const reasoningLines = buildReasoning({
    input,
    signal: {
      lScore,
      mScore,
      delta7,
      delta30,
      movementClass,
      recommendation: verdict.recommendation,
      headline: verdict.headline,
      suspicious: verdict.suspicious,
    },
    setContext: setContext ?? null,
    languagePendant: languagePendant ?? null,
  });

  return {
    lScore,
    mScore,
    delta7,
    delta30,
    movementClass,
    recommendation: verdict.recommendation,
    headline: verdict.headline,
    suspicious: verdict.suspicious,
    reasoningLines,
    sampleQuality,
  };
}
