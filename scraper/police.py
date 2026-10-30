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
# [AD] was once included here; in the posted logs it tags Adams, MA rows
# ("[AD] ADAMS"), so it is out of town. "GB" has never been observed; it is
# kept because it can only mean Great Barrington proper.
GB_SECTORS = {"GRE", "HOU", "GB"}

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

# --- PDF table parsing -------------------------------------------------------
# The weekly log is a printed table: one header row per call
# (call number / time / "SOURCE - REASON" / ACTION), then a "Call Source:"
# row, then a "Location/Address:" row, then narrative rows (Refer To,
# Arrest, Address, Age, Charges) that are never read.
#
# The department changed the table layout in October 2026: body columns
# shifted right and the reason/action separator collapsed from a wide gap
# to a single space, and the action can now wrap onto the next printed
# line. The old text regex (2+-space separator, alphabetic source token)
# therefore missed every 911-sourced call in every week and nearly the
# whole shifted week. This parser works on pdfplumber's word coordinates
# instead of the rendered text:
#   - a header row is any line whose first word is a call number and whose
#     second word is a 4-digit time;
#   - the reason/action split is the first horizontal gap of >= GAP_SPLIT
#     points between words after the "SOURCE -" prefix (inter-word gaps
#     measure <=7pt, column gaps >=12.7pt in both layouts);
#   - when no gap exists (shifted layout packs reason and action), the
#     action is recognized as a suffix from the dispatch software's closed
#     picklist (KNOWN_ACTIONS);
#   - continuation rows (wrapped action text) belong to the open header
#     until its "Call Source:"/"Location" row arrives.
CALL_ID_RE = re.compile(r"^\d{2}-\d{5}$")
# A line that starts with something call-number-shaped but fails the strict
# header shape is an unrecognized header: the old regex silently dropped
# those (that is how the site ended up publishing 12 of 269 calls), so they
# are now loud.
LOOSE_ID_RE = re.compile(r"^\d{2}-\d+")
TIME_RE = re.compile(r"^\d{4}$")
DATE_RE = re.compile(r"For\s+Date:\s+(\d{2})/(\d{2})/(\d{4})")

# Measured across the eight posted 2026 layouts: ordinary word gaps are
# 1.6-7.1 pt, reason->action column gaps are 12.7-127 pt. 10 splits them.
GAP_SPLIT = 10.0

# The dispatch software's action picklist, as observed in the posted logs.
# Longest match wins, so keep multi-word labels; matching is
# case-insensitive on a single-space-normalized string.
KNOWN_ACTIONS = [
    "TAKEN/REFERRED TO OTHER AGENCY", "BUILDING CHECKED/SECURED",
    "TRANSPORTED TO HOSPITAL", "CITATION/WARNING ISSUED",
    "FIRE DEPT. DISPATCHED", "AMBULANCE DISPATCHED", "NATIONAL GRID CALLED",
    "NO ACTION REQUIRED", "SERVICES RENDERED", "NO TRESPASS ORDER",
    "UNLOCKED VEHICLE", "COULD NOT LOCATE", "GONE ON ARRIVAL",
    "FAULTY DETECTOR", "REMOVED HAZARD", "ARREST(S) MADE",
    "PEACE RESTORED", "VEHICLE TOWED", "FALSE ALARM", "UNFOUNDED",
    "INVESTIGATED", "LOGGED", "BOLO",
]
KNOWN_ACTIONS.sort(key=len, reverse=True)

# Page furniture repeated above the table on every page (matched on
# single-space-normalized text).
FURNITURE_RES = (
    re.compile(r"^Great Barrington Police Department"),
    re.compile(r"^Dispatch Log From:"),
    re.compile(r"^Call Number Time Call Reason Action$"),
)

# Location row labels. Bare "Address:" is deliberately NOT one: in these
# logs that label only appears inside Refer To arrest/summons blocks, where
# it holds the person's home address next to their name, age and charges.
LOCATION_LABELS = ("Location/Address:", "Location:", "Vicinity of:")


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


def _word_lines(page):
    """One entry per printed line: words sorted left to right."""
    rows = []
    for w in page.extract_words(x_tolerance=1, y_tolerance=2):
        if rows and w["top"] - rows[-1][0] <= 2.0:
            rows[-1][1].append(w)
        else:
            rows.append([w["top"], [w]])
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in rows]


