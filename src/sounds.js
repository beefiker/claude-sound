import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function soundsDir() {
  return path.resolve(__dirname, '..', 'assets', 'sounds');
}

/**
 * @typedef {Record<string, string>} SoundPathMap
 */

/** @type {SoundPathMap | null} */
let _soundPathCache = null;

/**
 * Build a map of sound id -> absolute file path.
 * Discovers sounds from manifest.json and subdirs (common/, game/).
 * @returns {Promise<SoundPathMap>}
 */
async function buildSoundPathMap() {
  if (_soundPathCache) return _soundPathCache;

  const base = soundsDir();
  const map = /** @type {SoundPathMap} */ ({});

  // From manifest (ring1..ring10)
  const manifestPath = path.join(base, 'manifest.json');
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    /** @type {{id:string,file:string}[]} */
    const items = JSON.parse(raw);
    for (const it of items) {
      map[it.id] = path.join(base, path.basename(it.file));
    }
  } catch {
    // manifest missing or invalid
  }

  // From subdirs: common/, game/
  const subdirs = ['common', 'game'];
  for (const subdir of subdirs) {
    const dir = path.join(base, subdir);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && (e.name.endsWith('.mp3') || e.name.endsWith('.wav'))) {
          const id = path.join(subdir, path.basename(e.name, path.extname(e.name)));
          map[id] = path.join(dir, e.name);
        }
      }
    } catch {
      // dir missing or not readable
    }
  }

  _soundPathCache = map;
  return map;
}

/**
 * @typedef {Record<string, string[]>} GroupedSounds
 */

/**
 * List sounds grouped by category (common, game, ring).
 * @returns {Promise<GroupedSounds>}
 */
export async function listSoundsGrouped() {
  const map = await buildSoundPathMap();
  const grouped = /** @type {GroupedSounds} */ ({
    common: [],
    game: [],
    ring: []
  });

  for (const id of Object.keys(map)) {
    if (id.startsWith('common/')) grouped.common.push(id);
    else if (id.startsWith('game/')) grouped.game.push(id);
    else grouped.ring.push(id);
  }

  grouped.ring.sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });
  grouped.common.sort();
  grouped.game.sort();

  return grouped;
}

/**
 * List all sound IDs (flat).
 * @returns {Promise<string[]>}
 */
export async function listSounds() {
  const map = await buildSoundPathMap();
  return Object.keys(map);
}

/**
 * Resolve sound id to absolute file path.
 * Requires cache to be built first (call listSounds() or listSoundsGrouped()).
 * @param {string} soundId
 * @returns {string}
 */
export function resolveSoundPath(soundId) {
  if (!_soundPathCache) {
    throw new Error('Sounds not loaded. Call listSounds() or listSoundsGrouped() first.');
  }
  const p = _soundPathCache[soundId];
  if (!p) throw new Error(`Unknown sound: ${soundId}`);
  return p;
}

/**
 * Initialize sound cache. Call before resolveSoundPath if lists weren't called.
 * @returns {Promise<void>}
 */
export async function ensureSoundsLoaded() {
  await buildSoundPathMap();
}
