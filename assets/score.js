/* VDDM scoring core. Pure functions over a schema v2 state. No DOM.
   Step 5: quantify the network (goal = 1, sub-goal = share of its parent, lever = sum of link weight x target score, chained).
   Step 6: Pareto tiers over lever scores.
   Step 7: score options against levers, apply guardrails, rank.
   Weights follow the dissertation (Table 8): must 0.95, should 0.6, could 0.3, won't 0, conflicts negative. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VDDMScore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const WEIGHTS = {
    must: 0.95, should: 0.6, could: 0.3, wont: 0,
    important: 0.6, nice: 0.3,
    must_conflict: -0.95, should_conflict: -0.6, could_conflict: -0.3,
    important_conflict: -0.6, nice_conflict: -0.3
  };
  function weight(priority) {
    if (typeof priority === "number") return priority;
    const w = WEIGHTS[String(priority || "").toLowerCase().replace(/[\s-]+/g, "_")];
    return w == null ? 0 : w;
  }

  // ----- Step 5
  function scoreNetwork(state, opts) {
    const o = Object.assign({ maxIterations: 50, epsilon: 1e-9 }, opts || {});
    const goalId = (state.goal && state.goal.id) || "G";
    const scores = {};
    scores[goalId] = 1;
    const subGoals = state.sub_goals || [];
    const sgById = {};
    subGoals.forEach(s => { sgById[s.id] = s; });
    // sub-goals: share of parent (parent defaults to the goal; nested sub-goals resolve in order)
    const resolveSG = (s, seen) => {
      if (scores[s.id] != null) return scores[s.id];
      seen = seen || new Set();
      if (seen.has(s.id)) return 0;
      seen.add(s.id);
      const parentId = s.parent || goalId;
      const parentScore = parentId === goalId ? 1 : (sgById[parentId] ? resolveSG(sgById[parentId], seen) : 0);
      scores[s.id] = ((Number(s.share) || 0) / 100) * parentScore;
      return scores[s.id];
    };
    subGoals.forEach(s => resolveSG(s));
    // levers: iterate (Bellman-Ford style) until stable; handles lever-to-lever chains and tolerates cycles
    const levers = state.levers || [];
    levers.forEach(l => { scores[l.id] = 0; });
    let iterations = 0, converged = false;
    while (iterations < o.maxIterations && !converged) {
      converged = true; iterations++;
      for (const l of levers) {
        const v = (l.contributes_to || []).reduce((a, c) => a + weight(c.priority) * (scores[c.to] || 0), 0);
        if (Math.abs(v - scores[l.id]) > o.epsilon) { scores[l.id] = v; converged = false; }
      }
    }
    const leverScores = levers.map(l => ({ id: l.id, score: round(scores[l.id]) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const rank = {};
    leverScores.forEach((x, i) => { rank[x.id] = i + 1; });
    return { scores: mapRound(scores), leverScores, rank, converged, iterations };
  }

  // ----- Step 6: Pareto tiers. Each tier holds ceil(n * fraction) levers; a tie across the boundary stays together.
  function paretoTiers(leverScores, fraction) {
    const f = fraction || 0.2;
    const n = leverScores.length; if (!n) return [];
    const size = Math.max(1, Math.ceil(n * f));
    const tiers = []; let i = 0;
    while (i < n) {
      let end = Math.min(n, i + size);
      while (end < n && leverScores[end].score === leverScores[end - 1].score) end++;
      tiers.push(leverScores.slice(i, end).map(x => x.id));
      i = end;
    }
    return tiers;
  }

  // ----- Step 7
  // options: [{id, text, ratings: {leverId: priority}, guardrails: {guardrailId: true|false}}]
  // guardrail handling (extension, provisional): a failed must guardrail disqualifies; a failed important or nice guardrail
  // subtracts its conflict weight from the total.
  function scoreOptions(state, options, network) {
    const net = network || scoreNetwork(state);
    const rails = state.guardrails || [];
    const results = (options || []).map(opt => {
      const contributions = {};
      let total = 0;
      Object.keys(opt.ratings || {}).forEach(leverId => {
        const c = round(weight(opt.ratings[leverId]) * (net.scores[leverId] || 0));
        if (c) { contributions[leverId] = c; total += c; }
      });
      let disqualified = false, penalty = 0; const failed = [];
      rails.forEach(r => {
        const pass = opt.guardrails ? opt.guardrails[r.id] : true;
        if (pass === false) {
          failed.push(r.id);
          if ((r.weight || "must") === "must") disqualified = true;
          else penalty += Math.abs(weight(String(r.weight) + "_conflict"));
        }
      });
      const adjusted = disqualified ? null : round(total - penalty);
      return { id: opt.id, text: opt.text, contributions, total: round(total), penalty: round(penalty), failed, disqualified, adjusted };
    });
    const ranked = results.filter(r => !r.disqualified).sort((a, b) => b.adjusted - a.adjusted);
    ranked.forEach((r, i) => { r.rank = i + 1; });
    return { results, ranked, disqualified: results.filter(r => r.disqualified) };
  }

  // What would have to change for the runner-up to overtake the leader: the smallest single rating change on the leader.
  function sensitivity(state, options, network) {
    const net = network || scoreNetwork(state);
    const out = scoreOptions(state, options, net);
    if (out.ranked.length < 2) return null;
    const lead = out.ranked[0], second = out.ranked[1];
    const gap = round(lead.adjusted - second.adjusted);
    const flips = [];
    const leadOpt = options.find(o => o.id === lead.id);
    Object.keys(leadOpt.ratings || {}).forEach(leverId => {
      const cur = weight(leadOpt.ratings[leverId]);
      ["nice", "important", "must"].forEach(p => {
        const w = weight(p); if (w >= cur) return;
        const drop = round((cur - w) * (net.scores[leverId] || 0));
        if (drop >= gap) flips.push({ lever: leverId, from: leadOpt.ratings[leverId], to: p, drop });
      });
    });
    flips.sort((a, b) => a.drop - b.drop);
    return { leader: lead.id, runnerUp: second.id, gap, flips };
  }

  function round(x) { return Math.round((x + Number.EPSILON) * 10000) / 10000; }
  function mapRound(o) { const r = {}; Object.keys(o).forEach(k => { r[k] = round(o[k]); }); return r; }

  return { WEIGHTS, weight, scoreNetwork, paretoTiers, scoreOptions, sensitivity };
});
