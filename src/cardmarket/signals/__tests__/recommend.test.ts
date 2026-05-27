import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { recommend } from "../recommend.js";

describe("recommend — Ampel-Regelwerk aus cm.md §4", () => {
  it("GREEN 'Jetzt günstig' bei L<-0.15 + Korrektur in Aufwärtstrend", () => {
    const v = recommend(-0.20, 0.05, "correction_in_uptrend");
    assert.equal(v.recommendation, "GREEN");
    assert.equal(v.headline, "Jetzt günstig");
  });

  it("GREEN 'Listing-Gelegenheit' bei L<-0.05 + M zwischen 0.15..0.60", () => {
    const v = recommend(-0.10, 0.25, "sideways");
    assert.equal(v.recommendation, "GREEN");
    assert.equal(v.headline, "Listing-Gelegenheit");
  });

  it("RED 'Lokaler Peak' bei L>+0.20 + accelerating", () => {
    const v = recommend(0.25, 0.05, "accelerating");
    assert.equal(v.recommendation, "RED");
    assert.equal(v.headline, "Lokaler Peak");
  });

  it("RED 'Fällt weiter' bei capitulation und L>-0.15", () => {
    const v = recommend(-0.10, 0.05, "capitulation");
    assert.equal(v.recommendation, "RED");
    assert.equal(v.headline, "Fällt weiter");
  });

  it("AMBER 'Steigt — kein Schnäppchen mehr' bei stable_uptrend + L 0..0.15", () => {
    const v = recommend(0.05, 0.05, "stable_uptrend");
    assert.equal(v.recommendation, "AMBER");
    assert.equal(v.headline, "Steigt — kein Schnäppchen mehr");
  });

  it("AMBER 'Beobachten' bei bottoming + L<-0.10", () => {
    const v = recommend(-0.12, 0.05, "bottoming");
    assert.equal(v.recommendation, "AMBER");
    assert.equal(v.headline, "Beobachten");
  });

  it("AMBER 'Listing prüfen' bei M>0.60 ohne andere Treffer", () => {
    const v = recommend(0.05, 0.75, "sideways");
    assert.equal(v.recommendation, "AMBER");
    assert.equal(v.headline, "Listing prüfen");
    assert.equal(v.suspicious, true);
  });

  it("suspicious-Flag wird auch bei GREEN/RED gesetzt", () => {
    const v = recommend(-0.20, 0.75, "correction_in_uptrend");
    assert.equal(v.recommendation, "GREEN");
    assert.equal(v.suspicious, true);
  });

  it("NEUTRAL als Default", () => {
    const v = recommend(0.0, 0.05, "sideways");
    assert.equal(v.recommendation, "NEUTRAL");
    assert.equal(v.headline, "Marktneutral");
  });

  it("NEUTRAL wenn L null (Sealed ohne avg-Daten) und keine andere Regel greift", () => {
    const v = recommend(null, null, "sideways");
    assert.equal(v.recommendation, "NEUTRAL");
  });
});
