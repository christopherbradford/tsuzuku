import { render } from 'preact';
import { act } from 'preact/test-utils';
import { STATIONS } from '../content/types';
import { hashSeed } from '../shared/hash';
import { civilToDay, formatEraDate } from '../shared/time';
import { store } from '../store';
import { TEST_SEED, makeTestStore } from '../store/testing';
import { goshuinSvg } from './goshuin';
import { GOSHUIN_DEFAULT_SIZE, GOSHUIN_PRESS_CLASS, GoshuinStamp, goshuinSeed } from './GoshuinStamp';

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore();
});
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const DAY = civilToDay({ year: 2026, month: 10, day: 17 });
const ST7 = STATIONS[6]!;

function figure(): HTMLElement {
  return root.querySelector('figure.goshuin') as HTMLElement;
}
function host(): HTMLElement {
  return root.querySelector('.goshuin__svg') as HTMLElement;
}

describe('<GoshuinStamp>', () => {
  it('renders for a cleared station with an accessible label, tooltip and the stamp svg', () => {
    act(() => render(<GoshuinStamp station={7} at={DAY} perfect={false} assisted={false} />, root));
    const f = figure();
    expect(f).not.toBeNull();
    expect(f.dataset.station).toBe('7');
    const h = host();
    expect(h.getAttribute('role')).toBe('img');
    const label = h.getAttribute('aria-label') ?? '';
    expect(label).toContain('Station 7');
    expect(label).toContain('平塚');
    expect(label).toContain('Hiratsuka');
    expect(label).toContain(formatEraDate(DAY));
    expect(label).not.toContain('gold frame');
    expect(f.getAttribute('title')).toBe(`Station 7 · Hiratsuka · ${formatEraDate(DAY)}`);
    const svg = h.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe(String(GOSHUIN_DEFAULT_SIZE));
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('.goshuin__frame')).not.toBeNull();
    expect(svg.querySelector('.goshuin__band--seigaiha')).not.toBeNull();
    expect(h.innerHTML).toContain('var(--shu,');
    expect(f.querySelector('figcaption')).toBeNull();
  });

  it('perfect and assisted variants mark the figure and the label', () => {
    act(() => render(<GoshuinStamp station={7} at={DAY} perfect assisted={false} />, root));
    expect(figure().classList.contains('goshuin--perfect')).toBe(true);
    expect(figure().dataset.perfect).toBe('true');
    expect(host().getAttribute('aria-label')).toContain('gold frame');
    expect(host().querySelector('.goshuin__gold')).not.toBeNull();
    expect(host().querySelector('.goshuin__corner')).toBeNull();

    act(() => render(<GoshuinStamp station={7} at={DAY} perfect={false} assisted />, root));
    expect(figure().classList.contains('goshuin--assisted')).toBe(true);
    expect(host().getAttribute('aria-label')).toContain('Revenge Match');
    expect(host().querySelector('.goshuin__corner')).not.toBeNull();
    expect(host().querySelector('.goshuin__gold')).toBeNull();
  });

  it('seeds from the profile seed per station, so the stamp is stable and per-learner', () => {
    expect(store.seed()).toBe(TEST_SEED);
    expect(goshuinSeed(7)).toBe(hashSeed(TEST_SEED, 'goshuin', 7));
    expect(goshuinSeed(7)).not.toBe(goshuinSeed(8));
    expect(goshuinSeed(7, 'other-profile')).not.toBe(goshuinSeed(7));
    act(() => render(<GoshuinStamp station={7} at={DAY} perfect={false} assisted={false} />, root));
    const expected = goshuinSvg({ station: ST7, at: DAY, perfect: false, assisted: false, seed: goshuinSeed(7), size: GOSHUIN_DEFAULT_SIZE, cssVars: true });
    // compare through the DOM: HTML serialisation does not self-close SVG elements
    const twin = document.createElement('div');
    twin.innerHTML = expected;
    expect(host().innerHTML).toBe(twin.innerHTML);
  });

  it('an explicit seed changes the impression; renders are deterministic', () => {
    act(() => render(<GoshuinStamp station={7} at={DAY} perfect={false} assisted={false} />, root));
    const a = host().innerHTML;
    act(() => render(null, root));
    act(() => render(<GoshuinStamp station={7} at={DAY} perfect={false} assisted={false} />, root));
    expect(host().innerHTML).toBe(a);
    act(() => render(null, root));
    act(() => render(<GoshuinStamp station={7} at={DAY} perfect={false} assisted={false} seed={99} />, root));
    expect(host().innerHTML).not.toBe(a);
  });

  it('size, pressed, paper and class pass through', () => {
    act(() => render(<GoshuinStamp station={10} at={DAY} perfect={false} assisted={false} size={96} pressed paper class="road__stamp" />, root));
    const f = figure();
    expect(f.classList.contains(GOSHUIN_PRESS_CLASS)).toBe(true);
    expect(f.classList.contains('road__stamp')).toBe(true);
    expect(host().style.width).toBe('96px');
    expect(host().querySelector('svg')?.getAttribute('width')).toBe('96');
    expect(host().querySelector('.goshuin__paper')).not.toBeNull();
  });

  it('caption shows the name (lang ja), number · romaji, the era date and the variant notes', () => {
    act(() => render(<GoshuinStamp station={7} at={DAY} perfect assisted caption />, root));
    const cap = figure().querySelector('figcaption')!;
    expect(cap.querySelector('.goshuin__name')?.textContent).toBe('平塚');
    expect(cap.querySelector('.goshuin__name')?.getAttribute('lang')).toBe('ja');
    expect(cap.querySelector('.goshuin__romaji')?.textContent).toBe('7 · Hiratsuka');
    const time = cap.querySelector('time') as HTMLTimeElement;
    expect(time.getAttribute('dateTime')).toBe('2026-10-17');
    expect(time.textContent).toBe(formatEraDate(DAY));
    expect(cap.querySelectorAll('.goshuin__note').length).toBe(2);
  });

  it('an unknown station renders an honest note instead of a stamp', () => {
    act(() => render(<GoshuinStamp station={99} at={DAY} perfect={false} assisted={false} />, root));
    const f = figure();
    expect(f.classList.contains('goshuin--missing')).toBe(true);
    expect(f.getAttribute('role')).toBe('note');
    expect(f.textContent).toBe('No station 99 on this road.');
    expect(f.querySelector('svg')).toBeNull();
  });

  it('renders every station on the road', () => {
    for (const st of STATIONS) {
      act(() => render(<GoshuinStamp station={st.number} at={DAY} perfect={st.number % 5 === 0} assisted={st.number % 7 === 0} size={64} />, root));
      expect(host().querySelector('svg')).not.toBeNull();
      expect(host().getAttribute('aria-label')).toContain(st.nameJa);
      act(() => render(null, root));
    }
  });
});
