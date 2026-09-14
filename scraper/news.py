#!/usr/bin/env python3
"""Scrape South County town news / announcement pages into data/news.json.

None of these towns publish a working RSS feed, so everything here is HTML
parsing against three CMS families:

  - CivicPlus News Flash  : Great Barrington, Egremont, New Marlborough,
                            Tyringham, Alford  (server-rendered /m/newsflash)
  - Drupal news listings  : Sheffield, Monterey, Sandisfield, Becket
  - One-off               : Otis (Revize; news list is an embedded JSON blob),
                            BHRSD (ParentSquare feed rendered into the homepage)

Runs hourly from GitHub Actions. Failures are per-source and never abort the
run: a town whose site is down simply keeps the items already on file until
they age out.

Items are keyed by their source URL, so re-running never duplicates anything;
90 days of history is kept even after a town drops a post off its own page.
"""
import json
import re
import sys
import time
from datetime import date, datetime, timedelta
from html import unescape
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

ET = ZoneInfo("America/New_York")
NOW = datetime.now(ET)
TODAY = NOW.date()
RETENTION_DAYS = 90

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
MONTHS_RE = "|".join(MONTHS_FULL)

SUMMARY_MAX = 320

items = []          # this run's scrape
stats = {}          # source name -> count
errors = {}         # source name -> error string


# --------------------------------------------------------------- fetching

# Four of these towns sit behind Cloudflare, which serves a JS challenge to
# anything whose TLS fingerprint it doesn't like. Which fingerprint passes
# varies by town and changes over time, so try a few rather than one: as of
# this writing Chrome is refused everywhere the challenge is on, Safari 17
# clears Monterey, Sandisfield and Becket, and Sheffield wants Safari 15.
IMPERSONATE = ["chrome", "safari17_0", "safari15_5"]


def get(url, timeout=40):
    """GET, falling back to browser-TLS impersonation when a host refuses us."""
    try:
        r = requests.get(url, headers=UA, timeout=timeout)
        r.raise_for_status()
        return r
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else None
        if code not in (403, 429):
            raise
        try:
            from curl_cffi import requests as tls_requests
        except ImportError:
            print("[retry-tls] curl_cffi not installed", flush=True)
            raise
        for i, profile in enumerate(IMPERSONATE):
            print(f"[retry-tls] {code} for {url}; trying {profile}", flush=True)
            try:
                r2 = tls_requests.get(url, headers=UA, timeout=timeout,
                                      impersonate=profile)
            except Exception as err:
                print(f"[retry-tls] {profile} errored: {err}", flush=True)
                continue
            if r2.status_code < 400:
                print(f"[retry-tls] {profile} got through to {url}", flush=True)
                return r2
            print(f"[retry-tls] {profile} still {r2.status_code}", flush=True)
            time.sleep(2 * (i + 1))
        raise


def soup_of(url, timeout=40):
    return BeautifulSoup(get(url, timeout=timeout).text, "html.parser")


# ---------------------------------------------------------------- parsing

def squash(s):
    return re.sub(r"\s+", " ", unescape(str(s or ""))).strip()


def trim(s, n=SUMMARY_MAX):
    """Trim to a whole word, Twitter-card length."""
    s = squash(s)
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(" ", 1)[0].rstrip(" ,;:.—-")
    return cut + "…"


DATE_PATTERNS = [
    # September 09, 2026  /  Sep 9, 2026
    (re.compile(rf"\b({MONTHS_RE}|{'|'.join(m[:3] for m in MONTHS_FULL)})\.?\s+"
                r"(\d{1,2}),?\s+(\d{4})", re.I), "mdy"),
    # 2026-09-09
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), "ymd"),
    # 09/14/2026
    (re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b"), "slash"),
]


