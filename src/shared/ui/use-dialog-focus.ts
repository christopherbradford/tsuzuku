/**
 * TSUZUKU — focus management for small modal dialogs (shared/ui, design 01 §7).
 *
 * `role="dialog" aria-modal="true"` hides the rest of the page from assistive
 * tech but does nothing for the keyboard; this hook supplies the missing
 * half: focus moves into the dialog on open (the safe button first), Escape
 * closes it (consumed: `preventDefault` + `stopPropagation`, so an outer
 * `ExerciseFrame` key handler bails on `defaultPrevented`), Tab and Shift+Tab
 * wrap inside it, and focus returns to the element that opened it when it
 * unmounts. Pure DOM, no store, no strings. Contract tier so A's confirm
 * dialogs, E's Leave dialog and D's pause overlay share one implementation
 * (`src/app/use-dialog-focus.ts` re-exports it for A's existing imports).
 */
import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tabbable descendants of `root`, in DOM order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
}

/** Keeps a Tab / Shift+Tab keydown inside `root`; a no-op for other keys. */
export function trapTab(e: KeyboardEvent, root: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = focusableIn(root);
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

export interface DialogFocusOptions {
  /** Called on Escape. */
  onClose: () => void;
  /** Selector of the element to focus on open; defaults to the first tabbable, then the root. */
  initial?: string;
}

/**
 * Wire a mounted dialog root (give it `tabIndex={-1}`): initial focus, Escape,
 * Tab trap, and focus restoration to the opener on unmount.
 */
export function useDialogFocus(ref: RefObject<HTMLElement>, o: DialogFocusOptions): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = (o.initial ? root.querySelector<HTMLElement>(o.initial) : null) ?? focusableIn(root)[0] ?? root;
    target.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        o.onClose();
        return;
      }
      trapTab(e, root);
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
    // Mount-only: the dialog unmounts to close; `o.onClose` is read at call time.
  }, []);
}
