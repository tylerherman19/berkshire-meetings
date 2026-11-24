import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scraper"))
import scrape


TODAY = date(2026, 11, 24)
OLD_CHECK = "2026-11-23T17:00:00-05:00"
NEW_CHECK = "2026-11-24T17:00:00-05:00"


def meeting(town, title, day="2026-11-25", agenda=None):
    return {"town": town, "board": "Select Board", "title": title, "date": day,
            "start": None, "agenda_url": agenda, "minutes_url": None}


class MeetingScraperTests(unittest.TestCase):
    def setUp(self):
        clock = patch.object(scrape, "TODAY", TODAY)
        clock.start()
        self.addCleanup(clock.stop)
        self.addCleanup(scrape.meetings.clear)

    def test_failed_source_retains_records_and_reports_last_success(self):
        previous_meeting = meeting("Sheffield", "Previous meeting")
        previous = {"meetings": [previous_meeting, meeting("Sheffield", "Expired", "2026-04-01")],
                    "sources": {"Sheffield": {"ok": True, "checked_at": OLD_CHECK}}}

        def blocked():
            raise OSError("403 Forbidden")

        out, counts, sources = scrape.collect_meetings(previous, [("Sheffield", blocked)], NEW_CHECK)
        self.assertEqual(out, [previous_meeting])
        self.assertEqual(counts, {"Sheffield": 1})
        self.assertFalse(sources["Sheffield"]["ok"])
        self.assertEqual(sources["Sheffield"]["retained"], 1)
        self.assertEqual(sources["Sheffield"]["last_success_at"], OLD_CHECK)
        self.assertIn("403", sources["Sheffield"]["error"])
        self.assertEqual(scrape.detect_changes([previous_meeting], out, NEW_CHECK), [])

    def test_partial_refresh_keeps_old_documents_and_publishes_new_records(self):
        matched = meeting("Becket", "Seen again", agenda="https://town.example/agenda.pdf")
        retained = meeting("Becket", "Unreachable board")
        previous = {"meetings": [matched, retained]}

        def partial():
            scrape.add("Becket", "Select Board", "Seen again", date(2026, 11, 25))
            scrape.add("Becket", "Select Board", "New posting", date(2026, 11, 26))
            raise RuntimeError("One board failed")

        out, _, sources = scrape.collect_meetings(previous, [("Becket", partial)], NEW_CHECK)
        self.assertEqual({m["title"] for m in out}, {"Seen again", "Unreachable board", "New posting"})
        self.assertEqual(next(m for m in out if m["title"] == "Seen again")["agenda_url"], matched["agenda_url"])
        self.assertEqual(sources["Becket"]["retained"], 1)

    def test_district_reposts_survive_member_town_failure(self):
        district = meeting("SBRSD", "School district meeting")
        previous = {"meetings": [district]}

        def blocked():
            raise TimeoutError("Agenda center unavailable")

        out, _, sources = scrape.collect_meetings(previous, [("Egremont", blocked)], NEW_CHECK)
        self.assertEqual(out, [district])
        self.assertFalse(sources["SBRSD"]["ok"])
        self.assertEqual(sources["SBRSD"]["retained"], 1)

    def test_zero_result_is_flagged_when_recent_records_would_be_lost(self):
        previous = {"meetings": [meeting("Otis", "Published meeting")]}
        out, _, sources = scrape.collect_meetings(previous, [("Otis", lambda: 0), ("Alford", lambda: 0)], NEW_CHECK)
        self.assertEqual(out, previous["meetings"])
        self.assertFalse(sources["Otis"]["ok"])
        self.assertTrue(sources["Alford"]["ok"])

    def test_document_cache_survives_failed_download_only_with_same_links(self):
        old = meeting("Sheffield", "Meeting", agenda="https://town.example/agenda.pdf")
        old_texts = {scrape.meeting_key(old): "Last verified text"}
        with patch.object(scrape, "extract_document_text", side_effect=lambda _: {}):
            self.assertEqual(scrape.document_index([old], [old], old_texts), old_texts)
            replaced = {**old, "agenda_url": "https://town.example/revised.pdf"}
            self.assertEqual(scrape.document_index([replaced], [old], old_texts), {})

    def test_richmond_lists_cancellations_and_prefers_updated_agendas(self):
        html = """<main><div class="post"><strong>Cultural Council</strong>
        <table><tr><td>12/01/26 revised</td><td><a href="/revised.pdf">Agenda</a></td></tr></table>
        <table><tr><td>12/01/26</td><td><a href="/original.pdf">Agenda</a></td>
        <td><a href="/minutes.pdf">Minutes</a></td></tr></table>
        <strong>Board of Health</strong>
        <table><tr><td>12/02/26 NO MEETING</td><td></td></tr></table>
        <table><tr><td>01/01/25</td><td><a href="/old.pdf">Agenda</a></td></tr></table>
        </div></main>"""
        records = {}
        scrape.parse_richmond_agendas(BeautifulSoup(html, "html.parser"), "https://town.example/2026.php",
                                     date(2026, 7, 1), date(2027, 1, 1), records)
        self.assertEqual(len(records), 2)
        council = records[("Cultural Council", date(2026, 12, 1), None, "")]
        self.assertEqual(council["documents"], {"agenda": "https://town.example/revised.pdf",
                                               "minutes": "https://town.example/minutes.pdf"})
        self.assertTrue(any("Cancelled" in r["title"] for r in records.values()))


if __name__ == "__main__":
    unittest.main()
