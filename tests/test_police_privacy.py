"""Privacy exclusions and geocoding behaviour added after the Nov 2026 audit."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scraper"))
import police  # noqa: E402


def row(r, a, loc="BROOK LN", sector="GRE"):
    return {"id": "26-1", "d": "2026-11-01", "t": "1200", "r": r, "a": a,
            "loc": loc, "sector": sector, "unresolved": False}


class PrivacyTests(unittest.TestCase):
    def test_every_serve_call_type_is_excluded(self):
        # 26-13634 "Serve Paperwork" was published on Nov 1, 2026.
        for r in ("SERVE PAPERWORK", "SERVE WARRANT", "SERVE RESTRAINING ORDER"):
            self.assertEqual(police.drop_reason(row(r, "Services Rendered")),
                             "excluded", r)

    def test_medical_outcome_on_non_traffic_call_is_excluded(self):
        # 26-12327 "Assist Citizen / Transported To Hospital / Bentley Ave".
        self.assertEqual(police.drop_reason(
            row("ASSIST CITIZEN", "Transported To Hospital")), "excluded")
        self.assertEqual(police.drop_reason(
            row("SUSPICIOUS ACTIVITY", "Ambulance Dispatched")), "excluded")

    def test_crash_with_ambulance_on_public_road_is_kept(self):
        self.assertIsNone(police.drop_reason(
            row("MOTOR VEHICLE ACCIDENT", "Transported To Hospital", "MAIN ST")))

    def test_ordinary_call_is_kept(self):
        self.assertIsNone(police.drop_reason(row("PATROL CHECK", "Logged")))

    def test_rule_works_on_stored_title_cased_incidents(self):
        self.assertTrue(police.privacy_excluded(
            "Serve Paperwork", "Services Rendered", "Community"))
        self.assertFalse(police.privacy_excluded(
            "Motor Vehicle Accident", "Ambulance Dispatched", "Traffic"))


class LocationTests(unittest.TestCase):
    def test_doubled_street_suffix_collapsed(self):
        self.assertEqual(police.clean_location("[GRE] 12 COTTAGE ST ST")[0],
                         "COTTAGE ST")
        self.assertEqual(police.dedupe_suffix("Cottage St St"), "Cottage St")
        self.assertEqual(police.dedupe_suffix("State St"), "State St")


class GeocodeTests(unittest.TestCase):
    def _hit(self, lat="42.197", lon="-73.362"):
        return mock.Mock(raise_for_status=lambda: None,
                         json=lambda: [{"lat": lat, "lon": lon}])

    def test_network_error_is_not_cached_as_a_miss(self):
        cache = {}
        with mock.patch.object(police.requests, "get",
                               side_effect=police.requests.ConnectionError()), \
             mock.patch.object(police.time, "sleep"):
            self.assertIsNone(police.geocode("MAPLE AVE", "", cache))
        self.assertNotIn("MAPLE AVE", cache)

    def test_genuine_miss_is_cached(self):
        cache = {}
        empty = mock.Mock(raise_for_status=lambda: None, json=lambda: [])
        with mock.patch.object(police.requests, "get", return_value=empty), \
             mock.patch.object(police.time, "sleep"):
            police.geocode("NOWHERE LN", "", cache)
        self.assertIn("NOWHERE LN", cache)
        self.assertIsNone(cache["NOWHERE LN"])

    def test_misspelled_street_retried_with_correct_spelling(self):
        cache = {"ROSSETTER ST + MAIN ST": None}  # cached miss before the fix
        with mock.patch.object(police.requests, "get",
                               return_value=self._hit()) as g, \
             mock.patch.object(police.time, "sleep"):
            ll = police.geocode("ROSSETTER ST + MAIN ST", "", cache)
        self.assertEqual(ll, [42.197, -73.362])
        self.assertIn("ROSSETER ST", g.call_args.kwargs["params"]["q"])

    def test_alias_used_for_place_labels(self):
        cache = {"DOWNTOWN HOUSY": None}
        with mock.patch.object(police.requests, "get",
                               return_value=self._hit("42.25", "-73.36")) as g, \
             mock.patch.object(police.time, "sleep"):
            police.geocode("DOWNTOWN HOUSY", "", cache)
        self.assertEqual(g.call_args.kwargs["params"]["q"], "Housatonic, MA")


if __name__ == "__main__":
    unittest.main()
