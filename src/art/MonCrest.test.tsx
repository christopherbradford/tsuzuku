import { render } from 'preact';
import { act } from 'preact/test-utils';
import { BADGE_IDS } from '../shared/catalog';
import { civilToDay, formatEraDate } from '../shared/time';
import { BADGE_DEFS } from '../store';
import { MON_DEFAULT_SIZE, MON_SLAM_CLASS, MonCrest, monCrestText } from './MonCrest';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const KYOTO = BADGE_DEFS.find((d) => d.id === 'kyoto')!;
const ZEN = BADGE_DEFS.find((d) => d.id === 'zen')!;
const DAY = civilToDay({ year: 2026, month: 10, day: 17 });

function figure(): HTMLElement {
  return root.querySelector('figure.mon') as HTMLElement;
}
function host(): HTMLElement {
  return root.querySelector('.mon__svg') as HTMLElement;
}

describe('<MonCrest>', () => {
  it('aria-label includes the English and Japanese name; the svg is decorative inside the labelled host', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    const h = host();
    expect(h.getAttribute('role')).toBe('img');
    const label = h.getAttribute('aria-label') ?? '';
    expect(label).toContain(KYOTO.nameEn);
    expect(label).toContain(KYOTO.nameJa);
    expect(label).toContain('earned');
    const svg = h.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.classList.contains('mon-svg--earned')).toBe(true);
    expect(svg.getAttribute('width')).toBe(String(MON_DEFAULT_SIZE));
    expect(figure().dataset.tier).toBe('gold');
    expect(figure().dataset.earned).toBe('true');
  });

  it('unearned shows the condition in the caption, the label and the tooltip, as grey stone', () => {
    act(() => render(<MonCrest id="zen" earned={false} />, root));
    const f = figure();
    expect(f.classList.contains('mon--locked')).toBe(true);
    expect(f.querySelector('.mon__condition')?.textContent).toBe(ZEN.describe);
    expect(f.getAttribute('title')).toBe(ZEN.describe);
    expect(host().getAttribute('aria-label')).toContain(ZEN.describe);
    expect(host().getAttribute('aria-label')).toContain('not yet earned');
    expect(f.querySelector('svg')?.classList.contains('mon-svg--locked')).toBe(true);
    expect(f.querySelector('.mon__date')).toBeNull();
    // no accent colour in stone
    expect((host().innerHTML.match(/#c9302c|#4e8a3c|#b8860b/i) ?? []).length).toBe(0);
  });

  it('a describe prop overrides the catalog condition', () => {
    act(() => render(<MonCrest id="zen" earned={false} describe="Thirty quiet sessions." />, root));
    expect(figure().querySelector('.mon__condition')?.textContent).toBe('Thirty quiet sessions.');
    expect(figure().getAttribute('title')).toBe('Thirty quiet sessions.');
    expect(host().getAttribute('aria-label')).toContain('Thirty quiet sessions.');
  });

  it('earned with a day shows the era date as <time> and in the tooltip', () => {
    act(() => render(<MonCrest id="seven" earned earnedOn={DAY} />, root));
    const time = figure().querySelector('time.mon__date') as HTMLTimeElement;
    expect(time).not.toBeNull();
    expect(time.getAttribute('dateTime')).toBe('2026-10-17');
    expect(time.textContent).toBe(formatEraDate(DAY));
    expect(time.getAttribute('lang')).toBe('ja');
    expect(figure().getAttribute('title')).toBe(`Earned ${formatEraDate(DAY)}`);
    expect(host().getAttribute('aria-label')).toContain(formatEraDate(DAY));
    expect(figure().querySelector('.mon__condition')).toBeNull();
  });

  it('earned without a day falls back to the name as tooltip', () => {
    act(() => render(<MonCrest id="seven" earned />, root));
    expect(figure().getAttribute('title')).toBe('Seven Days');
    expect(figure().querySelector('.mon__date')).toBeNull();
  });

  it('Japanese name carries lang="ja" and the caption can be hidden', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    const ja = figure().querySelector('.mon__ja')!;
    expect(ja.getAttribute('lang')).toBe('ja');
    expect(ja.textContent).toBe('京');
    expect(figure().querySelector('.mon__name')?.textContent).toBe('Kyoto');

    act(() => render(<MonCrest id="kyoto" earned caption={false} />, root));
    expect(figure().querySelector('figcaption')).toBeNull();
    expect(host().getAttribute('aria-label')).toContain('Kyoto');
  });

  it('size sets the svg and the host box; slam and class pass through', () => {
    act(() => render(<MonCrest id="ippon" earned size={48} slam class="shelf__crest" />, root));
    const f = figure();
    expect(f.querySelector('svg')?.getAttribute('width')).toBe('48');
    expect(host().style.width).toBe('48px');
    expect(f.classList.contains(MON_SLAM_CLASS)).toBe(true);
    expect(f.classList.contains('shelf__crest')).toBe(true);
    expect(f.classList.contains('mon--bronze')).toBe(true);
  });

  it('follows the page theme through inline var() styles with hex fallbacks', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    expect(host().innerHTML).toContain('var(--kin,');
    expect(host().innerHTML).toContain('var(--kon,');
  });

  it('is deterministic across renders and distinct across ids', () => {
    act(() => render(<MonCrest id="kyoto" earned />, root));
    const a = host().innerHTML;
    act(() => render(null, root));
    act(() => render(<MonCrest id="kyoto" earned />, root));
    expect(host().innerHTML).toBe(a);
    act(() => render(null, root));
    act(() => render(<MonCrest id="zen" earned />, root));
    expect(host().innerHTML).not.toBe(a);
  });

  it('renders every badge id, earned and locked', () => {
    for (const id of BADGE_IDS) {
      act(() => render(<MonCrest id={id} earned size={48} />, root));
      expect(host().querySelector('svg')).not.toBeNull();
      act(() => render(<MonCrest id={id} earned={false} size={48} />, root));
      expect(figure().querySelector('.mon__condition')?.textContent?.length).toBeGreaterThan(0);
      act(() => render(null, root));
    }
  });
});

describe('monCrestText', () => {
  it('builds the label, tooltip and condition from the catalog', () => {
    const locked = monCrestText({ id: 'zen', earned: false });
    expect(locked.nameEn).toBe('Zen');
    expect(locked.nameJa).toBe('禅');
    expect(locked.condition).toBe(ZEN.describe);
    expect(locked.date).toBeNull();
    expect(locked.label).toBe(`Zen 禅 crest, not yet earned. ${ZEN.describe}`);
    const earned = monCrestText({ id: 'zen', earned: true, earnedOn: DAY });
    expect(earned.date).toBe(formatEraDate(DAY));
    expect(earned.label).toBe(`Zen 禅 crest, earned ${formatEraDate(DAY)}.`);
    expect(earned.tooltip).toBe(`Earned ${formatEraDate(DAY)}`);
  });
});