def date_from_text(s):
    """First plausible date in a blob of text, or None."""
    if not s:
        return None
    for rx, kind in DATE_PATTERNS:
        m = rx.search(s)
        if not m:
            continue
        try:
            if kind == "mdy":
                mon = (MON.get(m.group(1).capitalize())
                       or ABBR.get(m.group(1)[:3].lower()))
                if not mon:
                    continue
                return date(int(m.group(3)), mon, int(m.group(2)))
            if kind == "ymd":
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            y = int(m.group(3))
            y += 2000 if y < 100 else 0
            return date(y, int(m.group(1)), int(m.group(2)))
        except (ValueError, KeyError):
            continue
    return None


def iso_posted(d, dt=None):
    """Normalise a date (or datetime) into an ET-offset ISO string."""
    if dt is not None:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ET)
        return dt.astimezone(ET).isoformat(timespec="seconds")
    if d is None:
        return None
    return datetime(d.year, d.month, d.day, tzinfo=ET).isoformat(timespec="seconds")


def datetime_attr(node):
    """Pull a precise timestamp out of <time datetime="..."> when present."""
    t = node.find("time") if hasattr(node, "find") else None
    raw = (t.get("datetime") if t and t.has_attr("datetime") else None)
    if not raw:
        return None
    raw = raw.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


# ------------------------------------------------------------ categorising

# Buckets are tested in order, so a "Main Street paving public hearing" lands
# under road closures rather than meeting notices.
#
# Each bucket gets two patterns. STRICT runs over headline + summary + the
# town's own category, and has to be specific enough not to bucket a newsletter
# by a passing mention. BROAD runs over the headline alone, where a bare word
# like "meeting" really does mean the post is about one.
CATEGORY_RULES = [
    ("Road closures",
     re.compile(
         r"\broad(way)?s?\b.*\b(clos|work|repair|project)|"
         r"\b(road|street|lane|bridge|culvert)\s+(clos|work|repair)|"
         r"\bclosed?\s+to\s+(traffic|through)|"
         r"\b(detour|paving|repaving|chip\s*seal|road\s*work|roadwork)\b|"
         r"\btraffic\s+(advisor|alert|delay|impact)|"
         r"\b(bridge|culvert)\s+(replac|project|clos)|"
         r"\btemporar(y|ily)\s+clos", re.I),
     re.compile(
         r"\b(road|street|lane|bridge|culvert|highway)\b.*\bclos|"
         r"\bclos\w*\b.*\b(road|street|lane|bridge|culvert|highway)\b|"
         r"\bdetour\b|\bpaving\b", re.I)),

    ("Meeting notices",
     re.compile(
         r"\b(special|annual)\s+town\s+meeting\b|"
         r"\bpublic\s+(hearing|information\s+session|forum)\b|"
         r"\bmeeting\s+(notice|cancel|postpon|resched)|"
         r"\bnotice\s+of\s+(a\s+)?(public\s+)?(meeting|hearing)\b|"
         r"\b(select\s*board|selectmen|planning\s*board|board\s+of\s+health|"
         r"finance\s+committee|zoning\s+board|conservation\s+commission|"
         r"school\s+committee)\b.*\b(meet|agenda|hearing)|"
         r"\bagenda\s+posted\b|\bwill\s+meet\b|\blistening\s+session\b", re.I),
     re.compile(r"\bmeeting\b|\bhearing\b|\bforum\b|"
                r"\b(information|listening)\s+session\b", re.I)),

    ("Public notices",
     re.compile(
         r"\b(legal\s+)?notice\b|"
         r"\b(request\s+for\s+proposals?|rfp|invitation\s+to\s+bid|bid\s+opening)\b|"
         r"\b(warrant|ballot|election|polling|voter|absentee|early\s+voting)\b|"
         r"\b(transfer\s+station|landfill|recycling\s+center)\b|"
         r"\b(assessor|assessing|abatement|tax\s+bill|excise|"
         r"preliminary\s+values?|valuation)\b|"
         r"\b(burn\s+permit|water\s+ban|boil\s+water|hydrant\s+flush)\b|"
         r"\b(bylaw|by-law|ordinance|zoning\s+amendment)\b|"
         r"\b(vacanc|hiring|job\s+(opening|posting)|employment\s+opportunit|"
         r"position\s+(is\s+)?(available|open)|now\s+accepting\s+application|"
         r"applications?\s+(are\s+)?(now\s+)?(being\s+)?accept)", re.I),
     re.compile(r"\bnotice\b|\bvacanc|\bhiring\b|\bwanted\b|"
                r"\bemployment\s+opportunit|\brecruit", re.I)),
]
CATEGORIES = ["Road closures", "Meeting notices", "Public notices", "General"]


