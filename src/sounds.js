import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function soundsDir() {
  return path.resolve(__dirname, '..', 'assets', 'sounds');
}

export async function listSounds() {
  const manifestPath = path.join(soundsDir(), 'manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf-8');
  /** @type {{id:string,file:string}[]} */
  const items = JSON.parse(raw);
  return items.map((it) => it.id);
}

export function resolveSoundPath(soundId) {
  return path.join(soundsDir(), `${soundId}.wav`);
}
