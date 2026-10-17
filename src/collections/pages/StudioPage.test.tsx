import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ExportOptions } from '../../art/png';
import { sampleData } from '../../art/wallpapers/data';
import { createFakeLoader, V } from '../../content/fixtures';
import type { CardKey } from '../../content/types';
import { WALLPAPER_IDS } from '../../shared/catalog';
import type { CardTuple } from '../../shared/store-types';
import { civilToDay, epochDay } from '../../shared/time';
import { WALLPAPER_DEFS, store } from '../../store';
import { resetStoreForTests } from '../../store/store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '../../store/testing';
import StudioPage, { CUSTOM_SENTENCE, MAX_CUSTOM_SENTENCE, clampSentence, kanjiCandidates, personalize, sentenceCandidates, wallpaperIdOf } from './StudioPage';

const DAY = civilToDay({ year: 2026, month: 10, day: 17 });
const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
});

interface Recorder {
  calls: ExportOptions[];
  saved: string[];
  copied: Blob[];
  exporter(o: ExportOptions): Promise<Blob | null>;
  saver(blob: Blob, filename: string): 'download';
  clipboard(blob: Blob): Promise<void>;
}
function recorder(result: 'blob' | 'null' = 'blob'): Recorder {
  const r: Recorder = {
    calls: [],
    saved: [],
    copied: [],
    async exporter(o) {
      r.calls.push(o);
      o.onProgress?.(0.5);
      o.onProgress?.(1);
      return result === 'blob' ? new Blob(['png'], { type: 'image/png' }) : null;
    },
    saver(_b, filename) {
      r.saved.push(filename);
      return 'download';
    },
    async clipboard(blob) {
      r.copied.push(blob);
    },
  };
  return r;
}

/** Brown 私 (rec S 40, prod S 10) so `sentenceCandidates` has a Mastered word. */
const BROWN_CARDS: Record<CardKey, CardTuple> = {
  [`${V.私}#rec`]: card({ due: TODAY + 20, s: 40, reps: 9, state: 2, last: TODAY - 5 }),
  [`${V.私}#prod`]: card({ due: TODAY + 5, s: 10, reps: 4, state: 2, last: TODAY - 2 }),
};

