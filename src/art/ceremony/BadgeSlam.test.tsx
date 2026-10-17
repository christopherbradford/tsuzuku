import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices } from '../../shared/audio';
import { BADGE_IDS } from '../../shared/catalog';
import { makeTestStore } from '../../store/testing';
import { BadgeSlam, SLAM_AT, badgeDefinition, badgeShareCard, fallbackCrestSvg } from './BadgeSlam';
import { S } from './strings';
import { setLazyArtForTests, type MonCrestProps } from './support';

let root: HTMLDivElement;
let sfx: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await makeTestStore();
  root = document.createElement('div');
  document.body.appendChild(root);
  sfx = vi.fn();
  installServices({ audio: { ...nullAudio, sfx } });
  setLazyArtForTests({ MonCrest: null, mon: null });
  // jsdom has no 2D canvas; a null context is exactly the "cannot rasterise" path exportPng reports.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
  setLazyArtForTests(null);
  vi.useRealTimers();
});

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

describe('<BadgeSlam>', () => {
  it('renders the earned crest (fallback art until MonCrest is built) with name, strand, tier and condition', async () => {
    act(() => render(<BadgeSlam id="seven" onDone={() => {}} reduced />, root));
    await settle();
    const crest = root.querySelector('.badge-slam__crest')!;
    expect(crest.getAttribute('data-crest')).toBe('fallback');
    expect(crest.querySelector('svg')).not.toBeNull();
    expect(crest.querySelector('svg text')?.textContent).toBe('七');
    expect(root.querySelector('.badge-slam__name')?.textContent).toBe('七日');
    expect(root.querySelector('.badge-slam__name')?.getAttribute('lang')).toBe('ja');
    expect(root.querySelector('.badge-slam__name-en')?.textContent).toBe('Seven Days');
    expect(root.querySelector('.badge-slam__strand')?.textContent).toBe(S.strandStreak);
    expect(root.querySelector('.badge-slam__tier')?.textContent).toBe(S.tierBronze);
    expect(root.querySelector('.badge-slam__describe')?.textContent).toBe(badgeDefinition('seven')?.describe);
  });

  it('plays the badge sfx once on mount', () => {
    act(() => render(<BadgeSlam id="ippon" onDone={() => {}} reduced />, root));
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(sfx).toHaveBeenCalledWith('badge');
  });

  it('uses the real <MonCrest> when it is available, without its caption', async () => {
    const seen: MonCrestProps[] = [];
    const Fake = (p: MonCrestProps): JSX.Element => {
      seen.push(p);
      return <div class="fake-mon" data-id={p.id} />;
    };
    setLazyArtForTests({ MonCrest: Fake, mon: null });
    act(() => render(<BadgeSlam id="kyoto" onDone={() => {}} reduced />, root));
    await settle();
    const crest = root.querySelector('.badge-slam__crest')!;
    expect(crest.getAttribute('data-crest')).toBe('mon');
    expect(crest.querySelector('.fake-mon')?.getAttribute('data-id')).toBe('kyoto');
    expect(seen[0]?.earned).toBe(true);
    expect(seen[0]?.caption).toBe(false);
    expect(root.querySelector('.badge-slam__tier')?.textContent).toBe(S.tierGold);
  });

  it('slams: ready → slam → settled on the phase table', () => {
    vi.useFakeTimers();
    act(() => render(<BadgeSlam id="first-step" onDone={() => {}} reduced={false} />, root));
    const section = (): Element => root.querySelector('.badge-slam')!;
    expect(section().getAttribute('data-phase')).toBe('0');
    expect(section().classList.contains('badge-slam--ready')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(SLAM_AT[1]!);
    });
    expect(section().classList.contains('badge-slam--slam')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(SLAM_AT[2]! - SLAM_AT[1]!);
    });
    expect(section().classList.contains('badge-slam--settled')).toBe(true);
  });

  it('reduced motion renders the settled card at once', () => {
    act(() => render(<BadgeSlam id="first-step" onDone={() => {}} reduced />, root));
    expect(root.querySelector('.badge-slam')?.classList.contains('badge-slam--settled')).toBe(true);
  });

  it('Continue calls onDone', () => {
    const onDone = vi.fn();
    act(() => render(<BadgeSlam id="first-step" onDone={onDone} reduced />, root));
    (root.querySelector('.badge-slam__continue') as HTMLButtonElement).click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Save as image reports honestly when the host cannot rasterise (jsdom)', async () => {
    const monSvg = vi.fn<(spec: unknown, o: { size: number; earned: boolean; seed: number }) => string>(
      () => '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><circle r="10"/></svg>',
    );
    setLazyArtForTests({ MonCrest: null, mon: { monSvg, MON_SPECS: { 'first-step': { ring: 'bronze' } } } });
    act(() => render(<BadgeSlam id="first-step" onDone={() => {}} reduced />, root));
    await settle();
    const save = root.querySelector('.badge-slam__save') as HTMLButtonElement;
    await act(async () => {
      save.click();
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    await settle();
    expect(monSvg).toHaveBeenCalledTimes(1);
    expect(monSvg.mock.calls[0]?.[1]).toMatchObject({ size: 600, earned: true });
    expect(root.querySelector('.badge-slam__status')?.textContent).toBe(S.saveUnavailable);
    expect(save.disabled).toBe(false);
  });

  it('Save as image falls back to the drawn crest when mon.ts is not built', async () => {
    act(() => render(<BadgeSlam id="first-step" onDone={() => {}} reduced />, root));
    await settle();
    await act(async () => {
      (root.querySelector('.badge-slam__save') as HTMLButtonElement).click();
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    await settle();
    expect(root.querySelector('.badge-slam__status')?.textContent).toBe(S.saveUnavailable);
  });
});

describe('fallbackCrestSvg / badgeShareCard', () => {
  it('is deterministic and standalone for every field and tier', () => {
    const fields = ['circle', 'hexagon', 'tomoe', 'square', 'petal'] as const;
    const tiers = ['bronze', 'silver', 'gold'] as const;
    for (const field of fields) {
      for (const tier of tiers) {
        const a = fallbackCrestSvg({ glyph: '歩', tier, field, size: 200, seed: 7 });
        const b = fallbackCrestSvg({ glyph: '歩', tier, field, size: 200, seed: 7 });
        expect(a).toBe(b);
        expect(a.startsWith('<svg')).toBe(true);
        expect(a).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(a).toContain('>歩<');
      }
    }
    expect(fallbackCrestSvg({ glyph: '京', tier: 'gold', field: 'tomoe', size: 200, seed: 1 })).toContain('stroke-linecap="round"');
    expect(fallbackCrestSvg({ glyph: '京', tier: 'bronze', field: 'circle', size: 200, seed: 1 })).not.toContain('stroke-linecap="round"');
  });

  it('an unearned crest is grey stone', () => {
    const svg = fallbackCrestSvg({ glyph: '一', tier: 'gold', field: 'circle', size: 100, seed: 3, earned: false });
    expect(svg).toContain('#8A8578');
    expect(svg).not.toContain('#B8860B');
  });

  it('the share card is 1080 square with the crest and five text layers', () => {
    const crest = fallbackCrestSvg({ glyph: '歩', tier: 'bronze', field: 'circle', size: 600, seed: 1 });
    const card = badgeShareCard({ crestSvg: crest, nameJa: '一歩', nameEn: 'First Step', describe: 'One session finished.', day: 20_468 });
    expect(card.w).toBe(1080);
    expect(card.h).toBe(1080);
    expect(card.svg).toContain('viewBox="0 0 1080 1080"');
    expect(card.svg).toContain('>歩<');
    expect(card.texts).toHaveLength(5);
    expect(card.texts.map((t) => t.text)).toEqual([S.shareCardTitle, '一歩', 'First Step', 'One session finished.', expect.stringMatching(/年.*月.*日/)]);
    for (const t of card.texts) expect(t.x).toBe(540);
  });

  it('every badge id has a definition to draw from', () => {
    for (const id of BADGE_IDS) expect(badgeDefinition(id), id).toBeDefined();
  });
});
