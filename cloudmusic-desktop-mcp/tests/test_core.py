import base64
import json
import unittest
from unittest.mock import patch

import server


class CoreTests(unittest.TestCase):
    def test_build_song_url_contains_only_expected_command(self):
        url = server._build_play_url("song", 123456)
        self.assertTrue(url.startswith("orpheus://"))
        payload = base64.b64decode(url.removeprefix("orpheus://")).decode("utf-8")
        self.assertEqual(json.loads(payload), {"type": "song", "id": "123456", "cmd": "play"})

    def test_build_playlist_url(self):
        url = server._build_play_url("playlist", 42)
        payload = base64.b64decode(url.removeprefix("orpheus://")).decode("utf-8")
        self.assertEqual(json.loads(payload)["type"], "playlist")

    def test_rejects_non_positive_id(self):
        with self.assertRaises(ValueError):
            server._build_play_url("song", 0)

    def test_open_rejects_other_protocols(self):
        with self.assertRaises(ValueError):
            server._open_play_url("https://example.com")

    @patch.object(server, "_search")
    @patch.object(server, "_open_play_url")
    def test_search_and_play_uses_numeric_result_id(self, open_play_url, search):
        search.return_value = [{"id": 123, "name": "Test", "artists": ["Artist"]}]
        result = server.search_and_play("Test", artist="Artist")
        self.assertTrue(result["success"])
        open_play_url.assert_called_once()
        called_url = open_play_url.call_args.args[0]
        self.assertTrue(called_url.startswith("orpheus://"))

    @patch.object(server, "_search")
    @patch.object(server, "_open_play_url")
    def test_ambiguous_artist_does_not_play(self, open_play_url, search):
        search.return_value = [
            {"id": 123, "name": "Test", "artists": ["Artist-", "Someone Else"]}
        ]
        result = server.search_and_play("Test", artist="Artist")
        self.assertFalse(result["success"])
        open_play_url.assert_not_called()

    def test_song_selection_allows_one_exact_normalized_artist(self):
        match = {"id": 123, "name": "晴 天", "artists": ["周杰伦"]}
        self.assertEqual(server._select_song_match([match], "晴天", "周杰伦"), match)

    @patch.object(server, "_client_state")
    @patch.object(server, "_ensure_client_runtime")
    @patch.object(server, "_cdp_evaluate")
    @patch.object(server, "_fetch_tracks")
    def test_set_queue_uses_official_play_action(
        self, fetch_tracks, cdp_evaluate, ensure_runtime, client_state
    ):
        fetch_tracks.return_value = [{"id": 11}, {"id": 22}]
        client_state.side_effect = [
            {"queue": []},
            {"queue": [{"id": 11}, {"id": 22}], "mode": "playCycle"},
        ]
        result = server._set_queue(
            [11, 22], clear=True, start_playing=True, start_song_id=22
        )
        expression = cdp_evaluate.call_args_list[0].args[0]
        self.assertIn('type:"playing/play"', expression)
        self.assertIn('"clear":true', expression)
        self.assertIn('"playId":22', expression)
        self.assertEqual(result["queue"], [{"id": 11}, {"id": 22}])
        ensure_runtime.assert_called()

    @patch.object(server, "_client_state")
    @patch.object(server, "_ensure_client_runtime")
    @patch.object(server, "_cdp_evaluate")
    def test_set_play_mode_maps_public_name(
        self, cdp_evaluate, ensure_runtime, client_state
    ):
        client_state.return_value = {"mode": "playRandom"}
        result = server.set_netease_play_mode("shuffle")
        self.assertTrue(result["success"])
        self.assertIn("playRandom", cdp_evaluate.call_args.args[0])
        ensure_runtime.assert_called_once()

    @patch.object(server, "_set_queue")
    @patch.object(server, "_search")
    def test_search_queue_keeps_query_order(self, search, set_queue):
        search.side_effect = [
            [{"id": 11, "name": "First", "artists": ["A"]}],
            [{"id": 22, "name": "Second", "artists": ["B"]}],
        ]
        set_queue.return_value = {"queue": [{"id": 11}, {"id": 22}]}
        result = server.search_and_set_netease_queue(["First A", "Second B"])
        self.assertTrue(result["success"])
        self.assertEqual(set_queue.call_args.args[0], [11, 22])

    @patch.object(server, "_client_state")
    @patch.object(server, "_ensure_client_runtime")
    @patch.object(server, "_cdp_evaluate")
    def test_app_volume_uses_fractional_internal_value(
        self, cdp_evaluate, ensure_runtime, client_state
    ):
        client_state.return_value = {"volumePercent": 37}
        result = server.set_netease_volume(37)
        self.assertTrue(result["success"])
        self.assertIn("volume:0.37", cdp_evaluate.call_args.args[0])

    @patch.object(server, "_ensure_client_runtime")
    @patch.object(server, "_cdp_evaluate")
    def test_desktop_lyrics_is_explicit_not_blind_toggle(
        self, cdp_evaluate, ensure_runtime
    ):
        cdp_evaluate.side_effect = [False, True, True]
        result = server.set_desktop_lyrics(True)
        self.assertTrue(result["success"])
        self.assertEqual(cdp_evaluate.call_count, 3)
        self.assertIn("switchDesktopLyricShowOrHide", cdp_evaluate.call_args_list[1].args[0])

    @patch.object(server, "_client_state")
    @patch.object(server, "_ensure_client_runtime")
    @patch.object(server, "_cdp_evaluate")
    def test_clear_queue_uses_client_clear_action(
        self, cdp_evaluate, ensure_runtime, client_state
    ):
        client_state.return_value = {"queue": [], "status": 0}
        result = server.clear_netease_queue()
        self.assertTrue(result["success"])
        self.assertIn("playingList/clearCurPlayingList", cdp_evaluate.call_args.args[0])

    @patch.object(server, "_ensure_client_runtime")
    @patch.object(server, "_cdp_evaluate")
    def test_lyrics_theme_maps_to_client_action(self, cdp_evaluate, ensure_runtime):
        cdp_evaluate.side_effect = [True, "天际蓝"]
        result = server.set_desktop_lyrics_theme("sky_blue")
        self.assertTrue(result["success"])
        self.assertIn("preinBlue", cdp_evaluate.call_args_list[0].args[0])


if __name__ == "__main__":
    unittest.main()
