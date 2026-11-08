(function () {
  const CFG = window.VDDM_CONFIG || {};
  const RO = !!CFG.readonly;
  let FIXTURE = null;
  const KEY = CFG.storageKey || "vddm-map-state-v2";
  let S = null;
  let view = "detail";
  let hoverId = null;      // node under the pointer
  let pinned = null;       // node id pinned in the pane
  let pinnedLink = null;   // {from, to} to highlight a connection row
  const $ = (id) => document.getElementById(id);
  const svg = $("map"), wrap = $("mapwrap"), status = $("status"), pane = $("pane");
  const NS = "http://www.w3.org/2000/svg";
  const PRI = ["must", "important", "nice"];
  const PRI_LABEL = { must: "Must", important: "Important", nice: "Nice-to-have" };
  const KIND_LABEL = { goal: "Goal", sg: "Sub-goal", lever: "Lever", rail: "Guardrail" };

  function load() {
    if (!RO) { try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {} }
    return JSON.parse(JSON.stringify(FIXTURE));
  }
  function save() { if (RO) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function commit() { save(); render(); }

  // ----- lookups
  function nodeById(id) {
    if (!S) return null;
    if (S.goal.id === id) return { kind: "goal", n: S.goal };
    let n = S.sub_goals.find(x => x.id === id); if (n) return { kind: "sg", n };
    n = S.levers.find(x => x.id === id); if (n) return { kind: "lever", n };
    n = S.guardrails.find(x => x.id === id); if (n) return { kind: "rail", n };
    return null;
  }
  function isProposed(l) { return l && l.status === "proposed"; }
  function nextId(prefix, list) { let i = 1; while (list.some(x => x.id === prefix + i)) i++; return prefix + i; }
  function wrapText(t, max, maxLines) {
    const words = String(t || "").trim().split(/\s+/).filter(Boolean); const out = []; let cur = "";
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (!cur) { cur = w; continue; }
      if ((cur + " " + w).length <= max) { cur += " " + w; continue; }
      if (out.length === maxLines - 1) { cur += " " + words.slice(i).join(" "); break; }
      out.push(cur); cur = w;
    }
    if (cur) out.push(cur);
    return out.map(ln => short(ln, max));
  }
  function short(t, max) { t = String(t || ""); return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t; }
  function incoming(id) { return S.levers.flatMap(l => (l.contributes_to || []).filter(c => c.to === id).map(c => ({ from: l.id, pri: c.priority }))); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  function focusTarget() { return hoverId || pinned; }

  // ----- layout
  function layout() {
    const W0 = Math.max(700, Math.floor(wrap.clientWidth) - 2);
    const NH = 58, PITCH = 70, TOP = 46;
    const pos = {};
    const leverIds = new Set(S.levers.map(l => l.id));
    const depth = {};
    const depthOf = (id, seen) => {
      if (depth[id] != null) return depth[id];
      seen = seen || new Set(); if (seen.has(id)) return 0; seen.add(id);
      const l = S.levers.find(x => x.id === id); if (!l) return 0;
      let d = 0;
      (l.contributes_to || []).forEach(c => { if (leverIds.has(c.to)) d = Math.max(d, 1 + depthOf(c.to, seen)); });
      depth[id] = d; return d;
    };
    S.levers.forEach(l => depthOf(l.id));
    const maxDepth = S.levers.reduce((m, l) => Math.max(m, depth[l.id]), 0);
    const cols = maxDepth + 1 + 2;
    const GAP = Math.max(32, Math.min(90, Math.floor((W0 - 60) / (cols * 4))));
    const CW = Math.max(120, Math.min(300, Math.floor((W0 - 60 - GAP * (cols - 1)) / cols)));
    const W = Math.max(W0, 60 + cols * CW + (cols - 1) * GAP);
    const colX = (i) => 30 + i * (CW + GAP);
    const byCol = {};
    const ordered = [];
    const roots = S.levers.filter(l => !l.parent || !S.levers.some(p => p.id === l.parent));
    roots.forEach(r => { ordered.push({ l: r, d: 0 }); S.levers.filter(c => c.parent === r.id).forEach(c => ordered.push({ l: c, d: 1 })); });
    ordered.forEach(o => { const col = maxDepth - depth[o.l.id]; (byCol[col] = byCol[col] || []).push(o); });
    let tallest = 0;
    Object.keys(byCol).forEach(k => { tallest = Math.max(tallest, byCol[k].length); });
    const leverBottom = TOP + Math.max(tallest, 1) * PITCH - (PITCH - NH);
    const colMid = (TOP + leverBottom) / 2;
    Object.keys(byCol).forEach(k => {
      const list = byCol[k], span = list.length * PITCH - (PITCH - NH);
      const y0 = colMid - span / 2;
      list.forEach((o, i) => { pos[o.l.id] = { x: colX(Number(k)) + o.d * 18, y: y0 + i * PITCH, w: CW - o.d * 18, h: NH }; });
    });
    const SX = colX(maxDepth + 1), GX = colX(maxDepth + 2), SW = CW, GW = CW;
    const n = S.sub_goals.length;
    const sgSpan = Math.max((n - 1) * 100, 0);
    S.sub_goals.forEach((s, i) => { pos[s.id] = { x: SX, y: colMid - sgSpan / 2 - NH / 2 + i * 100, w: SW, h: NH }; });
    pos[S.goal.id] = { x: GX, y: colMid - 31, w: GW, h: 62 };
    const bottom = Math.max(leverBottom, colMid + sgSpan / 2 + NH / 2);
    const bandY = bottom + 56;
    const RW = Math.max(180, Math.floor((W - 60 - 28 - 3 * 14) / 4)), RH = 62, gap = 14, perRow = Math.max(1, Math.floor((W - 60 + gap) / (RW + gap)));
    S.guardrails.forEach((r, i) => { const row = Math.floor(i / perRow), col = i % perRow; pos[r.id] = { x: 30 + 14 + col * (RW + gap), y: bandY + 30 + row * (RH + 12), w: RW, h: RH }; });
    const rows = Math.max(1, Math.ceil(S.guardrails.length / perRow));
    const bandH = 30 + rows * (RH + 12) + 4;
    const leverLeft = colX(0), leverRight = colX(maxDepth) + CW;
    return { pos, W, H: bandY + bandH + 20, bandY, bandH, colMid, LW: leverRight - leverLeft, leverLeft, SX, SW, GX, GW, maxDepth };
  }

  function el(name, attrs, parent) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function text(x, y, cls, str, parent, anchor) { const t = el("text", { x, y, class: cls, "text-anchor": anchor || "middle", "dominant-baseline": "central" }, parent); t.textContent = str; return t; }

  // ----- map
  function render() { renderMap(); renderPane(); renderLot(); renderYaml(); renderStatus(); }

  function renderMap() {
    const L = layout();
    svg.setAttribute("viewBox", `0 0 ${L.W} ${L.H}`); svg.setAttribute("width", L.W); svg.setAttribute("height", L.H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    $("dtitle").textContent = S.decision.title || "";
    text(L.leverLeft + L.LW / 2, 22, "label", L.maxDepth > 0 ? "Levers, feeding levers on the left" : "Levers", svg);
    const sum = S.sub_goals.reduce((a, s) => a + (Number(s.share) || 0), 0);
    text(L.SX + L.SW / 2, 22, "label" + (sum === 100 ? "" : " bad"), `Sub-goals, shares ${sum}%`, svg);
    text(L.GX + L.GW / 2, 22, "label", "Goal", svg);
    el("rect", { x: 30, y: L.bandY, width: L.W - 60, height: L.bandH, rx: 12, class: "band" }, svg);
    text(44, L.bandY + 16, "label", "Guardrails", svg, "start");
    const linksG = el("g", {}, svg);
    S.levers.forEach(l => (l.contributes_to || []).forEach(c => {
      const a = L.pos[l.id], b = L.pos[c.to]; if (!a || !b) return;
      if (view === "overview" && c.priority !== "must") return;
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 2, y2 = b.y + b.h / 2;
      let d;
      if (b.x <= a.x + a.w) { const xl = Math.min(a.x, b.x) - 14; d = `M${a.x} ${y1} C ${xl} ${y1}, ${xl} ${y2}, ${b.x} ${y2}`; }
      else { const mx = (x1 + x2) / 2; d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`; }
      const prop = isProposed(l) || isProposed(S.levers.find(x => x.id === c.to));
      const isSel = pinnedLink && pinnedLink.from === l.id && pinnedLink.to === c.to;
      el("path", { d, class: `link ${c.priority}${prop ? " proposed" : ""}${isSel ? " sel" : ""}`, "data-from": l.id, "data-to": c.to }, linksG);
      const h = el("path", { d, class: "hit" }, linksG);
      h.addEventListener("click", (ev) => { ev.stopPropagation(); pin(l.id, { from: l.id, to: c.to }); });
    }));
    S.sub_goals.forEach(s => {
      const a = L.pos[s.id], b = L.pos[S.goal.id];
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 2, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      const share = Number(s.share) || 0, sw = (0.8 + share / 18).toFixed(1);
      const d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      el("path", { d, class: "link share", "stroke-width": sw, "data-from": s.id, "data-to": S.goal.id }, linksG);
      el("rect", { x: mx - 20, y: y1 + (y2 - y1) * 0.5 - 9, width: 40, height: 18, rx: 4, class: "sharebg" }, linksG);
      text(mx, y1 + (y2 - y1) * 0.5, "sharelbl", `${share}%`, linksG);
      const h = el("path", { d, class: "hit" }, linksG);
      h.addEventListener("click", (ev) => { ev.stopPropagation(); pin(s.id, null, "share"); });
    });
    const nodesG = el("g", {}, svg);
    const draw = (kind, n, title, subtitle, extra) => {
      const p = L.pos[n.id];
      const g = el("g", { class: `node ${kind}${extra || ""}${pinned === n.id ? " selected" : ""}`, "data-id": n.id }, nodesG);
      el("rect", { x: p.x, y: p.y, width: p.w, height: p.h, rx: 8 }, g);
      const two = subtitle != null;
      const lines = wrapText(title, Math.floor((p.w - 16) / 6.9), 2);
      const top = p.y + (two ? 15 : (lines.length > 1 ? p.h / 2 - 8 : p.h / 2));
      lines.forEach((ln, i) => text(p.x + p.w / 2, top + i * 15, "t", ln, g));
      if (two) text(p.x + p.w / 2, p.y + p.h - 12, "s", short(subtitle, Math.floor((p.w - 12) / 5.7)), g);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); pin(n.id); });
      g.addEventListener("mouseenter", () => { hoverId = n.id; refocus(); if (!pinned) renderPane(); });
      g.addEventListener("mouseleave", () => { hoverId = null; refocus(); if (!pinned) renderPane(); });
    };
    const detail = view === "detail";
    const net = (typeof VDDMScore !== "undefined") ? VDDMScore.scoreNetwork(S) : null;
    const top = net ? new Set(VDDMScore.paretoTiers(net.leverScores, 0.2)[0] || []) : new Set();
    S.levers.forEach(l => {
      if (isProposed(l)) { draw("lever", l, l.text, `${l.id}, proposed${detail && l.metric ? ", " + l.metric : ""}`, " proposed"); return; }
      draw("lever", l, l.text, net ? `${l.id}, score ${net.scores[l.id].toFixed(2)}, rank ${net.rank[l.id]}${detail && l.metric ? ", " + l.metric : ""}` : (detail ? `${l.id}${l.metric ? ", " + l.metric : ""}` : l.id), top.has(l.id) ? " top" : "");
    });
    S.sub_goals.forEach(s => {
      const gap = incoming(s.id).length === 0;
      draw("sg", s, s.text, gap ? `${s.id}, no lever` : (detail ? `${s.id}${s.booked_by ? ", booked " + s.booked_by : ""}${s.realized_by ? ", realized " + s.realized_by : ""}` : s.id), gap ? " gap" : "");
    });
    draw("goal", S.goal, S.goal.text, detail ? `Goal, ${S.decision.direction}, by ${S.goal.realized_by || S.decision.horizon}` : "Goal");
    S.guardrails.forEach(r => draw("rail", r, r.text, `${r.id}, ${PRI_LABEL[r.weight] || r.weight}${detail && r.bound ? ", " + r.bound : ""}`));
    refocus();
  }
  function isOn(id) {
    const f0 = focusTarget(); if (!f0) return false;
    if (id === f0) return true;
    const f = nodeById(f0); if (!f) return false;
    if (f.kind === "lever") return (f.n.contributes_to || []).some(c => c.to === id) || incoming(f0).some(i => i.from === id);
    return incoming(f0).some(i => i.from === id) || (f.kind === "sg" && id === S.goal.id) || (f.kind === "goal" && S.sub_goals.some(s => s.id === id));
  }
  function refocus() {
    const f = focusTarget();
    svg.classList.toggle("focus", !!f);
    svg.querySelectorAll(".node").forEach(g => g.classList.toggle("on", !!f && isOn(g.dataset.id)));
    svg.querySelectorAll(".link").forEach(p => p.classList.toggle("on", !!f && (p.dataset.from === f || p.dataset.to === f)));
    document.querySelectorAll("#lot li").forEach(li => li.classList.toggle("on", !!f && li.dataset.lever === f));
  }
  function renderStatus() {
    const gaps = S.sub_goals.filter(s => incoming(s.id).length === 0).map(s => s.id);
    const np = S.levers.filter(isProposed).length;
    const parts = [];
    if (gaps.length) parts.push(`Gap check: ${gaps.join(", ")} has no lever pointing at it.`);
    if (np) parts.push(`${np} proposed lever${np > 1 ? "s" : ""} to keep or remove; they do not count until kept.`);
    status.textContent = parts.join(" ");
  }

  // ----- pin and unpin
  function pin(id, link, focusField) {
    pinned = id; pinnedLink = link || null;
    renderMap(); renderPane(focusField);
    if (pinnedLink) { const row = pane.querySelector(`[data-conn="${pinnedLink.to}"]`); if (row) { row.classList.add("flash"); row.scrollIntoView({ block: "nearest" }); } }
  }
  function unpin() { pinned = null; pinnedLink = null; renderMap(); renderPane(); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") unpin(); });
  svg.addEventListener("click", () => unpin());

  // ----- pane
  function row(label, value) { return `<div class="prow"><span>${label}</span><div>${value}</div></div>`; }
  function field(label, value, attrs) { return `<label class="pf">${label}<input ${attrs || ""} value="${esc(value)}"></label>`; }
  function area(label, value, attrs) { return `<label class="pf">${label}<textarea rows="3" ${attrs || ""}>${esc(value)}</textarea></label>`; }
  function nameOf(id) { const t = nodeById(id); return t ? t.n.text : id; }
  function priSelect(cur, attrs) { return `<select ${attrs || ""}>${PRI.map(p => `<option value="${p}"${cur === p ? " selected" : ""}>${PRI_LABEL[p]}</option>`).join("")}</select>`; }

  function renderPane(focusField) {
    if (!pane) return;
    const id = pinned || hoverId;
    const editable = !!pinned && !RO;
    if (!id) {
      pane.innerHTML = `<div class="pempty">${RO ? "Hover a node to see its details." : "Hover a node to preview it. Click a node or a line to edit it here."}</div>`;
      return;
    }
    const t = nodeById(id); if (!t) { pane.innerHTML = ""; return; }
    const { kind, n } = t;
    const net = (typeof VDDMScore !== "undefined") ? VDDMScore.scoreNetwork(S) : null;
    let h = `<div class="phead"><span class="pkind">${isProposed(n) ? "Proposed lever" : KIND_LABEL[kind]} ${esc(n.id)}${editable ? "" : (pinned ? "" : ", preview")}</span>${pinned ? '<button class="btn x" data-act="unpin" aria-label="Close">×</button>' : ""}</div>`;
    if (isProposed(n)) h += `<div class="pnote">Suggested by the guide. Keep it to count it in the scores, or remove it.</div>`;

    if (editable) {
      h += area("Name", n.text, 'data-k="text"');
      if (kind === "goal") h += field("Metric", n.metric, 'data-k="metric"') + field("Target", n.target, 'data-k="target"') + field("Realized by", n.realized_by, 'data-k="realized_by"');
      if (kind === "sg") h += field("Share of goal, %", n.share, 'data-k="share" type="number" min="0" max="100"') + `<div class="pnote" data-sum></div>` + field("Metric", n.metric, 'data-k="metric"') + field("Booked by", n.booked_by, 'data-k="booked_by"') + field("Realized by", n.realized_by, 'data-k="realized_by"');
      if (kind === "lever") h += field("Metric", n.metric, 'data-k="metric"') + field("Target", n.target, 'data-k="target"') + field("By", n.by, 'data-k="by"');
      if (kind === "rail") h += field("Metric", n.metric, 'data-k="metric"') + field("Floor or cap", n.bound, 'data-k="bound"') + `<label class="pf">Weight${priSelect(n.weight, 'data-k="weight"')}</label>`;
    } else {
      h += `<div class="pname">${esc(n.text)}</div>`;
      if (n.metric) h += row("Metric", esc(n.metric));
      if (n.target) h += row("Target", esc(n.target));
      if (kind === "sg") { h += row("Share of goal", `${esc(n.share)}%`); if (n.booked_by) h += row("Booked by", esc(n.booked_by)); if (n.realized_by) h += row("Realized by", esc(n.realized_by)); }
      if (kind === "lever" && n.by) h += row("By", esc(n.by));
      if (kind === "goal" && n.realized_by) h += row("Realized by", esc(n.realized_by));
      if (kind === "rail") { if (n.bound) h += row("Bound", esc(n.bound)); h += row("Weight", PRI_LABEL[n.weight] || esc(n.weight)); }
    }
    if (kind === "lever" && net && !isProposed(n)) h += row("Score", `${net.scores[n.id].toFixed(2)}, rank ${net.rank[n.id]} of ${net.leverScores.length}`);

    // connections
    if (kind === "lever") {
      const conns = n.contributes_to || [];
      h += `<div class="psec">Contributes to</div>`;
      if (!conns.length) h += `<div class="pnote">No connections yet.</div>`;
      conns.forEach(c => {
        h += `<div class="conn" data-conn="${esc(c.to)}"><button class="lnk" data-jump="${esc(c.to)}" title="Go to ${esc(c.to)}">${esc(short(nameOf(c.to), 40))}</button>${editable ? priSelect(c.priority, `data-pri="${esc(c.to)}"`) + `<button class="x" data-rm="${esc(c.to)}" aria-label="Remove connection">×</button>` : `<span class="pri-ro">${PRI_LABEL[c.priority] || esc(c.priority)}</span>`}</div>`;
      });
      if (editable) {
        const taken = new Set(conns.map(c => c.to));
        const targets = [S.goal, ...S.sub_goals, ...S.levers.filter(l => l.id !== n.id)].filter(x => !taken.has(x.id));
        if (targets.length) h += `<div class="addconn"><select data-newtarget>${targets.map(x => `<option value="${esc(x.id)}">${esc(x.id)} ${esc(short(x.text, 34))}</option>`).join("")}</select><button class="btn" data-act="addconn">Add</button></div>`;
      }
    }
    if (kind === "sg") {
      h += `<div class="psec">Forms the goal</div>` + row(esc(short(S.goal.text, 40)), `${esc(n.share)}% share`);
    }
    if (kind === "goal") {
      h += `<div class="psec">Formed by</div>`;
      S.sub_goals.forEach(s => { h += `<div class="conn" data-conn="${esc(s.id)}"><button class="lnk" data-jump="${esc(s.id)}">${esc(short(s.text, 40))}</button><span class="pri-ro">${esc(s.share)}%</span></div>`; });
    }
    const fed = incoming(n.id);
    if (kind !== "rail" && fed.length) {
      h += `<div class="psec">Fed by</div>`;
      fed.forEach(i => { h += `<div class="conn"><button class="lnk" data-jump="${esc(i.from)}">${esc(short(nameOf(i.from), 40))}</button><span class="pri-ro">${PRI_LABEL[i.pri] || esc(i.pri)}</span></div>`; });
    }
    if (kind === "lever") {
      const opts = S.options_parked.filter(o => o.serves === n.id);
      if (opts.length) { h += `<div class="psec">Parked options</div>`; opts.forEach(o => { h += `<div class="popt">${esc(o.text)}</div>`; }); }
    }
    if (editable) {
      h += `<div class="pactions">`;
      if (kind === "lever" && isProposed(n)) h += `<button class="btn primary" data-act="keep">Keep</button>`;
      if (kind !== "goal") h += `<button class="btn danger" data-act="del">${isProposed(n) ? "Remove" : "Delete"}</button>`;
      h += `</div>`;
    }
    pane.innerHTML = h;

    // wiring
    pane.querySelectorAll("[data-jump]").forEach(b => b.addEventListener("click", () => pin(b.dataset.jump)));
    const un = pane.querySelector('[data-act="unpin"]'); if (un) un.addEventListener("click", unpin);
    if (!editable) return;
    const sumEl = pane.querySelector("[data-sum]");
    const updSum = () => { if (sumEl) { const sum = S.sub_goals.reduce((a, x) => a + (Number(x.share) || 0), 0); sumEl.textContent = `All shares sum to ${sum}%. They should sum to 100.`; sumEl.classList.toggle("bad", sum !== 100); } };
    updSum();
    pane.querySelectorAll("[data-k]").forEach(inp => {
      const apply = () => { n[inp.dataset.k] = inp.type === "number" ? Number(inp.value) : (inp.value || undefined); save(); renderMap(); renderYaml(); renderStatus(); updSum(); };
      inp.addEventListener(inp.type === "number" ? "input" : "change", apply);
    });
    pane.querySelectorAll("[data-pri]").forEach(sel => sel.addEventListener("change", () => { const c = (n.contributes_to || []).find(x => x.to === sel.dataset.pri); if (c) { c.priority = sel.value; save(); renderMap(); renderYaml(); } }));
    pane.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { n.contributes_to = (n.contributes_to || []).filter(x => x.to !== b.dataset.rm); pinnedLink = null; commit(); }));
    const add = pane.querySelector('[data-act="addconn"]');
    if (add) add.addEventListener("click", () => { const to = pane.querySelector("[data-newtarget]").value; n.contributes_to = n.contributes_to || []; if (!n.contributes_to.some(c => c.to === to)) n.contributes_to.push({ to, priority: "important" }); pinnedLink = { from: n.id, to }; commit(); });
    const kp = pane.querySelector('[data-act="keep"]'); if (kp) kp.addEventListener("click", () => { delete n.status; commit(); });
    const del = pane.querySelector('[data-act="del"]');
    if (del) del.addEventListener("click", () => {
      if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = isProposed(n) ? "Confirm remove" : "Confirm delete"; return; }
      if (kind === "sg") S.sub_goals = S.sub_goals.filter(x => x !== n);
      if (kind === "rail") S.guardrails = S.guardrails.filter(x => x !== n);
      if (kind === "lever") { S.levers = S.levers.filter(x => x !== n); S.levers.forEach(l => { if (l.parent === n.id) delete l.parent; }); S.options_parked.forEach(o => { if (o.serves === n.id) o.serves = "unassigned"; }); }
      S.levers.forEach(l => { l.contributes_to = (l.contributes_to || []).filter(c => c.to !== n.id); });
      pinned = null; pinnedLink = null; commit();
    });
    if (focusField === "share") { const sh = pane.querySelector('[data-k="share"]'); if (sh) { sh.focus(); sh.select(); } }
    else if (focusField === "name") { const nm = pane.querySelector('[data-k="text"]'); if (nm) { nm.focus(); nm.select(); } }
  }

  // ----- toolbar
  $("vOverview").addEventListener("click", () => setView("overview"));
  $("vDetail").addEventListener("click", () => setView("detail"));
  function setView(v) { view = v; $("vOverview").setAttribute("aria-pressed", v === "overview"); $("vDetail").setAttribute("aria-pressed", v === "detail"); renderMap(); }
  $("addLever").addEventListener("click", () => { const n = { id: nextId("L", S.levers), text: "New lever", metric: "", target: "", by: S.decision.horizon, from: [], contributes_to: [] }; S.levers.push(n); save(); pin(n.id, null, "name"); renderLot(); renderYaml(); renderStatus(); });
  $("addSG").addEventListener("click", () => { const n = { id: nextId("SG", S.sub_goals), text: "New sub-goal", share: 0, metric: "", realized_by: S.decision.horizon, from: [] }; S.sub_goals.push(n); save(); pin(n.id, null, "name"); renderLot(); renderYaml(); renderStatus(); });
  $("addRail").addEventListener("click", () => { const n = { id: nextId("R", S.guardrails), text: "New guardrail", metric: "", bound: "", weight: "important", from: [] }; S.guardrails.push(n); save(); pin(n.id, null, "name"); renderLot(); renderYaml(); renderStatus(); });
  $("reset").addEventListener("click", () => { const b = $("reset"); if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirm reset"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Reset to original"; }, 3000); return; } S = JSON.parse(JSON.stringify(FIXTURE)); b.dataset.armed = ""; b.textContent = "Reset to original"; pinned = null; pinnedLink = null; commit(); });
  const collapse = $("paneToggle");
  if (collapse) collapse.addEventListener("click", () => { const ws = $("workspace"); ws.classList.toggle("collapsed"); collapse.textContent = ws.classList.contains("collapsed") ? "Show details" : "Hide details"; renderMap(); });

  // ----- parked options
  function renderLot() {
    const ul = $("lot"); ul.innerHTML = "";
    const order = S.levers.map(l => l.id);
    const items = [...S.options_parked].sort((a, b) => order.indexOf(a.serves) - order.indexOf(b.serves));
    items.forEach(o => {
      const li = document.createElement("li"); li.dataset.lever = o.serves;
      li.innerHTML = `<span class="tag">${esc(o.serves)}</span><span class="txt">${esc(o.text)}</span><button class="x" aria-label="Remove option">×</button>`;
      if (!RO) li.querySelector(".x").addEventListener("click", () => { S.options_parked = S.options_parked.filter(x => x !== o); commit(); });
      ul.appendChild(li);
    });
    const selL = $("optLever"); const cur = selL.value; selL.innerHTML = S.levers.map(l => `<option value="${l.id}">${l.id} ${esc(short(l.text, 28))}</option>`).join(""); if (cur) selL.value = cur;
  }
  $("optAdd").addEventListener("click", () => { const t = $("optText").value.trim(); if (!t) { $("optText").focus(); return; } S.options_parked.push({ text: t, serves: $("optLever").value }); $("optText").value = ""; commit(); });
  $("optText").addEventListener("keydown", (e) => { if (e.key === "Enter") $("optAdd").click(); });

  // ----- yaml
  function renderYaml() {
    S.gaps = S.sub_goals.filter(s => incoming(s.id).length === 0).map(s => ({ sub_goal: s.id, reason: "" }));
    try { $("yaml").textContent = jsyaml.dump(S, { lineWidth: 120, noRefs: true, quotingType: '"' }); } catch (e) { $("yaml").textContent = "Could not render YAML: " + e.message; }
  }
  $("copy").addEventListener("click", () => {
    const txt = $("yaml").textContent, msg = $("copyMsg");
    const fallback = () => { const r = document.createRange(); r.selectNodeContents($("yaml")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); msg.textContent = "Selected; press copy."; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => { msg.textContent = "Copied."; setTimeout(() => msg.textContent = "", 2000); }, fallback); else fallback();
  });
  $("loadBtn").addEventListener("click", () => {
    const err = $("loadErr"); err.textContent = "";
    try {
      const d = jsyaml.load($("loadText").value);
      if (!d || !d.goal || !Array.isArray(d.levers) || !Array.isArray(d.sub_goals)) throw new Error("Needs goal, sub_goals and levers.");
      d.guardrails = d.guardrails || []; d.options_parked = d.options_parked || []; d.decision = d.decision || {}; d.stakeholders = d.stakeholders || {}; d.what_matters = d.what_matters || []; d.in_place = d.in_place || []; d.notes = d.notes || [];
      S = d; pinned = null; pinnedLink = null; commit(); $("loadText").value = "";
    } catch (e) { err.textContent = "Could not load: " + e.message; }
  });

  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (S) renderMap(); }, 120); });
  if (RO) document.body.classList.add("ro");
  fetch(CFG.fixture).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(txt => { FIXTURE = jsyaml.load(txt); S = load(); render(); })
    .catch(e => { status.textContent = "Could not load the decision: " + e.message; });
})();
