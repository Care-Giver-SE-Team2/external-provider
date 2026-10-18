// A tagged template that escapes every value unless it is already HTML from another `html` call.

import type { BadgeColour } from './types.js';

export class Html {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  toString(): string {
    return this.text;
  }
}

/** What a template may hold. `false`, `null` and `undefined` render nothing, so `cond && html`…`` works. */
export type Value = Html | string | number | boolean | null | undefined | readonly Value[];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(v: Value): string {
  if (v == null || v === false) return '';
  if (v instanceof Html) return v.text;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Html(out);
}

// Shared pieces used by more than one page.

const BADGE_LABELS: Record<BadgeColour, string> = {
  new: 'New',
  accepted: 'Accepted',
  completed: 'Completed',
  cancelled: 'Cancelled',
  declined: 'Declined',
  pending: 'Pending review',
};

export const badge = (
  colour: BadgeColour,
  label: string = BADGE_LABELS[colour],
  { dot = false, small = false }: { dot?: boolean; small?: boolean } = {},
): Html =>
  html`<span class="badge st-${colour}${small ? ' sm' : ''}">${dot && html`<span class="dot"></span>`}${label}</span>`;

export const spinner = html`<span class="spinner" aria-hidden="true"></span>`;

interface BusyButton {
  action: string;
  label: string;
  /** A verb with an ellipsis, e.g. "Accepting…". */
  busyLabel: string;
  busy: boolean;
  kind?: 'primary' | 'secondary' | 'danger';
}

/** A button that shows a spinner and a "verb…" label while its call runs. */
export function busyButton({ action, label, busyLabel, busy, kind = 'primary' }: BusyButton): Html {
  return html`<button type="button" class="btn btn-${kind}${busy ? ' busy' : ''}" data-action="${action}"
    aria-busy="${String(busy)}">${busy && spinner}${busy ? busyLabel : label}</button>`;
}

/** An action the design shows but this demo does not build. */
export const notBuilt = (label: string, kind: 'primary' | 'secondary' = 'secondary', size?: 'md'): Html =>
  html`<button type="button" class="btn btn-${kind}${size ? ` btn-${size}` : ''}" data-action="notBuilt">${label}</button>`;
