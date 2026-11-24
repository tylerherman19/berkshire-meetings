#!/usr/bin/env python3
"""Scrape South County (Berkshire) town meeting calendars into data/meetings.json.

Sources:
  - Sandisfield / Monterey : Drupal date_ical feeds (/calendar/ical/export.ics)
  - Great Barrington        : CivicPlus calendar.aspx?CID=23 (upcoming meetings list)
  - Egremont / New Marlborough / Tyringham : CivicPlus AgendaCenter (+Tyringham calendar)
  - Sheffield               : per-board agenda pages (/node/N/agenda)
  - Otis                    : Revize calendar JSON + per-board agenda pages
  - Becket                  : Drupal 7 per-board agenda/minutes indexes
  - Richmond                : Revize yearly agenda/minutes tables
  - Berkshire Hills RSD     : district meeting calendar + Google Doc agendas
  - SBRSD                   : reattributed from member-town cross-posts

Run daily from GitHub Actions. Failures are per-town and never abort the run.
"""
import json
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit
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


def require_complete(issues):
    if issues:
        detail = str(issues[0])
        if len(issues) > 1:
            detail += f" ({len(issues) - 1} more requests failed)"
        raise RuntimeError(detail)


def get(url, timeout=40):
    try:
        r = requests.get(url, headers=UA, timeout=timeout)
        r.raise_for_status()
        return r
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else None
        server = (e.response.headers.get("Server") if e.response is not None else None)
        if code == 403:
            try:
                from curl_cffi import requests as tls_requests
            except ImportError:
                print("[retry-tls] curl_cffi not installed", flush=True)
                raise
            for attempt in (1, 2, 3):
                print(f"[retry-tls] 403 (server={server}) for {url}; "
                      f"browser-TLS attempt {attempt}/3", flush=True)
                r2 = tls_requests.get(url, headers=UA, timeout=timeout, impersonate="chrome")
                if r2.status_code < 400:
                    print(f"[retry-tls] success for {url}", flush=True)
                    return r2
                print(f"[retry-tls] still failing: {r2.status_code}", flush=True)
                time.sleep(10 * attempt)
            raise
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


# ---------------- ICS towns: Sandisfield, Monterey, Mount Washington ----------------

def scrape_ics(town, base, feed_path="/calendar/ical/export.ics"):
    """Drupal date_ical feed (or any explicit feed path). Returns event count."""
    from icalendar import Calendar
    import recurring_ical_events

    url = base.rstrip("/") + feed_path
    raw = get(url).content
    cal = Calendar.from_ical(raw)
    window_start = datetime.combine(TODAY - timedelta(days=7), datetime.min.time())
    window_end = datetime.combine(TODAY + timedelta(days=120), datetime.min.time())
    events = recurring_ical_events.of(cal).between(window_start, window_end)
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
    soup = BeautifulSoup(get(url).text, "html.parser")
    calendar = soup.select_one(".calendarViewList")
    if calendar is None:
        raise ValueError("Expected CivicPlus calendar list was missing")
    n = 0
    for h3 in calendar.find_all("h3"):
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
    soup = BeautifulSoup(get(url).text, "html.parser")
    tables = soup.select("table[summary='List of Agendas']")
    if not tables:
        raise ValueError("Expected CivicPlus agenda tables were missing")
    cutoff = TODAY - timedelta(days=30)
    horizon = TODAY + timedelta(days=120)
    minutes_cutoff = TODAY - timedelta(days=180)
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
            a = tds[0].find("a", href=True)
            agenda_url = urljoin(base, a["href"]) if a else None
            title = a.get_text(" ", strip=True) if a else f"{board} Meeting"
            ma = tds[1].find("a", href=True)
            minutes_url = urljoin(base, ma["href"]) if ma else None
            # Minutes get posted weeks after the meeting, so keep older rows
            # that have minutes links (feeds the minutes archive).
            if d > horizon:
                continue
            if d < cutoff and not (minutes_url and d >= minutes_cutoff):
                continue
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
    soup = BeautifulSoup(get(base + "/minutes-and-agendas").text, "html.parser")
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
    if not uniq:
        raise ValueError("Expected Sheffield board links were missing")
    issues = []
    seen_urls = {}
    print(f"[{town}] {len(uniq)} board pages", flush=True)
    for name, burl in uniq:
        try:
            bsoup = BeautifulSoup(get(burl, timeout=20).text, "html.parser")
        except Exception as e:
            print(f"[{town}] board page failed ({name}): {e}", flush=True)
            issues.append(e)
            continue
        pages = [bsoup]
        year_a = bsoup.find("a", string=re.compile(rf"\b{TODAY.year}\b"))
        if year_a and year_a.has_attr("href"):
            try:
                pages.append(BeautifulSoup(
                    get(urljoin(base, year_a["href"]), timeout=20).text, "html.parser"))
            except Exception as e:
                issues.append(e)
        new_here = 0
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
                new_here += 1
        if new_here:
            print(f"[{town}] {name}: {new_here} new file(s)", flush=True)
    for rec in seen_urls.values():
        add(town, rec["board"], rec["title"], rec["date"],
            agenda_url=rec["agenda_url"], source_url=rec["source_url"])
    require_complete(issues)
    return len(seen_urls)


