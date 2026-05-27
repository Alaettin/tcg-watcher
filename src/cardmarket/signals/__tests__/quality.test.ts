import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computeSampleQuality } from "../quality.js";
import type { SignalInput } from "../types.js";

const base: SignalInput = {
  trend: 50,
  avg: null,
  low: null,
  trend7dAgo: null,
  trend30dAgo: null,
  snapshotCount: 0,
  snapshotRangePct: null,
};

describe("computeSampleQuality — cm.md §5", () => {
  it("0 wenn kein trend", () => {
    assert.equal(computeSampleQuality({ ...base, trend: null }), 0);
  });

  it("0.5 nur mit trend", () => {
    assert.equal(computeSampleQuality(base), 0.5);
  });

  it("0.7 mit avg dazu", () => {
    assert.equal(computeSampleQuality({ ...base, avg: 60 }), 0.7);
  });

  it("0.9 mit recent stable snapshots", () => {
    const q = computeSampleQuality({
      ...base,
      avg: 60,
      snapshotCount: 5,
      snapshotRangePct: 0.10,
    });
    assert.ok(Math.abs(q - 0.9) < 1e-9);
  });

  it("1.0 mit voller Historie", () => {
    const q = computeSampleQuality({
      ...base,
      avg: 60,
      snapshotCount: 30,
      snapshotRangePct: 0.05,
    });
    // 0.5+0.2+0.2+0.1 hat Float-Rundungsfehler — clamp auf [0,1] in der
    // Engine garantiert <=1, mit minimaler Toleranz für strikte Gleichheit
    assert.ok(Math.abs(q - 1.0) < 1e-9, `expected ~1.0, got ${q}`);
  });

  it("recent stable wird NICHT gezählt wenn Range > 30%", () => {
    const q = computeSampleQuality({
      ...base,
      avg: 60,
      snapshotCount: 5,
      snapshotRangePct: 0.40,
    });
    assert.ok(Math.abs(q - 0.7) < 1e-9);
  });
});
