import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'TeammateIdle',
  'TaskCompleted',
  'PreCompact',
  'SessionEnd'
];

export function configPathForScope(scope, projectDir) {
  if (scope === 'global') return path.join(os.homedir(), '.claude', 'settings.json');
  if (scope === 'project') return path.join(projectDir, '.claude', 'settings.json');
  if (scope === 'projectLocal') return path.join(projectDir, '.claude', 'settings.local.json');
  throw new Error(`Unknown scope: ${scope}`);
}

export async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return { ok: true, value: JSON.parse(raw) };
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return { ok: true, value: {} };
    }
    return { ok: false, error: err };
  }
}

export async function writeJson(filePath, obj) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const text = JSON.stringify(obj, null, 2) + '\n';
  await fs.writeFile(filePath, text);
}

const MANAGED_TOKEN = '--managed-by claude-sound';

/** Alphanumeric, slash, hyphen, underscore only (e.g. ring1, common/pop, custom/hello-abc123). */
const SAFE_SOUND_ID = /^[a-zA-Z0-9/_-]+$/;

/** Validate event name to prevent command injection. */
function validateEventName(eventName) {
  if (typeof eventName !== 'string' || !HOOK_EVENTS.includes(eventName)) {
    throw new Error(`Invalid event name: ${JSON.stringify(eventName)}`);
  }
}

/** Validate sound id to prevent command injection. */
function validateSoundId(soundId) {
  if (typeof soundId !== 'string' || !SAFE_SOUND_ID.test(soundId) || soundId.length > 120) {
    throw new Error(`Invalid sound id: ${JSON.stringify(soundId)}`);
  }
}

export function isManagedCommand(command) {
  return typeof command === 'string' && command.includes(MANAGED_TOKEN);
}

export function buildManagedCommand({ eventName, soundId }) {
  validateEventName(eventName);
  validateSoundId(soundId);
  // Use --yes to avoid prompts in hook context.
  // Keep args stable so we can parse back.
  return `npx --yes claude-sound@latest play --event ${eventName} --sound ${soundId} ${MANAGED_TOKEN}`;
}

export function extractManagedSoundId(command) {
  const m = /--sound\s+([^\s]+)/.exec(command || '');
  return m ? m[1] : null;
}

export function getExistingManagedMappings(settings) {
  /** @type {Record<string, string>} */
  const map = {};
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== 'object') return map;

  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups) || !HOOK_EVENTS.includes(eventName)) continue;
    for (const g of groups) {
      const handlers = g?.hooks;
      if (!Array.isArray(handlers)) continue;
      for (const h of handlers) {
        const cmd = h?.command;
        if (isManagedCommand(cmd)) {
          const soundId = extractManagedSoundId(cmd);
          if (soundId && SAFE_SOUND_ID.test(soundId) && soundId.length <= 120) {
            map[eventName] = soundId;
          }
        }
      }
    }
  }

  return map;
}

export function applyMappingsToSettings(settings, mappings) {
  const out = { ...(settings || {}) };
  out.hooks = { ...(out.hooks || {}) };

  // First: remove all existing managed handlers.
  for (const [eventName, groups] of Object.entries(out.hooks)) {
    if (!Array.isArray(groups)) continue;

    const newGroups = [];
    for (const g of groups) {
      const handlers = Array.isArray(g?.hooks) ? g.hooks : [];
      const kept = handlers.filter((h) => !isManagedCommand(h?.command));
      if (kept.length > 0) {
        newGroups.push({ ...g, hooks: kept });
      }
    }

    if (newGroups.length > 0) out.hooks[eventName] = newGroups;
    else delete out.hooks[eventName];
  }

  // Then: add current mappings.
  // IMPORTANT: do not clobber other user-defined hook groups for the same event.
  for (const [eventName, soundId] of Object.entries(mappings)) {
    if (!soundId) continue;

    const handler = {
      type: 'command',
      command: buildManagedCommand({ eventName, soundId }),
      async: true,
      timeout: 5
    };

    const group = {
      matcher: '*',
      hooks: [handler]
    };

    const existingGroups = Array.isArray(out.hooks[eventName]) ? out.hooks[eventName] : [];
    out.hooks[eventName] = [...existingGroups, group];
  }

  // Clean up if hooks is now empty
  if (out.hooks && Object.keys(out.hooks).length === 0) {
    delete out.hooks;
  }

  return out;
}
