import { execFile } from 'node:child_process';
import { resolveSoundPath } from './sounds.js';

export function playSound(soundId) {
  const file = resolveSoundPath(soundId);
  return new Promise((resolve, reject) => {
    execFile('afplay', [file], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