# ---------------- Drupal day-page crawl (Monterey, Sandisfield fallback) ----------------

def scrape_drupal_day_pages(town, base, days=45):
    """Crawl /calendar/day/YYYY-MM-DD pages (Drupal date module). Returns count."""
    count = 0
    issues = []
    consecutive_failures = 0
    for i in range(days):
        d = TODAY + timedelta(days=i)
        try:
            soup = BeautifulSoup(
                get(f"{base}/calendar/day/{d.isoformat()}", timeout=20).text, "html.parser")
        except Exception as e:
            issues.append(e)
            consecutive_failures += 1
            if consecutive_failures >= 3:
                break
            continue
        consecutive_failures = 0
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not re.search(r"/(node|events|event)/\d+", href):
                continue
            title = a.get_text(" ", strip=True)
            if not title or len(title) < 3:
                continue
            low = title.lower()
            if "postponed" in low or "cancel" in low or "reschedul" in low:
                continue  # not an upcoming meeting; towns re-post with the new date
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
    require_complete(issues)
    return count


def scrape_monterey():
    return scrape_drupal_calendar("Monterey", "https://www.montereyma.gov")


def scrape_sandisfield():
    return scrape_drupal_calendar("Sandisfield", "https://www.sandisfieldma.gov")


def scrape_drupal_calendar(town, base):
    try:
        return scrape_ics(town, base)
    except Exception as e:
        print(f"[{town}] calendar feed unavailable, falling back to day pages: {e}", flush=True)
        scrape_drupal_day_pages(town, base)
        raise RuntimeError("Calendar feed unavailable; fallback covers the next 45 days only") from e


# ---------------- Stockbridge (static meetings table) ----------------

def scrape_stockbridge():
    town = "Stockbridge"
    base = "https://www.stockbridge-ma.gov"
    url = base + "/meetings"
    try:
        soup = BeautifulSoup(get(url).text, "html.parser")
    except Exception as e:
        print(f"[{town}] fetch failed: {e}", flush=True)
        return 0
    n = 0
    cutoff = TODAY - timedelta(days=30)
    horizon = TODAY + timedelta(days=120)
    for tbl in soup.find_all("table"):
        for tr in tbl.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            when = tds[0].get_text(" ", strip=True)
            m = re.search(
                r"([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})"
                r"(?:\s*\|\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm))?",
                when, re.I)
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
            start = end = None
            if m.group(4):
                sh, sm, sap = int(m.group(4)), m.group(5), m.group(6).lower()
                eh, em, eap = int(m.group(7)), m.group(8), m.group(9).lower()
                start = f"{sh % 12 + (12 if sap == 'pm' else 0):02d}:{sm}"
                end = f"{eh % 12 + (12 if eap == 'pm' else 0):02d}:{em}"
            board = tds[1].get_text(" ", strip=True) or "Meeting"
            agenda_url = minutes_url = detail_url = None
            for i, key in ((2, "agenda"), (3, "agenda"), (4, "detail")):
                if i < len(tds):
                    a = tds[i].find("a", href=True)
                    if a:
                        href = urljoin(base, a["href"])
                        if key == "agenda" and not agenda_url:
                            agenda_url = href
                        elif key == "detail":
                            detail_url = href
            add(town, board, f"{board} Meeting", d, start=start, end=end,
                agenda_url=agenda_url, source_url=detail_url or url)
            n += 1
    return n


# ---------------- Alford (CivicEngage calendar, category sections) ----------------

