from __future__ import annotations

import base64
import ctypes
import json
import os
import re
import subprocess
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Literal

from mcp.server.fastmcp import FastMCP
import websocket


SEARCH_ENDPOINT = "https://music.163.com/api/search/get/web"
SONG_DETAIL_ENDPOINT = "https://music.163.com/api/song/detail"
DEFAULT_CDP_PORT = 9223
PLAY_MODES = {
    "order": "playOrder",
    "list_loop": "playCycle",
    "single_loop": "playOneCycle",
    "shuffle": "playRandom",
}
LYRIC_THEMES = {
    "netease_red": ("preinDefault", "网易红"),
    "sunset": ("preinSunset", "落日晖"),
    "cute_pink": ("preinPink", "可爱粉"),
    "sky_blue": ("preinBlue", "天际蓝"),
    "fresh_green": ("preinGreen", "清新绿"),
    "vivid_purple": ("preinPurple", "活力紫"),
    "warm_yellow": ("preinGolden", "温柔黄"),
    "soft_gray": ("preinGray", "低调灰"),
}
_CDP_LOCK = threading.Lock()

MEDIA_KEYS = {
    "play_pause": 0xB3,
    "stop": 0xB2,
    "next": 0xB0,
    "previous": 0xB1,
    "volume_up": 0xAF,
    "volume_down": 0xAE,
    "mute": 0xAD,
}

APP_SHORTCUTS = {
    "like": (0x11, 0x12, ord("L")),       # Ctrl+Alt+L
    "lyrics": (0x11, 0x12, ord("D")),     # Ctrl+Alt+D
    "mini_mode": (0x11, 0x12, ord("M")),  # Ctrl+Alt+M
}

KEYEVENTF_KEYUP = 0x0002

mcp = FastMCP(
    "GPT CloudMusic Control",
    instructions=(
        "Local-only controls for the NetEase Cloud Music desktop client. "
        "Use search_and_play to play one requested song or playlist. Use "
        "set_netease_queue and add_to_netease_queue for deterministic queues, "
        "and set_netease_play_mode for order, loop, or shuffle. Use "
        "control_netease for playback and volume controls. The server never "
        "reads browser cookies, account credentials, listening history, or "
        "private files."
    ),
)


def _cloudmusic_exe() -> Path:
    configured = os.environ.get("CLOUDMUSIC_EXE")
    if configured:
        return Path(configured).expanduser()

    candidates = [
        Path(os.environ.get("PROGRAMFILES", r"C:\Program Files"))
        / "NetEase"
        / "CloudMusic"
        / "cloudmusic.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
        / "NetEase"
        / "CloudMusic"
        / "cloudmusic.exe",
        Path.home() / "AppData" / "Local" / "NetEase" / "CloudMusic" / "cloudmusic.exe",
    ]
    return next((path for path in candidates if path.is_file()), candidates[0])


def _require_cloudmusic_exe() -> Path:
    executable = _cloudmusic_exe()
    if not executable.is_file():
        raise FileNotFoundError(f"NetEase Cloud Music executable not found: {executable}")
    return executable


