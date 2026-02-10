import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { customSoundsDir } from './tts.js';

/** Allowed extensions for import (lowercase). */
const ALLOWED_EXT = ['.mp3', '.wav'];

/** Max file size in bytes (5MB) to prevent DoS. */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Create a filesystem-safe slug from a filename (without extension). */
function slugifyFilename(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'imported';
}

/** Short hash for uniqueness. */
function shortHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

/**
 * Resolve and validate source path for import.
 * @param {string} inputPath - User-provided path (relative or absolute)
 * @returns {Promise<{ resolvedPath: string; ext: string; baseName: string }>}
 */
async function validateSourcePath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('Path cannot be empty');
  }

  const trimmed = inputPath.trim();

  // Resolve: expand ~ to homedir
  const expanded = trimmed.startsWith('~')
    ? path.join(os.homedir(), trimmed.slice(1))
    : path.resolve(process.cwd(), trimmed);

  const resolvedPath = path.normalize(expanded);

  // Reject paths containing null bytes
  if (resolvedPath.includes('\0')) {
    throw new Error('Invalid path');
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new Error(`Only .mp3 and .wav files are supported, got ${ext || '(no extension)'}`);
  }

  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile()) {
    throw new Error('Path must be a file, not a directory');
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  if (stat.size === 0) {
    throw new Error('File is empty');
  }

  const baseName = path.basename(resolvedPath, ext);
  return { resolvedPath, ext, baseName };
}

/**
 * Import an audio file into custom sounds directory.
 * Performs validation to prevent path traversal and DoS.
 *
 * @param {string} sourcePath - Path to MP3 or WAV file (relative or absolute)
 * @returns {Promise<{ soundId: string; filePath: string }>}
 */
export async function importSound(sourcePath) {
  const { resolvedPath, ext, baseName } = await validateSourcePath(sourcePath);

  const dir = customSoundsDir();
  await fs.mkdir(dir, { recursive: true });

  const baseSlug = slugifyFilename(baseName).slice(0, 40);
  let destName = `${baseSlug}${ext}`;
  let destPath = path.join(dir, destName);

  // Avoid overwriting: add hash suffix if file exists
  let attempt = 0;
  while (true) {
    try {
      await fs.access(destPath);
      const suffix = shortHash(resolvedPath + String(attempt));
      destName = `${baseSlug}-${suffix}${ext}`;
      destPath = path.join(dir, destName);
      attempt++;
    } catch {
      break;
    }
  }

  // Copy file (read + write to avoid symlink issues on destination)
  const buffer = await fs.readFile(resolvedPath);
  await fs.writeFile(destPath, buffer);

  const soundId = `custom/${path.basename(destName, ext)}`;
  return { soundId, filePath: destPath };
}
