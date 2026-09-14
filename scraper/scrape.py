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
UA = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

MONTHS_FULL = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]
MON = {m: i + 1 for i, m in enumerate(MONTHS_FULL)}
ABBR = {m[:3].lower(): i + 1 for i, m in enumerate(MONTHS_FULL)}
GB_MONTHS = "|".join(MONTHS_FULL)

meetings = []
stats = {}


def get(url, timeout=40):
    try:
        r = requests.get(url, headers=UA, timeout=timeout)
        r.raise_for_status()
        return r
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else None
        server = (e.response.headers.get("Server") if e.response is not None else None)
        if code == 403:
            print(f"[retry-tls] 403 (server={server}) for {url}; "
                  "retrying with browser TLS impersonation", flush=True)
            try:
                from curl_cffi import requests as tls_requests
            except ImportError:
                print("[retry-tls] curl_cffi not installed", flush=True)
                raise
            r2 = tls_requests.get(url, headers=UA, timeout=timeout, impersonate="chrome")
            if r2.status_code >= 400:
                print(f"[retry-tls] still failing: {r2.status_code}", flush=True)
                raise
            print(f"[retry-tls] success for {url}", flush=True)
            return r2
        raise


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


# ---------------- CivicPlus classic calendar list (Great Barrington, Lee) ----------------

def _civicplus_list(town, url):
    """Parse a CivicPlus classic /calendar.aspx upcoming-meetings list. Returns count."""
    base = re.match(r"https?://[^/]+", url).group(0)
    try:
        soup = BeautifulSoup(get(url).text, "html.parser")
    except Exception as e:
        print(f"[{town}] fetch failed ({url}): {e}", flush=True)
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


def scrape_great_barrington():
    return _civicplus_list("Great Barrington",
                           "https://www.townofgbma.gov/calendar.aspx?CID=23")


def scrape_lee():
    town = "Lee"
    # Site moved to leema.gov (CivicPlus) in 2026; try its calendar pages first.
    for path in ["/calendar.aspx", "/Calendar.aspx"]:
        try:
            n = _civicplus_list(town, "https://leema.gov" + path)
        except Exception as e:
            print(f"[{town}] {path} error: {e}", flush=True)
            n = 0
        if n:
            return n
    print(f"[{town}] civicplus calendar empty, trying legacy ics", flush=True)
    return scrape_ics(town, "https://www.lee.ma.us")


# ---------------- Egremont / New Marlborough (CivicPlus AgendaCenter) ----------------

def scrape_agenda_center(town, base):
    url = base.rstrip("/") + "/AgendaCenter/Search/?term=&CIDs=all"
    try:
        html = get(url).text
    except Exception as e:
        print(f"[{town}] fetch failed: {e}", flush=True)
        return 0
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    if not tables:
        title = soup.title.get_text(strip=True) if soup.title else "?"
        print(f"[{town}] no tables found (title={title!r}, len={len(html)})", flush=True)
        return 0
    cutoff = TODAY - timedelta(days=30)
    horizon = TODAY + timedelta(days=120)
    n = 0
    for tbl in tables:
        h2 = tbl.find_previous("h2")
        board = h2.get_text(" ", strip=True) if h2 else ""
        if not board or "search" in board.lower():
            continue
        for tr in tbl.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            cell = tds[0].get_text(" ", strip=True)
            m = re.search(r"([A-Za-z]{3,9})\s*(?:\([A-Za-z]+\))?\s*(\d{1,2}),\s*(\d{4})", cell)
            if not m:
                continue
            mon = ABBR.get(m.group(1)[:3].lower()) or MON.get(m.group(1).capitalize())
            if not mon:
                continue
            try:
                d = date(int(m.group(3)), mon, int(m.group(2)))
            except ValueError:
                continue
            if d < cutoff or d > horizon:
                continue
            a = tds[0].find("a", href=True)
            agenda_url = urljoin(base, a["href"]) if a else None
            title = a.get_text(" ", strip=True) if a else f"{board} Meeting"
            ma = tds[1].find("a", href=True)
            minutes_url = urljoin(base, ma["href"]) if ma else None
            add(town, board, title, d, agenda_url=agenda_url,
                minutes_url=minutes_url, source_url=url)
            n += 1
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


def board_from_agenda_title(title):
    """Sheffield agenda links usually name the board: 'X Committee Agenda 9/16/26'."""
    t = DATE_RE.sub("", title or "")
    t = DATE_RE2.sub("", t)
    t = DATE_RE3.sub("", t)
    t = re.sub(r"(?i)\b(agendas?|minutes|meetings?|special|regular|draft)\b", "", t)
    t = re.sub(r"\s+", " ", t).strip(" -–—")
    return t if len(t) >= 4 else None


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
    seen_urls = {}
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
                furl = urljoin(base, href)
                # Each board page repeats the same "recent agendas" sidebar, so the
                # same file shows up under many boards: keep one record per file and
                # prefer the board name parsed from the agenda title itself.
                board = board_from_agenda_title(text) or name
                if furl in seen_urls:
                    prev = seen_urls[furl]
                    if prev["board"] == prev["page_board"] and board != name:
                        prev["board"] = board
                    continue
                seen_urls[furl] = {"board": board, "page_board": name, "title": text,
                                   "date": d, "agenda_url": furl, "source_url": burl}
    for rec in seen_urls.values():
        add(town, rec["board"], rec["title"], rec["date"],
            agenda_url=rec["agenda_url"], source_url=rec["source_url"])
    return len(seen_urls)


# ---------------- Drupal day-page crawl (Monterey, Sandisfield fallback) ----------------

def scrape_drupal_day_pages(town, base, days=45):
    """Crawl /calendar/day/YYYY-MM-DD pages (Drupal date module). Returns count."""
    count = 0
    for i in range(days):
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
            start = None
            for depth, parent in enumerate(a.parents):
                if depth > 3 or parent.name in ("body", "html"):
                    break
                ttext = parent.get_text(" ", strip=True) if hasattr(parent, "get_text") else ""
                tm = re.search(r"(\d{1,2}):(\d{2})\s*(am|pm)", ttext, re.I)
                if tm:
                    hh = int(tm.group(1)) % 12 + (12 if tm.group(3).lower() == "pm" else 0)
                    start = f"{hh:02d}:{tm.group(2)}"
                    break
            add(town, title, title, d, start=start, source_url=urljoin(base, href))
            count += 1
    return count


def scrape_monterey():
    town = "Monterey"
    base = "https://www.montereyma.gov"
    n = scrape_ics(town, base)
    if n:
        return n
    print(f"[{town}] ics unavailable, falling back to day pages", flush=True)
    return scrape_drupal_day_pages(town, base)


def scrape_sandisfield():
    town = "Sandisfield"
    base = "https://www.sandisfieldma.gov"
    n = scrape_ics(town, base)
    if n:
        return n
    print(f"[{town}] ics blocked, falling back to day pages", flush=True)
    return scrape_drupal_day_pages(town, base)


# ---------------- main ----------------

def main():
    jobs = [
        ("Sandisfield", scrape_sandisfield),
        ("Lee", scrape_lee),
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
