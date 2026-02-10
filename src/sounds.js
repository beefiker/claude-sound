import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customSoundsDir } from './tts.js';

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
 * Clear the sound path cache. Call after adding custom sounds.
 * @returns {void}
 */
export function invalidateSoundCache() {
  _soundPathCache = null;
}

/**
 * Build a map of sound id -> absolute file path.
 * Discovers sounds from manifest.json, subdirs (common/, game/), and custom TTS sounds.
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

  // From custom TTS sounds (~/.claude-sound/sounds/)
  const customDir = customSoundsDir();
  try {
    const entries = await fs.readdir(customDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && (e.name.endsWith('.mp3') || e.name.endsWith('.wav'))) {
        const id = `custom/${path.basename(e.name, path.extname(e.name))}`;
        map[id] = path.join(customDir, e.name);
      }
    }
  } catch {
    // dir missing or not readable
  }

  _soundPathCache = map;
  return map;
}

/**
 * @typedef {Record<string, string[]>} GroupedSounds
 * @typedef {Record<string, string>} SoundLabels
 */

/**
 * Parse order entry: string "id" or object { id, label }.
 * @param {string|{id:string,label?:string}} entry
 * @returns {{ id: string, label?: string }}
 */
function parseOrderEntry(entry) {
  if (typeof entry === 'string') return { id: entry };
  if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
    return { id: entry.id, label: typeof entry.label === 'string' ? entry.label : undefined };
  }
  return { id: '' };
}

/**
 * Apply custom order and labels from order.json if present.
 * order.json format: { "common": ["id1", { "id": "id2", "label": "My Label" }], ... }
 * Use full IDs. Unlisted sounds append at end. Add label for custom display names.
 * @param {GroupedSounds} grouped
 * @param {SoundLabels} labels
 * @param {string} base
 * @returns {Promise<void>}
 */
async function applyCustomOrder(grouped, labels, base) {
  const orderPath = path.join(base, 'order.json');
  let order;
  try {
    const raw = await fs.readFile(orderPath, 'utf-8');
    order = JSON.parse(raw);
  } catch {
    return;
  }
  if (!order || typeof order !== 'object') return;

  for (const key of ['common', 'game', 'ring', 'custom']) {
    const ids = grouped[key];
    if (!ids?.length) continue;
    const ordered = order[key];
    if (!Array.isArray(ordered)) continue;

    const idSet = new Set(ids);
    const result = [];
    for (const entry of ordered) {
      const { id, label } = parseOrderEntry(entry);
      if (!id) continue;
      if (idSet.has(id)) {
        result.push(id);
        idSet.delete(id);
        if (label) labels[id] = label;
      }
    }
    result.push(...idSet);
    grouped[key] = result;
  }
}

/**
 * @typedef {{ grouped: GroupedSounds; labels: SoundLabels }} GroupedSoundsResult
 */

/**
 * List sounds grouped by category (common, game, ring).
 * Uses order.json if present for custom ordering and labels.
 * @returns {Promise<GroupedSoundsResult>}
 */
export async function listSoundsGrouped() {
  const map = await buildSoundPathMap();
  const base = soundsDir();
  const grouped = /** @type {GroupedSounds} */ ({
    common: [],
    game: [],
    ring: [],
    custom: []
  });
  const labels = /** @type {SoundLabels} */ ({});

  for (const id of Object.keys(map)) {
    if (id.startsWith('common/')) grouped.common.push(id);
    else if (id.startsWith('game/')) grouped.game.push(id);
    else if (id.startsWith('custom/')) grouped.custom.push(id);
    else grouped.ring.push(id);
  }

  grouped.ring.sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });
  grouped.common.sort();
  grouped.game.sort();

  await applyCustomOrder(grouped, labels, base);

  return { grouped, labels };
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
