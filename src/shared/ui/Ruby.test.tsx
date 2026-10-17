import { render } from 'preact';
import { act } from 'preact/test-utils';
import { toPlain } from '../../content/ruby';
import { Ruby } from './Ruby';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

/** textContent without the `<rt>` readings. */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('rt').forEach((rt) => rt.remove());
  return clone.textContent ?? '';
}

const JA = '{日本|にほん}へ{行|い}く';

describe('<Ruby>', () => {
  it('renders markup as <ruby><rb><rt> with lang="ja"', () => {
    act(() => render(<Ruby ja={JA} mode="always" />, root));
    const host = root.firstElementChild as HTMLElement;
    expect(host.getAttribute('lang')).toBe('ja');
    const rubies = root.querySelectorAll('ruby');
    expect(rubies.length).toBe(2);
    expect(rubies[0]?.querySelector('rb')?.textContent).toBe('日本');
    expect(rubies[0]?.querySelector('rt')?.textContent).toBe('にほん');
    expect(rubies[1]?.querySelector('rt')?.textContent).toBe('い');
    expect(visibleText(host)).toBe(toPlain(JA));
    expect(root.querySelector('.ruby__rt--fog')).toBeNull();
  });

  it('fog hides only predicate bases and reveals on tap, calling onReveal', () => {
    const onReveal = vi.fn();
    act(() => render(<Ruby ja={JA} mode="fog" fog={(b) => b === '日本'} onReveal={onReveal} />, root));
    const fogged = root.querySelectorAll('.ruby__seg--fog');
    expect(fogged.length).toBe(1);
    expect(fogged[0]?.getAttribute('role')).toBe('button');
    expect(fogged[0]?.querySelector('rt')?.classList.contains('ruby__rt--fog')).toBe(true);
    // 行 is not fogged
    expect(root.querySelectorAll('ruby')[1]?.querySelector('rt')?.classList.contains('ruby__rt--fog')).toBe(false);

    act(() => {
      (fogged[0] as HTMLElement).click();
    });
    expect(onReveal).toHaveBeenCalledWith('日本');
    expect(root.querySelector('.ruby__seg--fog')).toBeNull();
    expect(root.querySelectorAll('ruby')[0]?.getAttribute('data-revealed')).toBe('true');
  });

  it('fog without a predicate hides nothing', () => {
    act(() => render(<Ruby ja={JA} mode="fog" />, root));
    expect(root.querySelector('.ruby__rt--fog')).toBeNull();
  });

  it('tap mode hides every reading; Enter reveals', () => {
    const onReveal = vi.fn();
    act(() => render(<Ruby ja={JA} mode="tap" onReveal={onReveal} />, root));
    expect(root.querySelectorAll('.ruby__rt--fog').length).toBe(2);
    const second = root.querySelectorAll('ruby')[1] as HTMLElement;
    act(() => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onReveal).toHaveBeenCalledWith('行');
    expect(root.querySelectorAll('.ruby__rt--fog').length).toBe(1);
  });

  it('off renders plain text with no <ruby>', () => {
    act(() => render(<Ruby ja={JA} mode="off" />, root));
    expect(root.querySelector('ruby')).toBeNull();
    expect(root.textContent).toBe('日本へ行く');
  });

  it('tokens become tappable spans whose text concatenates to the plain sentence', () => {
    const onTokenTap = vi.fn();
    const tokens = ['日本', 'へ', '行く'];
    act(() => render(<Ruby ja={JA} mode="always" tokens={tokens} onTokenTap={onTokenTap} />, root));
    const spans = Array.from(root.querySelectorAll('.ruby__token'));
    expect(spans.length).toBe(3);
    expect(spans.map((s) => visibleText(s)).join('')).toBe(toPlain(JA));
    expect(spans.map((s) => visibleText(s))).toEqual(tokens);
    expect(spans[2]?.getAttribute('role')).toBe('button');
    act(() => {
      (spans[2] as HTMLElement).click();
    });
    expect(onTokenTap).toHaveBeenCalledWith('行く', 2);
  });

  it('a fog reveal inside a token does not fire the token tap', () => {
    const onTokenTap = vi.fn();
    const onReveal = vi.fn();
    act(() =>
      render(
        <Ruby ja={JA} mode="fog" fog={() => true} tokens={['日本', 'へ', '行く']} onTokenTap={onTokenTap} onReveal={onReveal} />,
        root,
      ),
    );
    const fogged = root.querySelector('.ruby__seg--fog') as HTMLElement;
    act(() => {
      fogged.click();
    });
    expect(onReveal).toHaveBeenCalledWith('日本');
    expect(onTokenTap).not.toHaveBeenCalled();
    // second tap on the now-revealed word reaches the token
    act(() => {
      (root.querySelector('.ruby__token') as HTMLElement).click();
    });
    expect(onTokenTap).toHaveBeenCalledWith('日本', 0);
  });

  it('vertical adds the tategaki class; reveal state resets when ja changes', () => {
    act(() => render(<Ruby ja={JA} mode="tap" vertical />, root));
    expect(root.firstElementChild?.classList.contains('tategaki')).toBe(true);
    act(() => {
      (root.querySelector('ruby') as HTMLElement).click();
    });
    expect(root.querySelectorAll('.ruby__rt--fog').length).toBe(1);
    act(() => render(<Ruby ja="{東京|とうきょう}" mode="tap" vertical />, root));
    expect(root.querySelectorAll('.ruby__rt--fog').length).toBe(1);
    expect(root.querySelector('rt')?.textContent).toBe('とうきょう');
  });
});