def categorise(headline, summary, topic=None):
    """Bucket an item into one of the four filterable categories.

    `topic` is the town's own label for the post (the CivicPlus towns publish
    one); it's read alongside the text, which is enough to pull e.g. Alford's
    "Select Board" posts into Meeting notices.
    """
    headline = headline or ""
    full = " ".join(x for x in (headline, summary, topic) if x)
    for name, strict, broad in CATEGORY_RULES:
        if broad.search(headline) or strict.search(full):
            return name
    return "General"


# ------------------------------------------------------------- collection

def add(town, headline, url, posted=None, summary=None, topic=None,
        date_only=True):
    headline = squash(headline)
    if not headline or len(headline) < 3 or not url:
        return False
    summary = trim(summary) or None
    # Towns routinely repeat the headline as the first line of the body; a card
    # showing the same sentence twice reads like a bug.
    if summary and summary.lower().startswith(headline.lower()):
        summary = summary[len(headline):].lstrip(" :–—-").strip()

    topic = squash(topic)
    # Several towns file everything under one catch-all category named after
    # the town ("Town of Great Barrington News"). The card already carries a
    # town pill, so that tag would just be the same word twice.
    if topic and re.sub(r"(?i)\b(town|of|news|notices?|announcements?|"
                        r"updates?|home|general|and)\b", "", topic).strip(" -–—&,") == "":
        topic = None
    if topic and town.lower() in topic.lower():
        topic = None

    items.append({
        "town": town,
        "category": categorise(headline, summary, topic),
        "topic": topic or None,
        "headline": headline,
        "summary": summary or None,
        "posted": posted,
        "date_only": bool(date_only),
        "url": url,
    })
    return True


# ============================================================== CivicPlus

def scrape_civicplus(town, url):
    """CivicPlus News Flash (/m/newsflash — server-rendered, htmx-driven).

    Each post is a .border-article block: an .article-title-link headline, an
    .article-preview body, and a footer carrying the town's own category badge
    and a "Posted on <date>" line. The page also runs the three newest posts
    through a carousel at the top; those repeat the same Detail URLs and fall
    out in the URL dedupe.

    The `cat=` query string is each town's own list of published categories —
    without it CivicPlus returns only the default category, which for most of
    these towns is a fraction of what they actually post.
    """
    soup = soup_of(url)
    n = 0
    seen = set()
    for a in soup.select("a.article-title-link"):
        href = a.get("href")
        if not href:
            continue
        link = urljoin(url, href)
        if link in seen:
            continue
        seen.add(link)

        block = a
        for _ in range(6):
            block = block.parent
            if block is None:
                break
            classes = block.get("class") or []
            if "border-article" in classes or "carousel-item" in classes:
                break
        if block is None:
            continue

        prev = block.select_one(".article-preview")
        summary = prev.get_text(" ", strip=True) if prev else None

        topic, posted, date_only = None, None, True
        footer = block.select_one(".article-list-footer, .newsflash-carousel-footer")
        if footer:
            badge = footer.select_one(".badge")
            if badge:
                topic = badge.get_text(" ", strip=True)
            stamp = footer.select_one(".fst-italic")
            text = stamp.get_text(" ", strip=True) if stamp else footer.get_text(" ", strip=True)
            d = date_from_text(text)
            if d:
                posted = iso_posted(d)
        if add(town, civicplus_title(a), link, posted=posted,
               summary=summary, topic=topic, date_only=date_only):
            n += 1
    return n


CIVICPLUS_TITLE_CAP = 100