def scrape_alford():
    town = "Alford"
    base = "https://www.townofalford.org"
    url = base + "/calendar.aspx?CID=26,29,30,14,23,25,31,27,24,22,28"
    soup = BeautifulSoup(get(url).text, "html.parser")
    calendar = soup.select_one(".calendarViewList")
    if calendar is None:
        raise ValueError("Expected Alford calendar list was missing")
    n = 0
    cutoff = TODAY - timedelta(days=30)
    horizon = TODAY + timedelta(days=120)
    for h2 in calendar.find_all("h2", class_="title"):
        board = h2.get_text(" ", strip=True)
        if not board or "search" in board.lower():
            continue
        ol = h2.find_next("ol")
        if not ol:
            continue
        for li in ol.find_all("li", recursive=False):
            h3 = li.find("h3")
            a = h3.find("a", href=True) if h3 else None
            if not a:
                continue
            title = a.get_text(" ", strip=True)
            if not title or len(title) < 3:
                continue
            lowt = title.lower()
            if "postponed" in lowt or "cancel" in lowt or "reschedul" in lowt:
                continue  # not an upcoming meeting; towns re-post with the new date
            detail = urljoin(base, a["href"])
            dd = li.find("div", class_="date")
            when = dd.get_text(" ", strip=True) if dd else ""
            m = re.search(
                r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)",
                when, re.I)
            if not m:
                # fall back to the date embedded in the detail URL
                m2 = re.search(r"day=(\d{1,2})&month=(\d{1,2})&year=(\d{4})", detail)
                if not m2:
                    continue
                try:
                    d = date(int(m2.group(3)), int(m2.group(2)), int(m2.group(1)))
                except ValueError:
                    continue
                start = None
            else:
                mon = MON.get(m.group(1).capitalize()) or ABBR.get(m.group(1)[:3].lower())
                if not mon:
                    continue
                try:
                    d = date(int(m.group(3)), mon, int(m.group(2)))
                except ValueError:
                    continue
                hh, ap = int(m.group(4)), m.group(6).upper()
                start = f"{hh % 12 + (12 if ap == 'PM' else 0):02d}:{m.group(5)}"
            if d < cutoff or d > horizon:
                continue
            loc_el = li.find("div", class_=re.compile(r"eventLocation"))
            loc = clean_location(loc_el.get_text(" ", strip=True)) if loc_el else None
            add(town, board, title, d, start=start, location=loc, source_url=detail)
            n += 1
    return n


def scrape_mount_washington():
    # Modern Events Calendar iCal feed; event pages carry agenda text (v2)
    return scrape_ics("Mount Washington", "https://mountwashington-ma.gov",
                      feed_path="/?mec-ical-feed=1")


# ---------------- Otis (Revize calendar JSON + per-board agenda pages) ----------------

OTIS_CAL = ("https://townofotisma.com/_assets_/plugins/revizeCalendar/calendar_data_handler.php"
            "?webspace=otismassachusetts&relative_revize_url=//cms2.revize.com&protocol=https:")
OTIS_BASE = "https://townofotisma.com"
OTIS_DOCS = OTIS_BASE + "/transparency/agendas_minutes.php"


