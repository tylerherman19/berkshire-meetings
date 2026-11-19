"""Scanned (text-less) weekly logs must stay visible as missing and be retried.

Background: the department posted 10.25.26-10.31.26.pdf as a 17-page scan
with no text layer. The run that fetched it noted it as unreadable, but the
next run marked the week as done and dropped the note, so the Blotter tab
showed Oct 25-31 as a week with no calls at all.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scraper"))
import police  # noqa: E402

READABLE = {"file": "11.1.26-11.7.26.pdf", "url": "https://x.invalid/a.pdf",
            "from": "2026-11-01", "to": "2026-11-07"}
SCANNED = {"file": "10.25.26-10.31.26.pdf", "url": "https://x.invalid/b.pdf",
           "from": "2026-10-25", "to": "2026-10-31"}
ROW = {"id": "26-15000", "d": "2026-11-02", "t": "1015", "r": "PATROL CHECK",
       "a": "Services Rendered", "loc": "MAIN ST", "sector": "GRE",
       "unresolved": False}


def run_main(existing, parsed_rows):
    """Run police.main() against a temp data file. ``parsed_rows`` maps a
    week filename to the rows parse_pdf returns for it."""
    fetched = []
    with tempfile.TemporaryDirectory() as tmp:
        data = Path(tmp) / "police.json"
        data.write_text(json.dumps(existing))

        def fake_get(url, **kw):
            fetched.append(url)
            return mock.Mock(content=url.encode(), raise_for_status=lambda: None)

        def fake_parse(path, stats=None):
            name = Path(path).read_bytes().decode()
            week = READABLE if name == READABLE["url"] else SCANNED
            rows = [dict(r) for r in parsed_rows.get(week["file"], [])]
            if stats is not None:
                n = len(rows)
                stats.update({"headers": n, "id_tokens": n, "sources": n,
                              "locations": n, "orphans": 0, "suspects": 0,
                              "unresolved": 0, "no_location": 0})
            return rows

        with mock.patch.object(police, "DATA_FILE", data), \
             mock.patch.object(police, "index_pdfs",
                               return_value=[dict(READABLE), dict(SCANNED)]), \
             mock.patch.object(police.requests, "get", side_effect=fake_get), \
             mock.patch.object(police, "parse_pdf", side_effect=fake_parse), \
             mock.patch.object(police, "geocode", return_value=[42.19, -73.36]), \
             mock.patch("builtins.print"):
            police.main()
        return json.loads(data.read_text()), fetched


class ScannedWeekTests(unittest.TestCase):
    def test_scanned_week_is_noted_and_note_survives_next_run(self):
        first, _ = run_main({"weeks": [], "geo": {}, "incidents": []},
                            {READABLE["file"]: [ROW]})
        notes = {w["file"]: w.get("note") for w in first["weeks"]}
        self.assertIsNone(notes[READABLE["file"]])
        self.assertTrue(notes[SCANNED["file"]])

        second, fetched = run_main(first, {READABLE["file"]: [ROW]})
        notes = {w["file"]: w.get("note") for w in second["weeks"]}
        self.assertTrue(notes[SCANNED["file"]], "note was dropped on rerun")
        # The readable week is not downloaded again; the scanned one is.
        self.assertEqual(fetched, [SCANNED["url"]])

    def test_week_stored_with_no_incidents_and_no_note_is_retried(self):
        # How the scanned week sits in data/police.json before this fix.
        existing = {"weeks": [dict(READABLE), dict(SCANNED)], "geo": {},
                    "incidents": [{"id": "26-15000", "d": "2026-11-02",
                                   "t": "1015", "r": "Patrol Check",
                                   "g": "Patrol checks", "a": "Services Rendered",
                                   "loc": "Main St", "w": READABLE["file"]}]}
        out, fetched = run_main(existing, {})
        self.assertEqual(fetched, [SCANNED["url"]])
        notes = {w["file"]: w.get("note") for w in out["weeks"]}
        self.assertTrue(notes[SCANNED["file"]])
        self.assertEqual(len(out["incidents"]), 1)

    def test_rescanned_week_that_becomes_readable_is_parsed(self):
        first, _ = run_main({"weeks": [], "geo": {}, "incidents": []},
                            {READABLE["file"]: [ROW]})
        row2 = dict(ROW, id="26-14000", d="2026-10-27")
        second, _ = run_main(first, {SCANNED["file"]: [row2]})
        notes = {w["file"]: w.get("note") for w in second["weeks"]}
        self.assertIsNone(notes[SCANNED["file"]])
        self.assertEqual(sorted(i["id"] for i in second["incidents"]),
                         ["26-14000", "26-15000"])


if __name__ == "__main__":
    unittest.main()
