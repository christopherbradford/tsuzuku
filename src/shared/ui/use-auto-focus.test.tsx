import { render } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { useAutoFocus } from './use-auto-focus';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function Harness(p: { phase: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useAutoFocus(ref, [p.phase]);
  return (
    <div>
      <button type="button" class="other">
        other
      </button>
      <button type="button" class="primary" ref={ref}>
        {p.phase}
      </button>
    </div>
  );
}

describe('useAutoFocus', () => {
  it('focuses the element on mount even after something else held focus, and again when deps change', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
    act(() => render(<Harness phase="begin" />, root));
    const primary = root.querySelector('.primary') as HTMLButtonElement;
    expect(document.activeElement).toBe(primary);
    (root.querySelector('.other') as HTMLButtonElement).focus();
    expect(document.activeElement).not.toBe(primary);
    act(() => render(<Harness phase="begin" />, root));
    expect(document.activeElement).not.toBe(primary); // same deps: no re-focus
    act(() => render(<Harness phase="resume" />, root));
    expect(document.activeElement).toBe(primary);
    outside.remove();
  });

  it('is a no-op while the ref is empty', () => {
    function Empty() {
      const ref = useRef<HTMLButtonElement>(null);
      const [show] = useState(false);
      useAutoFocus(ref);
      return show ? <button ref={ref} /> : <span>none</span>;
    }
    const before = document.activeElement;
    act(() => render(<Empty />, root));
    expect(document.activeElement).toBe(before);
  });
});