async function mount(id: string, rec: Recorder, o: { clipboard?: boolean; cards?: Record<CardKey, CardTuple> } = {}): Promise<void> {
  await makeTestStore({
    cards: o.cards,
    save: {
      profile: { chosenKanji: '続', nameKana: 'ハナ' },
      stats: { reviews: 600 },
      collections: { wallpapers: { 'torii-dawn': { at: DAY, reforges: 0, revealed: 4 } } },
    },
  });
  await act(async () => {
    render(
      <StudioPage route={{ name: 'studio', wallpaperId: id as (typeof WALLPAPER_IDS)[number] }} exporter={rec.exporter} saver={rec.saver} clipboard={o.clipboard === false ? null : rec.clipboard} allow4k={false} loader={createFakeLoader()} />,
      root,
    );
  });
  for (let i = 0; i < 40 && !root.querySelector('.studio__art, .studio__error'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function settleStatus(): Promise<void> {
  for (let i = 0; i < 40 && !(root.querySelector('.studio__status')?.textContent ?? '').trim(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const art = (): HTMLElement => root.querySelector<HTMLElement>('.studio__art')!;
const q = <T extends Element>(sel: string): T => root.querySelector<T>(sel)!;

describe('studio helpers', () => {
  it('wallpaperIdOf reads the route and falls back to the first catalog id', () => {
    expect(wallpaperIdOf({ name: 'studio', wallpaperId: 'daruma' })).toBe('daruma');
    expect(wallpaperIdOf({ name: 'dojo' })).toBe(WALLPAPER_IDS[0]);
  });

  it('kanjiCandidates leads with the profile kanji, dedupes and keeps single glyphs', () => {
    expect(kanjiCandidates('続', ['日', '続', '本', '日本'])).toEqual(['続', '日', '本']);
    expect(kanjiCandidates(undefined, [])).toEqual([]);
  });

  it('personalize applies the sentence of choice and can drop the seal', () => {
    const base = sampleData(1);
    const none = personalize(base, { sentence: '', custom: '', kanji: '' });
    expect(none.chosenKanji).toBeUndefined();
    expect(none.sentenceOfChoice).toBeUndefined();
    const custom = personalize(base, { sentence: CUSTOM_SENTENCE, custom: ' 毎日続けます。 ', kanji: '道' });
    expect(custom.sentenceOfChoice).toBe('毎日続けます。');
    expect(custom.chosenKanji).toBe('道');
    const picked = personalize(base, { sentence: '雨の日は本を読む。', custom: 'x', kanji: '' });
    expect(picked.sentenceOfChoice).toBe('雨の日は本を読む。');
  });

  it('a typed sentence is capped at MAX_CUSTOM_SENTENCE glyphs without splitting a surrogate pair (#42)', () => {
    expect(MAX_CUSTOM_SENTENCE).toBe(48);
    const long = '続'.repeat(60);
    expect(clampSentence(long)).toBe('続'.repeat(48));
    const astral = '𠮷'.repeat(47) + '野家です';
    expect(Array.from(clampSentence(astral)).length).toBe(48);
    expect(clampSentence(astral).endsWith('𠮷野')).toBe(true);
    const base = sampleData(1);
    const custom = personalize(base, { sentence: CUSTOM_SENTENCE, custom: ` ${long} `, kanji: '' });
    expect(custom.sentenceOfChoice).toBe('続'.repeat(48));
  });

  it('sentenceCandidates lists plain example sentences of Mastered words from the loader', async () => {
    await makeTestStore({ cards: BROWN_CARDS });
    const c = sentenceCandidates(createFakeLoader());
    expect(c).toContain('私はハナです。');
    expect(c.some((s) => s.includes('{'))).toBe(false);
    await makeTestStore();
    expect(sentenceCandidates(createFakeLoader())).toEqual([]);
  });
});

describe('<StudioPage>', () => {
  it('a locked wallpaper shows the condition and quadrant progress instead of the export controls', async () => {
    const rec = recorder();
    await mount('great-wave', rec);
    const page = q<HTMLElement>('.studio');
    expect(page.dataset.state).toBe('locked');
    expect(root.querySelector('[data-action="export"]')).toBeNull();
    expect(root.querySelector('[data-action="reforge"]')).toBeNull();
    expect(root.querySelector('#studio-sentence')).toBeNull();
    const locked = q<HTMLElement>('.studio__locked');
    expect(locked.textContent).toContain('Not yet.');
    expect(locked.textContent).toContain(WALLPAPER_DEFS.find((d) => d.id === 'great-wave')!.describe);
    expect(locked.textContent).toContain('2 of 4 quadrants revealed.');
    expect(locked.textContent).toContain('60 % toward the unlock');
    expect(art().getAttribute('aria-label')).toBe('Sumi silhouette of Great Wave of Words');
    expect(art().innerHTML).toContain('wp-reveal');
    expect(art().innerHTML).not.toContain('ハナ');
  });

  it('an unlocked wallpaper previews with the learner text, toggles orientation and lists gated resolutions', async () => {
    const rec = recorder();
    await mount('torii-dawn', rec);
    expect(q<HTMLElement>('.studio').dataset.state).toBe('unlocked');
    expect(art().getAttribute('aria-label')).toBe('Preview of Torii at Dawn');
    expect(art().innerHTML).toContain('ハナ');
    expect(art().innerHTML).toContain('続');
    const labels = (): string[] => Array.from(root.querySelectorAll('.studio__res span')).map((s) => s.textContent ?? '');
    expect(labels()).toEqual(['1920 × 1080', '2560 × 1440']);
    expect(root.textContent).toContain('4K is for desktop browsers');
    act(() => q<HTMLButtonElement>('[data-size="phone"]').click());
    expect(q<HTMLElement>('.studio').dataset.size).toBe('phone');
    expect(labels()).toEqual(['1080 × 2340', '1170 × 2532', '1290 × 2796']);
    expect(root.textContent).not.toContain('4K needs a desktop');
    expect(art().innerHTML).toContain('viewBox="0 0 1080 2340"');
  });

  it('export invokes the pipeline at the chosen size with the raster post pass, then offers download and copy', async () => {
    const rec = recorder();
    await mount('torii-dawn', rec);
    const radios = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="studio-resolution"]'));
    act(() => {
      radios[1]!.click();
      radios[1]!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(radios[1]!.checked).toBe(true);
    await act(async () => {
      q<HTMLButtonElement>('[data-action="export"]').click();
    });
    await settleStatus();
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]).toMatchObject({ width: 2560, height: 1440, post: 'grain' });
    expect(rec.calls[0]!.svg).not.toContain('wp-');
    expect(rec.calls[0]!.texts.length).toBeGreaterThan(0);
    expect(rec.saved).toEqual(['tsuzuku-torii-dawn-desktop-2026-01-15.png']);
    expect(q<HTMLElement>('.studio__status').textContent).toBe('Saved tsuzuku-torii-dawn-desktop-2026-01-15.png.');
    const copy = q<HTMLButtonElement>('[data-action="copy"]');
    expect(copy).not.toBeNull();
    await act(async () => {
      copy.click();
      await Promise.resolve();
    });
    expect(rec.copied).toHaveLength(1);
    expect(q<HTMLElement>('.studio__status').textContent).toBe('Copied.');
  });

  it('hides the copy button without an image clipboard and reports an unavailable rasteriser honestly', async () => {
    const rec = recorder('null');
    await mount('torii-dawn', rec, { clipboard: false });
    await act(async () => {
      q<HTMLButtonElement>('[data-action="export"]').click();
    });
    await settleStatus();
    expect(rec.saved).toEqual([]);
    expect(root.querySelector('[data-action="copy"]')).toBeNull();
    expect(q<HTMLElement>('.studio__status').textContent).toContain('cannot draw the image');
    expect(q<HTMLButtonElement>('[data-action="export"]').disabled).toBe(false);
  });

  it('reforge increments the counter once per day and redraws with a new brush', async () => {
    const rec = recorder();
    await mount('torii-dawn', rec);
    const before = art().innerHTML;
    const btn = q<HTMLButtonElement>('[data-action="reforge"]');
    expect(btn.disabled).toBe(false);
    expect(root.textContent).toContain('Same picture, new brush.');
    act(() => btn.click());
    const e = store.collections.value.wallpapers['torii-dawn']!;
    expect(e.reforges).toBe(1);
    expect(e.lastReforgeDay).toBe(TODAY);
    expect(e.at).toBe(DAY);
    expect(q<HTMLButtonElement>('[data-action="reforge"]').disabled).toBe(true);
    expect(root.textContent).toContain('Reforged today.');
    expect(root.textContent).toContain('Brush 2');
    expect(art().innerHTML).not.toBe(before);
    act(() => q<HTMLButtonElement>('[data-action="reforge"]').click());
    expect(store.collections.value.wallpapers['torii-dawn']!.reforges).toBe(1);
  });

  it('personalisation: dropping the seal removes the kanji layer; a custom sentence field appears on demand', async () => {
    const rec = recorder();
    await mount('torii-dawn', rec, { cards: BROWN_CARDS });
    const kanji = q<HTMLSelectElement>('#studio-kanji');
    expect(Array.from(kanji.options).map((o) => o.value)).toContain('続');
    expect(kanji.value).toBe('続');
    act(() => {
      kanji.value = '';
      kanji.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(art().innerHTML).not.toContain('>続<');
    const sentence = q<HTMLSelectElement>('#studio-sentence');
    expect(Array.from(sentence.options).map((o) => o.value)).toContain('私はハナです。');
    expect(root.querySelector('#studio-custom')).toBeNull();
    act(() => {
      sentence.value = CUSTOM_SENTENCE;
      sentence.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const custom = q<HTMLInputElement>('#studio-custom');
    expect(custom.maxLength).toBe(MAX_CUSTOM_SENTENCE);
  });

  it('the 4K hint explains the desktop gate without naming a memory figure (#41)', async () => {
    const rec = recorder();
    await mount('torii-dawn', rec, { cards: BROWN_CARDS });
    expect(q<HTMLElement>('.studio').dataset.size).toBe('desktop');
    const hints = Array.from(root.querySelectorAll<HTMLElement>('.studio__hint')).map((h) => h.textContent ?? '');
    const gate = hints.find((t) => t.includes('4K'));
    expect(gate).toBeDefined();
    expect(gate).toContain('2560 × 1440');
    expect(gate).not.toMatch(/GB/);
  });
});
