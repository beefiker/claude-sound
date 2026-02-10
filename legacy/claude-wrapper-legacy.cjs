#!/usr/bin/env node

"use strict";

const { spawn, execFile } = require("child_process");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOUNDS_DIR = "/System/Library/Sounds";

const SOUND_MAP = {
  start: path.join(SOUNDS_DIR, "Glass.aiff"),
  progress: path.join(SOUNDS_DIR, "Tink.aiff"),
  completion: path.join(SOUNDS_DIR, "Hero.aiff"),
  error: path.join(SOUNDS_DIR, "Basso.aiff"),
};

// Minimum interval (ms) between progress sounds to avoid spamming
const PROGRESS_THROTTLE_MS = 2000;

// ---------------------------------------------------------------------------
// Sound player
// ---------------------------------------------------------------------------

/** @type {Map<string, number>} Track last play time per sound category */
const lastPlayedAt = new Map();

/**
 * Play a macOS system sound via afplay. Non-blocking, fire-and-forget.
 * @param {"start" | "progress" | "completion" | "error"} category
 */
function playSound(category) {
  const file = SOUND_MAP[category];
  if (!file) return;

  // Throttle progress sounds
  if (category === "progress") {
    const now = Date.now();
    const last = lastPlayedAt.get("progress") || 0;
    if (now - last < PROGRESS_THROTTLE_MS) return;
    lastPlayedAt.set("progress", now);
  }

  execFile("afplay", [file], (err) => {
    // Silently ignore errors — sound is non-critical
    if (err && process.env.CLAUDE_SOUND_DEBUG) {
      process.stderr.write(`[claude-sound] afplay error: ${err.message}\n`);
    }
  });
}

// ---------------------------------------------------------------------------
// Pattern matchers for Claude Code output
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PatternRule
 * @property {RegExp} pattern
 * @property {"start" | "progress" | "completion" | "error"} sound
 * @property {string} label - human-readable description (for debug)
 */

/** @type {PatternRule[]} */
const RULES = [
  // ── Session / startup ──────────────────────────────────────────────
  { pattern: /^╭─/,                          sound: "start",      label: "session-border" },
  { pattern: /session/i,                     sound: "start",      label: "session-start" },
  { pattern: /claude code/i,                 sound: "start",      label: "claude-code-banner" },
  { pattern: /welcome/i,                     sound: "start",      label: "welcome" },

  // ── File operations (progress) ─────────────────────────────────────
  { pattern: /(?:created?|wrote|updated?|modified|saved)\s+.+\.\w+/i,
                                              sound: "progress",   label: "file-write" },
  { pattern: /(?:reading|read)\s+.+\.\w+/i, sound: "progress",   label: "file-read" },
  { pattern: /(?:deleted?|removed?)\s+.+\.\w+/i,
                                              sound: "progress",   label: "file-delete" },
  { pattern: /\b(?:edit|patch|diff)\b/i,     sound: "progress",   label: "file-edit" },

  // ── Build / install (progress) ─────────────────────────────────────
  { pattern: /(?:npm|pnpm|yarn|bun)\s+(?:install|add|run)/i,
                                              sound: "progress",   label: "pkg-install" },
  { pattern: /build\s+(?:succeeded|successful|complete|passed)/i,
                                              sound: "completion", label: "build-success" },
  { pattern: /compiled?\s+successfully/i,    sound: "completion", label: "compile-success" },
  { pattern: /tests?\s+passed/i,             sound: "completion", label: "tests-passed" },

  // ── Tool usage (progress) ──────────────────────────────────────────
  { pattern: /⏺/,                            sound: "progress",   label: "tool-marker" },
  { pattern: /\btool\b.*\b(?:run|exec|call)/i,
                                              sound: "progress",   label: "tool-run" },

  // ── Errors ─────────────────────────────────────────────────────────
  { pattern: /\berror\b/i,                   sound: "error",      label: "error" },
  { pattern: /\bfailed\b/i,                  sound: "error",      label: "failed" },
  { pattern: /\bfailure\b/i,                 sound: "error",      label: "failure" },
  { pattern: /\bERROR\b/,                    sound: "error",      label: "ERROR-caps" },
  { pattern: /\btraceback\b/i,              sound: "error",      label: "traceback" },
  { pattern: /\bpanic\b/i,                  sound: "error",      label: "panic" },
  { pattern: /\bexception\b/i,              sound: "error",      label: "exception" },

  // ── Completion ─────────────────────────────────────────────────────
  { pattern: /\b(?:done|finished|completed?)\b/i,
                                              sound: "completion", label: "done" },
  { pattern: /╰─/,                           sound: "completion", label: "session-end-border" },
];

// De-duplicate: only fire once per category per chunk of output
const recentFired = new Set();
let recentTimer = null;

/**
 * Scan a line of output and play the first matching sound.
 * Priority: error > completion > progress > start
 * @param {string} line
 */