def civicplus_title(a):
    """CivicPlus stores News Flash titles capped at 100 characters, and the
    detail page is cut at the same point — there is no fuller version to go
    and fetch. When a town has written past the cap the headline ends mid-word,
    so say it's truncated rather than let it read like a parsing bug."""
    title = squash(a.get_text(" ", strip=True))
    if len(title) == CIVICPLUS_TITLE_CAP and re.search(r"[A-Za-z0-9]$", title):
        title = title.rstrip() + "…"
    return title


# ================================================================= Drupal

# Nav chrome and utility links that show up inside Drupal listing markup.
DRUPAL_SKIP = re.compile(
    r"^(read more|more|continue reading|home|search|login|log in|contact|"
    r"subscribe|next|previous|back|view all|all news|share)$", re.I)

DRUPAL_ROW_SELECTORS = [
    "div.view-content div.views-row",
    "div.view-content li.views-row",
    "div.view-content article",
    "div.view-content div.node",
    "ul.views-row-list li",
    "div.region-content article.node",
    "main article",
]


def _drupal_rows(soup):
    """Return the repeated listing blocks, whichever Drupal theme this is."""
    for sel in DRUPAL_ROW_SELECTORS:
        rows = soup.select(sel)
        if len(rows) >= 2:
            return rows
    # Last resort: group node links by their nearest repeated block ancestor.
    rows, seen = [], set()
    for a in soup.select('a[href*="/node/"], a[href*="/news/"]'):
        block = a
        for _ in range(4):
            block = block.parent
            if block is None or block.name in ("body", "html"):
                block = None
                break
            if block.name in ("li", "article", "div") and len(block.get_text(strip=True)) > 60:
                break
        if block is None or id(block) in seen:
            continue
        seen.add(id(block))
        rows.append(block)
    return rows


def _drupal_title_link(row, page_url):
    """The row's headline link: prefer a heading, else the first real link."""
    for sel in ["h2 a[href]", "h3 a[href]", "h4 a[href]",
                ".views-field-title a[href]", ".node-title a[href]",
                ".field-content a[href]"]:
        a = row.select_one(sel)
        if a and not DRUPAL_SKIP.match(a.get_text(" ", strip=True)):
            return a, urljoin(page_url, a["href"])
    for a in row.find_all("a", href=True):
        text = a.get_text(" ", strip=True)
        if len(text) < 6 or DRUPAL_SKIP.match(text):
            continue
        if a["href"].startswith(("mailto:", "tel:", "#", "javascript:")):
            continue
        return a, urljoin(page_url, a["href"])
    return None, None


# A row cell holding nothing but a posting date — Drupal 7 renders these in the
# same .field-content wrapper as the body, so they have to be told apart.
STAMP_ONLY = re.compile(
    rf"^\s*(\w+day,?\s+)?({MONTHS_RE}|{'|'.join(m[:3] for m in MONTHS_FULL)})\.?\s+"
    r"\d{1,2},?\s+\d{4}\s*[-–—]?\s*(\d{1,2}:\d{2}\s*(am|pm)?)?\s*$", re.I)
# Drupal teaser furniture: "Read more", "… more ››", a bare chevron.
TEASER_TAIL = re.compile(r"(\.{3}|…)?\s*(read\s+)?more\s*[»›]{0,2}\s*$", re.I)


def _drupal_summary(row, headline):
    """The row's body text, avoiding the date cell and teaser furniture."""
    for sel in (".views-field-body", ".field-name-body",
                ".field-type-text-with-summary", ".node-content",
                ".views-field-field-summary"):
        el = row.select_one(sel)
        if el:
            text = squash(el.get_text(" ", strip=True))
            if text and text != headline and not STAMP_ONLY.match(text):
                return _clean_teaser(text, headline)

    # No named body field: take the longest candidate that isn't the headline,
    # a bare date, or teaser furniture.
    best = ""
    for el in row.select("p, .field-content, .teaser, .node-teaser"):
        text = squash(el.get_text(" ", strip=True))
        if not text or text == headline or STAMP_ONLY.match(text):
            continue
        if len(text) > len(best):
            best = text
    if not best:
        best = squash(row.get_text(" ", strip=True)).replace(headline, " ", 1)
    return _clean_teaser(best, headline)