def scrape_otis():
    town = "Otis"
    events = get(OTIS_CAL, timeout=40).json()
    if not isinstance(events, list):
        raise ValueError("Otis calendar returned an unexpected response")
    # Board landing -> (board name, agendas/minutes page)
    boards = []
    issues = []
    try:
        soup = BeautifulSoup(get(OTIS_DOCS, timeout=40).text, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "agendas_minutes.php" not in href:
                continue
            if href.rstrip("/").endswith("transparency/agendas_minutes.php"):
                continue
            name = a.get_text(" ", strip=True)
            if name:
                boards.append((name, urljoin(OTIS_BASE + "/", href)))
    except Exception as e:
        issues.append(e)
    else:
        if not boards:
            issues.append("Expected Otis board links were missing")
    docs = {}  # (board.lower(), date) -> {"agenda": url, "minutes": url}
    for name, page in boards:
        try:
            psoup = BeautifulSoup(get(page, timeout=30).text, "html.parser")
        except Exception as e:
            issues.append(e)
            continue
        for a in psoup.find_all("a", href=True):
            href = a["href"]
            low = href.lower()
            if ".pdf" not in low:
                continue
            fname = low.rsplit("/", 1)[-1]
            if "/agendas/" in low or "agenda" in fname:
                kind = "agenda"
            elif "/minutes/" in low or "minutes" in fname:
                kind = "minutes"
            else:
                continue
            d = date_from_text(a.get_text(" ", strip=True)) or date_from_text(href)
            if not d:
                continue
            docs.setdefault((name.lower(), d), {})[kind] = urljoin(page, href)
    n = 0
    cutoff = TODAY - timedelta(days=180)
    horizon = TODAY + timedelta(days=120)
    for ev in events:
        if not isinstance(ev, dict):
            continue
        if ev.get("primary_calendar_name") != "Public Meetings":
            continue
        title = (ev.get("title") or "").strip()
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", ev.get("start") or "")
        if not title or not m:
            continue
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            continue
        if d < cutoff or d > horizon:
            continue
        board = re.sub(r"\s+Meeting$", "", title, flags=re.I).strip() or title
        doc = docs.get((board.lower(), d), {})
        add(town, board, title, d, start=f"{m.group(4)}:{m.group(5)}",
            location=clean_location(ev.get("location")),
            agenda_url=doc.get("agenda"), minutes_url=doc.get("minutes"),
            source_url=OTIS_DOCS)
        n += 1
    require_complete(issues)
    return n


# ---------------- Tyringham (CivicPlus, same as Egremont/Alford) ----------------

def scrape_tyringham():
    town, base = "Tyringham", "https://www.tyringham-ma.gov"
    issues = []
    n = 0
    for fetch_source, url in ((_civicplus_list, base + "/calendar.aspx?CID=26"),
                              (scrape_agenda_center, base)):
        try:
            n += fetch_source(town, url)
        except Exception as e:
            issues.append(e)
    require_complete(issues)
    return n


# ---------------- Becket (Drupal 7 board indexes) ----------------

BECKET_BASE = "https://www.townofbecket.org"


def _becket_pdf(doc_url):
    """Fetch a Becket agenda/minutes doc page and return its PDF href."""
    try:
        soup = BeautifulSoup(get(doc_url, timeout=30).text, "html.parser")
    except Exception:
        return None
    for a in soup.find_all("a", href=True):
        low = a["href"].lower()
        if low.endswith(".pdf") and ("/agendas/" in low or "/minutes/" in low):
            return urljoin(BECKET_BASE, a["href"])
    return None


def scrape_becket():
    town = "Becket"
    try:
        soup = BeautifulSoup(get(BECKET_BASE + "/minutes-and-agendas", timeout=40).text,
                             "html.parser")
    except Exception as e:
        # The board index is the whole source; failing here means we know
        # nothing, so raise and let the Sources tab report the failure.
        raise RuntimeError(f"board index fetch failed: {e}")
    boards = []
    seen = set()
    for a in soup.find_all("a", href=True):
        m = re.search(r"/node/(\d+)(?:/|$|\?)", a["href"] or "")
        if not m or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        name = a.get_text(" ", strip=True)
        if name:
            boards.append((name, m.group(1)))
    if not boards:
        raise ValueError("Expected Becket board links were missing")
    cutoff = TODAY - timedelta(days=180)
    horizon = TODAY + timedelta(days=120)
    recent_cutoff = TODAY - timedelta(days=45)
    recs = {}  # (board, date) -> dict(title, start, agenda, minutes, source)
    fetches = 0
    issues = []
    for name, nid in boards:
        for kind, path in (("agenda", f"/node/{nid}/agenda/2026"),
                           ("minutes", f"/node/{nid}/minutes/2026")):
            try:
                isoup = BeautifulSoup(get(BECKET_BASE + path, timeout=40).text,
                                      "html.parser")
            except Exception as e:
                print(f"[{town}] {name} {kind} index failed: {e}", flush=True)
                if not isinstance(e, requests.HTTPError) or e.response is None or e.response.status_code != 404:
                    issues.append(e)
                continue
            for a in isoup.find_all("a", href=True):
                href = a["href"]
                if f"/{kind}/" not in href.lower():
                    continue
                doc_url = urljoin(BECKET_BASE, href)
                box = a.find_parent(["li", "div", "article", "tr"]) or a.parent
                text = box.get_text(" ", strip=True) if box else a.get_text(" ", strip=True)
                d = date_from_text(text)
                if not d or d < cutoff or d > horizon:
                    continue
                tm = re.search(r"(\d{1,2}):(\d{2})\s*(am|pm)", text, re.I)
                start = None
                if tm:
                    hh = int(tm.group(1)) % 12 + (12 if tm.group(3).lower() == "pm" else 0)
                    start = f"{hh:02d}:{tm.group(2)}"
                # Fetch the doc page for the direct PDF only for recent or
                # upcoming entries; older ones link to the doc page itself.
                pdf = None
                if d >= recent_cutoff and fetches < 400:
                    pdf = _becket_pdf(doc_url)
                    fetches += 1
                    time.sleep(0.4)  # polite: Cloudflare watches this host
                rec = recs.setdefault((name, d), {
                    "title": a.get_text(" ", strip=True) or f"{name} Meeting",
                    "start": start, "agenda": None, "minutes": None, "source": doc_url})
                rec[kind] = pdf or doc_url
                if start and not rec["start"]:
                    rec["start"] = start
    n = 0
    for (board, d), r in recs.items():
        add(town, board, r["title"], d, start=r["start"],
            agenda_url=r["agenda"], minutes_url=r["minutes"], source_url=r["source"])
        n += 1
    require_complete(issues)
    return n


# ---------------- Berkshire Hills RSD (district calendar + Google Doc agendas) ----------------

BHRSD_CAL = "https://www.bhrsd.org/sc-meeting-calendar"
BHRSD_AGENDA_PAGE = "https://www.bhrsd.org/upcoming-meeting-agenda"


def scrape_bhrsd():
    town = "BHRSD"
    soup = BeautifulSoup(get(BHRSD_CAL, timeout=40).text, "html.parser")
    dates = []
    for tag in soup.find_all("strong"):
        d = date_from_text(tag.get_text(" ", strip=True))
        if not d:
            continue
        row = tag.find_parent("tr") or tag.parent
        cells = row.find_all("td", recursive=False)
        loc = cells[-1].get_text(" ", strip=True) if len(cells) > 1 else ""
        dates.append((d, clean_location(loc)))
    if not dates:
        raise ValueError("Expected Berkshire Hills school committee dates were missing")
    # The upcoming agenda is a public Google Doc; export it as text for the
    # search index and pull the meeting time from it (calendar has no times).
    agenda_url, agenda_date, agenda_text, start = None, None, None, None
    issues = []
    try:
        asoup = BeautifulSoup(get(BHRSD_AGENDA_PAGE, timeout=40).text, "html.parser")
        link_text = ""
        for a in asoup.find_all("a", href=True):
            if "docs.google.com/document/d/" in a["href"]:
                agenda_url = a["href"]
                link_text = a.get_text(" ", strip=True)
                break
        if agenda_url:
            agenda_date = date_from_text(link_text)
            m = re.search(r"/document/d/([A-Za-z0-9_-]+)", agenda_url)
            if m:
                txt = get(f"https://docs.google.com/document/d/{m.group(1)}/export?format=txt",
                          timeout=40).text
                agenda_text = txt.strip()[:8000]
                if not agenda_date:
                    agenda_date = date_from_text(txt[:500])
                tm = re.search(r"(\d{1,2}):(\d{2})\s*(am|pm)", txt[:500], re.I)
                if tm:
                    hh = int(tm.group(1)) % 12 + (12 if tm.group(3).lower() == "pm" else 0)
                    start = f"{hh:02d}:{tm.group(2)}"
    except Exception as e:
        issues.append(e)
    n = 0
    for d, loc in dates:
        if d < TODAY - timedelta(days=180) or d > TODAY + timedelta(days=180):
            continue
        is_agenda_mtg = agenda_date is not None and d == agenda_date
        add(town, "School Committee", "School Committee Meeting", d,
            start=start if is_agenda_mtg else None,
            location=loc or "Berkshire Hills Regional School District",
            agenda_url=agenda_url if is_agenda_mtg else None,
            source_url=BHRSD_CAL)
        if is_agenda_mtg and agenda_text and len(agenda_text) > 120:
            meetings[-1]["_doc_text"] = agenda_text
        n += 1
    require_complete(issues)
    return n


RICHMOND_AGENDAS = "https://www.richmondma.org/agendas_and_minutes/"


def parse_richmond_agendas(soup, url, cutoff, horizon, records):
    page = soup.select_one("main .post")
    if page is None or not page.find("strong"):
        raise ValueError("Expected Richmond agenda and minutes listings were missing")
    for row in page.select("table tr"):
        cells = row.find_all("td", recursive=False)
        if len(cells) < 2:
            continue
        heading = row.find_previous("strong")
        if not heading or page not in heading.parents:
            continue
        board = heading.get_text(" ", strip=True)
        label = cells[0].get_text(" ", strip=True)
        match = re.match(r"^(\d{1,2}/\d{1,2}/\d{2,4})\s*(.*)$", label)
        if not match:
            continue
        d = date_from_text(match[1])
        if not d or not cutoff <= d <= horizon:
            continue
        note = match[2].strip(" -–—")
        cancelled = re.search(r"\b(?:no meeting|no quorum|cancell?ed)\b", note, re.I)
        documents = {}
        for cell in cells[1:]:
            for link in cell.find_all("a", href=True):
                kind = link.get_text(" ", strip=True).lower()
                href = urljoin(url, link["href"])
                if kind in {"agenda", "packet", "minutes"} and urlsplit(href).scheme in {"http", "https"}:
                    documents[kind] = href
        if not documents and not cancelled:
            continue
        start = None
        when = re.search(r"\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?", note, re.I)
        if when and 1 <= int(when[1]) <= 12 and int(when[2]) < 60:
            start = f"{int(when[1]) % 12 + (12 if when[3].lower() == 'p' else 0):02d}:{when[2]}"
        revised = bool(re.search(r"\b(?:revised|amended)\b", note, re.I))
        subject = re.sub(r"\b(?:revised|amended)\b", "", note, flags=re.I)
        subject = re.sub(r"\b\d{1,2}:\d{2}\s*[ap]\.?m\.?", "", subject, flags=re.I).strip(" -–—")
        if subject.casefold() == board.casefold():
            subject = ""
        title = f"{board} Meeting"
        if subject:
            title += f" – {subject}"
        if cancelled and not re.search(r"\bcancell?ed\b", title, re.I):
            title += " (Cancelled)"
        key = (board, d, start, subject.casefold())
        record = records.setdefault(key, {
            "title": title, "url": url, "documents": {}, "revised": False,
            "location": "Remote participation only" if "remote participation only" in note.lower() else None,
        })
        if revised or not record["revised"]:
            record["documents"].update(documents)
        else:
            for kind, href in documents.items():
                record["documents"].setdefault(kind, href)
        record["revised"] |= revised


def scrape_richmond():
    cutoff, horizon = TODAY - timedelta(days=180), TODAY + timedelta(days=120)
    url = f"{RICHMOND_AGENDAS}{TODAY.year}.php"
    soup = BeautifulSoup(get(url).text, "html.parser")
    records = {}
    parse_richmond_agendas(soup, url, cutoff, horizon, records)
    issues = []
    for year in {cutoff.year, horizon.year} - {TODAY.year}:
        year_url = f"{RICHMOND_AGENDAS}{year}.php"
        if not any(urljoin(url, link["href"]) == year_url for link in soup.find_all("a", href=True)):
            continue
        try:
            extra = BeautifulSoup(get(year_url).text, "html.parser")
            parse_richmond_agendas(extra, year_url, cutoff, horizon, records)
        except Exception as e:
            issues.append(e)
    for (board, d, start, _), record in records.items():
        docs = record["documents"]
        add("Richmond", board, record["title"], d, start=start, location=record["location"],
            agenda_url=docs.get("agenda") or docs.get("packet"), minutes_url=docs.get("minutes"),
            source_url=record["url"])
    require_complete(issues)
    return len(records)


SBRSD_RE = re.compile(r"southern berkshire regional school|\bsbrsd\b", re.I)

SBRSD_COMMITTEES = [
    ("finance", "Finance Subcommittee"),
    ("personnel", "Personnel & Negotiations Subcommittee"),
    ("negotiat", "Personnel & Negotiations Subcommittee"),
    ("bargaining", "Personnel & Negotiations Subcommittee"),
    ("policy", "Policy Subcommittee"),
    ("superintendent evaluation", "Superintendent Evaluation Subcommittee"),
    ("community relations", "Community Relations Subcommittee"),
    ("handbook", "Handbook Review Subcommittee"),
    ("executive minutes", "Executive Minutes Review Subcommittee"),
]


def sbrsd_committee(text):
    t = text.lower()
    for kw, name in SBRSD_COMMITTEES:
        if kw in t:
            return name
    return "School Committee"


def attribute_sbrsd():
    """SBRSD posts 'PLEASE POST' notices into member-town AgendaCenters; those
    scrapes already collect them. Reattribute to the district, canonicalize the
    committee name, and drop cross-posted duplicates."""
    n = 0
    seen, rest = set(), []
    for m in meetings:
        text = f"{m.get('board') or ''} {m.get('title') or ''}"
        if not SBRSD_RE.search(text):
            rest.append(m)
            continue
        m["town"] = "SBRSD"
        m["board"] = sbrsd_committee(text)
        key = (m["board"], m["date"], m["start"])
        if key in seen:
            continue
        seen.add(key)
        rest.append(m)
        n += 1
    meetings[:] = rest
    return n


# ---------------- main ----------------

def meeting_key(m):
    return "|".join([m.get("town") or "", m.get("board") or "",
                     m.get("title") or "", m.get("date") or "",
                     m.get("start") or ""])


PDF_HINTS = ("AgendaCenter/ViewFile/", ".pdf", "/media/")


def extract_document_text(meetings_out):
    """Download agenda + minutes PDFs and extract searchable text.

    Writes data/agenda_text.json keyed by meeting_key(). Agenda and minutes
    text are combined per meeting. Failures are silent per-document; the
    archive simply won't have text for those.
    """
    try:
        import pdfplumber
    except ImportError:
        print("[doc-text] pdfplumber not installed, skipping", flush=True)
        return {}
    import io
    print(f"[doc-text] extracting text for {len(meetings_out)} meetings", flush=True)

    def fetch_text(url):
        r = requests.get(url, headers=UA, timeout=45)
        r.raise_for_status()
        if len(r.content) > 15_000_000:  # skip monster files
            return ""
        with pdfplumber.open(io.BytesIO(r.content)) as pdf:
            parts = []
            for p in pdf.pages[:12]:
                parts.append(p.extract_text() or "")
                if sum(len(x) for x in parts) > 8000:
                    break
        txt = "\n".join(parts)
        txt = re.sub(r"[ \t]+", " ", txt)
        return re.sub(r"\n{3,}", "\n\n", txt).strip()[:8000]

    combined = {}
    for m in meetings_out:
        key = meeting_key(m)
        if m.get("_doc_text"):
            # Pre-extracted text (e.g. BHRSD's Google Doc agenda export).
            combined[key] = m["_doc_text"][:16000]
            continue
        if not m.get("agenda_url") and not m.get("minutes_url"):
            continue
        for url, kind in ((m.get("agenda_url"), "agenda"), (m.get("minutes_url"), "minutes")):
            if not url or not any(h in url for h in PDF_HINTS):
                continue
            try:
                txt = fetch_text(url)
            except Exception as e:
                print(f"[doc-text] skip {url}: {type(e).__name__}", flush=True)
                continue
            if len(txt) < 120:
                continue
            prev = combined.get(key, "")
            tag = "\n\n--- MINUTES ---\n\n" if kind == "minutes" else ""
            combined[key] = (prev + tag + txt)[:16000] if prev else txt
    print(f"[doc-text] extracted {len(combined)} documents", flush=True)
    return combined


def change_summary(m):
    return {"town": m.get("town") or "", "board": m.get("board") or "",
            "title": m.get("title") or "", "date": m.get("date") or "",
            "start": m.get("start") or ""}


def detect_changes(old, new, checked_at):
    """Diff the previous meetings.json against this run's. Returns change
    dicts, newest first, capped at 80. Only upcoming meetings (date >= today)
    are compared so yesterday's meetings aging out don't count as removed."""
    today = checked_at[:10]
    old_m = {meeting_key(m): m for m in old if (m.get("date") or "") >= today}
    new_m = {meeting_key(m): m for m in new if (m.get("date") or "") >= today}
    changes = []
    for k, m in new_m.items():
        if k not in old_m:
            changes.append({"type": "added", "at": checked_at,
                            **change_summary(m)})
            continue
        o = old_m[k]
        fields = []
        if (o.get("start") or "") != (m.get("start") or ""):
            fields.append("time")
        if (o.get("location") or "") != (m.get("location") or ""):
            fields.append("location")
        if bool(o.get("agenda_url")) != bool(m.get("agenda_url")):
            fields.append("agenda")
        if bool(o.get("minutes_url")) != bool(m.get("minutes_url")):
            fields.append("minutes")
        if fields:
            changes.append({"type": "changed", "at": checked_at,
                            "fields": fields, **change_summary(m)})
    for k, m in old_m.items():
        if k not in new_m:
            changes.append({"type": "removed", "at": checked_at,
                            **change_summary(m)})
    # A rescheduled meeting looks like a removed+added pair (the key holds
    # the start time). Coalesce those into a single "time changed" entry.
    removed = [c for c in changes if c["type"] == "removed"]
    added = [c for c in changes if c["type"] == "added"]
    paired = set()
    merged = []
    for r in removed:
        sig = (r["town"], r["board"], r["title"], r["date"])
        match = next((a for a in added
                      if (a["town"], a["board"], a["title"], a["date"]) == sig
                      and id(a) not in paired), None)
        if match:
            paired.add(id(match))
            merged.append({"type": "changed", "at": checked_at,
                           "fields": ["time"],
                           **{k: match[k] for k in
                              ("town", "board", "title", "date", "start")}})
        else:
            merged.append(r)
    merged.extend(a for a in added if id(a) not in paired)
    merged.extend(c for c in changes
                  if c["type"] not in ("removed", "added"))
    return merged[:80]


def collect_meetings(previous, jobs, checked_at):
    """Retain last verified records when a source can't complete its refresh."""
    meetings.clear()
    old_by_town = {}
    for m in previous.get("meetings", []):
        if m["date"] >= (TODAY - timedelta(days=180)).isoformat():
            old_by_town.setdefault(m["town"], []).append(m)
    old_sources = previous.get("sources", {})
    sources = {}

    def last_success(town):
        old = old_sources.get(town, {})
        return old.get("last_success_at") or (old.get("checked_at") if old.get("ok") else None)

    def record_status(town, error=None, retained=0):
        sources[town] = {
            "ok": error is None,
            "checked_at": checked_at,
            "last_success_at": checked_at if error is None else last_success(town),
            "error": error,
            "retained": retained,
        }

    for town, scrape in jobs:
        start = len(meetings)
        error = None
        try:
            scrape()
        except Exception as e:  # one unavailable source should never stop the others
            error = f"{type(e).__name__}: {e}"[:240]
        fresh = meetings[start:]
        known = old_by_town.get(town, [])
        if not fresh and known and error is None:
            error = "Source returned zero records while previously published records are still in range"
        retained = 0
        if error:
            print(f"[{town}] INCOMPLETE: {error}", flush=True)
            prior = {meeting_key(m): m for m in known}
            merged = []
            for m in fresh:
                old = prior.pop(meeting_key(m), {})
                merged.append({**old, **{key: value for key, value in m.items()
                                         if value is not None or key not in old}})
            retained = len(prior)
            meetings[start:] = merged + list(prior.values())
        record_status(town, error, retained)
        print(f"[{town}] {len(fresh)} collected, {retained} retained", flush=True)

    attribute_sbrsd()
    # The district's listings arrive as reposts from a subset of the town feeds.
    district_sources = {"Egremont", "New Marlborough"}
    incomplete = sorted(town for town in district_sources if town in sources and not sources[town]["ok"])
    retained = 0
    if incomplete:
        district_keys = {(m["board"], m["date"], m["start"]) for m in meetings if m["town"] == "SBRSD"}
        for m in old_by_town.get("SBRSD", []):
            key = (m["board"], m["date"], m["start"])
            if key not in district_keys:
                district_keys.add(key)
                meetings.append(m)
                retained += 1
    record_status("SBRSD", "Incomplete member-town sources: " + ", ".join(incomplete) if incomplete else None, retained)
    sources["SBRSD"]["note"] = "District notices reposted by member towns"
    if "BHRSD" in sources:
        sources["BHRSD"]["note"] = "Berkshire Hills Regional School District"

    unique = {}
    for m in meetings:
        unique.setdefault(meeting_key(m), m)
    out = sorted(unique.values(), key=lambda m: (m["date"], m["start"] or "99:99", m["town"]))
    counts = {}
    for m in out:
        counts[m["town"]] = counts.get(m["town"], 0) + 1
    for town, status in sources.items():
        status["meetings"] = counts.get(town, 0)
    return out, counts, sources


def read_json(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def document_index(out, old_meetings, old_texts):
    texts = extract_document_text(out)
    old_by_key = {meeting_key(m): m for m in old_meetings}
    for m in out:
        key = meeting_key(m)
        if key in texts or key not in old_texts or key not in old_by_key:
            continue
        old = old_by_key[key]
        if all(old.get(field) == m.get(field) for field in ("agenda_url", "minutes_url")):
            texts[key] = old_texts[key]
    return texts


def main():
    jobs = [
        ("Sandisfield", scrape_sandisfield),
        ("Monterey", scrape_monterey),
        ("Great Barrington", scrape_great_barrington),
        ("Egremont", lambda: scrape_agenda_center("Egremont", "https://www.egremont-ma.gov")),
        ("New Marlborough", lambda: scrape_agenda_center("New Marlborough", "https://www.newmarlboroughma.gov")),
        ("Sheffield", scrape_sheffield),
        ("Alford", scrape_alford),
        ("Otis", scrape_otis),
        ("Tyringham", scrape_tyringham),
        ("Becket", scrape_becket),
        ("Richmond", scrape_richmond),
        ("BHRSD", scrape_bhrsd),
    ]
    root = Path(__file__).resolve().parent.parent / "data"
    root.mkdir(parents=True, exist_ok=True)
    target = root / "meetings.json"
    atext_target = root / "agenda_text.json"
    previous = read_json(target)
    old_meetings = previous.get("meetings", [])
    old_texts = read_json(atext_target).get("texts", {})
    checked_at = datetime.now(ET).isoformat(timespec="seconds")
    out, town_counts, sources = collect_meetings(previous, jobs, checked_at)
    texts = document_index(out, old_meetings, old_texts)
    for m in out:
        m.pop("_doc_text", None)

    payload = {
        "updated": checked_at,
        "meetings": out,
        "towns": town_counts,
        "sources": sources,
    }
    changes = detect_changes(old_meetings, out, checked_at)
    changes_target = root / "changes.json"
    changes_target.write_text(json.dumps({"updated": checked_at,
                                          "changes": changes}, indent=1))
    print(f"{len(changes)} changes -> {changes_target}", flush=True)

    target.write_text(json.dumps(payload, indent=1))
    print(f"TOTAL {len(out)} meetings -> {target}", flush=True)

    # Searchable agenda/minutes text lives in a separate lazy-loaded file so
    # the main JSON stays small.
    atext_target.write_text(json.dumps({"updated": checked_at, "texts": texts}))
    print(f"agenda text -> {atext_target}", flush=True)


if __name__ == "__main__":
    main()
