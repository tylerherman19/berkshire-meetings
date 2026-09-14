# Berkshire Meetings

Every public meeting across seven South County Berkshire towns, on one page —
Great Barrington, Egremont, Sheffield, New Marlborough, Monterey, Sandisfield, and Lee.

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
| Lee | `lee.ma.us/calendar/ical/export.ics` |
| Monterey | `montereyma.gov/calendar/ical/export.ics` |
| Great Barrington | `townofgbma.gov/calendar.aspx?CID=23` |
| Egremont | `egremont-ma.gov/AgendaCenter/Search/?term=&CIDs=all` |
| New Marlborough | `newmarlboroughma.gov/AgendaCenter/Search/?term=&CIDs=all` |
| Sheffield | `sheffieldma.gov/minutes-and-agendas` (per-board agenda pages) |