def _cdp_port() -> int:
    raw = os.environ.get("CLOUDMUSIC_CDP_PORT", str(DEFAULT_CDP_PORT))
    try:
        port = int(raw)
    except ValueError as exc:
        raise ValueError("CLOUDMUSIC_CDP_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError("CLOUDMUSIC_CDP_PORT must be between 1 and 65535")
    return port


def _is_cloudmusic_running() -> bool:
    completed = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq cloudmusic.exe", "/FO", "CSV", "/NH"],
        check=False,
        capture_output=True,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    return "cloudmusic.exe" in completed.stdout.lower()


def _tap_virtual_key(virtual_key: int) -> None:
    user32 = ctypes.windll.user32
    user32.keybd_event(virtual_key, 0, 0, 0)
    user32.keybd_event(virtual_key, 0, KEYEVENTF_KEYUP, 0)


def _send_hotkey(keys: tuple[int, ...]) -> None:
    user32 = ctypes.windll.user32
    for key in keys:
        user32.keybd_event(key, 0, 0, 0)
    time.sleep(0.03)
    for key in reversed(keys):
        user32.keybd_event(key, 0, KEYEVENTF_KEYUP, 0)


def _search(query: str, kind: Literal["song", "playlist"], limit: int = 5) -> list[dict]:
    cleaned_query = query.strip()
    if not cleaned_query:
        raise ValueError("Search query cannot be empty")
    if not 1 <= limit <= 10:
        raise ValueError("limit must be between 1 and 10")

    try:
        return _search_via_client(cleaned_query, kind, limit)
    except RuntimeError:
        pass

    search_type = 1 if kind == "song" else 1000
    params = urllib.parse.urlencode(
        {
            "s": cleaned_query,
            "type": search_type,
            "offset": 0,
            "total": "true",
            "limit": limit,
        }
    )
    request = urllib.request.Request(
        f"{SEARCH_ENDPOINT}?{params}",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://music.163.com/",
        },
    )

    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.load(response)

    if payload.get("code") != 200:
        raise RuntimeError(f"NetEase search returned code {payload.get('code')!r}")

    result = payload.get("result") or {}
    if not isinstance(result, dict):
        raise RuntimeError(
            "NetEase returned an encrypted anonymous-search response and the "
            "desktop client search channel was unavailable"
        )
    if kind == "song":
        items = result.get("songs") or []
        return [
            {
                "id": int(item["id"]),
                "name": item.get("name", ""),
                "artists": [artist.get("name", "") for artist in item.get("artists", [])],
                "album": (item.get("album") or {}).get("name", ""),
            }
            for item in items[:limit]
        ]

    items = result.get("playlists") or []
    return [
        {
            "id": int(item["id"]),
            "name": item.get("name", ""),
            "creator": (item.get("creator") or {}).get("nickname", ""),
            "track_count": item.get("trackCount"),
        }
        for item in items[:limit]
    ]


