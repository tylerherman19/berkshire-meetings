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

## Photographs

- Hero: [Mount Everett and Mount Race, viewed from Bear Mountain](https://commons.wikimedia.org/wiki/File:Mount_Everett,_MA,_and_Mount_Race,_MA,_viewed_from_Bear_Mountain,_CT.jpg)
  by Zeete, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Town pages: [Main Street morning in Great Barrington, Massachusetts](https://commons.wikimedia.org/wiki/File:Main_Street_morning_in_Great_Barrington,_Massachusetts.jpg)
  by Kenneth C. Zirkel, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

Both are credited in the site footer, as the licence requires.
