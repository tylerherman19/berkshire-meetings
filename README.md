# Berkshire Meetings

Every public meeting across the southern Berkshires, on one page —
Great Barrington (incl. Housatonic), Sheffield, Egremont, New Marlborough,
Monterey, Sandisfield, Stockbridge, West Stockbridge, Alford, Mount Washington,
Richmond, and the Southern Berkshire Regional School District.

**Live:** https://tylerherman19.github.io/berkshire-meetings/

## How it works

- `scraper/scrape.py` pulls each town's meeting calendar (iCal feeds where available,
  HTML parsing elsewhere) into `data/meetings.json`.
- `.github/workflows/update.yml` runs the scraper daily at 6:00 AM ET and commits
  fresh data. GitHub Pages rebuilds automatically.
- The site is static (`index.html` + `styles.css` + `app.js`) — no server needed.

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
