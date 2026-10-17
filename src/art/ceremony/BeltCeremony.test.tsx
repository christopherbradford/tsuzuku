import { render, type JSX } from 'preact';
import { act } from 'preact/test-utils';
import { BELT_IDS } from '../../content/types';
import { installServices, nullAudio, resetServices } from '../../shared/audio';
import { makeTestStore } from '../../store/testing';
import { BELT_PHASES, BELT_PHASE_AT, BELT_WALLPAPER, BeltCeremony, beltPhaseIndex, kanjiSvg, knotSvg, lanternsSvg, nextStop, sealSvg, splashSvg } from './BeltCeremony';
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
  setLazyArtForTests({ MonCrest: null, wallpapers: null });
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
const section = (): Element => root.querySelector('.belt-ceremony')!;
const phaseName = (): string | null => section().getAttribute('data-phase-name');
const advanceTo = (phase: (typeof BELT_PHASES)[number]): void => {
  const target = BELT_PHASE_AT[beltPhaseIndex(phase)]!;
  const now = Number(section().getAttribute('data-elapsed') ?? '0');
  act(() => {
    vi.advanceTimersByTime(target - now);
  });
  section().setAttribute('data-elapsed', String(target));
};

describe('<BeltCeremony>', () => {
  it('runs the phases in order with the right art appearing at each one', () => {
    vi.useFakeTimers();
    act(() => render(<BeltCeremony belt="green" nameKana="ハナ" onDone={() => {}} reduced={false} />, root));
    expect(phaseName()).toBe('dim');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(0);
    expect(root.querySelector('.belt-kanji')).toBeNull();

    advanceTo('taiko1');
    expect(phaseName()).toBe('taiko1');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(1);
    advanceTo('taiko2');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(2);
    advanceTo('taiko3');
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(3);

    advanceTo('kanji');
    expect(phaseName()).toBe('kanji');
    expect(root.querySelector('.belt-kanji svg text')?.textContent).toBe('中堅');
    expect(root.querySelector('.belt-kanji svg mask path')?.getAttribute('stroke-dashoffset')).not.toBeNull();

    advanceTo('knot');
    expect(phaseName()).toBe('knot');
    expect(section().classList.contains('is-knot')).toBe(true);
    const knot = root.querySelector('.belt-knot')!;
    expect(knot.innerHTML).toContain('#3E9B4F');
    expect(knot.querySelector('animate[attributeName="d"]')).not.toBeNull();

    advanceTo('seal');
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('ハ');
    expect(sfx).toHaveBeenCalledTimes(1);

    advanceTo('thumb');
    expect(phaseName()).toBe('thumb');
    expect(root.querySelector('.belt-thumb')?.getAttribute('data-preview')).toBe('placeholder');
    expect(root.querySelector('.belt-thumb__caption')?.textContent).toBe('富士の線');
    expect(sfx).toHaveBeenLastCalledWith('wallpaper');

    advanceTo('lantern');
    expect(phaseName()).toBe('lantern');
    const lanterns = root.querySelector('.belt-lanterns')!;
    expect(lanterns.querySelectorAll('.belt-lantern--next')).toHaveLength(1);
    expect(lanterns.innerHTML).toContain('日坂');

    advanceTo('vignette');
    expect(phaseName()).toBe('vignette');
    expect(root.querySelector('.belt-vignette__rank')?.textContent).toBe('中堅');
    expect(root.querySelector('.belt-vignette__romaji')?.textContent).toBe('Chūken');
    expect(root.querySelector('.belt-vignette__sensei')?.textContent).toBe(S.beltSensei);
    expect(root.querySelector('.belt-vignette__text')?.textContent).toBe(S.beltVignettes.green);
    expect(root.querySelector('.belt-vignette__next')?.textContent).toContain('Nissaka');
    expect(root.querySelector('.belt-vignette__continue')).not.toBeNull();
    expect(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]).toBeLessThanOrEqual(12_000);
  });

  it('plays the ceremony sfx on mount and the wind chime only when a wallpaper rises', () => {
    vi.useFakeTimers();
    act(() => render(<BeltCeremony belt="yellow" nameKana="ハナ" onDone={() => {}} reduced={false} />, root));
    expect(sfx).toHaveBeenCalledWith('ceremony');
    act(() => {
      vi.advanceTimersByTime(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]! + 10);
    });
    expect(root.querySelector('.belt-thumb')).toBeNull();
    expect(sfx).toHaveBeenCalledTimes(1);
    expect(phaseName()).toBe('vignette');
  });

  it('onDone fires on Continue at the end (or when skipped early by the host)', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    act(() => render(<BeltCeremony belt="orange" nameKana="ハナ" onDone={onDone} reduced={false} />, root));
    expect(root.querySelector('.belt-vignette__continue')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(BELT_PHASE_AT[BELT_PHASE_AT.length - 1]!);
    });
    (root.querySelector('.belt-vignette__continue') as HTMLButtonElement).click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reduced motion renders the final frame at once: every phase, no SMIL morph, no dash writing', () => {
    act(() => render(<BeltCeremony belt="brown" nameKana="ハナ" onDone={() => {}} reduced />, root));
    expect(phaseName()).toBe('vignette');
    for (const ph of BELT_PHASES) expect(section().classList.contains(`is-${ph}`), ph).toBe(true);
    expect(root.querySelectorAll('.belt-splash')).toHaveLength(3);
    expect(root.querySelector('.belt-knot animate')).toBeNull();
    expect(root.querySelector('.belt-knot [stroke-dashoffset]')).toBeNull();
    expect(root.querySelector('.belt-kanji mask')).toBeNull();
    expect(root.querySelector('.belt-kanji svg text')?.textContent).toBe('師範');
    expect(root.querySelector('.belt-vignette__text')?.textContent).toBe(S.beltVignettes.brown);
    expect(sfx).toHaveBeenCalledWith('ceremony');
    expect(sfx).toHaveBeenCalledWith('wallpaper');
  });

  it('the name seal carries the learner (romaji → katakana; empty → 無名)', () => {
    act(() => render(<BeltCeremony belt="blue" nameKana="hana" onDone={() => {}} reduced />, root));
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('ハ');
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('ナ');
    act(() => render(<BeltCeremony belt="blue" nameKana="  " onDone={() => {}} reduced />, root));
    expect(root.querySelector('.belt-seal svg')?.innerHTML).toContain('無');
  });

  it('shows the belt badge crest in the vignette (real <MonCrest> when available)', async () => {
    const seen: MonCrestProps[] = [];
    const Fake = (p: MonCrestProps): JSX.Element => {
      seen.push(p);
      return <i class="fake-mon" />;
    };
    setLazyArtForTests({ MonCrest: Fake, wallpapers: null });
    act(() => render(<BeltCeremony belt="purple" nameKana="ハナ" onDone={() => {}} reduced />, root));
    await settle();
    expect(root.querySelector('.belt-vignette__crest')?.getAttribute('data-crest')).toBe('mon');
    expect(seen[0]).toMatchObject({ id: 'belt-purple', earned: true, caption: false });
    act(() => render(null, root));
    setLazyArtForTests({ MonCrest: null, wallpapers: null });
    act(() => render(<BeltCeremony belt="purple" nameKana="ハナ" onDone={() => {}} reduced />, root));
    await settle();
    expect(root.querySelector('.belt-vignette__crest')?.getAttribute('data-crest')).toBe('fallback');
    expect(root.querySelector('.belt-vignette__crest svg text')?.textContent).toBe('帯');
  });

  it('renders the registry thumbnail when the kakejiku module is available', async () => {
    const renderWallpaper = vi.fn(() =>
      Promise.resolve({
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect id="fake-thumb"/></svg>',
        texts: [],
        post: 'none' as const,
        effect: 'none' as const,
        locked: false,
        revealed: 4 as const,
        seed: 1,
        size: 'desktop' as const,
        w: 1920,
        h: 1080,
      }),
    );
    setLazyArtForTests({ MonCrest: null, wallpapers: { renderWallpaper } });
    act(() => render(<BeltCeremony belt="black" nameKana="ハナ" onDone={() => {}} reduced />, root));
    await settle();
    expect(renderWallpaper).toHaveBeenCalledWith('kyoto-arrival', { size: 'desktop', reforge: 0, revealed: 4, locked: false });
    expect(root.querySelector('.belt-thumb')?.getAttribute('data-preview')).toBe('render');
    expect(root.querySelector('#fake-thumb')).not.toBeNull();
    expect(root.querySelector('.belt-vignette__next')?.textContent).toContain(S.beltRoadEnd);
  });
});

