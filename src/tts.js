import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const CUSTOM_SOUNDS_DIR = path.join(os.homedir(), '.claude-sound', 'sounds');

const GOOGLE_TTS_URL = 'https://translate.google.com/translate_tts';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Get the directory for custom TTS sounds.
 * @returns {string}
 */
export function customSoundsDir() {
  return CUSTOM_SOUNDS_DIR;
}

/**
 * Create a filesystem-safe slug from text.
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  const trimmed = text.trim().slice(0, 40);
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'custom';
}

/**
 * Generate a short hash for uniqueness.
 * @param {string} s
 * @returns {string}
 */
function shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

/**
 * Fetch TTS audio from Google Translate (free, no API key).
 * Uses the undocumented translate_tts endpoint. Max ~200 chars per request.
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.lang]
 * @param {number} [opts.timeout]
 * @returns {Promise<ArrayBuffer>}
 */
function validateLang(lang) {
  if (typeof lang !== 'string' || lang.length < 2 || lang.length > 10) {
    return 'en';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(lang)) {
    return 'en';
  }
  return lang;
}

async function fetchGoogleTts(text, { lang = 'en', timeout = 15000 } = {}) {
  const safeLang = validateLang(lang);
  const url = new URL(GOOGLE_TTS_URL);
  url.searchParams.set('ie', 'UTF-8');
  url.searchParams.set('tl', safeLang);
  url.searchParams.set('client', 'tw-ob');
  url.searchParams.set('q', text);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`TTS request failed: ${res.status} ${res.statusText}`);
    }

    return await res.arrayBuffer();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generate TTS audio from text and save to custom sounds directory.
 * Uses Google Translate TTS (free, no API key). Requires network.
 * @param {string} text - Text to speak
 * @param {object} [opts]
 * @param {string} [opts.lang] - Language code (default: 'en')
 * @returns {Promise<{ soundId: string; filePath: string }>}
 */
export async function generateTts(text, opts = {}) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Text cannot be empty');
  }

  if (trimmed.length > 200) {
    throw new Error('Text must be 200 characters or less (Google TTS limit)');
  }

  const dir = customSoundsDir();
  await fs.mkdir(dir, { recursive: true });

  const baseSlug = slugify(trimmed);
  const unique = `${baseSlug}-${shortHash(trimmed)}`;
  const filePath = path.join(dir, `${unique}.mp3`);

  const timeoutMs = typeof opts.timeout === 'number' && opts.timeout > 0 ? opts.timeout : 15000;
  const arrayBuffer = await fetchGoogleTts(trimmed, {
    lang: opts.lang ?? 'en',
    timeout: timeoutMs
  });
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(filePath, buffer);

  return {
    soundId: `custom/${unique}`,
    filePath
  };
}
