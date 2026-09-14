#!/usr/bin/env python3
"""Scrape South County (Berkshire) town meeting calendars into data/meetings.json.

Sources:
  - Sandisfield / Lee / Monterey : Drupal date_ical feeds (/calendar/ical/export.ics)
  - Great Barrington             : CivicPlus calendar.aspx?CID=23 (upcoming meetings list)
  - Egremont / New Marlborough   : CivicPlus AgendaCenter search (agenda/minutes postings)
  - Sheffield                    : per-board agenda pages (/node/N/agenda)

Run daily from GitHub Actions. Failures are per-town and never abort the run.
"""
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

ET = ZoneInfo("America/New_York")
TODAY = datetime.now(ET).date()
UA = {"User-Agent": "BerkshireMeetingsBot/1.0 (+https://tylerherman19.github.io/berkshire-meetings/)"}

MONTHS_FULL = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]
MON = {m: i + 1 for i, m in enumerate(MONTHS_FULL)}
ABBR = {m[:3].lower(): i + 1 for i, m in enumerate(MONTHS_FULL)}
GB_MONTHS = "|".join(MONTHS_FULL)

meetings = []
stats = {}


def get(url, timeout=40):
    r = requests.get(url, headers=UA, timeout=timeout)
    r.raise_for_status()
    return r


def add(town, board, title, d, start=None, end=None, all_day=False,
        location=None, agenda_url=None, minutes_url=None, source_url=None):
    if not d or not isinstance(d, date):
        return
    meetings.append({
        "town": town,
        "board": (board or "").strip() or None,
        "title": (title or "").strip() or "Meeting",
        "date": d.isoformat(),
        "start": start,
        "end": end,
        "all_day": bool(all_day),
        "location": (location or "").strip() or None,
        "agenda_url": agenda_url,
        "minutes_url": minutes_url,
        "source_url": source_url,
    })


def clean_location(s):
    s = (s or "").replace("See map: Google Maps", " ")
    s = re.sub(r"\s+", " ", s).strip(" ,")
    return s or None


def board_from_path(url):
    m = re.search(r"/([a-z0-9\-]+)/(events|node|agenda)", url or "")
    if not m:
        return None
    return m.group(1).replace("-", " ").title()


# ---------------- ICS towns: Sandisfield, Lee, Monterey ----------------

def scrape_ics(town, base):
    """Drupal date_ical feed. Returns event count."""
    from icalendar import Calendar
    import recurring_ical_events

    url = base.rstrip("/") + "/calendar/ical/export.ics"
    try:
        raw = get(url).content
    except Exception as e:
        print(f"[{town}] ics fetch failed: {e}", flush=True)
        return 0
    try:
        cal = Calendar.from_ical(raw)
    except Exception as e:
        print(f"[{town}] ics parse failed: {e}", flush=True)
        return 0
    window_start = datetime.combine(TODAY - timedelta(days=7), datetime.min.time())
    window_end = datetime.combine(TODAY + timedelta(days=120), datetime.min.time())
    try:
        events = recurring_ical_events.of(cal).between(window_start, window_end)
    except Exception as e:
        print(f"[{town}] ics expansion failed: {e}", flush=True)
        return 0
    n = 0
    for ev in events:
        try:
            ds = ev.get("DTSTART").dt
            de = ev.get("DTEND").dt if ev.get("DTEND") else None
        except Exception:
            continue
        if isinstance(ds, datetime):
            if ds.tzinfo is None:
                ds = ds.replace(tzinfo=ET)
            local = ds.astimezone(ET)
            d = local.date()
            start = local.strftime("%H:%M")
            if isinstance(de, datetime):
                if de.tzinfo is None:
                    de = de.replace(tzinfo=ET)
                end = de.astimezone(ET).strftime("%H:%M")
            else:
                end = None
            all_day = False
        elif isinstance(ds, date):
            d, start, end, all_day = ds, None, None, True
        else:
            continue
        summary = str(ev.get("SUMMARY", "") or "").strip() or "Meeting"
        surl = str(ev.get("URL", "") or "") or None
        board = board_from_path(surl) or summary
        loc = clean_location(str(ev.get("LOCATION", "") or ""))
        add(town, board, summary, d, start=start, end=end, all_day=all_day,
            location=loc, source_url=surl)
        n += 1
    return n


# ---------------- Great Barrington ----------------