def _join(words):
    """Single-space join, but keep column-wide gaps as a double space so
    clean_location can still cut trailing wide-gap fragments."""
    parts = []
    prev = None
    for w in words:
        if prev is not None:
            parts.append("  " if w["x0"] - prev["x1"] >= GAP_SPLIT else " ")
        parts.append(w["text"])
        prev = w
    return "".join(parts)


def _split_action(text):
    """Split "<reason> <action>" on a known action suffix. Returns
    (reason, action); action "" when no picklist label matches."""
    norm = " ".join(text.split())
    up = norm.upper()
    for label in KNOWN_ACTIONS:
        if up.endswith(" " + label):
            cut = len(norm) - len(label)
            return norm[:cut].strip(), norm[cut:].strip()
    return norm, ""


def _parse_header(header_ws, cont_texts, cur_date, warn):
    """One call header row plus any wrapped continuation rows."""
    ident = header_ws[0]["text"]
    time = header_ws[1]["text"]
    body = header_ws[2:]
    dash = next((i for i, w in enumerate(body) if w["text"] == "-"), None)
    if dash is None or not body[dash + 1:]:
        warn(f"  warning: {ident}: no reason/action columns found; skipped")
        return None
    ra = body[dash + 1:]
    split = None
    for k, (a, b) in enumerate(zip(ra, ra[1:])):
        if b["x0"] - a["x1"] >= GAP_SPLIT:
            split = k + 1
            break
    if split is not None:
        reason = " ".join(w["text"] for w in ra[:split])
        action = " ".join(w["text"] for w in ra[split:])
        if cont_texts:
            action = (action + " " + " ".join(cont_texts)).strip()
    else:
        # Shifted layout: reason and action run together. Wrapped rows
        # carry the action (or its tail) on the continuation rows.
        reason, action = _split_action(" ".join(
            [w["text"] for w in ra] + cont_texts))
    unresolved = not action
    if unresolved:
        warn(f"  warning: {ident}: action not recognized"
             f" ({reason!r}); excluded pending review")
    return {
        "id": ident, "d": cur_date, "t": time,
        "r": " ".join(reason.split()).upper(),
        "a": " ".join(action.split()),
        "loc": "", "sector": "", "unresolved": unresolved,
    }


# Entry block states: after its header row an entry expects at most one
# Call Source row and then at most one Location row, in that order (either
# may be absent - see 26-11048 / 26-11763 in the posted logs). Anything
# beyond that is an orphan block whose header is missing from the PDF
# (real case: 26-12998). Orphans are logged and dropped; they never fill
# or replace a location, which is the bug class that once pinned a
# harassment-order call on a neighbouring call's street (26-11075).
_ST_SOURCE, _ST_LOCATION, _ST_DONE = "source", "location", "done"


