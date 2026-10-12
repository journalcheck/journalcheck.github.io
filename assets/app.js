/* JournalCheck website: dataset explorer, evidence reports and a live registry check. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
  const VCLS = { "Low risk": "low", Caution: "cau", "High risk": "high" };
  const VCHIP = { "Low risk": "v-low", Caution: "v-cau", "High risk": "v-high" };
  const RES = { pass: "Pass", fail: "Fail", unknown: "Not checked" };
  const CLASS_NAME = { legitimate: "Legitimate", predatory: "Predatory", hijacked: "Hijacked", compromised: "Compromised" };
  const bandColour = (t) => (t >= 80 ? "var(--low)" : t >= 50 ? "var(--cau)" : "var(--high)");
  const chip = (v) => `<span class="chip ${VCHIP[v] || ""}">${esc(v)}</span>`;
  const cls = (l) => `<span class="cls cls-${esc(l)}">${esc(CLASS_NAME[l] || l)}</span>`;
  const res = (r) => `<span class="res ${r}"><span class="dot ${r}"></span>${RES[r]}</span>`;
  const domainOf = (u) => { try { return new URL(/^https?:/i.test(u) ? u : "http://" + u).hostname.replace(/^www\./, ""); } catch { return u || ""; } };

  let DATA = null, META = null, BYID = {};
  const state = { label: "all", split: "all", q: "", key: "id", dir: 1 };

  /* ------------------------------------------------------------------ boot */
  fetch("data/journals.json")
    .then((r) => r.json())
    .then((d) => {
      DATA = d.journals; META = d.meta;
      DATA.forEach((j) => (BYID[j.id] = j));
      renderCatalogue(); renderMetrics(); renderFilters(); renderTable(); route();
    })
    .catch(() => { $("#dtable tbody").innerHTML = `<tr><td colspan="8">The dataset could not be loaded. Open the site through a web server (GitHub Pages or <code>python -m http.server</code> in docs/).</td></tr>`; });

  /* ------------------------------------------------------------------ indicator catalogue */
  function renderCatalogue() {
    const byCat = {};
    Object.entries(META.indicators).forEach(([id, v]) => (byCat[v.category] = byCat[v.category] || []).push([id, v]));
    $("#cats").innerHTML = Object.entries(META.categories).map(([c, name]) => {
      const items = byCat[c] || [], pts = items.reduce((s, [, v]) => s + v.points, 0);
      return `<div class="cat"><h4>${esc(c)}. ${esc(name)}<span>${pts} pts</span></h4><ul>${items.map(([id, v]) =>
        `<li class="${v.ml ? "" : "list"}"><b>${id}</b>${esc(v.name)}<span class="p">${v.points}</span></li>`).join("")}</ul></div>`;
    }).join("") + `<p class="note" style="grid-column:1/-1;margin:0">40 points in all. Indicators in italics use public lists and are given to the rules only, not to the model.</p>`;
    $("#manual").innerHTML = Object.entries(META.manual_checks).map(([k, v]) => `<li><b>${k}</b> ${esc(v)}</li>`).join("");
  }

  /* ------------------------------------------------------------------ metrics */
  function renderMetrics() {
    const pct = (v) => fmt(100 * v, 0) + "%";
    $("#mtable tbody").innerHTML = META.metrics.map((m) => {
      const best = m.setup.startsWith("Hybrid");
      return `<tr class="${best ? "best" : ""}"><td>${esc(m.setup)}</td><td class="num">${fmt(m.precision_mean, 3)}</td><td class="num">${fmt(m.recall_mean, 3)}</td><td class="num"><b>${fmt(m.f1_mean, 3)}</b> <span class="sd">± ${fmt(m.f1_std, 3)}</span></td><td class="num">${fmt(m.roc_auc_mean, 3)}</td><td class="num">${pct(m.legit_flagged_rate_mean)}</td><td class="num">${pct(m.high_risk_missed_rate_mean)}</td></tr>`;
    }).join("");
  }

  /* ------------------------------------------------------------------ dataset table */
  function renderFilters() {
    const count = (f) => DATA.filter(f).length;
    const labels = [["all", "All"], ["legitimate", "Legitimate"], ["predatory", "Predatory"], ["hijacked", "Hijacked"], ["compromised", "Compromised"]];
    const splits = [["all", "All splits"], ["train", "Training"], ["external", "External test"]];
    $("#seg-label").innerHTML = labels.map(([k, n]) => `<button type="button" data-k="${k}" aria-pressed="${state.label === k}">${n}<span class="c">${count((j) => k === "all" || j.label === k)}</span></button>`).join("");
    $("#seg-split").innerHTML = splits.map(([k, n]) => `<button type="button" data-k="${k}" aria-pressed="${state.split === k}">${n}<span class="c">${count((j) => k === "all" || j.split === k)}</span></button>`).join("");
  }
  $("#seg-label").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.label = b.dataset.k; renderFilters(); renderTable(); });
  $("#seg-split").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; state.split = b.dataset.k; renderFilters(); renderTable(); });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); renderTable(); });
  document.querySelectorAll("#dtable th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k; state.dir = state.key === k ? -state.dir : (["rule", "model", "hybrid"].includes(k) ? -1 : 1); state.key = k; renderTable();
  }));

  const VORDER = { "High risk": 0, Caution: 1, "Low risk": 2 };
  function renderTable() {
    const q = state.q;
    let rows = DATA.filter((j) => (state.label === "all" || j.label === state.label) && (state.split === "all" || j.split === state.split) &&
      (!q || [j.id, j.title, j.issn, j.issn_resolved, j.website].some((v) => v && String(v).toLowerCase().includes(q))));
    const k = state.key, d = state.dir;
    rows.sort((a, b) => {
      let x = a[k], y = b[k];
      if (k === "verdict") { x = VORDER[x]; y = VORDER[y]; }
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * d;
    });
    document.querySelectorAll("#dtable th").forEach((th) => th.setAttribute("aria-sort", th.dataset.k === k ? (d > 0 ? "ascending" : "descending") : "none"));
    $("#dtable tbody").innerHTML = rows.map((j) => `<tr tabindex="0" data-id="${esc(j.id)}">
      <td class="c-id">${esc(j.id)}</td>
      <td><span class="jt">${esc(j.title)}</span><span class="jd">${esc(domainOf(j.website || j.url))}</span></td>
      <td class="c-issn">${esc(j.issn || j.issn_resolved || "–")}</td>
      <td>${cls(j.label)}</td>
      <td class="num c-sc">${fmt(j.rule)}</td>
      <td class="num c-sc">${fmt(j.model)}</td>
      <td class="num"><span class="trust">${fmt(j.hybrid)}<span class="bar"><i style="width:${j.hybrid}%;background:${bandColour(j.hybrid)}"></i></span></span></td>
      <td>${chip(j.verdict)}</td></tr>`).join("") || `<tr><td colspan="8" class="note">No journal matches.</td></tr>`;
    $("#count").textContent = `${rows.length} of ${DATA.length} journals`;
  }
  $("#dtable tbody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) location.hash = "journal/" + tr.dataset.id; });
  $("#dtable tbody").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { const tr = e.target.closest("tr[data-id]"); if (tr) { e.preventDefault(); location.hash = "journal/" + tr.dataset.id; } } });

  /* ------------------------------------------------------------------ evidence report */
  const dlg = $("#report");
  let lastHash = "#dataset";
  window.addEventListener("hashchange", route);
  function route() {
    const m = location.hash.match(/^#journal\/([A-Z]\d{2})$/);
    if (m && BYID[m[1]]) { openReport(BYID[m[1]]); }
    else { if (dlg.open) dlg.close(); if (location.hash && !location.hash.startsWith("#journal")) lastHash = location.hash; }
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) closeReport(); });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeReport(); });
  function closeReport() {
    dlg.close();
    history.replaceState(null, "", lastHash === "#top" ? location.pathname : lastHash);
  }

  function scale(j) {
    const mk = (cl, v, t) => (v === null || v === undefined ? "" : `<span class="mk ${cl}" style="left:${Math.max(0, Math.min(100, v))}%" title="${t} ${fmt(v)}"><i></i></span>`);
    return `<div class="scale" aria-hidden="true"><div class="track"></div>${[0, 50, 80, 100].map((t) => `<span class="tick" style="left:${t}%">${t}</span>`).join("")}
      ${mk("rule", j.rule, "Rules")}${mk("model", j.model, "Model")}${mk("hyb", j.hybrid, "Trust")}</div>
      <div class="legend"><span><i style="background:#7b8698"></i>Rules ${fmt(j.rule)}</span><span><i style="background:#9db8dd"></i>Model ${fmt(j.model)}</span><span><i style="background:var(--navy)"></i>Trust ${fmt(j.hybrid)}</span><span>Evidence coverage ${fmt(100 * j.coverage)}%</span></div>`;
  }

  function indicatorTable(list, { pts = true } = {}) {
    let cur = "", out = "";
    list.forEach((i) => {
      const meta = META.indicators[i.id];
      if (meta.category !== cur) { cur = meta.category; out += `<tr class="catrow"><td colspan="${pts ? 4 : 3}">${esc(cur)}. ${esc(META.categories[cur])}</td></tr>`; }
      out += `<tr class="${i.off ? "off" : ""}"><td><span class="iid">${i.id}</span> ${esc(meta.name)}</td><td>${i.off ? '<span class="res unknown">Full tool</span>' : res(i.result)}</td>${pts ? `<td class="pts">${i.off ? "" : `${+i.points.toFixed(2)} / ${i.max}`}</td>` : ""}<td class="ev">${esc(i.evidence)}</td></tr>`;
    });
    return `<div class="r-itable"><table class="itable"><thead><tr><th>Indicator</th><th>Result</th>${pts ? '<th class="pts">Points</th>' : ""}<th>Evidence</th></tr></thead><tbody>${out}</tbody></table></div>`;
  }

  function openReport(j) {
    const v = VCLS[j.verdict];
    const site = j.website || j.url;
    const advice = { "Low risk": "No serious warning signs in the automated checks. Still do the five manual checks before submitting.", Caution: "Mixed evidence. A person should review the journal before anyone submits to it.", "High risk": "Strong warning signs. Do not submit unless a careful manual review clears the journal." }[j.verdict];
    const fx = j.factors.length ? `<div class="factors">${j.factors.map((f) => {
      const w = Math.min(50, Math.abs(f.value) * 12), pos = f.value > 0;
      return `<div class="fa"><span>${esc(f.feature)}</span><span class="t"><i style="${pos ? "left:50%" : `right:50%`};width:${w}%;background:${pos ? "var(--high)" : "var(--low)"}"></i></span><span class="v">${f.value > 0 ? "+" : ""}${f.value.toFixed(2)}</span></div>`;
    }).join("")}</div><p class="note">Contribution to the log-odds of high risk. Red bars push the model towards high risk; green bars towards low risk.</p>` : `<p class="note">No single feature moved the model much for this journal.</p>`;
    $("#r-body").innerHTML = `
      <div class="r-top"><span class="mono">${esc(j.id)}</span>${cls(j.label)}<span>${j.split === "external" ? "External test journal" : "Training journal"}</span></div>
      <h2 class="r-title" id="r-title">${esc(j.title)}</h2>
      <div class="r-meta"><span>ISSN ${esc(j.issn || j.issn_resolved || "not given")}</span><span>Website checked: <span class="mono">${esc(domainOf(site))}</span></span>${j.publisher ? `<span>Publisher: ${esc(j.publisher)}</span>` : ""}<span>Evidence collected ${esc((j.collected_at || "").slice(0, 10))}</span></div>
      <div class="r-verdict ${v}"><div class="r-vbig ${v}">${esc(j.verdict)}<small>Trust ${fmt(j.hybrid)} / 100</small></div><div>${scale(j)}</div></div>
      <div class="r-boxes">
        <div class="adv ${v === "low" ? "low" : v === "cau" ? "cau" : "high"}">${esc(advice)}</div>
        ${j.overrides.map((o) => `<div class="adv high"><b>Override.</b> ${esc(o)}</div>`).join("")}
        ${j.review.length ? `<div class="adv cau"><b>Human review needed:</b> ${esc(j.review.join("; "))}.</div>` : ""}
        ${j.notes.length ? `<div class="adv info">${esc(j.notes.join(" · "))}</div>` : ""}
      </div>
      <div class="r-sec"><h3>Score by category</h3><div class="catbars">${Object.entries(j.by_category).map(([c, [e, m]]) =>
        `<div class="cb"><span>${esc(c)}. ${esc(META.categories[c])}</span><span class="t"><i style="width:${(100 * e) / m}%"></i></span><span class="v">${+e.toFixed(2)} / ${m}</span></div>`).join("")}</div></div>
      <div class="r-sec"><h3>The 21 indicators</h3>${indicatorTable(j.indicators)}<p class="note">An indicator that could not be checked earns half its points.</p></div>
      <div class="r-sec"><h3>What moved the model</h3>${fx}</div>
      <div class="r-sec"><h3>Checks for a person</h3><ol class="manual">${Object.entries(META.manual_checks).map(([k, t]) => `<li><b>${k}</b> ${esc(t)}</li>`).join("")}</ol></div>
      <div class="r-sec"><p class="note">Label in the dataset: <b>${esc(CLASS_NAME[j.label])}</b>, from ${esc(j.label_source)}. ${j.split === "train" ? "The model score is out-of-fold." : "Scored by the final model, which never saw this journal."}</p></div>`;
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  /* ------------------------------------------------------------------ live registry check */
  const LIVE = ["I1", "I3", "I4", "I5", "I11", "I14", "I15", "I16", "I17"];
  const TWO_LEVEL = new Set("co.in ac.in org.in net.in gov.in edu.in res.in nic.in co.uk ac.uk org.uk com.au edu.au org.au net.au co.nz ac.nz com.br org.br edu.br com.cn edu.cn org.cn ac.cn co.jp ac.jp com.my edu.my com.ng edu.ng com.pk edu.pk ac.id co.id or.id com.tr edu.tr org.tr ac.ir ac.za co.za com.mx edu.mx com.ua com.sg edu.sg com.eg edu.eg ac.th co.th com.ph edu.ph".split(" "));
  const SECOND = new Set("co ac or go ne re com edu org net gov gob mil nic res sch info biz nom lg ed in web".split(" "));
  const GROUPS = [["elsevier.com", "sciencedirect.com", "cell.com", "thelancet.com"], ["springer.com", "springeropen.com", "biomedcentral.com", "nature.com", "springernature.com"],
    ["wiley.com", "onlinelibrary.wiley.com", "hindawi.com"], ["tandfonline.com", "taylorandfrancis.com", "routledge.com"], ["ieee.org", "computer.org"], ["acm.org"],
    ["oup.com", "academic.oup.com"], ["cambridge.org"], ["sagepub.com"], ["mdpi.com"], ["frontiersin.org"], ["iop.org", "iopscience.iop.org"]];

  const normIssn = (s) => { const d = String(s || "").replace(/[^0-9Xx]/g, "").toUpperCase(); return d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4) : null; };
  function issnOk(issn) {
    const d = (issn || "").replace("-", ""); if (!/^\d{7}[\dX]$/.test(d)) return false;
    const t = [...d.slice(0, 7)].reduce((s, c, i) => s + Number(c) * (8 - i), 0), c = (11 - (t % 11)) % 11;
    return d[7] === (c === 10 ? "X" : String(c));
  }
  function regDomain(u) {
    if (!u) return null; let h;
    try { h = new URL(/^https?:/i.test(u) ? u : "http://" + u).hostname.toLowerCase().replace(/\.$/, ""); } catch { return null; }
    const p = h.split(".");
    if (p.length >= 3 && (TWO_LEVEL.has(p.slice(-2).join(".")) || (p[p.length - 1].length === 2 && SECOND.has(p[p.length - 2])))) return p.slice(-3).join(".");
    return p.length >= 2 ? p.slice(-2).join(".") : h;
  }
  const sameSite = (a, b) => { a = regDomain(a); b = regDomain(b); return !!a && !!b && (a === b || GROUPS.some((g) => g.includes(a) && g.includes(b))); };

  async function getJSON(url) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
      if (r.status === 404 || r.status === 410) return { status: "not_found" };
      if (!r.ok) return { status: "error", error: "HTTP " + r.status };
      return { status: "found", data: await r.json() };
    } catch (e) { return { status: "error", error: e.name === "AbortError" ? "timed out" : "not reachable from the browser" }; }
    finally { clearTimeout(t); }
  }

  function ind(id, result, evidence) {
    const max = META.indicators[id].points;
    return { id, result, evidence, max, points: result === "pass" ? max : result === "fail" ? 0 : max / 2 };
  }

  async function liveCheck(issnRaw, urlRaw) {
    const issn = normIssn(issnRaw), url = (urlRaw || "").trim();
    const out = $("#check-out");
    if (!issn) { out.innerHTML = `<div class="adv cau">Enter an ISSN of eight characters, such as 2395-0056.</div>`; return; }
    out.innerHTML = `<div class="loading"><span class="spin"></span>Asking OpenAlex, Crossref and DOAJ about ISSN ${esc(issn)}…</div>`;
    const go = $("#f-go"); go.disabled = true;
    try {
      const checksum = issnOk(issn);
      const [oaR, crR, djR] = checksum ? await Promise.all([
        getJSON(`https://api.openalex.org/sources/issn:${issn}`),
        getJSON(`https://api.crossref.org/journals/${issn}`),
        getJSON(`https://doaj.org/api/search/journals/issn:${issn}`),
      ]) : [{ status: "skipped" }, { status: "skipped" }, { status: "skipped" }];
      const oa = oaR.status === "found" ? oaR.data : null;
      const cr = crR.status === "found" ? (crR.data.message || {}) : null;
      let dj = null, djStatus = djR.status;
      if (djR.status === "found") { const r0 = (djR.data.results || [])[0]; if (r0) dj = r0.bibjson || {}; else djStatus = "not_found"; }
      let rd = null, rdStatus = "skipped";
      if (url) { const dom = regDomain(url); if (dom) { const r = await getJSON(`https://rdap.org/domain/${dom}`); rdStatus = r.status; if (r.status === "found") rd = r.data; } }

      const I = {};
      // I1
      if (!checksum) I.I1 = ind("I1", "fail", `ISSN ${issn} has an invalid check digit`);
      else if (oa || cr) I.I1 = ind("I1", "pass", `ISSN ${issn} resolves in ${[oa && "OpenAlex", cr && "Crossref"].filter(Boolean).join(" and ")}`);
      else if (oaR.status === "not_found" && crR.status === "not_found") I.I1 = ind("I1", "fail", `ISSN ${issn} is valid but has no OpenAlex or Crossref record`);
      else I.I1 = ind("I1", "unknown", "Registries could not be reached");
      // I3
      const regUrls = [oa && oa.homepage_url, dj && dj.ref && dj.ref.journal].filter(Boolean);
      const regDoms = [...new Set(regUrls.map(regDomain).filter(Boolean))];
      if (url && regUrls.length) {
        const ok = regUrls.some((u) => sameSite(url, u));
        I.I3 = ind("I3", ok ? "pass" : "fail", `Website domain ${regDomain(url)} ${ok ? "matches" : "differs from"} registry homepage ${regDoms.join(", ")}`);
      } else I.I3 = ind("I3", "unknown", url ? "No registry homepage to compare with" : "Give the website you were sent to, to compare it with the registry");
      // I4
      const regEv = rd && (rd.events || []).find((e) => e.eventAction === "registration");
      const domYear = regEv && /^\d{4}/.test(regEv.eventDate) ? Number(regEv.eventDate.slice(0, 4)) : null;
      const firstYear = oa && oa.first_publication_year;
      if (domYear && firstYear) {
        const ok = domYear - Math.max(firstYear, 1995) <= 2;
        I.I4 = ind("I4", ok ? "pass" : "fail", `Domain ${regDomain(url)} registered ${domYear}; journal publishing since ${firstYear}`);
      } else I.I4 = ind("I4", "unknown", !url ? "Needs the website address" : rdStatus === "error" ? "Domain registration record not reachable from the browser" : "Domain registration date or first publication year unavailable");
      // I5
      const inDoaj = !!dj || !!(oa && oa.is_in_doaj);
      I.I5 = inDoaj ? ind("I5", "pass", "Indexed in DOAJ") : ind("I5", "unknown", djStatus === "not_found" ? "Not in DOAJ; Scopus (SCImago list) is checked only by the full tool" : "DOAJ not reachable; Scopus is checked only by the full tool");
      // I11
      const fees = [];
      if (oa && oa.apc_usd !== null && oa.apc_usd !== undefined) fees.push(`OpenAlex APC US$${oa.apc_usd}`);
      if (dj && dj.apc && dj.apc.has_apc !== undefined && dj.apc.has_apc !== null) fees.push("DOAJ fee record");
      I.I11 = fees.length ? ind("I11", "pass", "Fees disclosed: " + fees.join("; ")) : ind("I11", "unknown", "No registry fee record; the website's fee page is read only by the full tool");
      // I14
      let share = null, topField = null;
      if (oa && (oa.topics || []).length) {
        const fc = {}; oa.topics.forEach((t) => { const f = (t.field && t.field.display_name) || "unknown"; fc[f] = (fc[f] || 0) + (t.count || 0); });
        const tot = Object.values(fc).reduce((a, b) => a + b, 0);
        if (tot) { [topField] = Object.entries(fc).sort((a, b) => b[1] - a[1])[0]; share = fc[topField] / tot; }
      }
      I.I14 = share === null ? ind("I14", "unknown", "No topic information") : ind("I14", share < 0.35 ? "fail" : "pass", share < 0.35 ? `Only ${Math.round(100 * share)}% of topics in the main field (${topField})` : `Main field ${topField} (${Math.round(100 * share)}% of topics)`);
      // I15
      if (oa && (oa.counts_by_year || []).length) {
        const yr = new Date().getFullYear();
        const rows = oa.counts_by_year.map((c) => [c.year, c.works_count || 0]).filter(([y]) => y && y < yr).sort((a, b) => a[0] - b[0]);
        let best = null, by = null;
        for (let i = 1; i < rows.length; i++) { const [y0, w0] = rows[i - 1], [y1, w1] = rows[i]; if (y1 === y0 + 1 && w1 >= 500) { const g = w1 / Math.max(w0, 1); if (best === null || g > best) { best = g; by = y1; } } }
        const bad = best !== null && best >= 3;
        I.I15 = ind("I15", bad ? "fail" : "pass", bad ? `Output grew ${best.toFixed(1)}x in ${by}` : "No sudden jump in yearly output");
      } else I.I15 = ind("I15", "unknown", "No yearly publication counts");
      // I16
      const lic = dj ? (dj.license || []).map((l) => l.type).filter(Boolean) : [];
      const licCr = cr && cr.coverage ? cr.coverage["licenses-current"] : null;
      if (lic.length || (licCr !== null && licCr !== undefined && licCr >= 0.5)) I.I16 = ind("I16", "pass", "Licence: " + (lic.length ? lic.join(", ") : `${Math.round(100 * licCr)}% of recent Crossref records carry a licence`));
      else if (cr || dj) I.I16 = ind("I16", "fail", "No licence in DOAJ or Crossref metadata");
      else I.I16 = ind("I16", "unknown", "No DOAJ or Crossref record");
      // I17
      const dois = cr && cr.counts ? cr.counts["total-dois"] : 0;
      if (cr && dois > 0) I.I17 = ind("I17", "pass", `${dois.toLocaleString()} DOIs registered with Crossref`);
      else if (crR.status === "found" || crR.status === "not_found") I.I17 = ind("I17", "fail", "No Crossref DOIs for this ISSN");
      else I.I17 = ind("I17", "unknown", "Crossref not reachable");

      renderLive({ issn, url, oa, cr, dj, I, status: { OpenAlex: oaR.status, Crossref: crR.status, DOAJ: djStatus, ...(url ? { "Domain record": rdStatus } : {}) } });
    } finally { go.disabled = false; }
  }

  function renderLive({ issn, url, oa, cr, dj, I, status }) {
    const list = LIVE.map((k) => I[k]);
    const checked = list.filter((i) => i.result !== "unknown");
    const earned = checked.reduce((s, i) => s + i.points, 0), possible = checked.reduce((s, i) => s + i.max, 0);
    const nPass = checked.filter((i) => i.result === "pass").length, nFail = checked.length - nPass;
    const title = (oa && oa.display_name) || (cr && cr.title) || (dj && dj.title) || "No registry record";
    const publisher = (oa && oa.host_organization_name) || (cr && cr.publisher) || (dj && dj.publisher && dj.publisher.name) || "";
    const homepage = (oa && oa.homepage_url) || (dj && dj.ref && dj.ref.journal) || "";
    const known = DATA ? DATA.find((j) => [j.issn, j.issn_resolved].includes(issn)) : null;
    const adv = [];
    if (known) adv.push(`<div class="adv info">This ISSN is in the dataset as <b>${esc(CLASS_NAME[known.label])}</b>; the full tool rated it <b>${esc(known.verdict)}</b>. <a href="#journal/${esc(known.id)}">Open its evidence report</a>.</div>`);
    if (I.I1.result === "fail") adv.push(`<div class="adv high"><b>No registry record.</b> ${esc(I.I1.evidence)}. Almost every genuine journal has an OpenAlex or Crossref record, so treat this journal as high risk until a person has checked it.</div>`);
    if (I.I3.result === "fail") adv.push(`<div class="adv high"><b>${I.I4.result === "fail" ? "Possible clone." : "Different website."}</b> The site you were sent to is not the homepage registered for this ISSN (${esc(homepage)}). Hijackers copy a real journal's title and ISSN onto a look-alike site${I.I4.result === "fail" ? ", and this domain was registered long after the journal began" : ""}. Use the registered homepage, and look the site up in the <a href="https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/" rel="noopener">Retraction Watch Hijacked Journal Checker</a>.</div>`);
    ["I14", "I15", "I16", "I17"].forEach((k) => { if (I[k].result === "fail" && I.I1.result !== "fail") adv.push(`<div class="adv cau"><b>${esc(META.indicators[k].name)}: failed.</b> ${esc(I[k].evidence)}.</div>`); });
    if (!adv.some((a) => a.includes("adv high") || a.includes("adv cau")) && I.I1.result === "pass")
      adv.push(`<div class="adv low">The registry evidence is consistent with a genuine journal. That is not a verdict: the website's wording, the public lists and the five manual checks are still to do.</div>`);
    const st = Object.entries(status).map(([n, s]) => `<span class="src ${s === "found" ? "ok" : s === "not_found" ? "miss" : s === "skipped" ? "miss" : "err"}">${esc(n)}: ${s === "found" ? "record found" : s === "not_found" ? "no record" : s === "skipped" ? "skipped" : "not reachable"}</span>`).join("");
    const rest = Object.keys(META.indicators).filter((k) => !LIVE.includes(k)).map((k) => ({ id: k, off: true, evidence: META.indicators[k].ml ? "Reads the journal's website" : "Uses the public lists (Retraction Watch, Beall's archive, retractions)" }));
    const all = [...list, ...rest].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    $("#check-out").innerHTML = `<div class="cr">
      <div class="cr-head"><div><h3>${esc(title)}</h3><div class="meta">ISSN ${esc(issn)}${publisher ? " · " + esc(publisher) : ""}${homepage ? ` · registered homepage <span class="mono">${esc(domainOf(homepage))}</span>` : ""}${url ? ` · site checked <span class="mono">${esc(domainOf(url))}</span>` : ""}</div><div class="srcs">${st}</div></div>
        <div class="cr-score"><span class="big">${+earned.toFixed(1)} / ${possible}</span><span class="small">registry points · ${nPass} pass, ${nFail} fail, ${LIVE.length - checked.length} not checked</span></div></div>
      <div class="advice">${adv.join("")}</div>
      ${indicatorTable(all)}
      <div class="cr-foot"><span>Look further: <a href="https://portal.issn.org/resource/ISSN/${esc(issn)}" rel="noopener">ISSN Portal</a> · <a href="https://doaj.org/search/journals?source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22${esc(issn)}%22%7D%7D%7D" rel="noopener">DOAJ</a> · <a href="https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/" rel="noopener">Hijacked Journal Checker</a></span>
      <span class="note">For the website, list and model checks, and a full verdict, <a href="#run">run the full tool</a>.</span></div></div>`;
  }

  $("#checkform").addEventListener("submit", (e) => { e.preventDefault(); liveCheck($("#f-issn").value, $("#f-url").value); });
  document.querySelectorAll(".examples button").forEach((b) => b.addEventListener("click", () => {
    $("#f-issn").value = b.dataset.issn; $("#f-url").value = b.dataset.url || ""; liveCheck(b.dataset.issn, b.dataset.url || "");
  }));
})();
