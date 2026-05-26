import { createMarktguruAdapter } from "./marktguru.js";
import { createBonialAdapter } from "./bonial.js";
import type { OfflineAdapter } from "./OfflineAdapter.js";

export function getOfflineAdapters(): OfflineAdapter[] {
  return [createMarktguruAdapter(), createBonialAdapter()];
}
