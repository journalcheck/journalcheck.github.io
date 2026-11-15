#!/usr/bin/env python3
"""Replay the 50-paper evaluation offline against recorded OpenAlex answers.

Each eval/cache/<work id>.json.gz holds the paper as entered (title, abstract,
keywords) and every OpenAlex response the recommender received for it. This
script loads the local submit.html in headless Chrome, answers OpenAlex
requests from the cache, removes the paper itself from search results (so it
cannot find itself), and scores where the paper's real venue ranks.

Usage:  python3 eval/replay.py [--ids W1,W2] [--out eval/replay_results.json] [--show]
"""
import argparse, collections, functools, gzip, http.server, json, re, socketserver, threading
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "eval" / "cache"
DONE = re.compile(r"^(Done|No |Could|Error|Something|OpenAlex)", re.I)


def cache_key(url):
    """Same key the browser recorder uses: path + params sorted by name, api_key dropped."""
    u = urlsplit(url)
    params = sorted((k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k != "api_key")
    return u.path + "?" + "&".join(f"{k}={v}" for k, v in params)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def rank_of(paper, names):
    if paper["kind"] == "journal":
        want = {norm(paper["venue"]), norm(paper["venue"].split("/")[0])}
        hit = lambda n: norm(n) in want or norm(n.split("/")[0]) in want
    else:
        hit = lambda n: norm(n).startswith(norm(paper["conference"]))
    return next((i + 1 for i, n in enumerate(names) if hit(n)), 0)


def serve(port):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def run_one(page, port, paper, rec):
    responses, missing = rec["responses"], []
    own = paper["id"]

    def answer(route):
        url = route.request.url
        hit = responses.get(cache_key(url))
        if hit is None:
            missing.append(cache_key(url))
            return route.fulfill(status=404, body='{"error":"not recorded"}', content_type="application/json")
        body = hit["body"]
        if "search" in url and hit["status"] == 200:
            d = json.loads(body)
            if isinstance(d.get("results"), list):
                d["results"] = [w for w in d["results"] if not str(w.get("id", "")).endswith(own)]
                body = json.dumps(d)
        route.fulfill(status=hit["status"], body=body, content_type="application/json",
                      headers={"access-control-allow-origin": "*"})

    page.unroute("**/*")
    page.route(re.compile(r"https://api\.openalex\.org/.*"), answer)
    page.route(re.compile(r"https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
    page.goto(f"http://127.0.0.1:{port}/submit.html", wait_until="domcontentloaded")
    page.wait_for_function("window.__ws && window.__ws.ready")
    page.evaluate("() => window.__ws.ready")
    inp = rec["paper"]
    page.fill("#ws-title", inp["title"])
    page.fill("#ws-abstract", inp["abstract"])
    page.fill("#ws-keywords", inp.get("keywords") or "")
    page.check(f'input[name="ws-kind"][value="{paper["kind"]}"]')
    page.click("#ws-go")
    page.wait_for_function(f"() => {DONE.pattern!r}.length && new RegExp({DONE.pattern!r}, 'i').test(document.getElementById('ws-status').textContent)", timeout=60000)
    col = ".is-j" if paper["kind"] == "journal" else ".is-c"
    names = page.eval_on_selector_all(f"{col} .ws-card h3", "els => els.map(e => e.textContent.trim())")
    status = page.inner_text("#ws-status")
    return {"id": own, "kind": paper["kind"], "field": paper["field"],
            "truth": paper["venue"] if paper["kind"] == "journal" else paper["conference"],
            "rank": rank_of(paper, names), "names": names, "status": status[:80], "unrecorded": len(missing)}


def summary(rows):
    def line(rs):
        n = len(rs) or 1
        h = lambda k: sum(1 for r in rs if 0 < r["rank"] <= k)
        mrr = sum(1 / r["rank"] for r in rs if r["rank"]) / n
        return f"n={len(rs):2d}  top1 {h(1):2d} ({h(1)/n:4.0%})  top3 {h(3):2d} ({h(3)/n:4.0%})  top10 {h(10):2d} ({h(10)/n:4.0%})  MRR {mrr:.2f}"
    out = ["all          " + line(rows)]
    for k in ("journal", "conference"):
        out.append(f"{k:<13}" + line([r for r in rows if r["kind"] == k]))
    by = collections.defaultdict(list)
    for r in rows:
        if r["kind"] == "journal":
            by[r["field"]].append(r)
    out += [f"  {f[:24]:<25}" + line(rs) for f, rs in sorted(by.items())]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids")
    ap.add_argument("--out", default=str(ROOT / "eval" / "replay_results.json"))
    ap.add_argument("--show", action="store_true", help="print each paper's top 3")
    ap.add_argument("--port", type=int, default=8771)
    a = ap.parse_args()

    papers = json.loads((ROOT / "eval" / "papers.json").read_text())["papers"]
    if a.ids:
        want = set(a.ids.split(","))
        papers = [p for p in papers if p["id"] in want]
    httpd = serve(a.port)
    rows = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
        page = browser.new_page()
        for p in papers:
            f = CACHE / f"{p['id']}.json.gz"
            if not f.exists():
                print(f"skip {p['id']}: not recorded")
                continue
            rec = json.loads(gzip.decompress(f.read_bytes()))
            r = run_one(page, a.port, p, rec)
            rows.append(r)
            if a.show:
                print(f"{r['rank'] or '-':>3}  {r['truth'][:40]:<40}  {' ; '.join(r['names'][:3])[:90]}"
                      + (f"  [{r['unrecorded']} unrecorded]" if r["unrecorded"] else ""))
        browser.close()
    httpd.shutdown()
    Path(a.out).write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    print(summary(rows))
    gaps = sum(r["unrecorded"] for r in rows)
    if gaps:
        print(f"note: {gaps} requests were not in the cache (answered 404)")


if __name__ == "__main__":
    main()
