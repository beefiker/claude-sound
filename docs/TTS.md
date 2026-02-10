# Text-to-Speech (TTS)

claude-sound lets you create custom sounds from text using **Google Translate TTS** — free, no API key required.

## How to use

1. Run `npx claude-sound@latest`
2. Pick an event (e.g. SessionStart)
3. Choose **Enable & choose sound**
4. Select **Create my own (text-to-speech)**
5. Enter your text (e.g. "Claude is ready!")
6. The sound is generated and chosen for that event

## Details

| Aspect | Notes |
|--------|-------|
| **Implementation** | Built-in (no TTS dependency) |
| **Backend** | Google Translate TTS (`translate_tts` endpoint) |
| **Cost** | Free, no API key |
| **Format** | MP3 |
| **Storage** | `~/.claude-sound/sounds/` |
| **Limit** | ~200 characters per phrase |
| **Languages** | English (default), Korean |

## Requirements

- **Network** — TTS generation requires internet
- **Node.js** — shipped with claude-sound

## Custom sounds directory

Generated sounds are saved to:

```
~/.claude-sound/sounds/
```

Each file is named `<slug>-<hash>.mp3`, e.g. `hello-from-claude-1tcuau.mp3`. They appear under the **Custom (TTS & imported)** category when picking sounds. Imported MP3/WAV files from `claude-sound import` are stored in the same directory.

## Language

The default language is English (`en`). For other languages, you’d need to pass `lang` to `generateTts`:

```javascript
await generateTts(text, { lang: 'es' });  // e.g. 'fr', 'zh-CN'
```

Supported codes: [Google Cloud Speech docs](https://cloud.google.com/speech/docs/languages)
