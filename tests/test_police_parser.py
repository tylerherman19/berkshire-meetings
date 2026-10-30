"""Privacy-safe regression tests for scraper/police.py's PDF parser.

Fixtures are minimized synthetic word rows modeled on the two real table
layouts the department has used (pre- and mid-October 2026). No real log
content: every token here is either a column label, a call type, or an
invented street.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scraper"))
import police  # noqa: E402


def word(text, x, y, width=None):
    w = width if width is not None else max(4, len(text) * 5.5)
    return {"text": text, "x0": float(x), "x1": float(x) + w,
            "top": float(y), "bottom": float(y) + 8}


def row(items, y):
    return [word(text, x, y) for text, x in items]


class FakePage:
    def __init__(self, words):
        self.words = words

    def extract_words(self, **_kwargs):
        return self.words


class FakePdf:
    def __init__(self, pages):
        self.pages = [FakePage(words) for words in pages]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def parse_words(pages):
    with patch.object(police.pdfplumber, "open",
                      return_value=FakePdf(pages)):
        return police.parse_pdf("synthetic-fixture.pdf")


class OldLayoutTests(unittest.TestCase):
    """Pre-shift columns: time ~82, source ~125, reason ~157, action ~365."""

    def test_header_location_and_privacy(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/11/2026", 60)], 10),
            *row([("26-12683", 0), ("0039", 82), ("911", 125), ("-", 146),
                  ("NOISE", 157), ("COMPLAINT", 190), ("Services", 365),
                  ("Rendered", 413)], 30),
            *row([("Call", 38), ("Source:", 65), ("911", 124)], 40),
            *row([("Location/Address:", 11), ("[GRE]", 124), ("123", 140),
                  ("NORTH", 158), ("(A)", 191), ("ST", 209), ("Unit", 226),
                  ("7", 248)], 50),
            *row([("Refer", 38), ("To:", 70), ("REDACTED", 90)], 60),
            *row([("Arrest:", 38), ("REDACTED", 90)], 70),
            *row([("26-12684", 0), ("0040", 82), ("Initiated", 125),
                  ("-", 179), ("PATROL", 190), ("CHECK", 227),
                  ("LOGGED", 365)], 80),
            *row([("Call", 38), ("Source:", 65), ("Initiated", 124)], 90),
            *row([("Location:", 11), ("[HOU]", 124), ("MAIN", 140),
                  ("(A)", 167), ("ST", 185)], 100),
        ]]
        parsed = parse_words(pages)
        self.assertEqual(len(parsed), 2)
        self.assertEqual((parsed[0]["id"], parsed[0]["r"], parsed[0]["a"]),
                         ("26-12683", "NOISE COMPLAINT", "Services Rendered"))
        self.assertEqual((parsed[0]["loc"], parsed[0]["sector"]),
                         ("NORTH ST", "GRE"))
        self.assertEqual((parsed[1]["loc"], parsed[1]["sector"]),
                         ("MAIN ST", "HOU"))
        self.assertFalse(parsed[0]["unresolved"])
        self.assertNotIn("123", parsed[0]["loc"])
        self.assertNotIn("REDACTED", str(parsed))

    def test_numeric_911_source_parses(self):
        # The old regex required an alphabetic source token and dropped
        # every 911-sourced call; keep this pinned.
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/11/2026", 60)], 10),
            *row([("26-12747", 0), ("0755", 82), ("911", 125), ("-", 146),
                  ("MEDICAL", 157), ("EMERGENCY", 200), ("AMBULANCE", 365),
                  ("DISPATCHED", 419)], 30),
            *row([("Call", 38), ("Source:", 65), ("911", 124)], 40),
            *row([("Location/Address:", 11), ("[GRE]", 124),
                  ("BLUE", 156), ("HILL", 187), ("LN", 215)], 50),
        ]]
        parsed = parse_words(pages)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["r"], "MEDICAL EMERGENCY")
        self.assertEqual(parsed[0]["a"], "AMBULANCE DISPATCHED")
        self.assertIn(parsed[0]["r"], police.EXCLUDE_REASONS)


class ShiftedLayoutTests(unittest.TestCase):
    """Post-shift columns: time ~125, everything else packed from ~365."""

    def test_single_space_action_split_by_picklist(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-12986", 0), ("0046", 125), ("911", 365), ("-", 387),
                  ("NOISE", 398), ("COMPLAINT", 431), ("Services", 515),
                  ("Rendered", 564)], 30),
            *row([("Call", 39), ("Source:", 66), ("911", 126)], 40),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("NORTH", 143),
                  ("(A)", 176), ("ST", 194)], 50),
        ]]
        parsed = parse_words(pages)
        self.assertEqual(len(parsed), 1)
        self.assertEqual((parsed[0]["r"], parsed[0]["a"]),
                         ("NOISE COMPLAINT", "Services Rendered"))
        self.assertEqual(parsed[0]["loc"], "NORTH ST")

    def test_wrapped_action_tail(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-12989", 0), ("0128", 125), ("911", 365), ("-", 387),
                  ("MEDICAL", 398), ("EMERGENCY", 442),
                  ("AMBULANCE", 515)], 30),
            *row([("DISPATCHED", 0)], 40),
            *row([("Call", 39), ("Source:", 66), ("911", 126)], 50),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("BLUE", 159),
                  ("HILL", 187), ("LN", 215)], 60),
        ]]
        parsed = parse_words(pages)
        self.assertEqual(parsed[0]["r"], "MEDICAL EMERGENCY")
        self.assertEqual(parsed[0]["a"], "AMBULANCE DISPATCHED")

    def test_fully_wrapped_action(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-13069", 0), ("0924", 125), ("Phone", 365),
                  ("-", 398), ("LARCENY", 409), ("/", 453),
                  ("FORGERY/", 464), ("FRAUD", 513)], 30),
            *row([("Services", 0), ("Rendered", 50)], 40),
            *row([("Call", 39), ("Source:", 66), ("Telephone", 126)], 50),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("FRONT", 159),
                  ("ST", 192)], 60),
        ]]
        parsed = parse_words(pages)
        self.assertEqual((parsed[0]["r"], parsed[0]["a"], parsed[0]["loc"]),
                         ("LARCENY / FORGERY/ FRAUD", "Services Rendered",
                          "FRONT ST"))

    def test_two_line_wrapped_action(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-13165", 0), ("1854", 125), ("Initiated", 365),
                  ("-", 420), ("AMB", 431), ("TRANSPORT", 453),
                  ("Taken/Referred", 515), ("to", 597)], 30),
            *row([("Other", 0), ("Agency", 33)], 40),
            *row([("Call", 39), ("Source:", 66), ("Initiated", 126)], 50),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("MAIN", 159),
                  ("ST", 192)], 60),
        ]]
        parsed = parse_words(pages)
        self.assertEqual(parsed[0]["a"], "Taken/Referred to Other Agency")

    def test_packed_reason_action_no_gap(self):
        # Some shifted rows pack reason and action with ordinary word
        # spacing all the way through; the picklist suffix splits them.
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-13087", 0), ("2056", 125), ("Initiated", 365),
                  ("-", 420), ("RADAR", 431), ("AMBULANCE", 460),
                  ("DISPATCHED", 515)], 30),
            *row([("Call", 39), ("Source:", 66), ("Initiated", 126)], 40),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("MAIN", 159),
                  ("ST", 192)], 50),
        ]]
        parsed = parse_words(pages)
        self.assertEqual((parsed[0]["r"], parsed[0]["a"]),
                         ("RADAR", "AMBULANCE DISPATCHED"))

    def test_unrecognized_action_marks_row_unresolved(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-13999", 0), ("0100", 125), ("Phone", 365),
                  ("-", 398), ("WELFARE", 409), ("CHECK", 453),
                  ("Zorched", 486)], 30),
            *row([("Call", 39), ("Source:", 66), ("Telephone", 126)], 40),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("MAIN", 159),
                  ("ST", 192)], 50),
        ]]
        parsed = parse_words(pages)
        # No known action suffix: the row is flagged so main() keeps it
        # out rather than risk publishing a privacy-excluded call type
        # glued to an unrecognized action word.
        self.assertTrue(parsed[0]["unresolved"])


class AssociationTests(unittest.TestCase):
    def test_header_without_location_does_not_inherit_next_records(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-13069", 0), ("0924", 125), ("Phone", 365),
                  ("-", 398), ("LARCENY", 409), ("Services", 515),
                  ("Rendered", 564)], 30),
            *row([("Call", 39), ("Source:", 66), ("Telephone", 126)], 40),
            *row([("26-13070", 0), ("0925", 125), ("911", 365),
                  ("-", 398), ("MOTOR", 398), ("VEHICLE", 431),
                  ("ACCIDENT", 475), ("Citation/Warning", 515)], 50),
            *row([("Issued", 0)], 60),
            *row([("Call", 39), ("Source:", 66), ("911", 126)], 70),
            *row([("Location:", 55), ("[HOU]", 126), ("MAIN", 142),
                  ("ST", 169)], 80),
        ]]
        parsed = parse_words(pages)
        self.assertEqual(parsed[0]["loc"], "")
        self.assertEqual((parsed[1]["loc"], parsed[1]["sector"]),
                         ("MAIN ST", "HOU"))
        self.assertEqual(parsed[1]["a"], "Citation/Warning Issued")

    def test_arrest_block_address_is_not_a_location(self):
        # Bare "Address:" rows inside Refer To blocks hold a person's home
        # address; only Location/Location-Address rows are locations.
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/11/2026", 60)], 10),
            *row([("26-12900", 0), ("1200", 82), ("Phone", 125), ("-", 157),
                  ("DISTURBANCE", 168), ("Arrest(s)", 365), ("Made", 420)],
                 30),
            *row([("Call", 38), ("Source:", 65), ("Telephone", 124)], 40),
            *row([("Location/Address:", 11), ("[GRE]", 124), ("NORTH", 141),
                  ("ST", 174)], 50),
            *row([("Refer", 38), ("To", 70), ("Arrest:", 90),
                  ("26-999-AR", 130)], 60),
            *row([("Arrest:", 38), ("REDACTED", 90)], 70),
            *row([("Address:", 38), ("999", 82), ("PITTSFIELD", 100),
                  ("RD", 160)], 80),
            *row([("Age:", 38), ("35", 90)], 90),
        ]]
        parsed = parse_words(pages)
        self.assertEqual(parsed[0]["loc"], "NORTH ST")
        self.assertNotIn("PITTSFIELD", str(parsed))
        self.assertNotIn("REDACTED", str(parsed))

    def test_location_only_sector_means_no_street(self):
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/11/2026", 60)], 10),
            *row([("26-11075", 0), ("1448", 82), ("Phone", 125), ("-", 157),
                  ("Harrassment", 168), ("Order", 233), ("No", 365),
                  ("Action", 381), ("Required", 418)], 30),
            *row([("Call", 38), ("Source:", 65), ("Telephone", 124)], 40),
            *row([("Location:", 54), ("[GRE]", 124)], 50),
            *row([("26-11076", 0), ("1457", 82), ("911", 125), ("-", 146),
                  ("MEDICAL", 157), ("EMERGENCY", 200), ("AMBULANCE", 365),
                  ("DISPATCHED", 419)], 60),
            *row([("Call", 38), ("Source:", 65), ("911", 124)], 70),
            *row([("Location/Address:", 11), ("[GRE", 124), ("46]", 140),
                  ("MAIN", 161), ("(A)", 188), ("ST", 206)], 80),
        ]]
        parsed = parse_words(pages)
        # A sector-only location row is no location; the following call's
        # street must not leak backwards onto it.
        self.assertEqual(parsed[0]["loc"], "")
        self.assertEqual(parsed[1]["loc"], "MAIN ST")

    def test_page_furniture_and_date_changes(self):
        page1 = [
            *row([("Great", 166), ("Barrington", 209), ("Police", 288),
                  ("Department", 338), ("Page:", 504), ("1", 561)], 5),
            *row([("Dispatch", 20), ("Log", 69), ("From:", 97),
                  ("10/18/2026", 130)], 17),
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 49),
            *row([("Call", 0), ("Number", 27), ("Time", 83), ("Call", 125),
                  ("Reason", 152), ("Action", 365)], 70),
            *row([("26-12986", 0), ("0046", 125), ("911", 365), ("-", 387),
                  ("NOISE", 398), ("COMPLAINT", 431), ("Services", 515),
                  ("Rendered", 564)], 90),
        ]
        page2 = [
            *row([("Great", 166), ("Barrington", 209), ("Police", 288),
                  ("Department", 338), ("Page:", 504), ("2", 561)], 5),
            *row([("Call", 0), ("Number", 27), ("Time", 83), ("Call", 125),
                  ("Reason", 152), ("Action", 365)], 70),
            *row([("Call", 39), ("Source:", 66), ("911", 126)], 80),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("NORTH", 143),
                  ("(A)", 176), ("ST", 194)], 90),
            *row([("For", 0), ("Date:", 24), ("10/19/2026", 60)], 120),
            *row([("26-12990", 0), ("0134", 125), ("Initiated", 365),
                  ("-", 420), ("PATROL", 431), ("CHECK", 469),
                  ("LOGGED", 515)], 140),
            *row([("Call", 39), ("Source:", 66), ("Initiated", 126)], 150),
            *row([("Location/Address:", 11), ("[GRE", 126), ("364]", 142),
                  ("STOCKBRIDGE", 163), ("RD", 229)], 160),
        ]
        parsed = parse_words([page1, page2])
        self.assertEqual(len(parsed), 2)
        # Entry spanning the page break still gets its source/location.
        self.assertEqual((parsed[0]["d"], parsed[0]["loc"]),
                         ("2026-10-18", "NORTH ST"))
        self.assertEqual((parsed[1]["d"], parsed[1]["loc"]),
                         ("2026-10-19", "STOCKBRIDGE RD"))


if __name__ == "__main__":
    unittest.main()


def parse_words_stats(pages):
    stats = {}
    rows = parse_words(pages)
    st = {}
    with patch.object(police.pdfplumber, "open",
                      return_value=FakePdf(pages)):
        rows = police.parse_pdf("synthetic-fixture.pdf", stats=st)
    return rows, st


class BlockOwnershipTests(unittest.TestCase):
    """Auditor cases: one Call Source and one Location per entry, in order."""

    def _pages_orphan_after_located(self):
        # Real shape of the 26-12997/26-12998 case in 10.18-10.24: 12997 is
        # complete, then 12998's header is missing from the PDF and its
        # Call Source + Location rows appear at the top of the next page.
        page1 = [
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-12997", 0), ("0210", 125), ("Initiated", 365),
                  ("-", 420), ("PATROL", 431), ("CHECK", 469),
                  ("LOGGED", 515)], 30),
            *row([("Call", 39), ("Source:", 66), ("Initiated", 126)], 40),
            *row([("Location/Address:", 11), ("[GRE", 126), ("366]", 142),
                  ("MAIN", 163), ("(A)", 188), ("ST", 206)], 50),
        ]
        page2 = [
            *row([("Great", 166), ("Barrington", 209), ("Police", 288),
                  ("Department", 338), ("Page:", 504), ("2", 561)], 5),
            *row([("Dispatch", 20), ("Log", 69), ("From:", 97),
                  ("10/18/2026", 130)], 17),
            *row([("Call", 39), ("Source:", 66), ("Initiated", 126)], 30),
            *row([("Location/Address:", 11), ("[HOU", 126), ("30]", 142),
                  ("PARK", 163), ("(B)", 188), ("ST", 206)], 40),
            *row([("26-12999", 0), ("0213", 125), ("Initiated", 365),
                  ("-", 420), ("PATROL", 431), ("CHECK", 469),
                  ("LOGGED", 515)], 50),
            *row([("Call", 39), ("Source:", 66), ("Initiated", 126)], 60),
            *row([("Location/Address:", 11), ("[GRE", 126), ("365]", 142),
                  ("MAIN", 163), ("(A)", 188), ("ST", 206)], 70),
        ]
        return [page1, page2]

    def test_orphan_block_after_located_entry_is_discarded(self):
        rows, st = parse_words_stats(self._pages_orphan_after_located())
        self.assertEqual(len(rows), 2)
        # The located entry keeps its own street...
        self.assertEqual((rows[0]["loc"], rows[0]["sector"]),
                         ("MAIN ST", "GRE"))
        # ...and the orphan block fills nothing and is counted.
        self.assertEqual((rows[1]["loc"], rows[1]["sector"]),
                         ("MAIN ST", "GRE"))
        self.assertEqual(st["orphans"], 2)
        self.assertEqual(st["headers"], 2)
        self.assertEqual(st["sources"], 3)
        self.assertEqual(st["locations"], 3)

    def test_orphan_block_never_fills_blank_location(self):
        # 26-11075 pattern: an entry whose own Location row is sector-only
        # must stay locationless even when an orphan block follows.
        pages = [[
            *row([("For", 0), ("Date:", 24), ("08/31/2026", 60)], 10),
            *row([("26-11075", 0), ("1448", 82), ("Phone", 125), ("-", 157),
                  ("Harrassment", 168), ("Order", 233), ("No", 365),
                  ("Action", 381), ("Required", 418)], 30),
            *row([("Call", 38), ("Source:", 65), ("Telephone", 124)], 40),
            *row([("Location:", 54), ("[GRE]", 124)], 50),
            *row([("Call", 38), ("Source:", 65), ("911", 124)], 60),
            *row([("Location/Address:", 11), ("[GRE", 124), ("46]", 140),
                  ("MAIN", 161), ("(A)", 188), ("ST", 206)], 70),
        ]]
        rows, st = parse_words_stats(pages)
        self.assertEqual(rows[0]["loc"], "")
        self.assertEqual(st["orphans"], 2)
        self.assertEqual(police.drop_reason(rows[0]), "no_location")

    def test_unrecognized_header_row_is_a_loud_suspect(self):
        # Future drift, e.g. a 6-digit call number: the row and its block
        # are dropped, counted as a suspect, and the guards fail the run.
        pages = [[
            *row([("For", 0), ("Date:", 24), ("10/18/2026", 60)], 10),
            *row([("26-12986", 0), ("0046", 125), ("911", 365), ("-", 387),
                  ("NOISE", 398), ("COMPLAINT", 431), ("Services", 515),
                  ("Rendered", 564)], 30),
            *row([("Call", 39), ("Source:", 66), ("911", 126)], 40),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("NORTH", 143),
                  ("(A)", 176), ("ST", 194)], 50),
            *row([("26-129867", 0), ("0050", 125), ("Phone", 365),
                  ("-", 398), ("DISTURBANCE", 409), ("Services", 515),
                  ("Rendered", 564)], 60),
            *row([("Call", 39), ("Source:", 66), ("Telephone", 126)], 70),
            *row([("Location/Address:", 11), ("[GRE]", 126), ("MAIN", 143),
                  ("ST", 170)], 80),
        ]]
        rows, st = parse_words_stats(pages)
        self.assertEqual([r["id"] for r in rows], ["26-12986"])
        self.assertEqual(rows[0]["loc"], "NORTH ST")
        self.assertEqual(st["suspects"], 1)
        # The dropped row's block rows are orphans, not attachments.
        self.assertEqual(st["orphans"], 2)
        self.assertTrue(police.check_parse_guards("w.pdf", st))

    def test_page_break_location_without_call_source(self):
        # 26-11048 pattern: header at page bottom, Location at the top of
        # the next page, no Call Source row at all. Legitimate; attach.
        page1 = [
            *row([("For", 0), ("Date:", 24), ("08/31/2026", 60)], 10),
            *row([("26-11048", 0), ("0135", 82), ("Initiated", 125),
                  ("-", 179), ("PATROL", 190), ("CHECK", 227),
                  ("LOGGED", 365)], 700),
        ]
        page2 = [
            *row([("Great", 166), ("Barrington", 209), ("Police", 288),
                  ("Department", 338), ("Page:", 504), ("4", 561)], 5),
            *row([("Dispatch", 20), ("Log", 69), ("From:", 97),
                  ("08/30/2026", 130)], 17),
            *row([("Location/Address:", 11), ("[GRE", 124), ("356]", 140),
                  ("STOCKBRIDGE", 161), ("RD", 229)], 40),
            *row([("26-11049", 0), ("0136", 82), ("Initiated", 125),
                  ("-", 179), ("PATROL", 190), ("CHECK", 227),
                  ("LOGGED", 365)], 60),
            *row([("Call", 38), ("Source:", 65), ("Initiated", 124)], 70),
            *row([("Location/Address:", 11), ("[GRE", 124), ("209]", 140),
                  ("STATE", 161), ("RD", 190)], 80),
        ]
        rows, st = parse_words_stats([page1, page2])
        self.assertEqual(rows[0]["loc"], "STOCKBRIDGE RD")
        self.assertEqual(st["orphans"], 0)

    def test_page_break_entry_with_source_but_no_location(self):
        # 26-11763 pattern: header + Call Source, then the next header
        # after a page break. No location exists; the entry drops.
        page1 = [
            *row([("For", 0), ("Date:", 24), ("09/13/2026", 60)], 10),
            *row([("26-11763", 0), ("0634", 82), ("Phone", 125), ("-", 157),
                  ("FOUND/LOST", 168), ("PROPERTY", 230),
                  ("LOGGED", 365)], 700),
            *row([("Call", 38), ("Source:", 65), ("Telephone", 124)], 710),
        ]
        page2 = [
            *row([("Great", 166), ("Barrington", 209), ("Police", 288),
                  ("Department", 338), ("Page:", 504), ("9", 561)], 5),
            *row([("Dispatch", 20), ("Log", 69), ("From:", 97),
                  ("09/13/2026", 130)], 17),
            *row([("26-11764", 0), ("0701", 82), ("Phone", 125), ("-", 157),
                  ("LOCK", 168), ("OUT", 195), ("UNLOCKED", 365),
                  ("VEHICLE", 425)], 60),
            *row([("Call", 38), ("Source:", 65), ("Telephone", 124)], 70),
            *row([("Location/Address:", 11), ("[GRE]", 124), ("MAIN", 141),
                  ("ST", 168)], 80),
        ]
        rows, st = parse_words_stats([page1, page2])
        self.assertEqual(rows[0]["loc"], "")
        self.assertEqual(police.drop_reason(rows[0]), "no_location")
        self.assertEqual(st["orphans"], 0)


class MainFlowTests(unittest.TestCase):
    def test_drop_reason_flow(self):
        base = {"r": "NOISE COMPLAINT", "sector": "GRE", "loc": "MAIN ST",
                "unresolved": False}
        self.assertIsNone(police.drop_reason(dict(base)))
        self.assertEqual(police.drop_reason(
            dict(base, unresolved=True)), "unresolved")
        self.assertEqual(police.drop_reason(
            dict(base, r="WELFARE CHECK")), "excluded")
        self.assertEqual(police.drop_reason(
            dict(base, sector="PIT")), "out_of_town")
        self.assertEqual(police.drop_reason(
            dict(base, loc="")), "no_location")

    def test_adams_sector_is_out_of_town(self):
        # [AD] tags Adams, MA rows in the posted logs; it must not publish
        # as a Great Barrington pin.
        row = {"r": "ASSIST OTHER AGENCY", "sector": "AD", "loc": "ADAMS",
               "unresolved": False}
        self.assertEqual(police.drop_reason(row), "out_of_town")
        self.assertNotIn("AD", police.GB_SECTORS)
        self.assertIn("GB", police.GB_SECTORS)  # never observed; GB proper

    def test_guards_pass_on_healthy_stats(self):
        st = {"headers": 269, "id_tokens": 269, "sources": 270,
              "locations": 270, "orphans": 2, "suspects": 0,
              "unresolved": 0, "no_location": 1}
        self.assertEqual(police.check_parse_guards("w.pdf", st), [])

    def test_guards_fail_on_yield_collapse(self):
        # The historical 12-of-269 failure shape.
        st = {"headers": 12, "id_tokens": 269, "sources": 270,
              "locations": 270, "orphans": 0, "suspects": 257,
              "unresolved": 0, "no_location": 0}
        problems = police.check_parse_guards("w.pdf", st)
        self.assertTrue(problems)

    def test_guards_fail_on_unresolved_and_no_location_surge(self):
        st = {"headers": 100, "id_tokens": 100, "sources": 100,
              "locations": 100, "orphans": 0, "suspects": 0,
              "unresolved": 1, "no_location": 0}
        self.assertTrue(police.check_parse_guards("w.pdf", st))
        st["unresolved"] = 0
        st["no_location"] = 9
        self.assertTrue(police.check_parse_guards("w.pdf", st))

    def test_guards_fail_on_zero_headers_with_tokens(self):
        st = {"headers": 0, "id_tokens": 40, "sources": 40,
              "locations": 40, "orphans": 0, "suspects": 40,
              "unresolved": 0, "no_location": 0}
        self.assertTrue(police.check_parse_guards("w.pdf", st))
