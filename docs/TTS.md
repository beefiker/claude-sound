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
| **Library** | [@sefinek/google-tts-api](https://www.npmjs.com/package/@sefinek/google-tts-api) |
| **Backend** | Google Translate TTS |
| **Cost** | Free, no API key |
| **Format** | MP3 |
| **Storage** | `~/.claude-sound/sounds/` |
| **Limit** | ~200 characters per phrase |

## Requirements

- **Network** — TTS generation requires internet
- **Node.js** — shipped with claude-sound

## Custom sounds directory

Generated sounds are saved to:

```
~/.claude-sound/sounds/
```

Each file is named `<slug>-<hash>.mp3`, e.g. `hello-from-claude-1tcuau.mp3`. They appear under the **Custom (TTS)** category when picking sounds.

## Language

The default language is English (`en`). For other languages, you’d need to change the `lang` option in `src/tts.js`:

```javascript
const base64 = await getAudioBase64(trimmed, {
  lang: 'en',  // e.g. 'es', 'fr', 'zh-CN'
  slow: false,
  timeout: 15000
});
```

Supported codes: [Google Cloud Speech docs](https://cloud.google.com/speech/docs/languages)
