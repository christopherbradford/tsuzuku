import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { focusableIn, trapTab, useDialogFocus } from './use-dialog-focus';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function Dialog(p: { onClose: () => void; initial?: string; empty?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, { onClose: p.onClose, initial: p.initial });
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      {p.empty ? null : (
        <>
          <button data-a>A</button>
          <button data-b>B</button>
          <button data-c hidden>
            C
          </button>
        </>
      )}
    </div>
  );
}

function keydown(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

describe('useDialogFocus', () => {
  it('focuses the `initial` target, traps Tab both ways, closes on Escape and restores the opener', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const onClose = vi.fn();
    act(() => render(<Dialog onClose={onClose} initial="[data-b]" />, root));
    const a = root.querySelector<HTMLButtonElement>('[data-a]')!;
    const b = root.querySelector<HTMLButtonElement>('[data-b]')!;
    expect(document.activeElement).toBe(b);

    // Tab on the last tabbable wraps to the first; Shift+Tab on the first wraps to the last.
    expect(keydown(b, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(a);
    expect(keydown(a, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
    // Tab from the first (not the trailing edge) is left to the browser.
    a.focus();
    expect(keydown(a, 'Tab').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(a);
    b.focus();

    const esc = keydown(b, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);

    act(() => render(null, root));
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('defaults to the first tabbable, then the root itself; hidden elements are not tabbable', () => {
    act(() => render(<Dialog onClose={() => undefined} />, root));
    const dialog = root.querySelector<HTMLDivElement>('[role=dialog]')!;
    expect(document.activeElement).toBe(root.querySelector('[data-a]'));
    expect(focusableIn(dialog).map((el) => el.dataset)).toHaveLength(2);
    act(() => render(null, root));

    act(() => render(<Dialog onClose={() => undefined} empty />, root));
    const emptyDialog = root.querySelector<HTMLDivElement>('[role=dialog]')!;
    expect(document.activeElement).toBe(emptyDialog);
    // with nothing tabbable, Tab stays on the root
    expect(keydown(emptyDialog, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(emptyDialog);
  });

  it('trapTab is a no-op for other keys', () => {
    const div = document.createElement('div');
    root.appendChild(div);
    const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    trapTab(e, div);
    expect(e.defaultPrevented).toBe(false);
  });
});