def _clean_teaser(text, headline):
    # Squash the headline too: get_text(" ") can leave double spaces in it that
    # the row's own squashed text doesn't have, and the replace would miss.
    text = squash(text).replace(squash(headline), " ", 1)
    text = TEASER_TAIL.sub("", squash(text)).strip(" .·–—-")
    # What's left of a link-only teaser ("Click here to… more ››") says nothing;
    # a card carried by its headline alone reads better than a stub.
    if len(text) < 30 or STAMP_ONLY.match(text):
        return None
    return text


def scrape_drupal_news(town, urls):
    """Generic Drupal news listing.

    These four towns run four different Drupal themes, so rather than pin one
    set of class names this walks whatever repeated block the page uses and
    reads a headline link, a date and a body out of it. Extra URLs after the
    first are fallbacks, tried only if the canonical one yields nothing.
    """
    last_error = None
    for page_url in urls:
        try:
            soup = soup_of(page_url)
        except requests.HTTPError as e:
            last_error = e
            code = e.response.status_code if e.response is not None else None
            print(f"[{town}] {page_url}: HTTP {code}", flush=True)
            if code in (403, 429):
                # The whole host is refusing us; the fallback paths live on the
                # same host, so trying them is three more minutes of 403s.
                break
            continue
        except Exception as e:
            last_error = e
            print(f"[{town}] {page_url}: {type(e).__name__}: {e}", flush=True)
            continue

        rows = _drupal_rows(soup)
        print(f"[{town}] {page_url}: {len(rows)} candidate rows", flush=True)
        n, seen = 0, set()
        for row in rows:
            a, link = _drupal_title_link(row, page_url)
            if not a or link in seen:
                continue
            headline = a.get_text(" ", strip=True)
            if len(headline) < 6:
                continue
            seen.add(link)

            dt = datetime_attr(row)
            d = None
            if dt is None:
                stamp = row.select_one(
                    ".date-display-single, .submitted, .views-field-created, "
                    ".views-field-field-date, .node-date, .date, time")
                d = date_from_text(stamp.get_text(" ", strip=True)) if stamp else None
                if d is None:
                    d = date_from_text(row.get_text(" ", strip=True))
            posted = iso_posted(d, dt)

            summary = _drupal_summary(row, headline)

            if add(town, headline, link, posted=posted, summary=summary,
                   date_only=dt is None):
                n += 1
        if n:
            return n
    if last_error:
        raise last_error
    return 0


# =================================================================== Otis

OTIS_BASE = "https://townofotisma.com"
OTIS_LIST = OTIS_BASE + "/newslist.php"


def scrape_otis():
    """Revize CMS. The list page paginates client-side from a JSON blob
    embedded in the page script, so read that rather than the rendered DOM
    (which only ever holds one page of results)."""
    town = "Otis"
    html = get(OTIS_LIST).text
    m = re.search(r"dataSource:\s*(\[.*?\}\s*\])", html, re.S)
    if not m:
        print(f"[{town}] no dataSource blob on {OTIS_LIST}", flush=True)
        return 0
    try:
        rows = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        print(f"[{town}] dataSource parse failed: {e}", flush=True)
        return 0

    n = 0
    for row in rows:
        if not isinstance(row, dict) or row.get("module") != "news":
            continue
        link = row.get("link")
        title = squash(row.get("title"))
        if not link or not title:
            continue
        url = urljoin(OTIS_BASE + "/", link)
        d = date_from_text(row.get("date"))
        if d and d < TODAY - timedelta(days=RETENTION_DAYS):
            continue
        # The list blob carries no body text; the detail page is small.
        summary = None
        try:
            dsoup = soup_of(url, timeout=25)
            main = (dsoup.find(id="main") or dsoup.find("main")
                    or dsoup.find(id="content"))
            if main:
                summary = main.get_text(" ", strip=True)
        except Exception as e:
            print(f"[{town}] detail fetch failed ({url}): {e}", flush=True)
        if add(town, title, url, posted=iso_posted(d), summary=summary):
            n += 1
    return n