function matchLine(line) {
  /** @type {string | null} */
  let bestSound = null;
  let bestLabel = "";

  const priority = { error: 4, completion: 3, start: 2, progress: 1 };

  for (const rule of RULES) {
    if (rule.pattern.test(line)) {
      const p = priority[rule.sound] || 0;
      if (!bestSound || p > (priority[bestSound] || 0)) {
        bestSound = rule.sound;
        bestLabel = rule.label;
      }
    }
  }

  if (bestSound && !recentFired.has(bestSound)) {
    recentFired.add(bestSound);

    if (process.env.CLAUDE_SOUND_DEBUG) {
      process.stderr.write(
        `[claude-sound] 🔊 ${bestSound} (${bestLabel}): ${line.slice(0, 80)}\n`
      );
    }

    playSound(bestSound);

    // Clear recent set after a short window to allow re-firing
    if (recentTimer) clearTimeout(recentTimer);
    recentTimer = setTimeout(() => recentFired.clear(), 500);
  }
}

/**
 * Process a chunk of output, splitting into lines and matching each.
 * @param {Buffer | string} chunk
 */
function processChunk(chunk) {
  const text = chunk.toString("utf-8");
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length > 0) {
      matchLine(line);
    }
  }
}

// ---------------------------------------------------------------------------
// Resolve the real `claude` binary (skip ourselves if we shadow it on PATH)
// ---------------------------------------------------------------------------

/**
 * Find the real claude binary, excluding our own bin.
 * @returns {string}
 */
function resolveClaudeBinary() {
  // If the user explicitly passes --claude-bin, use that
  const binFlagIdx = process.argv.indexOf("--claude-bin");
  if (binFlagIdx !== -1 && process.argv[binFlagIdx + 1]) {
    const explicit = process.argv[binFlagIdx + 1];
    // Remove our flags before passing to claude
    process.argv.splice(binFlagIdx, 2);
    return explicit;
  }

  // Otherwise, try common locations
  const candidates = [
    "/Users/robster/.local/bin/claude", // local install
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];

  const fs = require("fs");
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // not found, try next
    }
  }

  // Fallback: hope PATH resolves it (works if we're not shadowing)
  return "claude";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const claudeBin = resolveClaudeBinary();
  const args = process.argv.slice(2);

  // Handle --help for our wrapper
  if (args.includes("--cs-help")) {
    process.stdout.write(`
claude-sound — Audio feedback wrapper for Claude Code

Usage:
  claude-sound [claude-args...]       Run Claude Code with sound effects
  claude-sound --cs-help              Show this help
  claude-sound --cs-mute              Run without sounds (passthrough only)
  claude-sound --claude-bin <path>    Specify path to claude binary

Environment:
  CLAUDE_SOUND_DEBUG=1                Print sound trigger debug info to stderr
  CLAUDE_SOUND_MUTE=1                 Disable all sounds

Sounds (macOS system sounds):
  Start       Glass.aiff    — Session begins
  Progress    Tink.aiff     — File changes, tool use
  Completion  Hero.aiff     — Task done, build success
  Error       Basso.aiff    — Errors, failures

`);
    process.exit(0);
  }

  const isMuted =
    args.includes("--cs-mute") || process.env.CLAUDE_SOUND_MUTE === "1";

  // Strip our flags before passing to claude
  const claudeArgs = args.filter(
    (a) => a !== "--cs-mute" && a !== "--cs-help"
  );

  // Play start sound
  if (!isMuted) {
    playSound("start");
  }

  // Spawn claude with inherited stdio for full interactivity, but we need
  // to intercept output. Use pipe for stdout/stderr, inherit stdin.
  const child = spawn(claudeBin, claudeArgs, {
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Pipe stdout through, scanning for patterns
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (!isMuted) {
      processChunk(chunk);
    }
  });

  // Pipe stderr through, scanning for patterns
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    if (!isMuted) {
      processChunk(chunk);
    }
  });

  // On exit, play completion or error sound
  child.on("close", (code) => {
    if (!isMuted) {
      if (code === 0) {
        playSound("completion");
        // Give afplay a moment to finish before we exit
        setTimeout(() => process.exit(code), 800);
        return;
      } else {
        playSound("error");
        setTimeout(() => process.exit(code || 1), 800);
        return;
      }
    }
    process.exit(code || 0);
  });

  child.on("error", (err) => {
    process.stderr.write(
      `[claude-sound] Failed to start claude: ${err.message}\n`
    );
    process.stderr.write(
      `[claude-sound] Make sure 'claude' is installed and on your PATH,\n` +
        `               or use --claude-bin <path> to specify its location.\n`
    );
    if (!isMuted) playSound("error");
    setTimeout(() => process.exit(1), 800);
  });

  // Forward signals to the child
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
}

main();
