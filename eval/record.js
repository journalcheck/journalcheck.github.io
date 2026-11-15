/* Browser-side recorder for the Where to submit evaluation.
 *
 * Run inside the beta page (submit.html loaded with its scripts) in a browser
 * that can reach api.openalex.org. For each paper it fills the form, runs a
 * search, and keeps every OpenAlex response. It also fetches the source record
 * of every venue that appeared in the search results or keyword counts, plus
 * the paper's real venue, so offline replays can widen the candidate pool
 * without new API calls. Single-source lookups are free.
 *
 * Records are gzipped and kept in IndexedDB ("jc-eval", store "rec"), keyed by
 * work id, so a closed tab or a disconnect loses nothing. eval/replay.py reads
 * them back from eval/cache/<id>.json.gz.
 *
 *   await JCRec.run(papers)          // record the papers not recorded yet
 *   await JCRec.list()               // [{id, bytes}]
 *   await JCRec.chunk(id, i, size)   // base64 slice of one gzipped record, for transfer
 */
(() => {
  const SRC_FIELDS = "id,display_name,issn_l,issn,host_organization_name,type,homepage_url,works_count,cited_by_count,summary_stats,is_oa,is_in_doaj,apc_usd,counts_by_year,topics,is_core";
  const DONE = /^(Done|No |Could|Error|Something|OpenAlex)/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // must match cache_key() in eval/replay.py
  const key = (u) => {
    const x = new URL(u);
    x.searchParams.delete("api_key");
    return x.pathname + "?" + [...x.searchParams].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + "=" + v).join("&");
  };

  const db = () => new Promise((res, rej) => {
    const r = indexedDB.open("jc-eval", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("rec");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction("rec", mode), s = t.objectStore("rec"), out = fn(s);
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
    });
  };
  const put = (id, buf) => tx("readwrite", (s) => s.put(buf, id));
  const getRec = (id) => tx("readonly", (s) => s.get(id));
  const keys = () => tx("readonly", (s) => s.getAllKeys());

  const gzip = async (text) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const b64 = (buf) => { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

  async function recordOne(p, base, log) {
    const cache = {};
    let cost = 0, left = null;
    const fetchRetry = async (u, o) => {
      for (let a = 0; ; a++) {
        const r = await base(u, o);
        if (r.status !== 429 || a >= 4) return r;
        await sleep(800 * 2 ** a);
      }
    };
    const wrapped = async (u, o) => {
      const s = String(u);
      if (!s.includes("api.openalex.org")) return base(u, o);
      const r = await fetchRetry(u, o);
      cost += +(r.headers.get("x-ratelimit-cost-usd") || 0);
      left = r.headers.get("x-ratelimit-remaining-usd") ?? left;
      cache[key(s)] = { status: r.status, body: await r.clone().text() };
      return r;
    };
    window.fetch = wrapped;
    try {
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); };
      set("ws-title", p.title); set("ws-abstract", p.abstract); set("ws-keywords", p.keywords || "");
      const radio = document.querySelector(`input[name="ws-kind"][value="${p.kind}"]`);
      radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("ws-out").innerHTML = "";
      document.getElementById("ws-status").textContent = "";
      document.getElementById("ws-go").click();
      const t0 = Date.now();
      let st = "";
      while (Date.now() - t0 < 90000) {
        await sleep(700);
        st = document.getElementById("ws-status").textContent;
        if (DONE.test(st)) break;
      }
      // widen: every venue seen in search results or keyword counts, plus the real venue
      const ids = new Set([p.venue_id]);
      for (const v of Object.values(cache)) {
        if (v.status !== 200) continue;
        let d; try { d = JSON.parse(v.body); } catch { continue; }
        (d.results || []).forEach((w) => { const s = w.primary_location && w.primary_location.source; if (s && s.id) ids.add(s.id.split("/").pop()); });
        (d.group_by || []).slice(0, 80).forEach((g) => g.key && ids.add(String(g.key).split("/").pop()));
      }
      const have = (id) => Object.keys(cache).some((k) => k.startsWith(`/sources/${id}?`));
      const todo = [...ids].filter((id) => /^S\d+$/.test(id) && !have(id));
      for (let i = 0; i < todo.length; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map((id) => wrapped(`https://api.openalex.org/sources/${id}?select=${encodeURIComponent(SRC_FIELDS)}`)));
        await sleep(250);
      }
      const rec = { paper: { id: p.id, title: p.title, abstract: p.abstract, keywords: p.keywords || "" }, status: st, recorded: new Date().toISOString(), responses: cache };
      const buf = await gzip(JSON.stringify(rec));
      await put(p.id, buf);
      log({ id: p.id, status: st.slice(0, 40), responses: Object.keys(cache).length, widened: todo.length, kb: Math.round(buf.byteLength / 1024), cost: +cost.toFixed(4), left });
      return left;
    } finally {
      window.fetch = base;
    }
  }

  window.JCRec = {
    log: [],
    stop: false,
    async run(papers, { minLeft = 0.003 } = {}) {
      const base = window.fetch;
      const done = new Set(await keys());
      for (const p of papers) {
        if (this.stop) break;
        if (done.has(p.id)) continue;
        const left = await recordOne(p, base, (x) => this.log.push(x));
        if (left != null && +left < minLeft) { this.log.push({ stopped: "allowance nearly used", left }); break; }
        await sleep(1500);
      }
      this.finished = true;
    },
    async list() {
      const out = [];
      for (const id of await keys()) out.push({ id, bytes: (await getRec(id)).byteLength });
      return out;
    },
    async chunk(id, i, size = 60000) {
      const all = b64(await getRec(id));
      return { id, i, of: Math.ceil(all.length / size), data: all.slice(i * size, (i + 1) * size) };
    },
  };
})();