describe('belt tables and SVG pieces', () => {
  it('BELT_WALLPAPER follows design 02 §2 and nextStop walks the road', () => {
    expect(BELT_WALLPAPER).toEqual({ green: 'fuji-ridge', blue: 'daruma', purple: 'koi-dragon', brown: 'wall-broken', black: 'kyoto-arrival' });
    expect(nextStop('yellow')).toMatchObject({ ja: '箱根', romaji: 'Hakone', number: 10 });
    expect(nextStop('black')).toMatchObject({ ja: S.beltRoadEndJa, romaji: S.beltRoadEnd, number: 54 });
    expect(BELT_PHASES).toHaveLength(BELT_PHASE_AT.length);
    for (let i = 1; i < BELT_PHASE_AT.length; i++) expect(BELT_PHASE_AT[i]).toBeGreaterThan(BELT_PHASE_AT[i - 1]!);
  });

  it('every belt has a vignette of 80 words or fewer', () => {
    for (const b of BELT_IDS) {
      const words = S.beltVignettes[b].trim().split(/\s+/).length;
      expect(words, b).toBeLessThanOrEqual(80);
      expect(S.beltVignettes[b]).not.toMatch(/!/);
    }
  });

  it('SVG pieces are deterministic standalone documents', () => {
    expect(splashSvg(3, 1)).toBe(splashSvg(3, 1));
    expect(splashSvg(3, 1).startsWith('<svg')).toBe(true);
    expect(kanjiSvg('達人', 9, false)).toBe(kanjiSvg('達人', 9, false));
    expect(kanjiSvg('達人', 9, false)).toContain('@keyframes belt-write-draw');
    expect(kanjiSvg('達人', 9, true)).not.toContain('<mask');
    const black = knotSvg('black', 1, false);
    expect(black).toContain('#B8860B');
    expect(black).toContain('@keyframes belt-tail-l-draw');
    expect(knotSvg('green', 1, true)).not.toContain('<animate');
    expect(sealSvg('ハナ', 2)).toBe(sealSvg('ハナ', 2));
    const lanterns = lanternsSvg('green');
    expect((lanterns.match(/belt-lantern--lit/g) ?? []).length).toBe(4);
    expect((lanterns.match(/belt-lantern--next/g) ?? []).length).toBe(1);
    expect(lanternsSvg('black')).toContain(S.beltRoadEndJa);
  });
});
