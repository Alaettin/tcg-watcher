import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { classifyMovement } from "../movement.js";

// classifyMovement(delta7, delta30) — Δ7 zuerst, Δ30 zweitens.

describe("classifyMovement — alle 11 Klassifikationen aus cm.md §3", () => {
  it("Δ30↑↑ + Δ7↑↑ → accelerating", () => {
    assert.equal(classifyMovement(0.20, 0.15), "accelerating");
  });

  it("Δ30↑ + Δ7↑ → stable_uptrend", () => {
    assert.equal(classifyMovement(0.08, 0.06), "stable_uptrend");
  });

  it("Δ30↑ + Δ7→ → stagnating_peak", () => {
    assert.equal(classifyMovement(0.0, 0.06), "stagnating_peak");
  });

  it("Δ30↑ + Δ7↓ → correction_in_uptrend", () => {
    assert.equal(classifyMovement(-0.05, 0.06), "correction_in_uptrend");
  });

  it("Δ30→ + Δ7↑ → turning_up", () => {
    assert.equal(classifyMovement(0.05, 0.0), "turning_up");
  });

  it("Δ30→ + Δ7→ → sideways", () => {
    assert.equal(classifyMovement(0.0, 0.0), "sideways");
  });

  it("Δ30→ + Δ7↓ → turning_down", () => {
    assert.equal(classifyMovement(-0.05, 0.0), "turning_down");
  });

  it("Δ30↓ + Δ7↑ → bounce_in_downtrend", () => {
    assert.equal(classifyMovement(0.05, -0.06), "bounce_in_downtrend");
  });

  it("Δ30↓ + Δ7→ → bottoming", () => {
    assert.equal(classifyMovement(0.0, -0.06), "bottoming");
  });

  it("Δ30↓ + Δ7↓ → stable_downtrend", () => {
    assert.equal(classifyMovement(-0.05, -0.06), "stable_downtrend");
  });

  it("Δ30↓↓ + Δ7↓ → capitulation", () => {
    assert.equal(classifyMovement(-0.05, -0.20), "capitulation");
  });

  it("beide null → unknown (Sealed Tag 0)", () => {
    assert.equal(classifyMovement(null, null), "unknown");
  });

  it("nur Δ7 null + Δ30↑ → klassifiziert trotzdem (FLAT für fehlendes Δ7)", () => {
    // Δ7=FLAT + Δ30=UP → stagnating_peak
    assert.equal(classifyMovement(null, 0.06), "stagnating_peak");
  });
});
