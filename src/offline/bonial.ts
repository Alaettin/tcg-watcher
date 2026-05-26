import type { OfflineAdapter } from "./OfflineAdapter.js";

// Bonial-Adapter stub. Phase 2 will fully implement this against the
// kaufda.de API (or bonial.com directly). For now: returns empty so the
// registry-iteration in the scheduler doesn't crash.
export function createBonialAdapter(): OfflineAdapter {
  return {
    source: "bonial",
    async search() {
      return [];
    },
  };
}