def scrape_great_barrington():
    town = "Great Barrington"
    base = "https://www.townofgbma.gov"
    try:
        soup = BeautifulSoup(get(base + "/calendar.aspx?CID=23").text, "html.parser")
    except Exception as e:
        print(f"[{town}] fetch failed: {e}", flush=True)
        return 0
    n = 0
    for h3 in soup.find_all("h3"):
        a = h3.find("a", href=True)
        if not a:
            continue
        title = a.get_text(" ", strip=True)
        if not title or len(title) < 3:
            continue
        detail = urljoin(base, a["href"])
        box = h3.find_parent(["li", "div", "article", "tr"]) or h3.parent
        text = box.get_text(" ", strip=True) if box else ""
        m = re.search(rf"({GB_MONTHS})\s+(\d{{1,2}}),\s+(\d{{4}}),\s+(\d{{1,2}}):(\d{{2}})\s*(AM|PM)",
                      text, re.I)
        if m:
            try:
                d = date(int(m.group(3)), MON[m.group(1).capitalize()], int(m.group(2)))
            except (KeyError, ValueError):
                continue
            hh = int(m.group(4)) % 12 + (12 if m.group(6).upper() == "PM" else 0)
            start, all_day = f"{hh:02d}:{m.group(5)}", False
        else:
            m2 = re.search(rf"({GB_MONTHS})\s+(\d{{1,2}}),\s+(\d{{4}}),\s+All Day", text, re.I)
            if not m2:
                continue
            try:
                d = date(int(m2.group(3)), MON[m2.group(1).capitalize()], int(m2.group(2)))
            except (KeyError, ValueError):
                continue
            start, all_day = None, True
        loc = None
        lm = re.search(r"@\s*(.+?)(?:More Details|$)", text)
        if lm:
            loc = clean_location(lm.group(1))
        agenda_url = None
        try:
            dsoup = BeautifulSoup(get(detail, timeout=20).text, "html.parser")
            for la in dsoup.find_all("a", href=True):
                lbl = (la.get_text(" ", strip=True) + " " + la["href"]).lower()
                if "agenda" in lbl:
                    agenda_url = urljoin(base, la["href"])
                    break
        except Exception:
            pass
        add(town, title, title, d, start=start, all_day=all_day,
            location=loc, agenda_url=agenda_url, source_url=detail)
        n += 1
    return n


# ---------------- Egremont / New Marlborough (CivicPlus AgendaCenter) ----------------

def scrape_agenda_center(town, base):
    url = base.rstrip("/") + "/AgendaCenter/Search/?term=&CIDs=all"
    try:
        soup = BeautifulSoup(get(url).text, "html.parser")
    except Exception as e:
        print(f"[{town}] fetch failed: {e}", flush=True)
        return 0
    cutoff = TODAY - timedelta(days=30)
    n = 0
    for h2 in soup.find_all("h2"):
        board = h2.get_text(" ", strip=True)
        if not board or "search" in board.lower():
            continue
        sib = h2.find_next_sibling()
        while sib is not None and sib.name != "h2":
            if sib.name == "table":
                for tr in sib.find_all("tr"):
                    tds = tr.find_all("td")
                    if len(tds) < 2:
                        continue
                    cell = tds[0].get_text(" ", strip=True)
                    m = re.search(r"([A-Za-z]{3})\s+\([A-Za-z]+\)\s+(\d{1,2}),\s+(\d{4})", cell)
                    if not m:
                        continue
                    mon = ABBR.get(m.group(1).lower())
                    if not mon:
                        continue
                    try:
                        d = date(int(m.group(3)), mon, int(m.group(2)))
                    except ValueError:
                        continue
                    if d < cutoff or d > TODAY + timedelta(days=120):
                        continue
                    a = tds[0].find("a", href=True)
                    agenda_url = urljoin(base, a["href"]) if a else None
                    title = a.get_text(" ", strip=True) if a else f"{board} Meeting"
                    ma = tds[1].find("a", href=True)
                    minutes_url = urljoin(base, ma["href"]) if ma else None
                    add(town, board, title, d, agenda_url=agenda_url,
                        minutes_url=minutes_url, source_url=url)
                    n += 1
            sib = sib.find_next_sibling()
    return n


# ---------------- Sheffield ----------------

DATE_RE = re.compile(rf"({GB_MONTHS})\s+(\d{{1,2}}),?\s+(\d{{4}})", re.I)
DATE_RE2 = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
DATE_RE3 = re.compile(r"(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})")


