"""Build data/conferences.json for the "Where to submit" page from the ccfddl dataset.

ccfddl (https://github.com/ccfddl/ccf-deadlines, MIT licence) is a community-maintained list of
computer-science conference deadlines, CCF/CORE ranks and acceptance rates. This script keeps, for
each conference, its latest edition, the next submission deadline (or an estimate from last year's)
and the latest known acceptance rate, so the browser can match papers to conferences offline.

    python tools/build_conferences.py /path/to/ccf-deadlines   # writes data/conferences.json
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "conferences.json"


def parse_tz(tz: str | None) -> timezone:
    """ccfddl uses 'UTC-12', 'UTC+8', 'AoE' (Anywhere on Earth = UTC-12)."""
    if not tz or tz.upper() == "AOE":
        return timezone(timedelta(hours=-12))
    m = re.match(r"UTC([+-]\d{1,2})(?::?(\d{2}))?$", tz.strip(), re.I)
    if not m:
        return timezone.utc
    hours = int(m.group(1))
    mins = int(m.group(2) or 0) * (1 if hours >= 0 else -1)
    return timezone(timedelta(hours=hours, minutes=mins))


def parse_dt(value, tz: timezone) -> datetime | None:
    if not value or str(value).strip().upper() == "TBD":
        return None
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz)
    except ValueError:
        return None


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def main(src: Path) -> None:
    now = datetime.now(timezone.utc)
    types = {t["sub"]: t["name_en"] for t in yaml.safe_load((src / "conference" / "types.yml").read_text())}
    rates: dict[str, dict] = {}
    for f in (src / "accept_rates").glob("*/*.yml"):
        for entry in yaml.safe_load(f.read_text()) or []:
            rows = [r for r in entry.get("accept_rates", []) if r.get("rate")]
            if rows:
                last = max(rows, key=lambda r: r["year"])
                rates[entry["title"].lower()] = {"year": last["year"], "rate": round(last["rate"], 3)}

    out = []
    for f in sorted((src / "conference").glob("*/*.yml")):
        for c in yaml.safe_load(f.read_text()) or []:
            confs = sorted(c.get("confs") or [], key=lambda e: e.get("year", 0))
            if not confs:
                continue
            latest = confs[-1]
            tz = parse_tz(latest.get("timezone"))
            # every deadline of the latest edition, with the round's comment
            rounds = []
            for t in latest.get("timeline") or []:
                d = parse_dt(t.get("deadline"), tz)
                if d:
                    rounds.append({"deadline": iso(d), "abstract": iso(parse_dt(t.get("abstract_deadline"), tz)), "comment": t.get("comment")})
            upcoming = [r for r in rounds if r["deadline"] >= iso(now)]
            nxt, estimated = (upcoming[0] if upcoming else None), False
            if not nxt and rounds:
                # no announced deadline yet: estimate from the last one, one year later
                last = max(rounds, key=lambda r: r["deadline"])
                d = datetime.strptime(last["deadline"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                while d < now:
                    d = d.replace(year=d.year + 1)
                nxt, estimated = {"deadline": iso(d), "abstract": None, "comment": None}, True
            rank = c.get("rank") or {}
            out.append({
                "id": c.get("dblp") or c["title"].lower(),
                "title": c["title"],
                "name": c.get("description") or c["title"],
                "sub": c.get("sub"),
                "area": types.get(c.get("sub"), ""),
                "ccf": rank.get("ccf"), "core": rank.get("core"),
                "year": latest.get("year"),
                "link": latest.get("link"),
                "date": latest.get("date"), "place": latest.get("place"),
                "next": nxt, "estimated": estimated,
                "accept": rates.get(c["title"].lower()),
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "ccfddl/ccf-deadlines (MIT licence)",
        "built": iso(now),
        "conferences": out,
    }, ensure_ascii=False, separators=(",", ":")))
    n_up = sum(1 for c in out if c["next"] and not c["estimated"])
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} conferences, {n_up} with an announced upcoming deadline")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "ccf-deadlines"))
