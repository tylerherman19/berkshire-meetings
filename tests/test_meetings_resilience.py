"""Regression tests for how the meetings scraper behaves when town sites
block or fail it.

Background (Nov 18, 2026 run): Monterey's and Sandisfield's sites blocked
the scraper. The run published them as "OK, 0 meetings", dropped all their
meetings from the site, put 20 false "removed" entries in What Changed, and
spent ~90 minutes retrying day pages that were never going to load.
"""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scraper"))
import scrape  # noqa: E402

TODAY = date(2026, 11, 18)


def mtg(town, board, d, start="19:00", **extra):
    return dict({"town": town, "board": board, "title": f"{board} Meeting",
                 "date": d.isoformat(), "start": start, "end": None,
                 "all_day": False, "location": None, "agenda_url": None,
                 "minutes_url": None, "source_url": None}, **extra)


def healthy(count=1):
    return {"ok": True, "fails": 0, "count": count, "error": None}


def blocked(fails=3, count=0):
    return {"ok": True, "fails": fails, "count": count, "error": None}


class CarryForwardTests(unittest.TestCase):
    def test_fully_blocked_town_keeps_its_previous_meetings(self):
        old = [mtg("Monterey", "Select Board", TODAY + timedelta(days=2)),
               mtg("Monterey", "Planning Board", TODAY - timedelta(days=20))]
        out, carried = scrape.carry_forward(
            [], old, {"Monterey": blocked()}, TODAY)
        self.assertEqual(len(out), 2)
        self.assertEqual(carried, {"Monterey": 2})
        self.assertTrue(all(m["carried_since"] == "2026-11-18" for m in out))

    def test_healthy_town_is_not_padded_with_old_meetings(self):
        old = [mtg("Egremont", "Select Board", TODAY + timedelta(days=2))]
        out, carried = scrape.carry_forward(
            [], old, {"Egremont": healthy(0)}, TODAY)
        self.assertEqual(out, [])
        self.assertEqual(carried, {})

    def test_partly_blocked_town_only_fills_gaps(self):
        d = TODAY + timedelta(days=3)
        fresh = [mtg("Becket", "Select Board", d, start="18:30")]
        old = [mtg("Becket", "Select Board", d, start="18:00"),  # rescheduled
               mtg("Becket", "Planning Board", d)]                # page blocked
        out, carried = scrape.carry_forward(
            list(fresh), old, {"Becket": blocked(count=1)}, TODAY)
        self.assertEqual(carried, {"Becket": 1})
        boards = sorted((m["board"], m["start"]) for m in out)
        self.assertEqual(boards, [("Planning Board", "19:00"),
                                  ("Select Board", "18:30")])

    def test_raised_scrape_counts_as_degraded(self):
        old = [mtg("Becket", "Select Board", TODAY + timedelta(days=1))]
        h = {"ok": False, "fails": 1, "count": 0, "error": "RuntimeError: x"}
        out, carried = scrape.carry_forward([], old, {"Becket": h}, TODAY)
        self.assertEqual(carried, {"Becket": 1})

    def test_upcoming_meeting_stops_carrying_after_limit(self):
        stale = (TODAY - timedelta(days=scrape.CARRY_UPCOMING_DAYS + 1)).isoformat()
        recent = (TODAY - timedelta(days=2)).isoformat()
        old = [mtg("Monterey", "Select Board", TODAY + timedelta(days=1),
                   carried_since=stale),
               mtg("Monterey", "Planning Board", TODAY + timedelta(days=1),
                   carried_since=recent)]
        out, _ = scrape.carry_forward([], old, {"Monterey": blocked()}, TODAY)
        self.assertEqual([m["board"] for m in out], ["Planning Board"])
        self.assertEqual(out[0]["carried_since"], recent)  # first-carried date kept

    def test_past_meetings_carry_without_limit_but_inside_archive_window(self):
        long_ago = (TODAY - timedelta(days=60)).isoformat()
        old = [mtg("Monterey", "Select Board", TODAY - timedelta(days=10),
                   carried_since=long_ago),
               mtg("Monterey", "Old Board", TODAY - timedelta(days=200))]
        out, _ = scrape.carry_forward([], old, {"Monterey": blocked()}, TODAY)
        self.assertEqual([m["board"] for m in out], ["Select Board"])