# ================================================================== BHRSD

BHRSD_BASE = "https://www.bhrsd.org"


def scrape_bhrsd():
    """Berkshire Hills RSD. District news is a ParentSquare feed rendered
    into the homepage; there is no standalone news index that returns items."""
    town = "BHRSD"
    soup = soup_of(BHRSD_BASE + "/")
    n, seen = 0, set()
    for art in soup.select("article.article-container"):
        a = art.select_one('a[href*="articleID"]') or art.find("a", href=True)
        if not a:
            continue
        url = urljoin(BHRSD_BASE + "/", a["href"])
        if url in seen:
            continue
        seen.add(url)
        title_el = art.select_one(".stack-news-grid-title") or art.find(["h2", "h3"])
        headline = title_el.get_text(" ", strip=True) if title_el else ""
        date_el = art.select_one(".stack-news-grid-date")
        d = date_from_text(date_el.get_text(" ", strip=True)) if date_el else None
        desc = art.select_one(".news-article-description")
        summary = desc.get_text(" ", strip=True) if desc else None
        if add(town, headline, url, posted=iso_posted(d), summary=summary):
            n += 1
    return n


# ================================================================ sources

# Egremont and Alford publish across many News Flash categories; the `cat=`
# lists below are theirs, taken from each town's own category picker.
EGREMONT_CATS = ("40,27,44,23,25,42,45,34,35,18,29,24,26,43,41,20,39,32,21,1,"
                 "36,17,9,37,28,16,30,19,22,33,31,38,6,46")
ALFORD_CATS = "1,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20"

SOURCES = [
    {"town": "Great Barrington", "name": "Great Barrington News Flash",
     "url": "https://www.townofgbma.gov/m/newsflash?cat=1",
     "kind": "civicplus"},

    {"town": "Sheffield", "name": "Sheffield Town News",
     "url": "https://www.sheffieldma.gov/news",
     "kind": "drupal"},

    {"town": "Egremont", "name": "Egremont News Flash",
     "url": "https://www.egremont-ma.gov/m/newsflash?cat=" + EGREMONT_CATS,
     "kind": "civicplus"},

    {"town": "New Marlborough", "name": "New Marlborough News & Notices",
     "url": "https://www.newmarlboroughma.gov/m/newsflash?cat=1",
     "kind": "civicplus"},

    {"town": "Monterey", "name": "Monterey Town News",
     "url": "https://www.montereyma.gov/node/1/news",
     "kind": "drupal"},

    {"town": "Sandisfield", "name": "Sandisfield Town News",
     "url": "https://www.sandisfieldma.gov/node/1/news",
     "kind": "drupal"},

    {"town": "Otis", "name": "Otis Town News",
     "url": OTIS_LIST,
     "run": scrape_otis},

    {"town": "Tyringham", "name": "Tyringham News Flash",
     "url": "https://www.tyringham-ma.gov/m/newsflash?cat=1,7,17,19",
     "kind": "civicplus"},

    {"town": "Becket", "name": "Becket News & Announcements",
     "url": "https://www.townofbecket.org/node/1/news",
     "kind": "drupal"},

    {"town": "Alford", "name": "Alford News Flash",
     "url": "https://www.townofalford.org/m/newsflash?cat=" + ALFORD_CATS,
     "kind": "civicplus"},

    {"town": "BHRSD", "name": "Berkshire Hills RSD News",
     "url": BHRSD_BASE + "/",
     "run": scrape_bhrsd},
]

# Fallback listing paths, tried only when a town's canonical URL yields nothing
# (these sites have moved their news index at least once before).
DRUPAL_FALLBACKS = ["/news", "/home/news", "/news-announcements"]