def _fetch_tracks(song_ids: list[int]) -> list[dict]:
    normalized = [int(song_id) for song_id in song_ids]
    if not normalized:
        raise ValueError("song_ids cannot be empty")
    if len(normalized) > 100:
        raise ValueError("song_ids is limited to 100 items per request")
    if any(song_id <= 0 for song_id in normalized):
        raise ValueError("Every song ID must be a positive integer")

    params = urllib.parse.urlencode(
        {"ids": json.dumps(normalized, separators=(",", ":"))}
    )
    request = urllib.request.Request(
        f"{SONG_DETAIL_ENDPOINT}?{params}",
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://music.163.com/",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        payload = json.load(response)

    tracks_by_id = {int(track["id"]): track for track in payload.get("songs") or []}
    missing = [song_id for song_id in normalized if song_id not in tracks_by_id]
    if missing:
        raise RuntimeError(f"NetEase did not return song details for IDs: {missing}")
    return [tracks_by_id[song_id] for song_id in normalized]


def _cdp_target() -> dict:
    endpoint = f"http://127.0.0.1:{_cdp_port()}/json"
    try:
        with urllib.request.urlopen(endpoint, timeout=2) as response:
            targets = json.load(response)
    except Exception as exc:
        raise RuntimeError(
            "NetEase Cloud Music is not exposing its local control channel. "
            "Close the client, then call launch_netease_music so it starts with "
            "queue and play-mode support enabled."
        ) from exc
    for target in targets:
        if target.get("type") == "page" and str(target.get("url", "")).startswith("orpheus://"):
            return target
    raise RuntimeError("Could not find the NetEase Cloud Music page control target")


def _cdp_send(expression: str, await_promise: bool = False):
    """Send one expression to the client verbatim. No rewriting happens here."""
    target = _cdp_target()
    with _CDP_LOCK:
        connection = websocket.create_connection(
            target["webSocketDebuggerUrl"], timeout=20, suppress_origin=True
        )
        try:
            connection.send(json.dumps({
                "id": 1,
                "method": "Runtime.evaluate",
                "params": {
                    "expression": expression,
                    "returnByValue": True,
                    "awaitPromise": await_promise,
                },
            }))
            while True:
                message = json.loads(connection.recv())
                if message.get("id") != 1:
                    continue
                result = message.get("result") or {}
                if result.get("exceptionDetails"):
                    detail = result["exceptionDetails"]
                    description = (
                        (detail.get("exception") or {}).get("description")
                        or detail.get("text")
                        or "Unknown JavaScript error"
                    )
                    raise RuntimeError(f"NetEase client control failed: {description}")
                return (result.get("result") or {}).get("value")
        finally:
            connection.close()


# --- Version resilience: do not hardcode the store's module number --------------------
# The client's internals are reached through the webpack `require` captured in
# _ensure_client_runtime(). Webpack module NUMBERS are build artifacts, and any client
# update renumbers them: the store was module 12 on the verified 3.1.24 build, and module
# 8 on 3.1.41. A hardcoded number does not fail loudly - it makes every stateful tool
# raise a TypeError - so resolve it at runtime instead by looking for the module whose
# exports expose both getStore() and getDispatch().
_STORE_PLACEHOLDER = "__gpt_cm_require__(12)"

_RESOLVE_STORE_JS = (
    "(()=>{if(typeof window.__gpt_cm_store_id__==='number')"
    "return window.__gpt_cm_store_id__;"
    "var r=window.__gpt_cm_require__;if(!r)return -1;"
    "for(var i=0;i<1500;i++){try{var m=r(i);"
    "if(m&&m.a&&typeof m.a.getStore==='function'"
    "&&typeof m.a.getDispatch==='function')"
    "{window.__gpt_cm_store_id__=i;return i;}}catch(e){}}return -1;})()"
)


def _resolve_module_placeholders(expression: str) -> str:
    if _STORE_PLACEHOLDER not in expression:
        return expression
    module_id = _cdp_send(_RESOLVE_STORE_JS)
    if not isinstance(module_id, int) or module_id < 0:
        raise RuntimeError(
            "Could not locate the NetEase client's state store module. The client build "
            "likely changed shape; inspect window.__gpt_cm_require__ manually."
        )
    return expression.replace(_STORE_PLACEHOLDER, f"__gpt_cm_require__({module_id})")


def _cdp_evaluate(expression: str, await_promise: bool = False):
    return _cdp_send(_resolve_module_placeholders(expression), await_promise)


def _ensure_client_runtime() -> None:
    _cdp_evaluate(
        "webpackJsonp.push([[987660],{987660:function(module,exports,require){"
        "window.__gpt_cm_require__=require;}},[[987660]]]);true"
    )


def _search_via_client(
    query: str, kind: Literal["song", "playlist"], limit: int
) -> list[dict]:
    _ensure_client_runtime()
    params = {
        "s": query,
        "type": 1 if kind == "song" else 1000,
        "offset": 0,
        "total": True,
        "limit": limit,
    }
    payload = _cdp_evaluate(
        f"__gpt_cm_require__(14).V({json.dumps(params, ensure_ascii=False)})",
        await_promise=True,
    )
    result = (payload or {}).get("result") or {}
    if not isinstance(result, dict):
        raise RuntimeError("The desktop client returned an invalid search response")

    if kind == "song":
        items = result.get("songs") or []
        return [
            {
                "id": int(item["id"]),
                "name": item.get("name", ""),
                "artists": [
                    artist.get("name", "")
                    for artist in (item.get("artists") or item.get("ar") or [])
                ],
                "album": (item.get("album") or item.get("al") or {}).get("name", ""),
            }
            for item in items[:limit]
        ]

    items = result.get("playlists") or []
    return [
        {
            "id": int(item["id"]),
            "name": item.get("name", ""),
            "creator": (item.get("creator") or {}).get("nickname", ""),
            "track_count": item.get("trackCount"),
        }
        for item in items[:limit]
    ]


def _client_state() -> dict:
    _ensure_client_runtime()
    return _cdp_evaluate(
        "(()=>{const s=__gpt_cm_require__(12).a.getStore();"
        "return {mode:s.playing.playingMode,status:s.playing.playingState,"
        "volumePercent:Math.round(Number(s.playing.playingVolume||0)*100),"
        "desktopLyricsVisible:Boolean(s.setting.showLyric),"
        "current:s.playing.curPlaying?{id:Number(s.playing.curPlaying.resourceId),"
        "name:(s.playing.curPlaying.track||{}).name||''}:null,"
        "queue:s.playingList.curPlayingList.map(x=>({id:Number(x.resourceId),"
        "name:(x.track||{}).name||''}))}})()"
    )


def _set_queue(
    song_ids: list[int],
    *,
    clear: bool,
    start_playing: bool,
    position: Literal["next", "end"] = "end",
    start_song_id: int = 0,
) -> dict:
    if position not in {"next", "end"}:
        raise ValueError("position must be 'next' or 'end'")
    tracks = _fetch_tracks(song_ids)
    state = _client_state()
    selected_id = int(start_song_id) if start_song_id else int(song_ids[0])
    if selected_id not in [int(song_id) for song_id in song_ids]:
        raise ValueError("start_song_id must be one of song_ids")

    queue = state.get("queue") or []
    current_id = (state.get("current") or {}).get("id")
    current_index = next(
        (index for index, item in enumerate(queue) if item.get("id") == current_id),
        -1,
    )
    offset = max(-1, len(queue) - 1) if position == "end" else current_index
    trigger_action = "playAll" if clear else (
        "addToPlayList" if position == "end" else "nextPlay"
    )
    track_from = {
        "text": "GPT Queue",
        "href": "",
        "resourceType": "track",
        "scene": "search",
        "fromInfo": {
            "originalScene": "search",
            "originalResourceType": "track",
            "computeSourceResourceType": "track",
            "sourceData": {},
        },
    }
    options = {
        "clear": clear,
        "play": start_playing,
        "playId": selected_id,
        "offset": offset,
    }
    if clear:
        payload = {
            "tracks": tracks,
            "from": track_from,
            "options": options,
            "triggerScene": "search",
            "triggerAction": trigger_action,
        }
        action_type = "playing/play"
    else:
        payload = {
            "trackList": tracks,
            "trackFrom": track_from,
            "options": options,
            "triggerScene": "search",
            "triggerAction": trigger_action,
        }
        action_type = "playingList/addItemToCurPlayingList"
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    _ensure_client_runtime()
    _cdp_evaluate(
        "(async()=>{const d=__gpt_cm_require__(12).a.getDispatch();"
        f"await d({{type:{json.dumps(action_type)},payload:{serialized}}});return true}})()",
        await_promise=True,
    )
    time.sleep(0.15)
    return _client_state()


def _build_play_url(kind: Literal["song", "playlist"], item_id: int) -> str:
    if kind not in {"song", "playlist"}:
        raise ValueError(f"Unsupported item kind: {kind}")
    if int(item_id) <= 0:
        raise ValueError("item_id must be a positive integer")

    command = {"type": kind, "id": str(int(item_id)), "cmd": "play"}
    encoded = base64.b64encode(
        json.dumps(command, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return f"orpheus://{encoded}"


def _normalized_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\W_]+", "", normalized, flags=re.UNICODE)


def _select_song_match(matches: list[dict], title: str, artist: str = "") -> dict | None:
    if not matches:
        return None
    if not artist.strip():
        return matches[0]

    wanted_title = _normalized_name(title)
    wanted_artist = _normalized_name(artist)
    for match in matches:
        artists = match.get("artists") or []
        if (
            _normalized_name(match.get("name", "")) == wanted_title
            and len(artists) == 1
            and _normalized_name(artists[0]) == wanted_artist
        ):
            return match
    return None


def _open_play_url(play_url: str) -> None:
    if not play_url.startswith("orpheus://"):
        raise ValueError("Only the orpheus:// protocol is allowed")
    _require_cloudmusic_exe()
    os.startfile(play_url)


@mcp.tool()
def get_netease_status() -> dict:
    """Check the configured NetEase Cloud Music path and whether it is running."""
    executable = _cloudmusic_exe()
    try:
        control_channel_ready = bool(_cdp_target())
    except RuntimeError:
        control_channel_ready = False
    return {
        "configured_path": str(executable),
        "executable_exists": executable.is_file(),
        "running": _is_cloudmusic_running(),
        "queue_control_ready": control_channel_ready,
        "privacy": "No account data, cookies, history, or private files are read.",
    }


@mcp.tool()
def launch_netease_music() -> dict:
    """Open the local NetEase Cloud Music desktop client via Windows ShellExecute."""
    executable = _require_cloudmusic_exe()
    if not _is_cloudmusic_running():
        subprocess.Popen(
            [
                str(executable),
                "--remote-debugging-address=127.0.0.1",
                f"--remote-debugging-port={_cdp_port()}",
            ],
            cwd=str(executable.parent),
        )
        return {
            "success": True,
            "message": "NetEase Cloud Music is opening with queue control enabled.",
        }
    try:
        _cdp_target()
        message = "NetEase Cloud Music is already running with queue control enabled."
    except RuntimeError:
        message = (
            "NetEase Cloud Music is already running, but queue control is unavailable. "
            "Close it once, then call launch_netease_music again."
        )
    return {"success": True, "message": message}


@mcp.tool()
def search_music(
    query: str,
    kind: Literal["song", "playlist"] = "song",
    limit: int = 5,
) -> dict:
    """Search NetEase Cloud Music over HTTPS without reading account credentials."""
    matches = _search(query=query, kind=kind, limit=limit)
    return {"query": query, "kind": kind, "count": len(matches), "matches": matches}


@mcp.tool()
def search_and_play(
    query: str,
    kind: Literal["song", "playlist"] = "song",
    artist: str = "",
) -> dict:
    """Search and play a song or playlist; artist can prevent playing a wrong cover version."""
    matches = _search(query=query, kind=kind, limit=10 if artist and kind == "song" else 5)
    if not matches:
        return {"success": False, "message": f"No matching {kind} found for: {query}"}

    selected = (
        _select_song_match(matches, title=query, artist=artist)
        if kind == "song"
        else matches[0]
    )
    if selected is None:
        return {
            "success": False,
            "message": (
                f"No unambiguous exact match for {query!r} by {artist!r}; "
                "nothing was played. Use search_music to inspect candidates."
            ),
            "candidates": matches,
        }

    _open_play_url(_build_play_url(kind=kind, item_id=int(selected["id"])))
    return {
        "success": True,
        "message": f"Playing the top {kind} match.",
        "selected": selected,
    }


@mcp.tool()
def play_netease_item(
    item_id: int,
    kind: Literal["song", "playlist"] = "song",
) -> dict:
    """Play a known NetEase song or playlist ID in the desktop client."""
    _open_play_url(_build_play_url(kind=kind, item_id=item_id))
    return {"success": True, "kind": kind, "id": item_id}


@mcp.tool()
def get_netease_queue() -> dict:
    """Read the current official-client queue, current track, and playback mode."""
    state = _client_state()
    inverse_modes = {value: key for key, value in PLAY_MODES.items()}
    state["mode"] = inverse_modes.get(state.get("mode"), state.get("mode"))
    return {"success": True, **state}


@mcp.tool()
def set_netease_queue(
    song_ids: list[int],
    start_playing: bool = True,
    start_song_id: int = 0,
) -> dict:
    """Replace the queue with song IDs in the given order and optionally start playback."""
    state = _set_queue(
        song_ids,
        clear=True,
        start_playing=start_playing,
        start_song_id=start_song_id,
    )
    return {"success": True, "action": "replace_queue", **state}


@mcp.tool()
def clear_netease_queue() -> dict:
    """Stop playback and clear every item from the official-client queue."""
    _ensure_client_runtime()
    _cdp_evaluate(
        "(async()=>{const d=__gpt_cm_require__(12).a.getDispatch();"
        "await d({type:'playingList/clearCurPlayingList',payload:{"
        "triggerScene:'playingList'}});return true})()",
        await_promise=True,
    )
    time.sleep(0.15)
    state = _client_state()
    return {
        "success": not state.get("queue"),
        "action": "clear_queue",
        **state,
    }


@mcp.tool()
def search_and_set_netease_queue(
    queries: list[str],
    start_playing: bool = True,
) -> dict:
    """Search each phrase, use its top song match, and replace the queue in that order."""
    if not queries:
        raise ValueError("queries cannot be empty")
    if len(queries) > 50:
        raise ValueError("queries is limited to 50 songs")

    selected = []
    for query in queries:
        matches = _search(query=query, kind="song", limit=1)
        if not matches:
            return {
                "success": False,
                "message": f"No song found for {query!r}; the queue was not changed.",
                "selected": selected,
            }
        selected.append(matches[0])

    state = _set_queue(
        [int(item["id"]) for item in selected],
        clear=True,
        start_playing=start_playing,
    )
    return {
        "success": True,
        "action": "search_and_replace_queue",
        "selected": selected,
        **state,
    }


@mcp.tool()
def add_to_netease_queue(
    song_ids: list[int],
    position: Literal["next", "end"] = "end",
    start_playing: bool = False,
) -> dict:
    """Add song IDs after the current track or at the end of the official-client queue."""
    state = _set_queue(
        song_ids,
        clear=False,
        start_playing=start_playing,
        position=position,
    )
    return {"success": True, "action": f"add_{position}", **state}


@mcp.tool()
def set_netease_play_mode(
    mode: Literal["order", "list_loop", "single_loop", "shuffle"],
) -> dict:
    """Set official-client playback mode: order, list_loop, single_loop, or shuffle."""
    if mode not in PLAY_MODES:
        raise ValueError(f"Unsupported playback mode: {mode}")
    _ensure_client_runtime()
    internal_mode = PLAY_MODES[mode]
    _cdp_evaluate(
        "(async()=>{const d=__gpt_cm_require__(12).a.getDispatch();"
        "await d({type:'playing/switchPlayingMode',payload:{"
        f"playingMode:{json.dumps(internal_mode)},triggerScene:'sysTray',"
        "HeartBeatFlage:false}});return true})()",
        await_promise=True,
    )
    state = _client_state()
    return {"success": True, "mode": mode, "internal_mode": state.get("mode")}


@mcp.tool()
def set_netease_volume(percent: int) -> dict:
    """Set NetEase Cloud Music's own player volume from 0 to 100."""
    if not 0 <= int(percent) <= 100:
        raise ValueError("percent must be between 0 and 100")
    _ensure_client_runtime()
    volume = int(percent) / 100
    _cdp_evaluate(
        "(async()=>{const d=__gpt_cm_require__(12).a.getDispatch();"
        f"await d({{type:'playing/setVolume',payload:{{volume:{volume}}}}});"
        "return true})()",
        await_promise=True,
    )
    time.sleep(0.1)
    state = _client_state()
    return {
        "success": abs(int(state.get("volumePercent", -1)) - int(percent)) <= 1,
        "volume_percent": state.get("volumePercent"),
    }


@mcp.tool()
def set_desktop_lyrics(visible: bool) -> dict:
    """Explicitly show or hide the official NetEase desktop lyrics window."""
    _ensure_client_runtime()
    current = bool(
        _cdp_evaluate("Boolean(__gpt_cm_require__(12).a.getStore().setting.showLyric)")
    )
    if current != visible:
        _cdp_evaluate(
            "(async()=>{const d=__gpt_cm_require__(12).a.getDispatch();"
            "await d({type:'async:action/doAction',payload:{"
            "actionId:'switchDesktopLyricShowOrHide',data:{}}});return true})()",
            await_promise=True,
        )
    actual = bool(
        _cdp_evaluate("Boolean(__gpt_cm_require__(12).a.getStore().setting.showLyric)")
    )
    return {"success": actual == visible, "visible": actual}


@mcp.tool()
def set_desktop_lyrics_theme(
    theme: Literal[
        "netease_red", "sunset", "cute_pink", "sky_blue",
        "fresh_green", "vivid_purple", "warm_yellow", "soft_gray",
    ],
) -> dict:
    """Set one of the official desktop-lyrics color themes."""
    if theme not in LYRIC_THEMES:
        raise ValueError(f"Unsupported desktop lyrics theme: {theme}")
    action_id, expected_name = LYRIC_THEMES[theme]
    action_payload = json.dumps(
        {"actionId": action_id, "data": {"callback": None}},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    _ensure_client_runtime()
    _cdp_evaluate(
        "(async()=>{const d=__gpt_cm_require__(12).a.getDispatch();"
        f"await d({{type:'async:action/doAction',payload:{action_payload}}});"
        "return true})()",
        await_promise=True,
    )
    actual_name = _cdp_evaluate(
        "String(__gpt_cm_require__(12).a.getStore().setting.prein||'')"
    )
    return {
        "success": actual_name == expected_name,
        "theme": theme,
        "client_theme_name": actual_name,
    }


@mcp.tool()
def control_netease(
    action: Literal[
        "play_pause",
        "stop",
        "next",
        "previous",
        "volume_up",
        "volume_down",
        "mute",
    ],
    repeats: int = 1,
) -> dict:
    """Control playback with Windows media keys; repeats is limited to 1-10."""
    if action not in MEDIA_KEYS:
        raise ValueError(f"Unsupported action: {action}")
    if not 1 <= repeats <= 10:
        raise ValueError("repeats must be between 1 and 10")

    for index in range(repeats):
        _tap_virtual_key(MEDIA_KEYS[action])
        if index + 1 < repeats:
            time.sleep(0.08)
    return {"success": True, "action": action, "repeats": repeats}


@mcp.tool()
def send_netease_shortcut(
    action: Literal["like", "lyrics", "mini_mode"],
) -> dict:
    """Send a whitelisted NetEase global shortcut; the matching shortcut must be enabled in the app."""
    if action not in APP_SHORTCUTS:
        raise ValueError(f"Unsupported shortcut action: {action}")
    _send_hotkey(APP_SHORTCUTS[action])
    return {
        "success": True,
        "action": action,
        "note": "This requires the corresponding global shortcut to be enabled in NetEase Cloud Music.",
    }


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
