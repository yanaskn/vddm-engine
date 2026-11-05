(function () {
  const CFG = window.VDDM_CONFIG || {};
  const RO = !!CFG.readonly;
  let FIXTURE = null;
  // The first state fixture from cycle 1, migrated to schema v2.
  
  const KEY = CFG.storageKey || "vddm-map-state-v2";
  let S = null;
  let view = "detail";
  let sel = null;          // selected node id (link mode source)
  let focusId = null;      // hovered node id
  const $ = (id) => document.getElementById(id);
  const svg = $("map"), wrap = $("mapwrap"), status = $("status");
  const NS = "http://www.w3.org/2000/svg";
  const PRI = ["must", "important", "nice"];
  const PRI_LABEL = { must: "Must", important: "Important", nice: "Nice-to-have" };

  function load() {
    if (!RO) { try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {} }
    return JSON.parse(JSON.stringify(FIXTURE));
  }
  function save() { if (RO) return; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function commit() { save(); render(); }

  // ----- lookups
  function nodeById(id) {
    if (S.goal.id === id) return { kind: "goal", n: S.goal };
    let n = S.sub_goals.find(x => x.id === id); if (n) return { kind: "sg", n };
    n = S.levers.find(x => x.id === id); if (n) return { kind: "lever", n };
    n = S.guardrails.find(x => x.id === id); if (n) return { kind: "rail", n };
    return null;
  }
  function nextId(prefix, list) { let i = 1; while (list.some(x => x.id === prefix + i)) i++; return prefix + i; }
  function short(t, max) { t = String(t || ""); return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t; }
  function incoming(id) { return S.levers.flatMap(l => (l.contributes_to || []).filter(c => c.to === id).map(c => ({ from: l.id, pri: c.priority }))); }

  // ----- layout
  function layout() {
    const W = 900, LX = 30, LW = 200, SX = 360, SW = 200, GX = 690, GW = 180, NH = 54, PITCH = 68, TOP = 46;
    const pos = {};
    // levers in order, children directly under their parent, indented
    const roots = S.levers.filter(l => !l.parent || !S.levers.some(p => p.id === l.parent));
    const ordered = [];
    roots.forEach(r => { ordered.push({ l: r, depth: 0 }); S.levers.filter(c => c.parent === r.id).forEach(c => ordered.push({ l: c, depth: 1 })); });
    ordered.forEach((o, i) => { pos[o.l.id] = { x: LX + o.depth * 18, y: TOP + i * PITCH, w: LW - o.depth * 18, h: NH }; });
    const leverBottom = TOP + Math.max(ordered.length, 1) * PITCH - (PITCH - NH);
    const colMid = (TOP + leverBottom) / 2;
    const n = S.sub_goals.length;
    const sgSpan = Math.max((n - 1) * 100, 0);
    S.sub_goals.forEach((s, i) => { pos[s.id] = { x: SX, y: colMid - sgSpan / 2 - NH / 2 + i * 100, w: SW, h: NH }; });
    pos[S.goal.id] = { x: GX, y: colMid - 31, w: GW, h: 62 };
    let bottom = Math.max(leverBottom, colMid + sgSpan / 2 + NH / 2);
    // guardrail band
    const bandY = bottom + 56;
    const RW = 196, RH = 48, gap = 14, perRow = Math.max(1, Math.floor((W - 60 + gap) / (RW + gap)));
    S.guardrails.forEach((r, i) => { const row = Math.floor(i / perRow), col = i % perRow; pos[r.id] = { x: 30 + 14 + col * (RW + gap), y: bandY + 30 + row * (RH + 12), w: RW, h: RH }; });
    const rows = Math.max(1, Math.ceil(S.guardrails.length / perRow));
    const bandH = 30 + rows * (RH + 12) + 4;
    return { pos, W, H: bandY + bandH + 20, bandY, bandH, colMid };
  }

  // ----- render
  function el(name, attrs, parent) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function text(x, y, cls, str, parent, anchor) { const t = el("text", { x, y, class: cls, "text-anchor": anchor || "middle", "dominant-baseline": "central" }, parent); t.textContent = str; return t; }

  function render() {
    const L = layout();
    svg.setAttribute("viewBox", `0 0 ${L.W} ${L.H}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    $("dtitle").textContent = S.decision.title || "";
    // column labels
    text(130, 22, "label", "Levers", svg);
    const sum = S.sub_goals.reduce((a, s) => a + (Number(s.share) || 0), 0);
    text(460, 22, "label" + (sum === 100 ? "" : " bad"), `Sub-goals, shares ${sum}%`, svg);
    text(780, 22, "label", "Goal", svg);
    // guardrail band
    el("rect", { x: 30, y: L.bandY, width: L.W - 60, height: L.bandH, rx: 12, class: "band" }, svg);
    text(44, L.bandY + 16, "label", "Guardrails", svg, "start");
    // links (drawn first, under nodes)
    const linksG = el("g", {}, svg);
    S.levers.forEach(l => (l.contributes_to || []).forEach((c, ci) => {
      const a = L.pos[l.id], b = L.pos[c.to]; if (!a || !b) return;
      if (view === "overview" && c.priority !== "must") return;
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 2, y2 = b.y + b.h / 2;
      let d;
      if (b.x <= a.x + a.w) { // target is in the lever column (another lever): hook around the left
        const xl = Math.min(a.x, b.x) - 14;
        d = `M${a.x} ${y1} C ${xl} ${y1}, ${xl} ${y2}, ${b.x} ${y2}`;
      } else {
        const mx = (x1 + x2) / 2; d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      }
      const on = focusId && (focusId === l.id || focusId === c.to);
      const p = el("path", { d, class: `link ${c.priority}${on ? " on" : ""}`, "data-from": l.id, "data-to": c.to }, linksG);
      const h = el("path", { d, class: "hit" }, linksG);
      if (!RO) h.addEventListener("click", (ev) => { ev.stopPropagation(); openLinkPop(l.id, c.to, ev); });
    }));
    // formative links sg -> goal, weighted by share
    S.sub_goals.forEach(s => {
      const a = L.pos[s.id], b = L.pos[S.goal.id];
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 2, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      const on = focusId && (focusId === s.id || focusId === S.goal.id);
      const share = Number(s.share) || 0, sw = (0.8 + share / 18).toFixed(1);
      const d = `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      el("path", { d, class: "link share" + (on ? " on" : ""), "stroke-width": sw, "data-from": s.id, "data-to": S.goal.id }, linksG);
      const ly = y1 + (y2 - y1) * 0.5, lx = mx;
      const bg = el("rect", { x: lx - 20, y: ly - 9, width: 40, height: 18, rx: 4, class: "sharebg" }, linksG);
      text(lx, ly, "sharelbl", `${share}%`, linksG);
      const h = el("path", { d, class: "hit" }, linksG);
      if (!RO) h.addEventListener("click", (ev) => { ev.stopPropagation(); openSharePop(s, ev); });
    });
    // nodes
    const nodesG = el("g", {}, svg);
    const draw = (kind, n, title, subtitle, extra) => {
      const p = L.pos[n.id];
      const g = el("g", { class: `node ${kind}${extra || ""}${sel === n.id ? " selected" : ""}${focusId && isOn(n.id) ? " on" : ""}`, "data-id": n.id }, nodesG);
      el("rect", { x: p.x, y: p.y, width: p.w, height: p.h, rx: 8 }, g);
      const two = subtitle != null;
      text(p.x + p.w / 2, p.y + (two ? 19 : p.h / 2), "t", short(title, Math.floor(p.w / 7.6)), g);
      if (two) text(p.x + p.w / 2, p.y + 38, "s", short(subtitle, Math.floor(p.w / 6.4)), g);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); onNodeClick(kind, n, ev); });
      g.addEventListener("mouseenter", () => { focusId = n.id; svg.classList.add("focus"); refocus(); });
      g.addEventListener("mouseleave", () => { focusId = null; svg.classList.remove("focus"); refocus(); });
      if (sel && sel !== n.id && (kind === "sg" || kind === "goal" || kind === "lever")) g.classList.add("target");
    };
    const detail = view === "detail";
    S.levers.forEach(l => draw("lever", l, l.text, detail ? `${l.id}${l.metric ? ", " + l.metric : ""}` : l.id));
    S.sub_goals.forEach(s => {
      const gap = incoming(s.id).length === 0;
      draw("sg", s, s.text, gap ? `${s.id}, no lever` : (detail ? `${s.id}${s.booked_by ? ", booked " + s.booked_by : ""}${s.realized_by ? ", realized " + s.realized_by : ""}` : s.id), gap ? " gap" : "");
    });
    draw("goal", S.goal, S.goal.text, detail ? `Goal, ${S.decision.direction}, by ${S.goal.realized_by || S.decision.horizon}` : "Goal");
    S.guardrails.forEach(r => draw("rail", r, r.text, `${r.id}, ${PRI_LABEL[r.weight] || r.weight}${detail && r.bound ? ", " + r.bound : ""}`));
    renderLot(); renderYaml(); renderStatus();
  }
  function isOn(id) {
    if (!focusId) return false;
    if (id === focusId) return true;
    const f = nodeById(focusId); if (!f) return false;
    if (f.kind === "lever") return (f.n.contributes_to || []).some(c => c.to === id);
    return incoming(focusId).some(i => i.from === id) || (f.kind === "sg" && id === S.goal.id) || (f.kind === "goal" && S.sub_goals.some(s => s.id === id));
  }
  function refocus() {
    svg.querySelectorAll(".node").forEach(g => g.classList.toggle("on", !!focusId && isOn(g.dataset.id)));
    svg.querySelectorAll(".link").forEach(p => { const f = p.dataset.from, t = p.dataset.to; p.classList.toggle("on", !!focusId && (f === focusId || t === focusId || (!f && false))); });
    document.querySelectorAll("#lot li").forEach(li => li.classList.toggle("on", !!focusId && li.dataset.lever === focusId));
  }
  function renderStatus() {
    if (sel) { const n = nodeById(sel); status.textContent = `Linking ${sel}: click a sub-goal, the goal, or another lever it contributes to. Esc to cancel.`; status.classList.add("active"); }
    else { const gaps = S.sub_goals.filter(s => incoming(s.id).length === 0).map(s => s.id); status.textContent = gaps.length ? `Gap check: ${gaps.join(", ")} has no lever pointing at it.` : "Every sub-goal has at least one lever."; status.classList.remove("active"); }
  }

  // ----- interactions
  function onNodeClick(kind, n, ev) {
    if (RO) return;
    if (sel && sel !== n.id && kind !== "rail") { addLink(sel, n.id, ev); return; }
    openNodePop(kind, n, ev);
  }
  function addLink(from, to, ev) {
    const l = S.levers.find(x => x.id === from); if (!l) return;
    l.contributes_to = l.contributes_to || [];
    if (!l.contributes_to.some(c => c.to === to)) l.contributes_to.push({ to, priority: "important" });
    sel = null; commit(); openLinkPop(from, to, ev);
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { sel = null; closePop(); render(); } });
  svg.addEventListener("click", () => { sel = null; closePop(); render(); });

  // ----- popovers
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function placePop(ev) {
    const r = wrap.getBoundingClientRect();
    let x = ev.clientX - r.left + wrap.scrollLeft + 12, y = ev.clientY - r.top + 12;
    if (x + 290 > wrap.clientWidth + wrap.scrollLeft) x = Math.max(8, ev.clientX - r.left + wrap.scrollLeft - 292);
    pop.style.left = x + "px"; pop.style.top = y + "px";
    wrap.appendChild(pop);
    const over = pop.offsetTop + pop.offsetHeight - wrap.clientHeight; if (over > 0) pop.style.top = Math.max(8, y - over - 8) + "px";
  }
  function field(label, value, attrs) { return `<label>${label}<input ${attrs || ""} value="${esc(value == null ? "" : value)}"></label>`; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

  function openNodePop(kind, n, ev) {
    closePop(); pop = document.createElement("div"); pop.className = "pop"; pop.addEventListener("click", e => e.stopPropagation());
    const name = { goal: "Goal", sg: "Sub-goal", lever: "Lever", rail: "Guardrail" }[kind];
    let body = `<h3>${name} ${esc(n.id)}</h3>` + field("Text", n.text, 'data-k="text"');
    if (kind === "sg") body += field("Share of goal, %", n.share, 'data-k="share" type="number" min="0" max="100"') + field("Metric", n.metric, 'data-k="metric"') + field("Booked by", n.booked_by, 'data-k="booked_by"') + field("Realized by", n.realized_by, 'data-k="realized_by"');
    if (kind === "lever") body += field("Metric", n.metric, 'data-k="metric"') + field("Target", n.target, 'data-k="target"') + field("By", n.by, 'data-k="by"') +
      `<label>Parent lever<select data-k="parent"><option value="">none</option>${S.levers.filter(l => l.id !== n.id).map(l => `<option value="${l.id}"${l.parent === undefined && n.parent === l.id ? " selected" : (n.parent === l.id ? " selected" : "")}>${l.id} ${esc(short(l.text, 30))}</option>`).join("")}</select></label>`;
    if (kind === "goal") body += field("Metric", n.metric, 'data-k="metric"') + field("Target", n.target, 'data-k="target"') + field("Realized by", n.realized_by, 'data-k="realized_by"');
    if (kind === "rail") body += field("Metric", n.metric, 'data-k="metric"') + field("Floor or cap", n.bound, 'data-k="bound"') +
      `<label>Weight</label><div class="pri">${PRI.map(p => `<button class="btn" data-w="${p}" aria-pressed="${n.weight === p}">${PRI_LABEL[p]}</button>`).join("")}</div>`;
    body += `<div class="row">${kind === "lever" ? '<button class="btn primary" data-act="link">Link from here</button>' : ""}<span class="spacer"></span>${kind !== "goal" ? '<button class="btn danger" data-act="del">Delete</button>' : ""}<button class="btn" data-act="done">Done</button></div>`;
    pop.innerHTML = body;
    pop.querySelectorAll("[data-k]").forEach(inp => inp.addEventListener("change", () => { n[inp.dataset.k] = inp.type === "number" ? Number(inp.value) : (inp.value || undefined); if (inp.dataset.k === "parent" && !inp.value) delete n.parent; save(); render(); }));
    pop.querySelectorAll("[data-w]").forEach(b => b.addEventListener("click", () => { n.weight = b.dataset.w; pop.querySelectorAll("[data-w]").forEach(x => x.setAttribute("aria-pressed", x === b)); save(); render(); }));
    pop.querySelector('[data-act="done"]').addEventListener("click", () => { closePop(); render(); });
    const del = pop.querySelector('[data-act="del"]');
    if (del) del.addEventListener("click", () => {
      if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Confirm delete"; return; }
      if (kind === "sg") S.sub_goals = S.sub_goals.filter(x => x !== n);
      if (kind === "rail") S.guardrails = S.guardrails.filter(x => x !== n);
      if (kind === "lever") { S.levers = S.levers.filter(x => x !== n); S.levers.forEach(l => { if (l.parent === n.id) delete l.parent; }); S.options_parked = S.options_parked.filter(o => o.serves !== n.id); }
      S.levers.forEach(l => { l.contributes_to = (l.contributes_to || []).filter(c => c.to !== n.id); });
      closePop(); commit();
    });
    const lk = pop.querySelector('[data-act="link"]');
    if (lk) lk.addEventListener("click", () => { sel = n.id; closePop(); render(); });
    placePop(ev);
    const first = pop.querySelector("input"); if (first) first.focus();
  }

  function openLinkPop(from, to, ev) {
    closePop(); pop = document.createElement("div"); pop.className = "pop"; pop.addEventListener("click", e => e.stopPropagation());
    const l = S.levers.find(x => x.id === from); const c = (l.contributes_to || []).find(x => x.to === to); if (!c) return;
    const t = nodeById(to);
    pop.innerHTML = `<h3>Link</h3><div>${esc(short(l.text, 44))}</div><div class="hint" style="color:var(--muted);font-size:13px">contributes to ${esc(short(t ? t.n.text : to, 44))}</div>
      <label>Priority</label><div class="pri">${PRI.map(p => `<button class="btn" data-p="${p}" aria-pressed="${c.priority === p}">${PRI_LABEL[p]}</button>`).join("")}</div>
      <div class="row"><button class="btn danger" data-act="rm">Remove link</button><span class="spacer"></span><button class="btn" data-act="done">Done</button></div>`;
    pop.querySelectorAll("[data-p]").forEach(b => b.addEventListener("click", () => { c.priority = b.dataset.p; pop.querySelectorAll("[data-p]").forEach(x => x.setAttribute("aria-pressed", x === b)); save(); render(); }));
    pop.querySelector('[data-act="rm"]').addEventListener("click", () => { l.contributes_to = l.contributes_to.filter(x => x !== c); closePop(); commit(); });
    pop.querySelector('[data-act="done"]').addEventListener("click", () => { closePop(); render(); });
    placePop(ev);
  }

  function openSharePop(s, ev) {
    closePop(); pop = document.createElement("div"); pop.className = "pop"; pop.addEventListener("click", e => e.stopPropagation());
    const sum = S.sub_goals.reduce((a, x) => a + (Number(x.share) || 0), 0);
    pop.innerHTML = `<h3>Share of the goal</h3><div>${esc(short(s.text, 44))}</div>
      <label>How much of the goal ${esc(s.id)} represents, %<input type="number" min="0" max="100" value="${Number(s.share) || 0}" data-share></label>
      <div class="hint" style="color:var(--muted);font-size:13px;margin-top:6px">All shares now sum to <span data-sum>${sum}</span>%. They should sum to 100.</div>
      <div class="row"><span class="spacer"></span><button class="btn" data-act="done">Done</button></div>`;
    const inp = pop.querySelector("[data-share]");
    inp.addEventListener("input", () => { s.share = Number(inp.value) || 0; pop.querySelector("[data-sum]").textContent = S.sub_goals.reduce((a, x) => a + (Number(x.share) || 0), 0); save(); });
    pop.querySelector('[data-act="done"]').addEventListener("click", () => { closePop(); render(); });
    placePop(ev); inp.focus(); inp.select();
  }

  // ----- toolbar
  $("vOverview").addEventListener("click", () => setView("overview"));
  $("vDetail").addEventListener("click", () => setView("detail"));
  function setView(v) { view = v; $("vOverview").setAttribute("aria-pressed", v === "overview"); $("vDetail").setAttribute("aria-pressed", v === "detail"); closePop(); render(); }
  $("addLever").addEventListener("click", (ev) => { const n = { id: nextId("L", S.levers), text: "New lever", metric: "", target: "", by: S.decision.horizon, from: [], contributes_to: [] }; S.levers.push(n); commit(); openNodePop("lever", n, ev); });
  $("addSG").addEventListener("click", (ev) => { const n = { id: nextId("SG", S.sub_goals), text: "New sub-goal", share: 0, metric: "", realized_by: S.decision.horizon, from: [] }; S.sub_goals.push(n); commit(); openNodePop("sg", n, ev); });
  $("addRail").addEventListener("click", (ev) => { const n = { id: nextId("R", S.guardrails), text: "New guardrail", metric: "", bound: "", weight: "important", from: [] }; S.guardrails.push(n); commit(); openNodePop("rail", n, ev); });
  $("reset").addEventListener("click", () => { const b = $("reset"); if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirm reset"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "Reset to fixture"; }, 3000); return; } S = JSON.parse(JSON.stringify(FIXTURE)); b.dataset.armed = ""; b.textContent = "Reset to fixture"; sel = null; closePop(); commit(); });

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
      S = d; sel = null; closePop(); commit(); $("loadText").value = "";
    } catch (e) { err.textContent = "Could not load: " + e.message; }
  });

  if (RO) document.body.classList.add("ro");
  fetch(CFG.fixture || "../fixtures/off-season.yaml").then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
    .then(txt => { FIXTURE = jsyaml.load(txt); S = load(); render(); })
    .catch(e => { status.textContent = "Could not load the decision: " + e.message; });
})();
