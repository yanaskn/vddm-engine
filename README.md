# VDDM Engine

A self-service decision system built on the Value-Driven Decision Model (VDDM). The decision-maker works alone with three parts that share one state: a guided conversation that draws out what matters, an interactive map where the network is edited and confirmed, and the VDDM scoring algorithm.

Static site, no build step. Deployed on Vercel from `main`.

## Layout

- `index.html` landing page
- `projects/<name>/` one page per project, each an editable decision map with its own browser-side state; "Start a new project" on the landing page is disabled until the guided session exists
- `assets/score.js` the scoring core: Step 5 network quantification, Step 6 Pareto tiers, Step 7 option scoring with guardrails and a sensitivity check; pure functions, tested against the dissertation's Table 13 (`npm test`)
- `assets/map.css`, `assets/map.js` the map module shared by both pages; configured through `window.VDDM_CONFIG` (`fixture`, `readonly`, `storageKey`)
- `fixtures/*.yaml` state documents in schema v2
- `prompts/` the guide prompts, one file per version; the schema is at the end of the current one

## Vocabulary

| Decision-maker sees | Method term |
|---|---|
| DMer | decision-maker |
| Goal | destination objective |
| Sub-goal (SG) | formative sub-objective |
| Lever | means objective |
| Option | alternative |
| Guardrail | constraint objective |
| What matters | value statement |
| Must, important, nice-to-have | must-have, should-have, could-have |

## Status

Cycle 1 done: prompt v1 on a live decision, 15 findings, schema v2. Cycle 2 in progress: prompt v2 and the map prototype. Next: scoring core, guided session, options phase.
