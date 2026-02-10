# claude-sound

Cross-platform CLI (macOS, Windows, Linux) that configures **Claude Code Hooks** to play **bundled sounds**.

![claude-sound CLI](assets/images/how-to-use.gif)

- Setup UI: `npx claude-sound@latest`
- Hook runner: `npx --yes claude-sound@latest play --event <Event> --sound <SoundId> --managed-by claude-sound`

## Install / run

```bash
npx claude-sound@latest
```

You’ll be prompted to choose where to write settings:

- Project (shared): `.claude/settings.json`
- Project (local): `.claude/settings.local.json`
- Global: `~/.claude/settings.json`

Then you can enable/disable events and choose a sound per event. Selecting a sound plays a quick preview. Choose **Create my own** to generate custom text-to-speech sounds, or **Import from file** to add your own MP3/WAV files.

## Commands

```bash
claude-sound list-events
claude-sound list-sounds
claude-sound play --sound ring1
claude-sound import <path>   # Import MP3/WAV into ~/.claude-sound/sounds/
```

## What gets written

For each configured event, `claude-sound` writes a Claude hook handler like:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes claude-sound@latest play --event SessionStart --sound ring1 --managed-by claude-sound",
            "async": true,
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

`claude-sound` only manages hook handlers whose `command` contains `--managed-by claude-sound`.

## Uninstall / remove hooks

Run the setup again and choose **Remove all claude-sound hooks**, then **Apply**.

Or manually delete any hook handlers whose command contains:

```
--managed-by claude-sound
```

## Custom sound order and labels

Add `assets/sounds/order.json` to control order and display names:

```json
{
  "common": [
    { "id": "common/baemin", "label": "Baemin Delivery" },
    "common/pop",
    "common/kakaotalk"
  ],
  "game": ["game/undertale-sans", "game/pokemon-battle", ...],
  "ring": ["ring1", "ring2", "ring3", "ring4", "ring5", "ring6", "ring7", "ring8", "ring9", "ring10"]
}
```

- Use full IDs (e.g. `common/baemin`). Sounds not listed append at the end.
- Use `{ "id": "...", "label": "Display Name" }` for custom labels; otherwise the filename is shown.

## Create my own (text-to-speech)

When picking a sound, choose **Create my own** to generate custom sounds from text. Supports English (default) and Korean. Enter any phrase (e.g. "Claude is ready!" or "클로드가 준비됐어요!") and it will be turned into speech using Google Translate TTS (free, no API key). Requires network. Custom sounds are saved to `~/.claude-sound/sounds/`.

See [docs/TTS.md](docs/TTS.md) for details.

## Import from file

When picking a sound, choose **Import from file** and enter a path to an MP3 or WAV file. It will be copied to `~/.claude-sound/sounds/` and appear under **Custom (TTS & imported)**. Or use the CLI:

```bash
claude-sound import ./my-notification.mp3
```

Supported formats: MP3, WAV. Max file size: 5MB.

## Platform support

| Platform | Audio player | Notes |
|----------|--------------|-------|
| **macOS** | `afplay` | Built-in, no setup needed |
| **Windows** | `ffplay`, `mpv`, `mpg123`, or PowerShell | Install [ffmpeg](https://ffmpeg.org/) (includes `ffplay`) or [mpv](https://mpv.io/) for best support. PowerShell (built-in) plays WAV only. |
| **Linux** | `ffplay`, `mpv`, `mpg123`, `aplay`, etc. | Install ffmpeg or mpv for MP3 support. |

## Notes

- Hooks run `npx` each time the event fires. It’s simple and works everywhere, but may be slower than a local install.
