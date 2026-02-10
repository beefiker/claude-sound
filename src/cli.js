#!/usr/bin/env node

import { intro, outro, select, isCancel, cancel, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import process from 'node:process';
import fs from 'node:fs/promises';
import { playSound } from './play.js';
import { listSounds, listSoundsGrouped, ensureSoundsLoaded } from './sounds.js';
import { selectWithSoundPreview } from './select-with-preview.js';
import {
  HOOK_EVENTS,
  configPathForScope,
  readJsonIfExists,
  writeJson,
  getExistingManagedMappings,
  applyMappingsToSettings
} from './hooks.js';

function usage(exitCode = 0) {
  process.stdout.write(`\
claude-sound (macOS)\n\nUsage:\n  npx claude-sound@latest                Interactive hook sound setup\n  claude-sound                          Interactive hook sound setup\n\n  claude-sound play --sound <id>         Play a bundled sound (uses afplay)\n  claude-sound list-sounds              List bundled sound ids\n  claude-sound list-events              List Claude hook event names\n\nOptions:\n  -h, --help                             Show help\n\nExamples:\n  npx claude-sound@latest\n  npx claude-sound@latest play --sound ring1\n`);
  process.exit(exitCode);
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

/**
 * Build flat select options with group headers from grouped sounds.
 * @param {Record<string, string[]>} grouped
 * @returns {Array<{ value: string; label: string; disabled?: boolean }>}
 */
function buildGroupedSoundOptions(grouped) {
  const options = [];
  const groups = [
    ['Common', 'common'],
    ['Game', 'game'],
    ['Ring', 'ring']
  ];
  for (const [label, key] of groups) {
    const ids = grouped[key];
    if (!ids?.length) continue;
    options.push({ value: `__group_${key}__`, label: pc.bold(label), disabled: true });
    for (const id of ids) {
      const shortName = id.includes('/') ? id.split('/')[1] : id;
      options.push({ value: id, label: `  ${shortName}` });
    }
  }
  return options;
}

async function cmdPlay() {
  const soundId = parseArg('--sound');
  if (!soundId) {
    process.stderr.write('Missing --sound <id>\n');
    process.exit(1);
  }

  await ensureSoundsLoaded();

  try {
    await playSound(soundId);
  } catch (err) {
    process.stderr.write(`Failed to play sound '${soundId}': ${err?.message || err}\n`);
    process.exit(1);
  }
}

async function cmdListSounds() {
  const sounds = await listSounds();
  for (const s of sounds) process.stdout.write(s + '\n');
}

async function cmdListEvents() {
  for (const e of HOOK_EVENTS) process.stdout.write(e + '\n');
}

async function interactiveSetup() {
  intro('claude-sound');

  const scope = await select({
    message: 'Where do you want to write Claude Code hook settings?',
    options: [
      { value: 'project', label: 'Project (shared): .claude/settings.json' },
      { value: 'projectLocal', label: 'Project (local): .claude/settings.local.json (gitignored)' },
      { value: 'global', label: 'Global: ~/.claude/settings.json' }
    ]
  });

  if (isCancel(scope)) {
    cancel('Cancelled');
    process.exit(0);
  }

  const projectDir = process.cwd();
  const settingsPath = configPathForScope(scope, projectDir);

  const existingRes = await readJsonIfExists(settingsPath);
  if (!existingRes.ok) {
    cancel(`Could not read/parse JSON at ${settingsPath}`);
    note(String(existingRes.error?.message || existingRes.error), 'Error');
    process.exit(1);
  }

  let settings = existingRes.value;

  // Load existing mappings we previously wrote.
  /** @type {Record<string, string>} */
  let mappings = getExistingManagedMappings(settings);

  const soundsGrouped = await listSoundsGrouped();

  // main loop
  while (true) {
    const options = HOOK_EVENTS.map((eventName) => {
      const soundId = mappings[eventName];
      const enabled = Boolean(soundId);
      return {
        value: eventName,
        label: `${eventName}${soundId ? `  ${pc.dim('→')}  ${pc.cyan(soundId)}` : ''}`
      };
    });

    options.push({ value: '__apply__', label: 'Apply (write settings)' });
    options.push({ value: '__remove_all__', label: 'Remove all claude-sound hooks' });
    options.push({ value: '__exit__', label: 'Exit (no changes)' });

    const choice = await select({
      message: `Configure hook sounds (${settingsPath})`,
      options
    });

    if (isCancel(choice) || choice === '__exit__') {
      cancel('No changes written');
      process.exit(0);
    }

    if (choice === '__remove_all__') {
      mappings = {};
      note('All claude-sound mappings cleared (not written yet). Choose Apply to save.', 'Cleared');
      continue;
    }

    if (choice === '__apply__') {
      const s = spinner();
      s.start('Writing settings...');
      settings = applyMappingsToSettings(settings, mappings);
      await writeJson(settingsPath, settings);
      s.stop('Done');
      outro(`Saved hooks to ${settingsPath}`);
      return;
    }

    const eventName = choice;

    const action = await select({
      message: `Event: ${eventName}  ${pc.dim('(ESC to back)')}`,
      options: [
        { value: 'enable', label: mappings[eventName] ? 'Change sound' : 'Enable & choose sound' },
        { value: 'disable', label: 'Disable (remove mapping)' },
        { value: 'back', label: 'Back' }
      ]
    });

    if (isCancel(action) || action === 'back') continue;

    if (action === 'disable') {
      delete mappings[eventName];
      continue;
    }

    const soundOptions = buildGroupedSoundOptions(soundsGrouped);

    const soundId = await selectWithSoundPreview({
      message: `Pick a sound for ${eventName} (↑/↓ preview)  ${pc.dim('(ESC to back)')}`,
      options: soundOptions
    });

    if (isCancel(soundId)) continue;
    if (typeof soundId === 'string' && soundId.startsWith('__group_')) continue;

    mappings[eventName] = soundId;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) usage(0);

  const cmd = args[0];

  if (!cmd) {
    await interactiveSetup();
    return;
  }

  if (cmd === 'play') {
    await cmdPlay();
    return;
  }

  if (cmd === 'list-sounds') {
    await cmdListSounds();
    return;
  }

  if (cmd === 'list-events') {
    await cmdListEvents();
    return;
  }

  process.stderr.write(`Unknown command: ${cmd}\n`);
  usage(1);
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + '\n');
  process.exit(1);
});
