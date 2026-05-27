import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computeDelta, computeL, computeM, resolveDelta7, resolveDelta30 } from "../compute.js";

describe("computeL", () => {
  it("liefert positive Abweichung wenn trend > avg", () => {
    // trend €100, avg €80 → +25% über lifetime
    assert.equal(computeL(100, 80), 0.25);
  });

  it("liefert negative Abweichung wenn trend < avg (Buy-Signal-Kandidat)", () => {
    // 151 ETB Beispiel aus cm.md §4: trend €68, avg €82 → -17%
    assert.ok(computeL(68, 82)! < -0.16);
    assert.ok(computeL(68, 82)! > -0.18);
  });

  it("liefert null wenn avg < 1.0 (Rundungs-Edge-Case)", () => {
    assert.equal(computeL(0.5, 0.8), null);
  });

  it("liefert null wenn avg null", () => {
    assert.equal(computeL(50, null), null);
  });

  it("liefert null wenn trend null", () => {
    assert.equal(computeL(null, 80), null);
  });
});

describe("computeM", () => {
  it("liefert Margin gegen Listing-Floor", () => {
    // trend €100, low €70 → 30% Margin
    assert.equal(computeM(100, 70), 0.3);
  });

  it("liefert > 0.60 (suspicious) bei Outlier-Listing", () => {
    // cm.md §2.2 Beispiel: EX Power Keepers Booster Box trend €7733, low €250
    const m = computeM(7733, 250)!;
    assert.ok(m > 0.6);
    assert.ok(m < 1.0);
  });

  it("liefert negativen Wert wenn low > trend (gültig laut cm.md §3)", () => {
    assert.equal(computeM(100, 120), -0.2);
  });

  it("liefert null wenn low null", () => {
    assert.equal(computeM(100, null), null);
  });

  it("liefert null wenn trend <= 0", () => {
    assert.equal(computeM(0, 50), null);
  });
});

describe("computeDelta", () => {
  it("liefert relative Differenz", () => {
    // +10% von 50 → 55
    assert.ok(Math.abs(computeDelta(55, 50)! - 0.1) < 1e-9);
  });

  it("liefert null bei past <= 0", () => {
    assert.equal(computeDelta(50, 0), null);
  });

  it("liefert null bei null today", () => {
    assert.equal(computeDelta(null, 50), null);
  });
});

describe("resolveDelta7 — Snapshot-vs-Proxy-Fallback", () => {
  it("nutzt Snapshot-Δ wenn verfügbar (Sealed Tag 7+)", () => {
    // trend heute €100, vor 7 Tagen €95 → +5.26%
    const d = resolveDelta7(100, 95, null, null)!;
    assert.ok(Math.abs(d - 0.0526) < 1e-3);
  });

  it("fällt auf avg1/avg7-Proxy zurück wenn kein Snapshot (Singles Tag 0)", () => {
    // avg1 = €60, avg7 = €50 → +20%
    assert.equal(resolveDelta7(100, null, 60, 50), 0.2);
  });

  it("bevorzugt Snapshot über Proxy wenn beide da", () => {
    // Snapshot würde -5% sagen, Proxy +20% — Snapshot gewinnt
    const d = resolveDelta7(95, 100, 60, 50)!;
    assert.ok(d < 0);
  });

  it("liefert null wenn weder Snapshot noch Proxy verfügbar (Sealed Tag 0)", () => {
    assert.equal(resolveDelta7(100, null, null, null), null);
  });
});

describe("resolveDelta30", () => {
  it("nutzt avg30-Proxy für Singles ohne Historie", () => {
    // trend heute null vom Snapshot, avg1=80 vs avg30=50 → +60%
    assert.equal(resolveDelta30(100, null, 80, 50), 0.6);
  });

  it("bevorzugt Snapshot über avg30-Proxy", () => {
    const d = resolveDelta30(95, 100, 80, 50)!;
    assert.ok(d < 0);
  });
});
