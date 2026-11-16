/* Browser-side replay for the Where to submit evaluation.
 *
 * Runs in the same page as eval/record.js, after the recordings are in IndexedDB
 * ("jc-eval" / "rec"). Every OpenAlex request is answered from the recording, with
 * the paper itself removed from search results so it cannot find itself. A source
 * lookup that was not recorded is fetched live (single-source lookups are free);
 * any other unrecorded request is answered 404 and counted, since it would cost money.
 *
 * Ranking settings are passed as window.__wsTune, so experiments need no code change.
 *
 *   await JCReplay.load()                         // decompress recordings into memory
 *   await JCReplay.run({ tune: {...}, ids })      // -> { summary, rows }
 */
(() => {
  const DONE = /^(Done|No |Could|Error|Something|OpenAlex)/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (u) => {   // must match record.js
    const x = new URL(u);
    x.searchParams.delete("api_key");
    return x.pathname + "?" + [...x.searchParams].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + "=" + v).join("&");
  };
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

  const all = () => new Promise((res, rej) => {
    const r = indexedDB.open("jc-eval", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("rec");
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const out = {}, c = r.result.transaction("rec").objectStore("rec").openCursor();
      c.onsuccess = (e) => { const x = e.target.result; if (x) { out[x.key] = x.value; x.continue(); } else res(out); };
    };
  });
  const gunzip = async (buf) => JSON.parse(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).text());

  function rankOf(p, names) {
    if (p.kind === "journal") {
      const want = new Set([norm(p.venue), norm(p.venue.split("/")[0])]);
      return names.findIndex((n) => want.has(norm(n)) || want.has(norm(n.split("/")[0]))) + 1;
    }
    const c = norm(p.conf || p.conference);
    return names.findIndex((n) => norm(n).startsWith(c)) + 1;
  }

  function summarise(rows) {
    const line = (rs) => {
      const n = rs.length || 1, h = (k) => rs.filter((r) => r.rank > 0 && r.rank <= k).length;
      return { n: rs.length, top1: h(1), top3: h(3), top10: h(10), mrr: +(rs.reduce((a, r) => a + (r.rank ? 1 / r.rank : 0), 0) / n).toFixed(3) };
    };
    return { all: line(rows), journal: line(rows.filter((r) => r.kind === "journal")), conference: line(rows.filter((r) => r.kind === "conference")) };
  }

  window.JCReplay = {
    recs: {},
    live: {},     // source records fetched live during replays, reused across runs
    async load() {
      const raw = await all();
      for (const [id, buf] of Object.entries(raw)) this.recs[id] = await gunzip(buf);
      return Object.keys(this.recs).length;
    },
    async runOne(p, rec) {
      const base = window.__jcBaseFetch || (window.__jcBaseFetch = window.fetch);
      const responses = rec.responses, live = this.live;
      let unrecorded = 0;
      window.fetch = async (u, o) => {
        const s = String(u);
        if (!s.includes("api.openalex.org")) return base(u, o);
        const k = key(s);
        let hit = responses[k] || live[k];
        if (!hit && k.startsWith("/sources/")) {
          const r = await base(u, o);
          hit = live[k] = { status: r.status, body: await r.text() };
        }
        if (!hit) { unrecorded++; return new Response('{"error":"not recorded"}', { status: 404 }); }
        let body = hit.body;
        if (hit.status === 200 && /search/.test(k)) {
          const d = JSON.parse(body);
          if (Array.isArray(d.results)) { d.results = d.results.filter((w) => !String(w.id).endsWith(p.id)); body = JSON.stringify(d); }
        }
        return new Response(body, { status: hit.status, headers: { "content-type": "application/json" } });
      };
      try {
        const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
        set("ws-title", rec.paper.title); set("ws-abstract", rec.paper.abstract); set("ws-keywords", rec.paper.keywords || "");
        const radio = document.querySelector(`input[name="ws-kind"][value="${p.kind}"]`);
        radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true }));
        const st = document.getElementById("ws-status");
        document.getElementById("ws-out").innerHTML = ""; st.textContent = "";
        document.getElementById("ws-go").click();
        const t0 = Date.now();
        while (Date.now() - t0 < 60000 && !DONE.test(st.textContent)) await sleep(60);
        const col = document.querySelector(p.kind === "journal" ? ".is-j" : ".is-c");
        const names = col ? [...col.querySelectorAll(".ws-card h3")].map((h) => h.textContent.trim()) : [];
        return { id: p.id, kind: p.kind, field: p.field, truth: p.kind === "journal" ? p.venue : (p.conf || p.conference), rank: rankOf(p, names), names, status: st.textContent.slice(0, 50), unrecorded };
      } finally {
        window.fetch = base;
      }
    },
    async run({ tune = {}, ids = null, papers = null } = {}) {
      papers = papers || JSON.parse(localStorage.getItem("jc-eval-papers")).papers;
      window.__wsTune = tune;
      const rows = [];
      try {
        for (const p of papers) {
          if (ids && !ids.includes(p.id)) continue;
          const rec = this.recs[p.id];
          if (!rec || !/^Done/.test(rec.status || "")) continue;   // skip missing or failed recordings
          rows.push(await this.runOne(p, rec));
        }
      } finally {
        window.__wsTune = null;
      }
      return { summary: summarise(rows), rows };
    },
  };
})();
