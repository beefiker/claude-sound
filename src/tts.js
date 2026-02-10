import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { getAudioBase64 } from '@sefinek/google-tts-api';

const CUSTOM_SOUNDS_DIR = path.join(os.homedir(), '.claude-sound', 'sounds');

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
 * Generate TTS audio from text and save to custom sounds directory.
 * Uses Google Translate TTS (free, no API key). Requires network.
 * @param {string} text - Text to speak
 * @param {object} [opts]
 * @param {string} [opts.lang] - Language code (default: 'en')
 * @returns {Promise<{ soundId: string; filePath: string }>}
 */
export async function generateTts(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Text cannot be empty');
  }

  const dir = customSoundsDir();
  await fs.mkdir(dir, { recursive: true });

  const baseSlug = slugify(trimmed);
  const unique = `${baseSlug}-${shortHash(trimmed)}`;
  const filePath = path.join(dir, `${unique}.mp3`);

  const base64 = await getAudioBase64(trimmed, {
    lang: 'en',
    slow: false,
    timeout: 15000
  });

  const buffer = Buffer.from(base64, 'base64');
  await fs.writeFile(filePath, buffer);

  return {
    soundId: `custom/${unique}`,
    filePath
  };
}
