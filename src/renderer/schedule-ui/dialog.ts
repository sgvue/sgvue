// The Schedules window's own confirm and prompt — 2026-09-25, phase 2.
//
// ifcTable asks with `confirm()` (replace the setup, delete a saved one) and `prompt()`
// (rename a saved one). Electron implements neither the way a browser does: `prompt()` is not
// supported at all, and `confirm()` is an OS message box, which is not SGVue. So both are this
// one small modal, built from the Preferences dialog's own idiom — the scrim, the 10 px card
// on `--card` with `--border-strong` and `--shadow`, the uppercase 11 px label, the 8 px field,
// the `fadein` entrance — and its keyboard contract: focus goes in, Tab stays in
// (`app/focus-trap.ts`, the helpers Preferences uses), Escape cancels, focus comes back.
//
// Drawn once per question and appended to <body>, outside `#app`: nothing in the app's
// repaint path can rebuild it mid-answer, and its clicks never reach the app's delegated
// handlers. The answer is a Promise, so a caller acts in the dialog's own click, never inside
// the click that asked.
//
// 2026-10-02 — a question raised **for the assistant** (`manage.ts`) takes no default button.
// The user's own confirm puts the focus on its confirm button, because their click asked for
// it. One nobody in this window clicked for appears while the user may be typing — here, or in
// the main window's chat as this window comes forward — and a focused button answers to Enter
// and Space: the next space of a sentence would delete a saved template. So there the focus
// goes to the card itself, which answers to no key but Escape; Tab reaches Cancel first, then
// the confirm.

import { focusables, trapTab } from '../app/focus-trap';
import { esc } from './dom';

let current: HTMLElement | null = null;
/** Answers the open dialog "cancel" — a second question never leaves the first unanswered. */
let cancelCurrent: (() => void) | null = null;

/** True while a dialog is up — the window's own shortcuts stand aside for it. */
export const dialogOpen = () => current !== null;

interface Ask {
  title: string;
  message?: string;
  /** Present for a prompt: the text box's starting value. */
  value?: string;
  confirm: string;
  danger?: boolean;
  /** Raised for the assistant: the card takes the focus, and no button does (`ConfirmHow`). */
  forAssistant?: boolean;
}

function ask(o: Ask): Promise<string | null> {
  cancelCurrent?.();
  const opener = document.activeElement as HTMLElement | null;
  const scrim = document.createElement('div');
  scrim.className = 'dlg-scrim';
  // (`tabindex="-1"`: the card can be given the focus by script, and Tab never lands on it.)
  scrim.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlg-title"
      ${o.message ? 'aria-describedby="dlg-message"' : ''}${o.forAssistant ? ' tabindex="-1"' : ''}>
      <span class="dlg-label" id="dlg-title">${esc(o.title)}</span>
      ${o.message ? `<p class="dlg-message" id="dlg-message">${esc(o.message)}</p>` : ''}
      ${o.value !== undefined ? `<input class="dlg-field" type="text" spellcheck="false"
        value="${esc(o.value)}" aria-label="${esc(o.title)}" />` : ''}
      <div class="dlg-actions">
        <button type="button" class="btn hv-step-ink" data-answer="cancel">Cancel</button>
        <button type="button" class="btn ${o.danger ? 'danger hv-warn-both' : 'primary'}"
          data-answer="ok">${esc(o.confirm)}</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
  current = scrim;
  const card = scrim.querySelector<HTMLElement>('.dlg')!;
  const input = scrim.querySelector<HTMLInputElement>('.dlg-field');

  return new Promise((resolve) => {
    const close = (answer: string | null) => {
      if (!scrim.isConnected) return;
      scrim.remove();
      if (current === scrim) { current = null; cancelCurrent = null; }
      // Back to whatever asked, when it is still there to take it.
      if (opener?.isConnected) opener.focus();
      resolve(answer);
    };
    const accept = () => close(input ? input.value : '');
    cancelCurrent = () => close(null);

    scrim.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-answer]');
      if (b) { if (b.dataset.answer === 'ok') accept(); else close(null); }
    });
    // A press that starts AND ends on the scrim dismisses; a drag out of the text box does
    // not (ifcTable LESSONS, 2026-09-11).
    let pressedScrim = false;
    scrim.addEventListener('pointerdown', (e) => { pressedScrim = e.target === scrim; });
    scrim.addEventListener('pointerup', (e) => {
      if (pressedScrim && e.target === scrim) close(null);
      pressedScrim = false;
    });
    scrim.addEventListener('keydown', (e) => {
      // A modal owns Escape, Enter and Tab: none of them reaches the window's shortcuts.
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); return; }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); accept(); return; }
      if (trapTab(card, e)) e.preventDefault();
    });

    // No default button for a question the assistant raised: the card, which no key answers.
    if (o.forAssistant) card.focus();
    else if (input) { input.focus(); input.select(); } else (focusables(card).at(-1) ?? card).focus();
  });
}

/** How a confirm is asked, beyond its words. */
export interface ConfirmHow {
  /**
   * The card's small label: `Schedules` for a question the user's own click raised. A question
   * raised for the assistant (2026-10-02, `manage.ts`) carries its name there instead — `Ask
   * Vee` — so that a dialog nobody in this window clicked for says who is asking.
   */
  title?: string;
  /**
   * The question was raised for the assistant, not by a click in this window: it takes **no
   * default button**. The focus goes to the card — Enter and Space answer nothing, Tab reaches
   * Cancel first and then the confirm, Escape cancels — where the user's own confirm puts it on
   * the confirm button. Said by whoever asks, never read off the label.
   */
  forAssistant?: boolean;
}

/** Ask a yes / no question. Resolves true only on the confirm button (or Enter on it). */
export function confirmDialog(
  message: string, confirm: string, danger = false, how: ConfirmHow = {},
): Promise<boolean> {
  return ask({ title: how.title ?? 'Schedules', message, confirm, danger, forAssistant: how.forAssistant })
    .then((a) => a !== null);
}

/** Ask for one line of text. Resolves the text, or null when cancelled. */
export function promptDialog(title: string, value: string, confirm: string): Promise<string | null> {
  return ask({ title, value, confirm });
}
