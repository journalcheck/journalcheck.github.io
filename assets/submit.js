/* JournalCheck — Where to submit (beta).
   Everything runs in the reader's browser: the PDF is read locally and only the title,
   abstract and keywords are sent to OpenAlex. Journals and conferences are ranked by how much
   similar recent work they published, then screened with JournalCheck's registry rules. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const OA = "https://api.openalex.org";
  const YEARS_BACK = 5;
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";

  /* ------------------------------------------------------------ static data */
  let CONFS = [], JC = {};
  const ready = Promise.all([
    fetch("data/conferences.json").then((r) => r.json()).then((d) => { CONFS = d.conferences.map(prepConf); }).catch(() => {}),
    fetch("data/journals.json").then((r) => r.json()).then((d) => {
      d.journals.forEach((j) => [j.issn, j.issn_resolved].filter(Boolean).forEach((i) => (JC[i] = j)));
    }).catch(() => {}),
  ]);

  /* ------------------------------------------------------------ text → search terms */
  const STOP = new Set(("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having here how i if in into is it its itself just more most no nor not of off on once only or other our ours out over own paper propose proposed present same she should so some such than that the their them then there these they this those through to too under until up very via was we were what when where which while who whom why will with would you your using use used based approach method methods study results show shows new novel towards toward however thus therefore within across among two three one first second significant significantly existing different various respectively achieve achieves achieved performance state art effective efficient work also furthermore moreover").split(" "));

  function terms({ title, abstract, keywords }) {
    const given = String(keywords || "").split(/[;,·|\n]/).map((k) => k.trim().toLowerCase()).filter((k) => k.length > 2 && k.split(" ").length <= 5);
    const text = `${title}. ${title}. ${abstract}`.toLowerCase().replace(/[^a-z0-9\-\s.,;:()]/g, " ");
    const phrases = [];
    text.split(/[.,;:()\n]+/).forEach((chunk) => {
      let cur = [];
      chunk.split(/\s+/).forEach((w) => {
        w = w.replace(/^-+|-+$/g, "");
        if (!w || STOP.has(w) || /^\d+$/.test(w) || w.length < 3) { if (cur.length) phrases.push(cur); cur = []; }
        else cur.push(w);
      });
      if (cur.length) phrases.push(cur);
    });
    const freq = {}, deg = {};
    phrases.forEach((p) => p.forEach((w) => { freq[w] = (freq[w] || 0) + 1; deg[w] = (deg[w] || 0) + p.length; }));
    const scored = {};
    phrases.filter((p) => p.length <= 3).forEach((p) => { const k = p.join(" "); scored[k] = p.reduce((s, w) => s + deg[w] / freq[w], 0); });
    const auto = Object.entries(scored).sort((a, b) => b[1] - a[1]).map(([k]) => k)
      .filter((k, i, all) => !all.slice(0, i).some((o) => o.includes(k) || k.includes(o)));
    const out = [];
    [...given, ...auto].forEach((k) => { if (out.length < 7 && !out.some((o) => o === k || o.includes(k))) out.push(k); });
    return out;
  }

  /* ------------------------------------------------------------ PDF reading */
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = PDFJS + "pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; res(); };
      s.onerror = () => rej(new Error("The PDF reader could not be loaded."));
      document.head.appendChild(s);
    });
  }
  async function readPdf(file) {
    await loadPdfJs();
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let lines = [], first = [];
    for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      let cur = null;
      tc.items.forEach((it) => {
        const y = Math.round(it.transform[5]), h = Math.abs(it.transform[3]);
        if (!cur || Math.abs(cur.y - y) > 2) { cur = { y, h, s: "" }; lines.push(cur); if (p === 1) first.push(cur); }
        cur.s += (cur.s && !cur.s.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str; cur.h = Math.max(cur.h, h);
      });
    }
    lines = lines.map((l) => ({ ...l, s: l.s.replace(/\s+/g, " ").trim() })).filter((l) => l.s);
    first = first.map((l) => ({ ...l, s: l.s.replace(/\s+/g, " ").trim() })).filter((l) => l.s && l.s.length > 3);
    const maxH = Math.max(...first.slice(0, 25).map((l) => l.h));
    const title = first.slice(0, 25).filter((l) => l.h >= maxH * 0.92).map((l) => l.s).join(" ").slice(0, 300);
    const full = lines.map((l) => l.s).join("\n");
    const ab = full.match(/abstract[\s.:—–-]*([\s\S]{80,3000}?)(?:\n\s*(?:keywords|key words|index terms|ccs concepts|(?:1|i)\.?\s+introduction|introduction)\b)/i);
    const kw = full.match(/(?:keywords|key words|index terms)\s*[:—–-]?\s*([^\n]{3,300}(?:\n[^\n]{3,200})?)/i);
    return {
      title,
      abstract: ab ? ab[1].replace(/\s*\n\s*/g, " ").replace(/(\w)- (\w)/g, "$1$2").trim() : "",
      keywords: kw ? kw[1].replace(/\s*\n\s*/g, " ").replace(/\s*(?:1|i)\.?\s+introduction.*$/i, "").trim() : "",
      pages: pdf.numPages,
    };
  }

  /* ------------------------------------------------------------ OpenAlex */
  const key = () => { try { return localStorage.getItem("jc-oa-key") || ""; } catch { return ""; } };
  async function oa(path, params = {}) {
    const u = new URL(OA + path);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    if (key()) u.searchParams.set("api_key", key());
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (r.status === 429) { $(".ws-adv").open = true; throw new Error("OpenAlex's free daily allowance for this network is used up (on a shared network such as a campus it is shared by everyone). Paste a free OpenAlex key under “Options” below and search again, or try tomorrow."); }
    if (!r.ok) throw new Error(`OpenAlex answered ${r.status}.`);
    return r.json();
  }
  const sid = (u) => String(u || "").split("/").pop();
  const quote = (t) => (t.includes(" ") ? `"${t}"` : t);

  let CLOSEST = 50;
  const SINCE = () => new Date().getFullYear() - YEARS_BACK;
  const GENERIC = new Set("machine learning,deep learning,artificial intelligence,neural network,neural networks,data analysis,case study,systematic review,literature review,proposed method,experimental results,large language models,big data".split(","));

  /* the 50 papers closest in meaning to the title + abstract (OpenAlex semantic search, one call) */
  async function semantic(input) {
    const text = [input.title, input.abstract, input.keywords].filter(Boolean).join(". ").slice(0, 2000);
    const q = { "search.semantic": text, filter: `publication_year:>${SINCE() - 1},is_retracted:false`, per_page: 50,
      select: "id,title,publication_year,relevance_score,primary_location,primary_topic" };
    const res = (await oa("/works", q)).results || [];
    CLOSEST = res.length || 50;
    return res;
  }
  /* how many matching papers each venue published (keyword search on the most specific phrases, grouped) */
  function focus(ts) {
    const specific = ts.filter((t) => !GENERIC.has(t));
    return (specific.length ? specific : ts).slice(0, 3);
  }
  async function grouped(ts, sourceType) {
    const data = await oa("/works", {
      search: focus(ts).map(quote).join(" OR "),
      // journals: research and review articles only (no retraction notices or errata); conference papers carry mixed types
      filter: `from_publication_date:${SINCE()}-01-01,primary_location.source.type:${sourceType},is_retracted:false${sourceType === "journal" ? ",type:article|review" : ""}`,
      group_by: "primary_location.source.id",
    });
    const m = {};
    (data.group_by || []).forEach((g) => { const k = sid(g.key); if (k) m[k] = { id: k, name: g.key_display_name, count: g.count }; });
    return m;
  }
  /* per-venue evidence from the semantic results; plus the paper's subject profile */
  function fromSemantic(works) {
    const by = {}, sub = {}, field = {};
    const minRel = Math.min(...works.map((w) => w.relevance_score || 0));
    works.forEach((w) => {
      const r = Math.max(0.01, (w.relevance_score || 0) - minRel + 0.02);
      const t = w.primary_topic;
      if (t && t.subfield) sub[t.subfield.display_name] = (sub[t.subfield.display_name] || 0) + r;
      if (t && t.field) field[t.field.display_name] = (field[t.field.display_name] || 0) + r;
      const s = w.primary_location && w.primary_location.source;
      if (!s || !s.id) return;
      const k = sid(s.id);
      const e = (by[k] = by[k] || { id: k, name: s.display_name, type: s.type, sem: 0, n: 0, titles: [] });
      e.sem += r; e.n += 1;
      if (e.titles.length < 2 && w.title) e.titles.push(w.title);
    });
    const norm = (o) => { const t = Object.values(o).reduce((a, b) => a + b, 0) || 1; Object.keys(o).forEach((k) => (o[k] /= t)); return o; };
    return { venues: by, profile: { sub: norm(sub), field: norm(field) } };
  }
  /* histogram intersection between the paper's subfields and the venue's published topics */
  function scope(profile, src) {
    const tp = src.topics || [];
    const tot = tp.reduce((a, t) => a + (t.count || 0), 0);
    if (!tot) return null;
    const vs = {}, vf = {};
    tp.forEach((t) => { const w = (t.count || 0) / tot; if (t.subfield) vs[t.subfield.display_name] = (vs[t.subfield.display_name] || 0) + w; if (t.field) vf[t.field.display_name] = (vf[t.field.display_name] || 0) + w; });
    const inter = (a, b) => Object.keys(a).reduce((s, k) => s + Math.min(a[k], b[k] || 0), 0);
    return 0.7 * inter(profile.sub, vs) + 0.3 * inter(profile.field, vf);
  }

  /* ------------------------------------------------------------ journals */
  const SRC_FIELDS = "id,display_name,issn_l,issn,host_organization_name,type,homepage_url,works_count,cited_by_count,summary_stats,is_oa,is_in_doaj,apc_usd,counts_by_year,topics,is_core";
  function screen(src) {
    const flags = [];
    const issns = [src.issn_l, ...(src.issn || [])].filter(Boolean);
    const known = issns.map((i) => JC[i]).find(Boolean);
    if (known) flags.push({ level: known.verdict === "High risk" ? "high" : known.verdict === "Caution" ? "cau" : "low", text: `JournalCheck dataset: ${known.verdict}`, id: known.id });
    const rows = (src.counts_by_year || []).map((c) => [c.year, c.works_count || 0]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < rows.length; i++) {
      const [y0, w0] = rows[i - 1], [y1, w1] = rows[i];
      if (y1 === y0 + 1 && y1 < new Date().getFullYear() && w1 >= 500 && w1 / Math.max(w0, 1) >= 3) { flags.push({ level: "cau", text: `Output grew ${(w1 / Math.max(w0, 1)).toFixed(1)}× in ${y1}` }); break; }
    }
    if ((src.works_count || 0) < 50) flags.push({ level: "cau", text: "Fewer than 50 papers on record" });
    const h = (src.summary_stats && src.summary_stats.h_index) || 0;
    if (!known && !src.is_in_doaj && !src.is_core && h < 25) flags.push({ level: "cau", text: "Little track record: not in DOAJ or the CWTS core list. Run the full check" });
    const level = flags.some((f) => f.level === "high") ? "high" : flags.some((f) => f.level === "cau") ? "cau" : "low";
    return { level, flags };
  }
  function fee(src) {
    if (src.apc_usd != null) return { usd: src.apc_usd, text: src.apc_usd === 0 ? "No publication fee" : `APC US$${src.apc_usd.toLocaleString()}` };
    if (src.is_in_doaj || src.is_oa) return { usd: null, text: "Open access, fee not recorded" };
    return { usd: 0, text: "Subscription (no fee to publish closed)" };
  }
  async function rankJournals(sem, counts, opt) {
    const semJ = Object.values(sem.venues).filter((v) => v.type === "journal");
    const ids = [...new Set([
      ...semJ.sort((a, b) => b.sem - a.sem).slice(0, 20).map((v) => v.id),
      ...Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 30).map((v) => v.id),
    ])];
    // single-source lookups are free on OpenAlex; fetch five at a time so a burst does not trip its rate limit
    const srcs = [];
    for (let i = 0; i < ids.length; i += 5) srcs.push(...await Promise.all(ids.slice(i, i + 5).map((k) => oa(`/sources/${k}`, { select: SRC_FIELDS }).catch(() => null))));
    const maxSem = Math.max(0.001, ...semJ.map((v) => v.sem));
    return ids.map((k, i) => ({ k, s: srcs[i] })).filter(({ s }) => s && s.type === "journal").map(({ k, s }) => {
      const v = sem.venues[k] || { sem: 0, n: 0, titles: [] }, cnt = (counts[k] || {}).count || 0;
      // share of the journal's own output that matches: a specialist journal beats a mega-journal with a bigger raw count
      const total = (s.counts_by_year || []).filter((c) => c.year >= SINCE()).reduce((a, c) => a + (c.works_count || 0), 0);
      const share = total ? Math.min(1, cnt / total) : 0;
      const semN = Math.sqrt(v.sem / maxSem), shareN = Math.min(1, share / 0.05), sc0 = scope(sem.profile, s);
      const scopeN = sc0 == null ? 0.3 : Math.min(1, sc0 / 0.5);           // 50% overlap or more counts as a full scope match
      const h = (s.summary_stats && s.summary_stats.h_index) || 0, quality = Math.min(1, Math.log10(h + 1) / Math.log10(300));
      // scope also scales the whole fit, so a keyword-heavy journal in another field cannot rank on volume
      const fit = (0.5 * semN + 0.25 * shareN + 0.25 * scopeN) * (0.35 + 0.65 * scopeN);
      const sc = screen(s), f = fee(s);
      return { kind: "journal", s, v, cnt, share, scope: sc0, fit, score: 0.85 * fit + 0.15 * quality - (sc.level === "cau" ? 0.1 : 0), screen: sc, fee: f };
    }).filter((j) => j.screen.level !== "high")
      // a venue whose published topics barely overlap the paper's subject areas is out of scope
      .filter((j) => j.scope == null || j.scope >= 0.15)
      .filter((j) => j.v.n > 0 ? true : (j.share >= 0.005 && j.scope != null && j.scope >= 0.3))
      .filter((j) => !opt.oaOnly || j.s.is_oa)
      .filter((j) => opt.maxFee == null || j.fee.usd == null || j.fee.usd <= opt.maxFee)
      .sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /* ------------------------------------------------------------ conferences */
  const norm = (s) => String(s || "").toLowerCase().replace(/\b(19|20)\d{2}\b/g, " ").replace(/proceedings of( the)?|international|conference|symposium|workshop|annual|acm|ieee|on the|on|the|of|and|&/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  function prepConf(c) {
    const ac = String(c.title || "").replace(/[^A-Za-z0-9]/g, "");
    return { ...c, _ac: ac.length >= 3 ? new RegExp(`(^|[^A-Za-z])${ac}([^A-Za-z]|$)`) : null, _n: norm(c.name), _tok: new Set(norm(c.name).split(" ").filter((w) => w.length > 2)) };
  }
  function matchConf(sourceName) {
    const n = norm(sourceName), tok = new Set(n.split(" ").filter((w) => w.length > 2));
    let best = null, bestS = 0;
    CONFS.forEach((c) => {
      let s = 0;
      if (c._ac && c._ac.test(sourceName)) s = 1;
      else if (c._n && c._n.length > 8 && n.includes(c._n)) s = 0.9;
      else if (c._tok.size >= 2) { const inter = [...c._tok].filter((w) => tok.has(w)).length; s = inter / c._tok.size >= 0.8 ? 0.7 : 0; }
      if (s > bestS) { bestS = s; best = c; }
    });
    return best;
  }
  function rankConferences(sem, counts, opt) {
    const by = {};
    const add = (name, semV, n, cnt, titles) => {
      const c = matchConf(name); if (!c) return;
      const e = (by[c.id] = by[c.id] || { conf: c, sem: 0, n: 0, cnt: 0, titles: [] });
      e.sem += semV; e.n += n; e.cnt += cnt; (titles || []).forEach((t) => e.titles.length < 2 && e.titles.push(t));
    };
    Object.values(sem.venues).filter((v) => v.type === "conference").forEach((v) => add(v.name, v.sem, v.n, 0, v.titles));
    Object.values(counts).forEach((g) => add(g.name, 0, 0, g.count, []));
    const list = Object.values(by);
    const maxSem = Math.max(0.001, ...list.map((e) => e.sem)), maxCount = Math.max(1, ...list.map((e) => e.cnt));
    const horizon = opt.months ? Date.now() + opt.months * 30.4 * 864e5 : Infinity;
    return list.map((e) => {
      const rankBoost = ({ "A*": 0.12, A: 0.08, B: 0.04 })[e.conf.core] || ({ A: 0.08, B: 0.04 })[e.conf.ccf] || 0;
      const fit = 0.6 * (e.sem / maxSem) + 0.4 * (Math.log1p(e.cnt) / Math.log1p(maxCount));
      return { kind: "conference", e, fit, score: fit + rankBoost };
    }).filter((x) => x.e.n > 0 || x.e.cnt >= 25)
      .filter((x) => !opt.months || (x.e.conf.next && Date.parse(x.e.conf.next.deadline) <= horizon))
      .sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /* ------------------------------------------------------------ rendering */
  const pct = (v) => Math.round(100 * v);
  const until = (iso) => { const d = Math.ceil((Date.parse(iso) - Date.now()) / 864e5); return d <= 0 ? "passed" : d === 1 ? "1 day left" : `${d} days left`; };
  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const chip = (lv, t) => `<span class="chip v-${lv}">${esc(t)}</span>`;

  function journalCard(j, i) {
    const s = j.s, issn = s.issn_l || (s.issn || [])[0] || "";
    const st = s.summary_stats || {};
    const verdict = j.screen.level === "low" ? chip("low", "Passes registry checks") : chip("cau", "Review first");
    return `<li class="ws-card" style="--i:${i}">
      <div class="ws-rank">${String(i + 1).padStart(2, "0")}</div>
      <div class="ws-main">
        <div class="ws-top"><span class="label">Journal${s.host_organization_name ? " · " + esc(s.host_organization_name) : ""}</span>${verdict}</div>
        <h3>${esc(s.display_name)}</h3>
        <div class="ws-fit"><span class="ws-bar"><i style="--w:${pct(j.fit)}%"></i></span><span>${pct(j.fit)}% fit</span></div>
        <p class="ws-ev">${[j.v.n ? `${j.v.n} of the ${CLOSEST} closest papers` : "", j.cnt ? `${j.cnt.toLocaleString()} matching papers since ${SINCE()}${j.share >= 0.005 ? ` (${(100 * j.share).toFixed(j.share < 0.1 ? 1 : 0)}% of its output)` : ""}` : "", j.scope != null ? `scope match ${pct(Math.min(1, j.scope / 0.5))}%` : ""].filter(Boolean).join(" · ")}</p>
        ${j.v.titles.length ? `<p class="ws-why">Closest: <i>${j.v.titles.map(esc).join("</i> · <i>")}</i></p>` : ""}
        <dl class="ws-facts">
          <div><dt>Submission</dt><dd>Open all year</dd></div>
          <div><dt>Fee</dt><dd>${esc(j.fee.text)}</dd></div>
          <div><dt>Access</dt><dd>${s.is_in_doaj ? "Open access · in DOAJ" : s.is_oa ? "Open access" : "Subscription / hybrid"}</dd></div>
          <div><dt>h-index</dt><dd>${st.h_index ?? "–"}</dd></div>
          <div><dt>2-yr citations / paper</dt><dd>${st["2yr_mean_citedness"] != null ? st["2yr_mean_citedness"].toFixed(1) : "–"}</dd></div>
        </dl>
        ${j.screen.flags.some((f) => f.level !== "low") ? `<p class="ws-flags">${j.screen.flags.filter((f) => f.level !== "low").map((f) => esc(f.text)).join(" · ")}</p>` : ""}
        ${j.screen.flags.filter((f) => f.level === "low" && f.id).map((f) => `<p class="ws-known">${esc(f.text)} · <a href="index.html#journal/${esc(f.id)}">evidence report</a></p>`).join("")}
        <div class="ws-links">${s.homepage_url ? `<a class="ghost sm" href="${esc(s.homepage_url)}" rel="noopener">Registered homepage <span aria-hidden="true">↗</span></a>` : ""}${issn ? `<a class="ghost sm" href="index.html#check" data-issn="${esc(issn)}">Run the full JournalCheck <span aria-hidden="true">→</span></a>` : ""}</div>
      </div></li>`;
  }
  function confCard(x, i) {
    const c = x.e.conf, nx = c.next;
    const ranks = [c.core && `CORE ${c.core}`, c.ccf && `CCF ${c.ccf}`].filter(Boolean).join(" · ");
    const dl = nx ? `${c.estimated ? "Expected around " : ""}${fmtDate(nx.deadline)}${c.estimated ? "" : ` · <b>${until(nx.deadline)}</b>`}` : "Not announced";
    return `<li class="ws-card" style="--i:${i}">
      <div class="ws-rank">${String(i + 1).padStart(2, "0")}</div>
      <div class="ws-main">
        <div class="ws-top"><span class="label">Conference · ${esc(c.area)}</span>${ranks ? `<span class="chip v-low">${esc(ranks)}</span>` : ""}</div>
        <h3>${esc(c.title)} <span class="ws-sub">${esc(c.name)}</span></h3>
        <div class="ws-fit"><span class="ws-bar"><i style="--w:${pct(x.fit)}%"></i></span><span>${pct(x.fit)}% fit</span></div>
        <p class="ws-ev">${[x.e.n ? `${x.e.n} of the ${CLOSEST} closest papers` : "", x.e.cnt ? `${x.e.cnt.toLocaleString()} matching papers since ${SINCE()}` : ""].filter(Boolean).join(" · ")}</p>
        ${x.e.titles.length ? `<p class="ws-why">Closest: <i>${x.e.titles.map(esc).join("</i> · <i>")}</i></p>` : ""}
        <dl class="ws-facts">
          <div><dt>Submission deadline</dt><dd>${dl}${nx && nx.comment && !c.estimated ? `<span class="ws-note">${esc(nx.comment)}</span>` : ""}</dd></div>
          ${nx && nx.abstract && !c.estimated ? `<div><dt>Abstract due</dt><dd>${fmtDate(nx.abstract)}</dd></div>` : ""}
          <div><dt>Conference dates</dt><dd>${esc(c.date || "Not announced")}</dd></div>
          <div><dt>Venue</dt><dd>${esc(c.place || "Not announced")}</dd></div>
          <div><dt>Acceptance</dt><dd>${c.accept ? `${Math.round(100 * c.accept.rate)}% (${c.accept.year})` : "–"}</dd></div>
          <div><dt>Fee</dt><dd>See registration page</dd></div>
        </dl>
        <div class="ws-links">${c.link ? `<a class="ghost sm" href="${esc(c.link)}" rel="noopener">Conference site <span aria-hidden="true">↗</span></a>` : ""}</div>
      </div></li>`;
  }

  /* ------------------------------------------------------------ wiring */
  const form = $("#ws-form"), out = $("#ws-out"), status = $("#ws-status");
  const say = (html) => { status.innerHTML = html; };

  $("#ws-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $("#ws-drop").classList.add("busy"); say(`<span class="spin"></span> Reading ${esc(f.name)} in your browser…`);
    try {
      const r = await readPdf(f);
      if (r.title) $("#ws-title").value = r.title;
      if (r.abstract) $("#ws-abstract").value = r.abstract;
      if (r.keywords) $("#ws-keywords").value = r.keywords;
      say(`Read ${esc(f.name)} (${r.pages} page${r.pages === 1 ? "" : "s"}). ${r.abstract ? "Check the title, abstract and keywords below, then find venues." : "No abstract found: paste it below."} The file never left your device.`);
    } catch (err) { say(`<span class="err">${esc(err.message || "This PDF could not be read.")}</span> Type the details below instead.`); }
    finally { $("#ws-drop").classList.remove("busy"); }
  });
  const drop = $("#ws-drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f && /pdf$/i.test(f.type || f.name)) { const dt = new DataTransfer(); dt.items.add(f); $("#ws-file").files = dt.files; $("#ws-file").dispatchEvent(new Event("change")); } });

  try { $("#ws-key").value = key(); } catch {}
  $("#ws-key").addEventListener("change", (e) => { try { localStorage.setItem("jc-oa-key", e.target.value.trim()); } catch {} });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = { title: $("#ws-title").value.trim(), abstract: $("#ws-abstract").value.trim(), keywords: $("#ws-keywords").value.trim() };
    if ((input.title + input.abstract + input.keywords).length < 20) { say(`<span class="err">Add at least a title or a few keywords.</span>`); return; }
    const kind = $("input[name=ws-kind]:checked").value;
    const opt = { oaOnly: $("#ws-oa").checked, maxFee: $("#ws-fee").value === "" ? null : Number($("#ws-fee").value), months: Number($("#ws-months").value) || 0 };
    const ts = terms(input);
    const go = $("#ws-go"); go.disabled = true;
    say(`<span class="spin"></span> Finding the papers closest to yours in OpenAlex…`);
    out.innerHTML = "";
    try {
      await ready;
      const sem = fromSemantic(await semantic(input));
      const [cj, cc] = await Promise.all([kind !== "conference" ? grouped(ts, "journal") : {}, kind !== "journal" ? grouped(ts, "conference") : {}]);
      const js = kind !== "conference" ? await rankJournals(sem, cj, opt) : [];
      const cs = kind !== "journal" ? rankConferences(sem, cc, opt) : [];
      const col = (title, items, card, empty) => `<section class="ws-col"><div class="ws-col-head"><p class="label">${title}</p><span class="label">${items.length} of 10</span></div>${items.length ? `<ol class="ws-list">${items.map(card).join("")}</ol>` : `<p class="note">${empty}</p>`}</section>`;
      out.innerHTML = `<div class="ws-terms"><span class="label">Matched by meaning to your title and abstract, and by keywords</span>${focus(ts).map((t) => `<span class="ws-term">${esc(t)}</span>`).join("")}</div>
        <div class="ws-cols ${kind === "both" ? "two" : ""}">
          ${kind !== "conference" ? col("Journals", js, journalCard, "No journal matched. Try broader keywords or remove a filter.") : ""}
          ${kind !== "journal" ? col("Conferences (computer science)", cs, confCard, "No tracked conference matched. Conference deadlines cover computer science only for now.") : ""}
        </div>`;
      say(`Done. Ranked by meaning-level similarity, matching papers since ${SINCE()} and scope; high-risk journals were removed.`);
      out.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      say(`<span class="err">${esc(err.message || "Something went wrong.")}</span>`);
    } finally { go.disabled = false; }
  });

  /* "Run the full JournalCheck" opens the main page's live check with the ISSN filled in */
  out.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-issn]"); if (!a) return;
    try { sessionStorage.setItem("jc-prefill", a.dataset.issn); } catch {}
  });

  /* test hook (used by the automated checks only) */
  window.__ws = { terms, focus, scope, matchConf: (n) => (matchConf(n) || {}).title, ready };
})();