def parse_pdf(path, stats=None):
    """Extract privacy-filtered incidents from one weekly PDF.

    Only header rows and Location rows are read. Call Source rows are used
    purely as structure (they end wrapped-action continuation and prove
    block ownership). Narrative rows - Refer To, Arrest/Summons names,
    home Address, Age, Charges - are never read.

    When ``stats`` is a dict it is filled with per-PDF reconciliation
    counts for check_parse_guards().
    """
    st = {"headers": 0, "id_tokens": 0, "sources": 0, "locations": 0,
          "orphans": 0, "suspects": 0, "unresolved": 0, "no_location": 0}
    out = []
    cur_date = None
    entry = None

    def warn(msg):
        print(msg)

    def close():
        nonlocal entry
        if entry is not None:
            e = entry
            entry = None
            row = _parse_header(e["_ws"], e["_cont"], e["_d"], warn)
            if row is not None:
                row["loc"] = e.get("loc", "")
                row["sector"] = e.get("sector", "")
                out.append(row)

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for ws in _word_lines(page):
                text = _join(ws)
                # Furniture is matched on normalized spacing: _join keeps
                # column-wide gaps as double spaces.
                norm = " ".join(text.split())
                if not norm or any(r.search(norm) for r in FURNITURE_RES):
                    continue
                st["id_tokens"] += sum(
                    1 for w in ws if CALL_ID_RE.match(w["text"]))
                dm = DATE_RE.search(norm)
                if dm:
                    close()
                    cur_date = f"{dm.group(3)}-{dm.group(1)}-{dm.group(2)}"
                    continue
                if (CALL_ID_RE.match(ws[0]["text"]) and len(ws) > 1
                        and TIME_RE.match(ws[1]["text"])):
                    close()
                    st["headers"] += 1
                    if cur_date:
                        entry = {"_ws": ws, "_cont": [], "_d": cur_date,
                                 "_state": _ST_SOURCE, "_loc_seen": False,
                                 "loc": "", "sector": ""}
                    continue
                if LOOSE_ID_RE.match(ws[0]["text"]):
                    # Call-number-shaped row that failed the strict header
                    # shape: format drift. Loud, and the following block is
                    # treated as an orphan.
                    close()
                    st["suspects"] += 1
                    warn(f"  warning: unrecognized call row skipped:"
                         f" {norm[:80]}")
                    continue
                if norm.startswith("Call Source"):
                    st["sources"] += 1
                    if entry is not None and entry["_state"] == _ST_SOURCE:
                        entry["_state"] = _ST_LOCATION
                    else:
                        st["orphans"] += 1
                        warn(f"  warning: orphan Call Source row discarded"
                             f" after {entry['_ws'][0]['text'] if entry else 'unknown header'}")
                        if entry is not None:
                            entry["_state"] = _ST_DONE
                    continue
                loc_text = None
                for label in LOCATION_LABELS:
                    if text.startswith(label):
                        loc_text = text[len(label):].strip()
                        break
                if loc_text is not None:
                    st["locations"] += 1
                    if (entry is not None
                            and entry["_state"] in (_ST_SOURCE, _ST_LOCATION)
                            and not entry["_loc_seen"]):
                        loc, sector = clean_location(loc_text)
                        entry["loc"], entry["sector"] = loc, sector
                        entry["_loc_seen"] = True
                        entry["_state"] = _ST_DONE
                    else:
                        st["orphans"] += 1
                        warn(f"  warning: orphan Location row discarded"
                             f" after {entry['_ws'][0]['text'] if entry else 'unknown header'}")
                    continue
                if entry is not None and entry["_state"] == _ST_SOURCE:
                    # Wrapped action text: a short row between the header
                    # and its Call Source/Location rows.
                    entry["_cont"].append(text)
                # Anything else (narrative, Refer To, Arrest, Address,
                # Age, Charges) is deliberately ignored.
        # An entry may span a page break (header at the bottom of one page,
        # Call Source/Location at the top of the next), so the open entry
        # is only closed by the next header/date row or end of document.
        close()
    for row in out:
        if row["unresolved"]:
            st["unresolved"] += 1
        if not row["loc"]:
            st["no_location"] += 1
    if stats is not None:
        stats.update(st)
    return out


# Per-PDF reconciliation guards. The old parser failed silently (12 of 269
# calls published from one week); these guards make any comparable drift a
# hard, visible failure instead of a quietly thin week.
MAX_ORPHANS = 10        # known real case is 1 (26-12998's missing header)
MAX_NO_LOCATION = 3     # observed: at most 1 per week
MAX_ID_TOKEN_GAP = 3    # call-id tokens that were not parsed as headers
MAX_BLOCK_DRIFT = 3     # Call Source/Location rows vs headers


def check_parse_guards(week_file, st):
    """Return a list of hard-failure messages for one parsed PDF."""
    problems = []
    if st["suspects"]:
        problems.append(f"{st['suspects']} unrecognized call row(s)")
    if st["unresolved"]:
        problems.append(f"{st['unresolved']} row(s) with unrecognized action")
    if st["orphans"] > MAX_ORPHANS:
        problems.append(f"{st['orphans']} orphan block rows"
                        f" (max {MAX_ORPHANS})")
    if st["no_location"] > MAX_NO_LOCATION:
        problems.append(f"{st['no_location']} calls without a location row"
                        f" (max {MAX_NO_LOCATION})")
    if st["headers"] == 0 and st["id_tokens"] > 0:
        problems.append(f"0 of {st['id_tokens']} call-number tokens parsed")
    elif st["id_tokens"] - st["headers"] > MAX_ID_TOKEN_GAP:
        problems.append(f"{st['id_tokens'] - st['headers']} call-number"
                        f" token(s) not parsed as headers")
    if abs(st["sources"] - st["headers"]) > MAX_BLOCK_DRIFT:
        problems.append(f"{st['sources']} Call Source rows vs"
                        f" {st['headers']} headers")
    if abs(st["locations"] - st["headers"]) > MAX_BLOCK_DRIFT:
        problems.append(f"{st['locations']} Location rows vs"
                        f" {st['headers']} headers")
    return [f"{week_file}: {p}" for p in problems]


def drop_reason(row):
    """Why a parsed row must be kept out of the published data, or None."""
    if row.get("unresolved"):
        # Reason/action could not be separated with confidence, so the
        # privacy exclusions cannot be relied on for this row.
        return "unresolved"
    if row["r"] in EXCLUDE_REASONS:
        return "excluded"
    if row["sector"] and row["sector"] not in GB_SECTORS:
        return "out_of_town"
    if not row["loc"]:
        return "no_location"
    return None