def date_from_text(s):
    if not s:
        return None
    m = DATE_RE.search(s)
    if m:
        try:
            return date(int(m.group(3)), MON[m.group(1).capitalize()], int(m.group(2)))
        except (KeyError, ValueError):
            return None
    m = DATE_RE2.search(s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = DATE_RE3.search(s)
    if m:
        y = int(m.group(3))
        y += 2000 if y < 100 else 0
        try:
            return date(y, int(m.group(1)), int(m.group(2)))
        except ValueError:
            return None
    return None


def scrape_sheffield():
    town = "Sheffield"
    base = "https://www.sheffieldma.gov"
    try:
        soup = BeautifulSoup(get(base + "/minutes-and-agendas").text, "html.parser")
    except Exception as e:
        print(f"[{town}] fetch failed: {e}", flush=True)
        return 0
    boards = []
    h2 = soup.find(["h2", "h3"], string=re.compile(r"Agendas", re.I))
    scope = h2.find_next(["ul", "div"]) if h2 else soup
    if scope:
        for a in scope.find_all("a", href=True):
            name = a.get_text(" ", strip=True)
            if name and len(name) > 2 and "archive" not in a["href"].lower():
                boards.append((name, urljoin(base, a["href"])))
    # dedupe boards while preserving order
    seen_b, uniq = set(), []
    for name, url in boards:
        if url not in seen_b:
            seen_b.add(url)
            uniq.append((name, url))
    n = 0
    for name, burl in uniq:
        try:
            bsoup = BeautifulSoup(get(burl, timeout=20).text, "html.parser")
        except Exception as e:
            print(f"[{town}] board page failed ({name}): {e}", flush=True)
            continue
        pages = [bsoup]
        year_a = bsoup.find("a", string=re.compile(rf"\b{TODAY.year}\b"))
        if year_a and year_a.has_attr("href"):
            try:
                pages.append(BeautifulSoup(
                    get(urljoin(base, year_a["href"]), timeout=20).text, "html.parser"))
            except Exception:
                pass
        for pg in pages:
            for a in pg.find_all("a", href=True):
                href = a["href"]
                text = a.get_text(" ", strip=True)
                if not text or len(text) < 4:
                    continue
                if not (href.lower().endswith(".pdf") or "agenda" in (text + " " + href).lower()):
                    continue
                d = date_from_text(text) or date_from_text(href)
                if not d or d < TODAY - timedelta(days=30) or d > TODAY + timedelta(days=120):
                    continue
                add(town, name, text, d, agenda_url=urljoin(base, href), source_url=burl)
                n += 1
    return n


# ---------------- Monterey ----------------

def scrape_monterey():
    town = "Monterey"
    base = "https://www.montereyma.gov"
    n = scrape_ics(town, base)
    if n:
        return n
    print(f"[{town}] ics empty, falling back to day pages", flush=True)
    count = 0
    for i in range(45):
        d = TODAY + timedelta(days=i)
        try:
            soup = BeautifulSoup(
                get(f"{base}/calendar/day/{d.isoformat()}", timeout=20).text, "html.parser")
        except Exception:
            continue
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not re.search(r"/(node|events|event)/\d+", href):
                continue
            title = a.get_text(" ", strip=True)
            if not title or len(title) < 3:
                continue
            parent = a.find_parent(["div", "li", "td"]) or a.parent
            ttext = parent.get_text(" ", strip=True) if parent else ""
            tm = re.search(r"(\d{1,2}):(\d{2})\s*(am|pm)", ttext, re.I)
            start = None
            if tm:
                hh = int(tm.group(1)) % 12 + (12 if tm.group(3).lower() == "pm" else 0)
                start = f"{hh:02d}:{tm.group(2)}"
            add(town, title, title, d, start=start, source_url=urljoin(base, href))
            count += 1
    return count


# ---------------- main ----------------

def main():
    jobs = [
        ("Sandisfield", lambda: scrape_ics("Sandisfield", "https://www.sandisfieldma.gov")),
        ("Lee", lambda: scrape_ics("Lee", "https://www.lee.ma.us")),
        ("Monterey", scrape_monterey),
        ("Great Barrington", scrape_great_barrington),
        ("Egremont", lambda: scrape_agenda_center("Egremont", "https://www.egremont-ma.gov")),
        ("New Marlborough", lambda: scrape_agenda_center("New Marlborough", "https://www.newmarlboroughma.gov")),
        ("Sheffield", scrape_sheffield),
    ]
    total = 0
    for name, fn in jobs:
        try:
            c = fn()
        except Exception as e:  # never let one town kill the run
            print(f"[{name}] ERROR: {e}", flush=True)
            c = 0
        stats[name] = c
        total += c
        print(f"[{name}] {c} meetings", flush=True)

    seen, out = set(), []
    for m in meetings:
        key = (m["town"], m["board"], m["title"], m["date"], m["start"])
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    out.sort(key=lambda m: (m["date"], m["start"] or "99:99", m["town"] or ""))

    payload = {
        "updated": datetime.now(ET).isoformat(timespec="seconds"),
        "meetings": out,
        "towns": stats,
    }
    root = Path(__file__).resolve().parent.parent
    target = root / "data" / "meetings.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, indent=1))
    print(f"TOTAL {len(out)} meetings -> {target}", flush=True)


if __name__ == "__main__":
    main()
