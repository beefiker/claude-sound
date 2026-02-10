import { execFile, execFileSync, spawn } from 'node:child_process';
import { platform } from 'node:os';
import { resolveSoundPath } from './sounds.js';

/**
 * Player config: { name, check, args }
 * - name: executable name
 * - check: sync function to verify availability (returns boolean)
 * - args: (filePath) => string[] - args to pass to the executable
 */

/**
 * Check if an executable exists in PATH.
 * Uses command -v (POSIX) on Unix, where.exe on Windows.
 */
function findExecutable(name) {
  try {
    if (platform() === 'win32') {
      execFileSync('where.exe', [name], { stdio: 'pipe', windowsHide: true });
    } else {
      execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'pipe' });
    }
    return true;
  } catch {
    return false;
  }
}

/** @type {Array<{ name: string; check: () => boolean; args: (f: string) => string[] }>} */
const PLAYERS = [
  {
    name: 'afplay',
    check: () => platform() === 'darwin' && findExecutable('afplay'),
    args: (f) => [f]
  },
  {
    name: 'ffplay',
    check: () => findExecutable('ffplay'),
    args: (f) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', f]
  },
  {
    name: 'mpv',
    check: () => findExecutable('mpv'),
    args: (f) => ['--no-video', '--really-quiet', f]
  },
  {
    name: 'mpg123',
    check: () => findExecutable('mpg123'),
    args: (f) => ['-q', f]
  },
  {
    name: 'mpg321',
    check: () => findExecutable('mpg321'),
    args: (f) => ['-q', f]
  },
  {
    name: 'mplayer',
    check: () => findExecutable('mplayer'),
    args: (f) => ['-really-quiet', '-vo', 'null', f]
  },
  {
    name: 'aplay',
    check: () => findExecutable('aplay'),
    args: (f) => ['-q', f]
  },
  {
    name: 'paplay',
    check: () => findExecutable('paplay'),
    args: (f) => [f]
  },
  {
    name: 'cvlc',
    check: () => findExecutable('cvlc'),
    args: (f) => ['--play-and-exit', '-q', f]
  },
  {
    name: 'powershell.exe',
    check: () => platform() === 'win32',
    args: (f) => {
      const escaped = f.replace(/'/g, "''");
      return [
        '-NoProfile',
        '-Command',
        `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`
      ];
    }
  }
];

/** @type {{ name: string; args: (f: string) => string[] } | null} */
let _resolvedPlayer = null;

/**
 * @returns {{ name: string; args: (f: string) => string[] }}
 * @throws {Error}
 */
function getPlayer() {
  if (_resolvedPlayer) return _resolvedPlayer;

  for (const p of PLAYERS) {
    if (p.check()) {
      _resolvedPlayer = { name: p.name, args: p.args };
      return _resolvedPlayer;
    }
  }

  throw new Error(
    'No audio player found. On Windows/Linux, install ffmpeg (ffplay) or mpv.'
  );
}

/**
 * Play a sound and wait for it to finish.
 * @param {string} soundId
 * @returns {Promise<void>}
 */
export function playSound(soundId) {
  const file = resolveSoundPath(soundId);
  const { name, args } = getPlayer();
  return new Promise((resolve, reject) => {
    execFile(name, args(file), { windowsHide: true }, (err) => {
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
  const { name, args } = getPlayer();

  const proc = spawn(name, args(file), {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  _previewProcess = proc;
  proc.on('error', () => {
    if (_previewProcess === proc) _previewProcess = null;
  });
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
      if (pid != null && platform() !== 'win32') {
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
