// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const S = require("../assets/score.js");

const near = (a, b, tol = 0.0051) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test("weights follow Table 8 and accept the engine vocabulary", () => {
  assert.equal(S.weight("must"), 0.95);
  assert.equal(S.weight("should"), 0.6);
  assert.equal(S.weight("important"), 0.6);
  assert.equal(S.weight("could"), 0.3);
  assert.equal(S.weight("nice"), 0.3);
  assert.equal(S.weight("wont"), 0);
  assert.equal(S.weight("must-conflict"), -0.95);
});

test("Step 5 on the off-season fixture: chained lever scores", () => {
  // fixture is YAML; parse it with a minimal loader to avoid a dependency: use js-yaml if present
  let yaml; try { yaml = require("js-yaml"); } catch (e) { yaml = null; }
  if (!yaml) return test.skip("js-yaml not installed; run npm i js-yaml in tests/");
  const state = yaml.load(fs.readFileSync(path.join(__dirname, "..", "fixtures", "off-season.yaml"), "utf8"));
  const net = S.scoreNetwork(state);
  assert.equal(net.converged, true);
  near(net.scores.SG1, 0.75); near(net.scores.SG2, 0.15); near(net.scores.SG3, 0.10);
  near(net.scores.L6, 0.95);                       // must to all three sub-goals
    near(net.scores.L1, 0.95 + 0.95 * 0.95);         // own links plus must into L6
  near(net.scores.L5, 0.95 * 0.75 + 0.6 * 0.15 + 0.6 * 0.95);  // conversion lever: SG1 must, SG2 important, L6 important
  assert.equal(net.leverScores[0].id, "L1");
  assert.equal(net.rank.L8, 7);
});

test("Step 6 Pareto tiers keep ties together", () => {
  const ls = [{ id: "a", score: 1 }, { id: "b", score: 1 }, { id: "c", score: 1 }, { id: "d", score: 0.9 }, { id: "e", score: 0.5 }, { id: "f", score: 0.4 }, { id: "g", score: 0.1 }];
  const tiers = S.paretoTiers(ls, 0.2);
  assert.deepEqual(tiers[0], ["a", "b", "c"]);
  assert.deepEqual(tiers[1], ["d", "e"]);
  assert.deepEqual(tiers[2], ["f", "g"]);
});

test("Step 7 reproduces Table 13 of the dissertation (field test)", () => {
  // Means objective scores (MOS) as printed; options rated as implied by the printed contributions.
  const mos = { expand: 1.6, channels: 1.1, menu: 1.05, share: 0.71, vendors: 0.6, renovate: 0.4, affiliate: 0.34, space: 0.27, discipline: 0.22, price: 0.22, social: 0.04, cred: 0.02, debt: 0.02, brand: 0.01, redundant: 0.01, reporting: 0.01, cookbook: 0.01 };
  const state = { goal: { id: "G" }, sub_goals: [], levers: [], guardrails: [] };
  const net = { scores: mos };
  const options = [
    { id: "repeat", ratings: { expand: "should", channels: "must", menu: "could", share: "must", vendors: "must", renovate: "could", affiliate: "should", price: "could", social: "could", cred: "must", brand: "should", redundant: "could" } },
    { id: "store", ratings: { expand: "should", channels: "must", menu: "could", share: "must", vendors: "must", affiliate: "should", price: "should", social: "must", cred: "must", brand: "should", redundant: "could", cookbook: "should" } },
    { id: "airline", ratings: { expand: "should", channels: "must", menu: "could", share: "must", vendors: "must", affiliate: "should", cred: "must", brand: "could", redundant: "could" } },
    { id: "bridal", ratings: { expand: "must", menu: "could", share: "must", vendors: "could", affiliate: "must", price: "could", social: "must", cred: "must", brand: "must" } },
    { id: "vendor", ratings: { expand: "must", share: "could", vendors: "must", affiliate: "could", social: "should", cred: "could", cookbook: "could" } }
  ];
  const out = S.scoreOptions(state, options, net);
  const byId = Object.fromEntries(out.results.map(r => [r.id, r]));
  near(byId.repeat.contributions.expand, 0.96);
  near(byId.repeat.contributions.channels, 1.045);
  near(byId.repeat.contributions.menu, 0.315);
  near(byId.bridal.contributions.expand, 1.52);
  near(byId.repeat.total, 3.9925);
  near(byId.store.total, 3.9725);
  near(byId.airline.total, 3.7935);
  near(byId.bridal.total, 3.145);
  near(byId.vendor.total, 2.438);
  assert.deepEqual(out.ranked.map(r => r.id), ["repeat", "store", "airline", "bridal", "vendor"]);
});

test("Step 7 guardrails: must disqualifies, important penalizes", () => {
  const state = { goal: { id: "G" }, sub_goals: [{ id: "SG1", share: 100 }], levers: [{ id: "L1", contributes_to: [{ to: "SG1", priority: "must" }] }],
    guardrails: [{ id: "R1", weight: "must" }, { id: "R2", weight: "important" }] };
  const out = S.scoreOptions(state, [
    { id: "a", ratings: { L1: "must" }, guardrails: { R1: true, R2: true } },
    { id: "b", ratings: { L1: "must" }, guardrails: { R1: false, R2: true } },
    { id: "c", ratings: { L1: "must" }, guardrails: { R1: true, R2: false } }
  ]);
  assert.equal(out.disqualified.length, 1);
  assert.equal(out.disqualified[0].id, "b");
  assert.deepEqual(out.ranked.map(r => r.id), ["a", "c"]);
  near(out.ranked[1].adjusted, 0.95 * 0.95 - 0.6);
});

test("sensitivity names the smallest rating change that flips the leader", () => {
  const state = { goal: { id: "G" }, sub_goals: [{ id: "SG1", share: 100 }], levers: [
    { id: "L1", contributes_to: [{ to: "SG1", priority: "must" }] }, { id: "L2", contributes_to: [{ to: "SG1", priority: "must" }] }], guardrails: [] };
  const options = [{ id: "a", ratings: { L1: "must", L2: "must" } }, { id: "b", ratings: { L1: "must", L2: "important" } }];
  const s = S.sensitivity(state, options);
  assert.equal(s.leader, "a"); assert.equal(s.runnerUp, "b");
  assert.ok(s.flips.length >= 1);
  assert.equal(s.flips[0].to, "important");
});
