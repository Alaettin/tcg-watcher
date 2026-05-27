import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computeSignalForProduct } from "../index.js";
import type { SignalInput } from "../types.js";

describe("computeSignalForProduct — Integrationstest aus cm.md §4 Beispiel", () => {
  it("151 ETB-ähnlich: trend 68 / avg 82 / low 54 mit Korrektur-in-Aufwärtstrend → GREEN 'Jetzt günstig'", () => {
    const input: SignalInput = {
      trend: 68,
      avg: 82,
      low: 54,
      // Δ7 = (68-71)/71 = -4.2% → DOWN (< -0.03)
      trend7dAgo: 71,
      // Δ30 = (68-64)/64 = +6.25% → UP (>= 0.05)
      trend30dAgo: 64,
      snapshotCount: 12,
      snapshotRangePct: 0.06,
    };
    const out = computeSignalForProduct(input);

    assert.ok(out.lScore! < -0.16 && out.lScore! > -0.18, `expected L≈-0.17, got ${out.lScore}`);
    assert.ok(out.mScore! > 0.20 && out.mScore! < 0.22, `expected M≈0.21, got ${out.mScore}`);
    assert.equal(out.movementClass, "correction_in_uptrend");
    assert.equal(out.recommendation, "GREEN");
    assert.equal(out.headline, "Jetzt günstig");
    assert.ok(Math.abs(out.sampleQuality - 1.0) < 1e-9);
    // Reasoning enthält trend/avg-Zeile, M-Zeile, Movement-Zeile
    assert.ok(out.reasoningLines.length >= 3);
    assert.ok(out.reasoningLines.some((l) => l.includes("lifetime-avg")));
    assert.ok(out.reasoningLines.some((l) => l.includes("Listing-Fenster")));
  });

  it("Outlier-Listing: trend 7733 / low 250 → suspicious + Listing-Warnung im Reasoning", () => {
    const input: SignalInput = {
      trend: 7733,
      avg: 8000,
      low: 250,
      trend7dAgo: null,
      trend30dAgo: null,
      snapshotCount: 1,
      snapshotRangePct: null,
    };
    const out = computeSignalForProduct(input);
    assert.equal(out.suspicious, true);
    assert.ok(out.reasoningLines.some((l) => l.toLowerCase().includes("manuell prüfen") || l.toLowerCase().includes("listing prüfen") || l.toLowerCase().includes("defekt")));
  });

  it("Sealed Tag 0 ohne Historie: movement_class=unknown, recommendation=NEUTRAL", () => {
    const input: SignalInput = {
      trend: 100,
      avg: null,  // viele Sealed haben keinen avg → L null
      low: 95,
      trend7dAgo: null,
      trend30dAgo: null,
      avg1: null,
      avg7: null,
      avg30: null,
      snapshotCount: 1,
      snapshotRangePct: null,
    };
    const out = computeSignalForProduct(input);
    assert.equal(out.movementClass, "unknown");
    assert.equal(out.recommendation, "NEUTRAL");
    assert.equal(out.lScore, null);
  });
});