class SourceStatusTests(unittest.TestCase):
    AT = "2026-11-18T15:42:56-05:00"

    def test_blocked_town_is_reported_as_failed_not_ok(self):
        old_src = {"ok": True, "checked_at": "2026-11-17T14:01:00-05:00"}
        rec = scrape.source_status("Monterey", blocked(fails=6),
                                   {"Monterey": 27}, self.AT, old_src)
        self.assertFalse(rec["ok"])
        self.assertIn("blocked", rec["error"])
        self.assertIn("27 meetings from the last successful check (Nov 17)",
                      rec["error"])
        self.assertEqual(rec["last_ok"], "2026-11-17T14:01:00-05:00")

    def test_last_good_date_survives_consecutive_failures(self):
        old_src = {"ok": False, "last_ok": "2026-11-15T14:01:00-05:00"}
        rec = scrape.source_status("Monterey", blocked(), {"Monterey": 3},
                                   self.AT, old_src)
        self.assertEqual(rec["last_ok"], "2026-11-15T14:01:00-05:00")
        self.assertIn("(Nov 15)", rec["error"])

    def test_partial_block_is_ok_but_flagged(self):
        rec = scrape.source_status("Sheffield", blocked(fails=16, count=3),
                                   {"Sheffield": 2}, self.AT, None)
        self.assertTrue(rec["ok"])
        self.assertTrue(rec["partial"])
        self.assertIn("16 pages", rec["note"])
        self.assertIn("2 meetings carried over", rec["note"])

    def test_healthy_town(self):
        rec = scrape.source_status("Egremont", healthy(78), {}, self.AT, None)
        self.assertEqual(rec, {"ok": True, "meetings": 0,
                               "checked_at": self.AT, "error": None})


class DetectChangesTests(unittest.TestCase):
    AT = "2026-11-18T15:42:56-05:00"

    def test_no_false_removals_for_degraded_town(self):
        d = TODAY + timedelta(days=1)
        old = [mtg("Monterey", "Select Board", d), mtg("Egremont", "ZBA", d)]
        changes = scrape.detect_changes(old, [], self.AT, degraded={"Monterey"})
        self.assertEqual([(c["town"], c["type"]) for c in changes],
                         [("Egremont", "removed")])


class FetchBehaviourTests(unittest.TestCase):
    def setUp(self):
        scrape.FETCH_FAILS["n"] = 0

    def _forbidden(self):
        import requests
        resp = requests.Response()
        resp.status_code = 403
        resp.url = "https://example.invalid/"
        return resp

    def test_no_sleep_after_last_tls_attempt_and_failure_counted(self):
        tls = mock.Mock()
        tls.get.return_value = mock.Mock(status_code=403)
        with mock.patch.object(scrape.requests, "get", return_value=self._forbidden()), \
             mock.patch.dict(sys.modules, {"curl_cffi": mock.Mock(requests=tls)}), \
             mock.patch.object(scrape.time, "sleep") as sleep:
            with self.assertRaises(Exception):
                scrape.get("https://example.invalid/")
        self.assertEqual(tls.get.call_count, 3)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [10, 20])
        self.assertEqual(scrape.FETCH_FAILS["n"], 1)

    def test_non_critical_failure_not_counted(self):
        with mock.patch.object(scrape.requests, "get",
                               side_effect=scrape.requests.ConnectionError()):
            with self.assertRaises(Exception):
                scrape.get("https://example.invalid/", critical=False)
        self.assertEqual(scrape.FETCH_FAILS["n"], 0)

    def test_day_page_crawl_gives_up_when_site_blocks(self):
        with mock.patch.object(scrape, "get",
                               side_effect=RuntimeError("403")) as g:
            n = scrape.scrape_drupal_day_pages("Monterey", "https://x.invalid")
        self.assertEqual(n, 0)
        self.assertEqual(g.call_count, scrape.DAY_PAGE_GIVE_UP)


class DocTextFallbackTests(unittest.TestCase):
    def test_previous_text_kept_when_download_fails(self):
        m = mtg("Becket", "Select Board", TODAY,
                agenda_url="https://x.invalid/agenda.pdf")
        key = scrape.meeting_key(m)
        with mock.patch.object(scrape, "get", side_effect=RuntimeError("403")):
            texts = scrape.extract_document_text([m], {key: "old agenda text"})
        self.assertEqual(texts, {key: "old agenda text"})


if __name__ == "__main__":
    unittest.main()
