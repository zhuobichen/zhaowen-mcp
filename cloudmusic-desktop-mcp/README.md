# CloudMusic Desktop MCP

A small, local-only MCP server that lets an AI control the official NetEase
Cloud Music desktop client on Windows.

It searches through the desktop client's own API (with an anonymous HTTPS
fallback), opens one-off selections through the official `orpheus://` protocol,
and controls queues, playback modes, desktop lyrics, and app volume through a
localhost-only Chromium control channel. It does not replace the official
player or create a second playback process.

> This is an independent community project. It is not affiliated with,
> endorsed by, or supported by NetEase Cloud Music.

## Prerequisites

- Windows 10 or Windows 11.
- The official NetEase Cloud Music desktop client installed.
- A personal account signed in to the desktop client is recommended. The
  account determines which subscribed or paid tracks the client can play.
- Python 3.11 or newer.
- A local MCP host that can launch a stdio server, such as Codex or Claude
  Desktop.

The MCP never reads the signed-in account, browser cookies, credentials,
listening history, playlists, or local music library.

## Install

```powershell
git clone https://github.com/Seraph310/cloudmusic-desktop-mcp.git
cd cloudmusic-desktop-mcp
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
```

If the executable is installed outside a standard NetEase directory, set
`CLOUDMUSIC_EXE` to its full path in the MCP configuration.

### Codex configuration

Add the following to `%USERPROFILE%\.codex\config.toml`, replacing both paths:

```toml
[mcp_servers.cloudmusic]
command = 'C:\path\to\cloudmusic-desktop-mcp\.venv\Scripts\python.exe'
args = ['C:\path\to\cloudmusic-desktop-mcp\server.py']
startup_timeout_sec = 30

[mcp_servers.cloudmusic.env]
CLOUDMUSIC_EXE = 'C:\path\to\CloudMusic\cloudmusic.exe'
```

Restart the MCP host after changing its configuration.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_netease_status` | Check the configured executable and running state |
| `launch_netease_music` | Start the official desktop client |
| `search_music` | Search songs or playlists without playing |
| `search_and_play` | Search and play an unambiguous match |
| `play_netease_item` | Play a known numeric song or playlist ID |
| `get_netease_queue` | Read the queue, current song, mode, app volume, and desktop-lyrics state |
| `set_netease_queue` | Replace the queue with ordered numeric song IDs |
| `clear_netease_queue` | Stop playback and empty the current queue |
| `search_and_set_netease_queue` | Search several phrases and build a queue in that order |
| `add_to_netease_queue` | Insert songs next or append them to the queue |
| `set_netease_play_mode` | Select order, list loop, single loop, or shuffle |
| `set_netease_volume` | Set the app's independent 0-100 player volume |
| `set_desktop_lyrics` | Explicitly show or hide desktop lyrics |
| `set_desktop_lyrics_theme` | Choose an official desktop-lyrics color theme |
| `control_netease` | Play/pause, stop, skip, mute, or use Windows volume keys |
| `send_netease_shortcut` | Send an allowlisted like, lyrics, or mini-mode shortcut |

When an artist is supplied, `search_and_play` refuses to play unless it finds
one exact normalized title/artist match. This avoids silently choosing a cover
version. Optional app shortcuts must first be configured to the matching global
shortcuts inside NetEase Cloud Music.

The advanced stateful tools require Cloud Music to be launched with the local
control channel. If `get_netease_status` reports
`queue_control_ready: false`, close Cloud Music once and call
`launch_netease_music`. The MCP starts it with the channel bound to
`127.0.0.1` on port `9223`. Set `CLOUDMUSIC_CDP_PORT` in the MCP environment to
choose another local port.

Playback modes are `order`, `list_loop`, `single_loop`, and `shuffle`.
`set_netease_volume` changes only Cloud Music's own volume, not Windows master
volume. `set_desktop_lyrics` reads the current state before acting, so repeated
requests do not accidentally toggle it the wrong way.

Desktop-lyrics themes are `netease_red`, `sunset`, `cute_pink`, `sky_blue`,
`fresh_green`, `vivid_purple`, `warm_yellow`, and `soft_gray`.

## Tested environment

- Windows 11 64-bit, build `26200`.
- NetEase Cloud Music desktop client `3.1.24.204791`.
- Python `3.11.5`.

Other recent Windows client versions may work but have not yet been verified.

## Safety choices

- HTTPS-only search.
- No Selenium, ChromeDriver, cookies, or account credentials.
- Advanced control is bound to `127.0.0.1` only and is never exposed remotely.
- Only fixed, allowlisted client actions plus validated song IDs and settings are evaluated.
- No arbitrary commands, URLs, keyboard input, or shell execution.
- Does not kill or restart an existing Cloud Music process.
- Opens only allowlisted `orpheus://` commands built from numeric result IDs.

The queue integration uses internal actions in the tested official client
version. A future NetEase update may rename them; use
`queue_control_ready` and the returned state to diagnose compatibility.

## Optional hardware companion

Pair this server with
[Halo PixelBar MCP](https://github.com/Seraph310/halo-pixelbar-mcp) so an MCP
host can coordinate music with the speaker's ambient light, pixel screen, and
independent hardware volume.

## Related project

[luuu-h/netease-music-mcp](https://github.com/luuu-h/netease-music-mcp)
inspired this project and offers a different, feature-rich approach using
`neteasecli`, `mpv`, synchronized lyrics, and a local web player. Choose that
project when you want an independent player UI; choose this one when you want
to keep using the official Windows desktop client without importing cookies
into the MCP.

## Test

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Credits

Built together by Celia and OpenAI Codex.

Celia led the product direction and live client validation. Codex assisted
with reverse engineering, implementation, and testing.

## License

[MIT](LICENSE)
