#!/usr/bin/env node

import { intro, outro, select, text, isCancel, cancel, note, spinner } from '@clack/prompts';
import pc from 'picocolors';
import process from 'node:process';
import fs from 'node:fs/promises';
import { playSound } from './play.js';
import { listSounds, listSoundsGrouped, ensureSoundsLoaded, invalidateSoundCache } from './sounds.js';
import { generateTts } from './tts.js';
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
claude-sound (macOS, Windows, Linux)\n\nUsage:\n  npx claude-sound@latest                Interactive hook sound setup\n  claude-sound                          Interactive hook sound setup\n\n  claude-sound play --sound <id>         Play a bundled sound\n  claude-sound list-sounds              List bundled sound ids\n  claude-sound list-events              List Claude hook event names\n\nOptions:\n  -h, --help                             Show help\n\nExamples:\n  npx claude-sound@latest\n  npx claude-sound@latest play --sound ring1\n`);
  process.exit(exitCode);
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const SOUND_GROUPS = [
  { value: 'common', label: 'Common' },
  { value: 'game', label: 'Game' },
  { value: 'ring', label: 'Ring' },
  { value: 'custom', label: 'Custom (TTS)' },
  { value: '__create__', label: 'Create my own (text-to-speech)' }
];

/**
 * Get display string for a sound: "Group / label" for grouped sounds, "label" for ring.
 * @param {string} soundId
 * @param {Record<string, string>} labels
 * @returns {string}
 */
function formatSoundDisplay(soundId, labels) {
  const displayName = labels[soundId] ?? (soundId.includes('/') ? soundId.split('/')[1] : soundId);
  const group = SOUND_GROUPS.find(
    (g) =>
      (g.value !== '__create__' && soundId.startsWith(g.value + '/')) ||
      (g.value === 'ring' && !soundId.includes('/'))
  );
  return group ? `${group.label} / ${displayName}` : displayName;
}

/**
 * Build options for a single sound group.
 * @param {string[]} ids
 * @param {Record<string, string>} labels
 * @returns {Array<{ value: string; label: string }>}
 */
function buildSoundOptionsForGroup(ids, labels) {
  return ids.map((id) => {
    const displayName = labels[id] ?? (id.includes('/') ? id.split('/')[1] : id);
    return { value: id, label: displayName };
  });
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

  // When editing project scope, load inherited mappings and their source.
  /** @type {Record<string, string>} */
  let inheritedMappings = {};
  /** @type {Record<string, 'global' | 'project'>} */
  let inheritedFrom = {};
  if (scope === 'project' || scope === 'projectLocal') {
    const globalPath = configPathForScope('global', projectDir);
    const globalRes = await readJsonIfExists(globalPath);
    if (globalRes.ok) {
      const global = getExistingManagedMappings(globalRes.value);
      for (const [ev, id] of Object.entries(global)) {
        inheritedMappings[ev] = id;
        inheritedFrom[ev] = 'global';
      }
    }
    if (scope === 'projectLocal') {
      const projectPath = configPathForScope('project', projectDir);
      const projectRes = await readJsonIfExists(projectPath);
      if (projectRes.ok) {
        const project = getExistingManagedMappings(projectRes.value);
        for (const [ev, id] of Object.entries(project)) {
          inheritedMappings[ev] = id;
          inheritedFrom[ev] = 'project';
        }
      }
    }
    if (Object.keys(inheritedMappings).length > 0) {
      note(
        'Events marked "(from global)" or "(from project)" use parent settings. Configure here to override.',
        'Info'
      );
    }
  }

  const { grouped: soundsGrouped, labels: soundLabels } = await listSoundsGrouped();

  // main loop
  while (true) {
    const options = HOOK_EVENTS.map((eventName) => {
      const soundId = mappings[eventName];
      const inheritedSoundId = inheritedMappings[eventName];
      const source = inheritedFrom[eventName];
      const displayName = soundId ? formatSoundDisplay(soundId, soundLabels) : '';
      const inheritedDisplay = inheritedSoundId
        ? formatSoundDisplay(inheritedSoundId, soundLabels)
        : '';

      let label = eventName;
      if (soundId) {
        label += `  ${pc.dim('→')}  ${pc.cyan(displayName)}`;
      } else if (inheritedSoundId) {
        const fromLabel = source === 'project' ? '(from project)' : '(from global)';
        label += `  ${pc.dim('→')}  ${pc.gray(inheritedDisplay)}  ${pc.dim(fromLabel)}`;
      }
      return { value: eventName, label };
    });

    options.push({ value: '__apply__', label: 'Apply (write settings)' });
    options.push({ value: '__remove_all__', label: 'Remove all claude-sound hooks' });
    options.push({ value: '__exit__', label: 'Exit (no changes)' });

    const choice = await select({
      message: `Configure hook sounds (${settingsPath})${Object.keys(inheritedMappings).length > 0 ? `  ${pc.dim('· Gray = inherited')}` : ''}`,
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

    const categoryOptions = SOUND_GROUPS.filter(
      (g) => g.value === '__create__' || (soundsGrouped[g.value]?.length ?? 0) > 0
    );

    while (true) {
      const category = await select({
        message: `Pick a category for ${eventName}  ${pc.dim('(ESC to back)')}`,
        options: categoryOptions
      });

      if (isCancel(category)) break;

      if (category === '__create__') {
        const textInput = await text({
          message: 'Enter text to speak (e.g. "Claude is ready!")',
          placeholder: 'Claude is ready!',
          validate: (v) => {
            if (!v?.trim()) return 'Text cannot be empty';
            if (v.length > 200) return 'Keep it under 200 characters';
            return undefined;
          }
        });

        if (isCancel(textInput)) continue;

        const s = spinner();
        s.start('Generating speech...');
        try {
          const { soundId: newSoundId } = await generateTts(textInput);
          invalidateSoundCache();
          const refreshed = await listSoundsGrouped();
          soundsGrouped.custom = refreshed.grouped.custom;
          soundLabels[newSoundId] = refreshed.labels[newSoundId] ?? textInput.trim().slice(0, 30);
          s.stop('Done');
          mappings[eventName] = newSoundId;
          note(`Created and selected: ${newSoundId}`, 'Created');
          break;
        } catch (err) {
          s.stop('Failed');
          note(String(err?.message ?? err), 'Error');
          continue;
        }
      }

      const ids = soundsGrouped[category] ?? [];
      const soundOptions = buildSoundOptionsForGroup(ids, soundLabels);

      const soundId = await selectWithSoundPreview({
        message: `Pick a sound for ${eventName} (↑/↓ preview)  ${pc.dim('(ESC to back)')}`,
        options: soundOptions
      });

      if (isCancel(soundId)) continue;

      mappings[eventName] = soundId;
      break;
    }
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
