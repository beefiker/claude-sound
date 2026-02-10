import { execFile, spawn } from 'node:child_process';
import { resolveSoundPath } from './sounds.js';

/**
 * Play a sound and wait for it to finish.
 * @param {string} soundId
 * @returns {Promise<void>}
 */
export function playSound(soundId) {
  const file = resolveSoundPath(soundId);
  return new Promise((resolve, reject) => {
    execFile('afplay', [file], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** @type {import('node:child_process').ChildProcess | null} */
let _previewProcess = null;

/**
 * Play a sound preview, killing any previously playing preview.
 * Non-blocking — does not wait for playback to finish.
 * @param {string} soundId
 * @returns {void}
 */
export function playSoundPreview(soundId) {
  stopPreview();
  const file = resolveSoundPath(soundId);
  const proc = spawn('afplay', [file], {
    detached: true,
    stdio: 'ignore'
  });
  _previewProcess = proc;
  proc.on('exit', () => {
    if (_previewProcess === proc) _previewProcess = null;
  });
  proc.unref();
}

/**
 * Stop any currently playing preview sound.
 * @returns {void}
 */
export function stopPreview() {
  if (_previewProcess) {
    try {
      const pid = _previewProcess.pid;
      if (pid != null && process.platform !== 'win32') {
        process.kill(-pid, 'SIGKILL');
      } else {
        _previewProcess.kill('SIGKILL');
      }
    } catch {
      // Process may already be dead
    }
    _previewProcess = null;
  }
}
