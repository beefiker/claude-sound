import { SelectPrompt } from '@clack/core';
import {
  S_BAR,
  S_BAR_END,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
  symbolBar,
  limitOptions
} from '@clack/prompts';
import { wrapTextWithPrefix } from '@clack/core';
import pc from 'picocolors';
import { playSoundPreview, stopPreview } from './play.js';

/**
 * A select prompt that plays a sound preview when the user navigates
 * through options using keyboard up/down arrows.
 *
 * @template TValue
 * @param {{
 *   message: string;
 *   options: Array<{ value: TValue; label?: string; hint?: string; disabled?: boolean }>;
 *   initialValue?: TValue;
 *   maxItems?: number;
 *   output?: import('node:stream').Writable;
 *   input?: import('node:stream').Readable;
 *   signal?: AbortSignal;
 * }} opts
 * @returns {Promise<TValue | symbol>}
 */
export function selectWithSoundPreview(opts) {
  const styleOption = (option, state) => {
    const label = option.label ?? String(option.value);
    switch (state) {
      case 'disabled':
        return `${pc.gray(S_RADIO_INACTIVE)} ${pc.gray(label)}${option.hint ? ` ${pc.dim(`(${option.hint ?? 'disabled'})`)}` : ''}`;
      case 'selected':
        return `${pc.dim(label)}`;
      case 'active':
        return `${pc.green(S_RADIO_ACTIVE)} ${label}${option.hint ? ` ${pc.dim(`(${option.hint})`)}` : ''}`;
      case 'cancelled':
        return `${pc.strikethrough(pc.dim(label))}`;
      default:
        return `${pc.dim(S_RADIO_INACTIVE)} ${pc.dim(label)}`;
    }
  };

  let previousCursor = -1;

  const prompt = new SelectPrompt({
    options: opts.options,
    signal: opts.signal,
    input: opts.input,
    output: opts.output,
    initialValue: opts.initialValue,
    render() {
      const startPrefix = `${symbol(this.state)}  `;
      const barPrefix = `${symbolBar(this.state)}  `;
      const title = wrapTextWithPrefix(opts.output, opts.message, barPrefix, startPrefix);
      const header = `${pc.gray(S_BAR)}\n${title}\n`;

      switch (this.state) {
        case 'submit': {
          stopPreview();
          const prefix = `${pc.gray(S_BAR)}  `;
          const selected = wrapTextWithPrefix(
            opts.output,
            styleOption(this.options[this.cursor], 'selected'),
            prefix
          );
          return `${header}${selected}`;
        }
        case 'cancel': {
          stopPreview();
          const prefix = `${pc.gray(S_BAR)}  `;
          const cancelled = wrapTextWithPrefix(
            opts.output,
            styleOption(this.options[this.cursor], 'cancelled'),
            prefix
          );
          return `${header}${cancelled}\n${pc.gray(S_BAR)}`;
        }
        default: {
          // Play sound preview when cursor changes
          if (this.cursor !== previousCursor) {
            previousCursor = this.cursor;
            const currentOption = this.options[this.cursor];
            if (currentOption && !currentOption.disabled) {
              playSoundPreview(String(currentOption.value));
            }
          }

          const barLine = `${pc.cyan(S_BAR)}  `;
          const headerLineCount = header.split('\n').length;
          const items = limitOptions({
            output: opts.output,
            cursor: this.cursor,
            options: this.options,
            maxItems: opts.maxItems,
            columnPadding: barLine.length,
            rowPadding: headerLineCount + 2,
            style: (option, active) =>
              styleOption(option, option.disabled ? 'disabled' : active ? 'active' : 'inactive')
          });
          return `${header}${barLine}${items.join(`\n${barLine}`)}\n${pc.cyan(S_BAR_END)}\n`;
        }
      }
    }
  });

  return prompt.prompt();
}