def runner(src):
    """Resolve a source entry to the callable that scrapes it."""
    if "run" in src:
        return src["run"]
    if src["kind"] == "civicplus":
        return lambda: scrape_civicplus(src["town"], src["url"])
    base = re.match(r"https?://[^/]+", src["url"]).group(0)
    urls = [src["url"]] + [base + p for p in DRUPAL_FALLBACKS
                           if base + p != src["url"]]
    return lambda: scrape_drupal_news(src["town"], urls)


# =================================================================== merge

def merge(previous, fresh, checked_at):
    """Fold this run's scrape into the items already on file.

    Keyed by source URL, so an item a town has been showing for six weeks is
    written once and never again. `first_seen` is preserved across runs — the
    site uses it for its "new since your last visit" marker, and it would be
    meaningless if every run reset it.
    """
    by_url = {}
    for it in previous:
        if it.get("url"):
            by_url[it["url"]] = dict(it)

    for it in fresh:
        url = it["url"]
        old = by_url.get(url)
        if old is None:
            by_url[url] = dict(it, first_seen=checked_at, posted=it.get("posted") or checked_at)
            continue
        # Towns quietly edit posts in place; take the latest text but keep the
        # dates that give the item its identity in the feed.
        old.update({k: it[k] for k in
                    ("town", "category", "topic", "headline", "summary")})
        if it.get("posted") and not old.get("posted"):
            old["posted"] = it["posted"]
            old["date_only"] = it.get("date_only", True)
        by_url[url] = old

    cutoff = (NOW - timedelta(days=RETENTION_DAYS)).isoformat(timespec="seconds")
    out = []
    for it in by_url.values():
        stamp = it.get("posted") or it.get("first_seen") or checked_at
        if stamp < cutoff:
            continue
        it.setdefault("first_seen", checked_at)
        it.setdefault("posted", it["first_seen"])
        out.append(it)

    out.sort(key=lambda x: (x.get("posted") or "", x.get("first_seen") or ""),
             reverse=True)
    return out


def within_hours(now):
    """The workflow's cron covers both UTC offsets so the schedule survives
    daylight saving; this is what actually holds it to 6am–midnight Eastern."""
    return 6 <= now.hour <= 23


def main():
    if "--force" not in sys.argv and not within_hours(NOW):
        print(f"{NOW:%H:%M} ET is outside the 6:00 AM – midnight window; skipping.",
              flush=True)
        return 0

    for src in SOURCES:
        name = src["town"]
        before = len(items)
        try:
            runner(src)()
        except Exception as e:      # never let one town kill the run
            print(f"[{name}] ERROR: {type(e).__name__}: {e}", flush=True)
            errors[name] = f"{type(e).__name__}: {e}"[:200]
        stats[name] = len(items) - before
        print(f"[{name}] {stats[name]} items", flush=True)

    checked_at = NOW.isoformat(timespec="seconds")
    root = Path(__file__).resolve().parent.parent
    target = root / "data" / "news.json"
    target.parent.mkdir(parents=True, exist_ok=True)

    previous = []
    if target.exists():
        try:
            previous = json.loads(target.read_text()).get("items") or []
        except Exception as e:
            print(f"could not read previous news.json: {e}", flush=True)

    merged = merge(previous, items, checked_at)

    town_counts = {}
    for it in merged:
        town_counts[it["town"]] = town_counts.get(it["town"], 0) + 1

    sources = []
    for src in SOURCES:
        name = src["town"]
        sources.append({
            "town": name,
            "name": src["name"],
            "url": src["url"],
            "ok": name not in errors and stats.get(name, 0) > 0,
            "scraped": stats.get(name, 0),
            "items": town_counts.get(name, 0),
            "checked_at": checked_at,
            "error": errors.get(name),
        })

    payload = {
        "updated": checked_at,
        "retention_days": RETENTION_DAYS,
        "categories": CATEGORIES,
        "items": merged,
        "towns": town_counts,
        "sources": sources,
    }
    target.write_text(json.dumps(payload, indent=1))

    live = sum(1 for s in sources if s["ok"])
    print(f"TOTAL {len(items)} scraped, {len(merged)} on file "
          f"from {live}/{len(SOURCES)} sources -> {target}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