# Filenames are "8.23.26-8.29.26.pdf", but a handful use dashes where the rest
# use dots ("1.19-26-1.25-26.pdf"), so both separators are accepted.
WEEK_RE = re.compile(r"^(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})"
                     r"[.\-]+(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})")

def week_dates(filename):
    """(from, to) as ISO dates for a weekly log filename, or (None, None)."""
    m = WEEK_RE.match(filename)
    if not m:
        return None, None
    def iso(mo, da, yr):
        yr = "20" + yr if len(yr) == 2 else yr
        return f"{yr}-{int(mo):02d}-{int(da):02d}"
    return (iso(m.group(1), m.group(2), m.group(3)),
            iso(m.group(4), m.group(5), m.group(6)))

def index_pdfs():
    """Weekly PDF links from the logs index page, newest week first.

    The page lists three-plus years of logs grouped by upload month, and the
    groups are not in date order - so slicing the raw document order kept an
    arbitrary eight weeks and could silently miss the newest one. Sort by the
    week encoded in the filename and the newest really is first.
    """
    r = requests.get(INDEX_URL, headers=UA, timeout=40)
    r.raise_for_status()
    found = {}
    for m in re.finditer(r'href="(https://greatbarringtonpolice\.com/[^"]+\.pdf)"',
                         r.text):
        url = m.group(1)
        name = url.rsplit("/", 1)[-1]
        if name not in found:
            found[name] = url
    out = []
    for n, u in found.items():
        start, end = week_dates(n)
        if not start:
            # Not a weekly log (or a filename shape we do not understand);
            # skipping beats guessing at its date.
            print(f"  note: skipping unrecognised filename {n}")
            continue
        out.append({"file": n, "url": u, "from": start, "to": end})
    out.sort(key=lambda p: p["from"], reverse=True)
    return out

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
    guard_fails = []
    stats = {"new_weeks": [], "kept": 0, "excluded": 0, "out_of_town": 0,
             "no_location": 0, "unresolved": 0, "unmapped": 0, "mapped": 0}
    if not new_weeks:
        print("No new weekly PDFs; data is current.")
    for p in new_weeks:
        print(f"Fetching {p['file']} ...")
        rr = requests.get(p["url"], headers=UA, timeout=60)
        rr.raise_for_status()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
            tf.write(rr.content)
            tmp = tf.name
        pst = {}
        rows = parse_pdf(tmp, stats=pst)
        guard_fails.extend(check_parse_guards(p["file"], pst))
        stats["new_weeks"].append(f"{p['file']} ({len(rows)} raw entries)")
        if not rows:
            # Scanned PDF with no text layer (seen once so far) - record it so
            # the gap is visible instead of silently missing a week.
            stats.setdefault("unreadable", []).append(p["file"])
        for row in rows:
            why = drop_reason(row)
            if why:
                stats[why] += 1
                continue
            loc_disp = LOCATION_ALIASES.get(row["loc"].upper(), row["loc"])
            incidents[row["id"]] = {
                "id": row["id"], "d": row["d"], "t": row["t"],
                "r": title(row["r"]), "g": group_for(row["r"]),
                "a": title(row["a"]), "loc": row["loc"].title(),
                "w": p["file"],
            }
            stats["kept"] += 1

    if guard_fails:
        # Fail the run loudly: a week that does not reconcile against its
        # own PDF means the format drifted, and committing it would
        # silently publish a thin or shifted dataset (this exact failure
        # once put 12 of 269 calls on the site).
        print("PARSE GUARDS FAILED; no data written:")
        for p in guard_fails:
            print("  " + p)
        sys.exit(1)

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
        w = {"file": p["file"], "url": p["url"],
             "from": p["from"], "to": p["to"]}
        if p["file"] in stats.get("unreadable", []):
            w["note"] = "No text layer in this PDF (scanned); skipped."
        weeks.append(w)
    weeks.sort(key=lambda w: w["from"], reverse=True)

    payload = {
        "updated": datetime.now(ET).isoformat(timespec="seconds"),
        "source": {
            "name": "Great Barrington Police Department - public dispatch logs",
            "url": INDEX_URL,
        },
        "weeks": weeks,
        # The newest week the department has posted, which is typically two to
        # three weeks behind today. The blotter tab ranges dates off this.
        "published_through": max((w["to"] for w in weeks), default=None),
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
