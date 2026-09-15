#!/usr/bin/env python3
"""Scrape Great Barrington PD's public weekly dispatch-log PDFs into
data/police.json for the Blotter tab.

Source: https://greatbarringtonpolice.com/logs/ - one PDF per week, posted a
week or two after the week closes. This is the only town the site covers that
publishes an incident-level log, so the blotter is Great Barrington only.

Privacy rules (hard requirements, do not loosen):
  - No names. Arrest lines, "Refer To" lines and narratives are never parsed;
    only the entry header (call number / time / reason / action) and the
    location line are read.
  - No exact addresses. Anything with a house number is reduced to the street
    name; intersections stay intersections. Street level is the maximum
    resolution, matching how the department itself publishes locations.
  - Medical, mental-health, welfare, missing-person and legal-service call
    types are excluded entirely - a small-town street dot on one of those
    identifies a household.

Runs daily from GitHub Actions. Weeks are immutable once parsed: a run only
downloads PDFs it has not seen before, and street geocodes are cached inside
police.json so Nominatim only ever sees new streets.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pdfplumber
import requests

ET = ZoneInfo("America/New_York")
INDEX_URL = "https://greatbarringtonpolice.com/logs/"
DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "police.json"
BACKFILL_WEEKS = 8          # how many recent weekly PDFs to keep on file
NOMINATIM = "https://nominatim.openstreetmap.org/search"

UA = {"User-Agent": "berkshire-meetings-blotter/1.0 "
                    "(https://github.com/tylerherman19/berkshire-meetings)"}

# Sectors inside Great Barrington (Housatonic is a GB village). Anything else
# ([PIT], [LEE], [ST], [SH], [O], ...) is mutual aid outside town and dropped.
GB_SECTORS = {"GRE", "HOU", "AD", "GB"}

# Excluded call types: health, welfare, missing persons, legal process,
# administrative, and events that by definition happened out of town.
EXCLUDE_REASONS = {
    "MEDICAL EMERGENCY", "AMB TRANSPORT", "ALARM - MEDICAL",
    "CO-RESPONDER MENTAL HEALTH", "SECTION 12", "WELFARE CHECK",
    "MISSING PERSON", "SERVE WARRANT", "SERVE SUMMONS",
    "SERVE IMMEDIATE THREAT", "ESCORT / TRANSPORT",
    "BOLO", "OUT OF TOWN ARREST", "FID / LTC",
}

GROUPS = [
    "Crime", "Traffic", "Disorder", "Alarms", "Fire & hazards",
    "Patrol checks", "Community",
]

def group_for(reason):
    r = reason.upper()
    if r.startswith("MOTOR VEHICLE") or r in {
        "RADAR", "DISABLED MV", "LOCK OUT", "PARKING ENFORCEMENT",
        "TRAFFIC CONTROL",
    }:
        return "Traffic"
    if r in {"LARCENY / FORGERY/ FRAUD", "BURGLARY", "AUTO THEFT",
             "MAL DAMAGE", "TRESPASS COMPLAINT", "ASSAULT", "INVESTIGATION"}:
        return "Crime"
    if r in {"DISTURBANCE", "NOISE COMPLAINT", "SUSPICIOUS ACTIVITY"}:
        return "Disorder"
    if r.startswith("ALARM"):
        return "Alarms"
    if r.startswith("FIRE") or r in {
        "WIRES DOWN/TREE ON WIRES", "WIRES SMOKING", "POWER OUTAGE",
        "ROAD HAZARD",
    }:
        return "Fire & hazards"
    if r == "PATROL CHECK":
        return "Patrol checks"
    return "Community"

# Location labels that are not streets, mapped to a geocodable place.
LOCATION_ALIASES = {
    "DOWNTOWN HOUSATONIC BUSINESS DISTRICT": "Housatonic, MA",
}
SKIP_LOC = re.compile(r"POSSIBLY|UNKNOWN|LAST SEEN|MSP\b|^\s*$", re.I)

HEADER_RE = re.compile(
    r"^(\d{2}-\d+)\s+(\d{4})\s+([A-Za-z-]+)\s+-\s+(.+?)\s{2,}(\S.*?)\s*$")
LOC_RE = re.compile(
    r"^\s*(?:Location/Address|Location|Vicinity of|Address)\s*:\s*(.+?)\s*$")
DATE_RE = re.compile(r"For Date:\s+(\d{2})/(\d{2})/(\d{4})")

def title(s):
    return (s.strip().title().replace("Mv", "MV").replace("Ltc", "LTC")
            .replace("(S)", "(s)").replace("Ems", "EMS"))

def clean_location(raw):
    """Reduce a raw location line to street level. Returns (display, sector)."""
    sector = ""
    s = raw.strip()
    m = re.match(r"^\[([A-Za-z]+)(?:\s+[A-Za-z0-9 ]*)?\]\s*(.*)$", s)
    if m:
        sector = m.group(1).strip().upper()
        s = m.group(2).strip()
    # Strip house numbers and anything after them (apt, building names).
    s = re.sub(r"^\d+\s+", "", s)
    s = re.split(r"\s{2,}", s)[0]
    s = re.sub(r"\s+(Apt|Unit|Bldg|Suite)\b.*$", "", s, flags=re.I)
    # Zone letters the PD puts inside street names: MAIN (A) ST -> MAIN ST.
    s = re.sub(r"\s*\([A-Z]\)\s*", " ", s).strip()
    s = re.sub(r"\s{2,}", " ", s)
    return s, sector

def parse_pdf(path):
    """Extract privacy-filtered incidents from one weekly PDF."""
    out = []
    cur_date = None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(layout=True) or ""
            entry = None
            for line in text.splitlines():
                dm = DATE_RE.search(line)
                if dm:
                    cur_date = f"{dm.group(3)}-{dm.group(1)}-{dm.group(2)}"
                    continue
                hm = HEADER_RE.match(line.strip())
                if hm and cur_date:
                    if entry:
                        out.append(entry)
                    entry = {
                        "id": hm.group(1), "d": cur_date, "t": hm.group(2),
                        "r": hm.group(4).strip().upper(),
                        "a": hm.group(5).strip(), "loc": "", "sector": "",
                    }
                    continue
                lm = LOC_RE.match(line)
                if lm and entry and not entry["loc"]:
                    loc, sector = clean_location(lm.group(1))
                    entry["loc"], entry["sector"] = loc, sector
            if entry:
                out.append(entry)
    return out

def index_pdfs():
    """Weekly PDF links from the logs index page, newest first."""
    r = requests.get(INDEX_URL, headers=UA, timeout=40)
    r.raise_for_status()
    found = {}
    for m in re.finditer(r'href="(https://greatbarringtonpolice\.com/[^"]+\.pdf)"',
                         r.text):
        url = m.group(1)
        name = url.rsplit("/", 1)[-1]
        if name not in found:
            found[name] = url
    return [{"file": n, "url": u} for n, u in found.items()]

def geocode(street, sector, cache):
    key = street.upper()
    if key in cache:
        return cache[key]
    result = None
    if street.upper() in LOCATION_ALIASES:
        queries = [LOCATION_ALIASES[street.upper()]]
    elif SKIP_LOC.search(street):
        queries = []
    else:
        parts = [p.strip() for p in re.split(r"\s+\+\s+", street) if p.strip()]
        town = "Housatonic, MA" if sector == "HOU" else "Great Barrington, MA"
        queries = []
        if len(parts) > 1:
            queries.append(f"{parts[0]} & {parts[1]}, {town}")
        queries.append(f"{parts[0]}, {town}")
        if sector != "HOU":
            queries.append(f"{parts[0]}, Housatonic, MA")
    for q in queries:
        try:
            r = requests.get(NOMINATIM, headers=UA, timeout=20, params={
                "q": q, "format": "json", "limit": 1,
                "countrycodes": "us",
            })
            hits = r.json()
        except Exception:
            hits = []
        time.sleep(1.05)  # Nominatim usage policy: max 1 req/s
        if hits:
            lat, lon = float(hits[0]["lat"]), float(hits[0]["lon"])
            # Great Barrington and its villages, generously boxed.
            if 42.06 <= lat <= 42.34 and -73.56 <= lon <= -73.16:
                result = [round(lat, 5), round(lon, 5)]
                break
    cache[key] = result
    return result

def main():
    existing = {"weeks": [], "geo": {}, "incidents": []}
    if DATA_FILE.exists():
        existing = json.loads(DATA_FILE.read_text())
    geo = existing.get("geo", {})
    have = set() if os.environ.get("REPARSE") else {
        w["file"] for w in existing.get("weeks", [])}
    incidents = {} if os.environ.get("REPARSE") else {
        i["id"]: i for i in existing.get("incidents", [])}

    pdfs = index_pdfs()[:BACKFILL_WEEKS]
    keep_files = {p["file"] for p in pdfs}
    # Drop weeks that aged out of the backfill window.
    incidents = {k: v for k, v in incidents.items() if v.get("w") in keep_files}

    new_weeks = [p for p in pdfs if p["file"] not in have]
    stats = {"new_weeks": [], "kept": 0, "excluded": 0, "out_of_town": 0,
             "no_location": 0, "unmapped": 0, "mapped": 0}
    if not new_weeks:
        print("No new weekly PDFs; data is current.")
    for p in new_weeks:
        print(f"Fetching {p['file']} ...")
        rr = requests.get(p["url"], headers=UA, timeout=60)
        rr.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
            tf.write(rr.content)
            tmp = tf.name
        rows = parse_pdf(tmp)
        stats["new_weeks"].append(f"{p['file']} ({len(rows)} raw entries)")
        if not rows:
            # Scanned PDF with no text layer (seen once so far) - record it so
            # the gap is visible instead of silently missing a week.
            stats.setdefault("unreadable", []).append(p["file"])
        for row in rows:
            if row["r"] in EXCLUDE_REASONS:
                stats["excluded"] += 1
                continue
            if row["sector"] and row["sector"] not in GB_SECTORS:
                stats["out_of_town"] += 1
                continue
            if not row["loc"]:
                stats["no_location"] += 1
                continue
            loc_disp = LOCATION_ALIASES.get(row["loc"].upper(), row["loc"])
            incidents[row["id"]] = {
                "id": row["id"], "d": row["d"], "t": row["t"],
                "r": title(row["r"]), "g": group_for(row["r"]),
                "a": title(row["a"]), "loc": row["loc"].title(),
                "w": p["file"],
            }
            stats["kept"] += 1

    # Geocode every street we keep (cached inside the JSON).
    streets = {(i["loc"], ) for i in incidents.values()}
    for i in incidents.values():
        raw = i["loc"].upper()
        sector = "HOU" if raw in LOCATION_ALIASES else ""
        ll = geocode(raw, sector, geo)
        if ll:
            i["lat"], i["lon"] = ll[0], ll[1]
            stats["mapped"] += 1
        else:
            i.pop("lat", None); i.pop("lon", None)
            stats["unmapped"] += 1

    weeks = []
    for p in pdfs:
        m = re.match(r"(\d+)\.(\d+)\.(\d+)-(\d+)\.(\d+)\.(\d+)", p["file"])
        w = {"file": p["file"], "url": p["url"]}
        if p["file"] in stats.get("unreadable", []):
            w["note"] = "No text layer in this PDF (scanned); skipped."
        if m:
            y1, y2 = m.group(3), m.group(6)
            y1 = "20" + y1 if len(y1) == 2 else y1
            y2 = "20" + y2 if len(y2) == 2 else y2
            w["from"] = f"{y1}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
            w["to"] = f"{y2}-{int(m.group(4)):02d}-{int(m.group(5)):02d}"
        weeks.append(w)

    payload = {
        "updated": datetime.now(ET).isoformat(timespec="seconds"),
        "source": {
            "name": "Great Barrington Police Department - public dispatch logs",
            "url": INDEX_URL,
        },
        "weeks": weeks,
        "groups": GROUPS,
        "geo": geo,
        "incidents": sorted(incidents.values(),
                            key=lambda i: (i["d"], i["t"]), reverse=True),
    }
    DATA_FILE.write_text(json.dumps(payload, separators=(",", ":")))
    print(json.dumps({k: v for k, v in stats.items() if k != "new_weeks"}))
    for w in stats["new_weeks"]:
        print("  parsed:", w)
    print(f"Total incidents on file: {len(incidents)}")

if __name__ == "__main__":
    sys.exit(main())
