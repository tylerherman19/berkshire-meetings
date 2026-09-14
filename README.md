# Berkshire Meetings

Every public meeting across the southern Berkshires, on one page —
Great Barrington (incl. Housatonic), Sheffield, Egremont, New Marlborough,
Monterey, Sandisfield, Stockbridge, West Stockbridge, Alford, Mount Washington,
Richmond, and the Southern Berkshire Regional School District.

**Live:** https://tylerherman19.github.io/berkshire-meetings/

## The site

Three ways into the same data, all in one static page:

- **Briefing** — the homepage. What's on this week, what changed since yesterday,
  and the towns and boards you follow.
- **Calendar** — filter and scan everything at once: town, board, date range,
  in-person vs. remote, sort order, saved searches. Built for reporters and
  anyone tracking one board closely.
- **Towns** — a dashboard per town: next meeting, this week's count, recent
  changes, every board, and recent minutes.

- **News** — one feed of everything the towns themselves are announcing, newest
  first: road closures, special meeting notices, public notices, transfer station
  hours. Tap any card's town pill to narrow the feed to that town and tap it
  again to come back, or use the town and category pills at the top. Search runs
  across headlines and summaries, and anything posted since your last visit is
  marked. Every card carries a **Read full post** button to the original town
  posting, and the tab lists its own sources.

Plus **Archive** (full-text search across posted agendas and minutes) and
**Sources** (which scrapers succeeded in the last run).

## Starring meetings and syncing them to a calendar

Star any meeting with the ☆ button. Stars are kept in `localStorage` — they never
leave the browser, and there is no account and no server to sign in to. Clearing
site data clears them.

From **Starred** you can take just those meetings to your own calendar:

- **Download .ics** — every starred meeting in one file, with a `VTIMEZONE` for
  `America/New_York` so times land correctly. In Google Calendar: Settings →
  Import & export → Import. In Apple Calendar, Outlook or Fantastical: open the
  file. Each event carries a stable UID, so re-importing after starring more
  meetings updates the existing entries rather than duplicating them.
- **Add to Google** — a single meeting, via a prefilled Google Calendar event.

It's a one-time export, not a live subscription feed; a subscription would need a
server to host a per-person feed, and this site is deliberately static.

## How it works

- `scraper/scrape.py` pulls each town's meeting calendar (iCal feeds where available,
  HTML parsing elsewhere) into `data/meetings.json`, and diffs against the previous
  run into `data/changes.json`.
- `.github/workflows/update.yml` runs the scraper daily at 6:00 AM ET and commits
  fresh data. GitHub Pages rebuilds automatically.
- `scraper/news.py` pulls each town's news/announcements page into `data/news.json`,
  keyed by source URL so re-runs never duplicate anything, keeping 90 days of
  history even after a town drops a post off its own page.
- `.github/workflows/news.yml` runs that one hourly from 6:00 AM to midnight ET.
  Cron is UTC and DST-blind, so the schedule covers both offsets and the scraper
  checks the Eastern clock itself, exiting without writing outside the window.
- The site is static (`index.html` + `styles.css` + `app.js` + `assets/`) — no
  build step, no dependencies, no server.

## Sources

| Town | Source |
|---|---|
| Sandisfield | `sandisfieldma.gov/calendar/ical/export.ics` |
| Monterey | `montereyma.gov/calendar/ical/export.ics` |
| Great Barrington | `townofgbma.gov/calendar.aspx?CID=23` |
| Egremont | `egremont-ma.gov/AgendaCenter/Search/?term=&CIDs=all` |
| New Marlborough | `newmarlboroughma.gov/AgendaCenter/Search/?term=&CIDs=all` |
| Sheffield | `sheffieldma.gov/minutes-and-agendas` (per-board agenda pages) |
| Stockbridge | `stockbridge-ma.gov/meetings` (static table) |
| West Stockbridge | `weststockbridge-ma.gov/AgendaCenter/` |
| Alford | `townofalford.org/calendar.aspx` (CivicEngage) |
| Mount Washington | `mountwashington-ma.gov/?mec-ical-feed=1` (iCal) |
| SBRSD | reattributed from member-town AgendaCenter "PLEASE POST" notices |
| Richmond | _no reliable central listing found yet — in progress_ |

Pittsfield is covered editorially when a story crosses over (no automated scrape).

### News sources

None of these towns publish a working RSS feed, so the news feed is HTML parsing
against three CMS families. The News tab lists these in the page itself, with a
live status dot per source.

| Town | News source |
|---|---|
| Great Barrington | `townofgbma.gov/m/newsflash?cat=1` |
| Sheffield | `sheffieldma.gov/news` |
| Egremont | `egremont-ma.gov/m/newsflash` (all published categories) |
| New Marlborough | `newmarlboroughma.gov/m/newsflash?cat=1` |
| Monterey | `montereyma.gov/node/1/news` |
| Sandisfield | `sandisfieldma.gov/node/1/news` |
| Otis | `townofotisma.com/newslist.php` |
| Tyringham | `tyringham-ma.gov/m/newsflash?cat=1,7,17,19` |
| Becket | `townofbecket.org/node/1/news` |
| Alford | `townofalford.org/m/newsflash` (all published categories) |
| BHRSD | `bhrsd.org` homepage feed (ParentSquare-driven, limited) |

## Photographs

- Hero: [Mount Everett and Mount Race, viewed from Bear Mountain](https://commons.wikimedia.org/wiki/File:Mount_Everett,_MA,_and_Mount_Race,_MA,_viewed_from_Bear_Mountain,_CT.jpg)
  by Zeete, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Town pages: [Main Street morning in Great Barrington, Massachusetts](https://commons.wikimedia.org/wiki/File:Main_Street_morning_in_Great_Barrington,_Massachusetts.jpg)
  by Kenneth C. Zirkel, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Both are credited in the site footer, as the licence requires.
