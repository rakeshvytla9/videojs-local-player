# VideoJS Local Player

Play local videos in a normal browser tab, served by Python's built-in HTTP server. No browser extension, desktop app, build step, or npm installation is needed.

This was created to watch local videos in Chrome while using Gemini in Chrome to ask questions about the current tab. The player has no Gemini API integration; tab sharing is controlled by Chrome and Gemini. Sharing a tab is not a guarantee that Gemini can inspect or transcribe an entire local video.

## Run locally

Requires Python 3 and a modern browser.

```sh
git clone https://github.com/rakeshvytla9/videojs-local-player.git
cd videojs-local-player
bash start-server.sh
```

Open **http://localhost:8080/player/player.html** in Chrome. Drop a video onto the page or click to browse. Keep the server terminal open; press Ctrl+C to stop it.

Alternatively, run this from the project directory:

```sh
python3 -m http.server 8080
```

## Existing features

- Drag-and-drop video loading and a session playlist
- Automatic playback of the next playlist item
- Volume boost controls
- Fullscreen and picture-in-picture controls

Selected videos are loaded using browser blob URLs. Playback support depends on the browser's codecs and the video's encoding; a listed file extension does not guarantee playback.

## Project files

- `start-server.sh` — original local server launcher
- `player/` — original HTML, CSS, and JavaScript
- `lib/` — original bundled player libraries
- `THIRD_PARTY_NOTICES.md` and `licenses/` — notices for bundled libraries

