import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G, V, createFakeLoader } from '@/content/fixtures';
import type { ContentLoader } from '@/content/loader';
import { DRILL_IDS, type CardKey, type ContentItem, type GrammarItem, type KanjiItem, type VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices, type AudioService, type SpeakOptions } from '@/shared/audio';
import { mulberry32 } from '@/shared/hash';
import type { AttemptResult, Step } from '@/shared/session-types';
import { CardFlag, type CardTuple, type LogEntry } from '@/shared/store-types';
import { dayOf } from '@/shared/time';
import { store } from '@/store';
import { DEFAULT_TEST_NOW, card, makeTestStore } from '@/store/testing';
import { NemesisDossier, blank, daysUntilDuel, dossierFor, duelPrompt, meta, surfaceOf } from './NemesisDossier';

const fake = vi.hoisted(() => ({ loader: null as ContentLoader | null }));
vi.mock('@/content/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/content/loader')>();
  const content = new Proxy(actual.content, { get: (t, k) => Reflect.get(fake.loader ?? t, k) });
  return { ...actual, content };
});

const taberu = FIXTURE.items[V.食べる] as VocabItem; // confusables: [飲む]
const desu = FIXTURE.items[G.です] as GrammarItem;
const shoku = FIXTURE.items['j-食'] as KanjiItem;
const lookup = (id: string): ContentItem | undefined => FIXTURE.items[id];
const DUEL_IDX = DRILL_IDS.indexOf('nemesis-duel');
const DAY = 86_400_000;
const today = dayOf(DEFAULT_TEST_NOW, 'UTC');

const K_PROD = `${V.食べる}#prod` as CardKey;
const K_REC = `${V.食べる}#rec` as CardKey;
const K_LISTEN = `${V.食べる}#listen` as CardKey;

const nemesisCard = (lastDaysAgo: number, over: Partial<Parameters<typeof card>[0]> = {}): CardTuple =>
  card({ due: today, s: 2, d: 8, reps: 30, lapses: 8, state: 2, last: today - lastDaysAgo, flags: CardFlag.nemesis, ...over });

let root: HTMLDivElement;
let calls: { text: string; o?: SpeakOptions }[];

function fakeAudio(): AudioService {
  return {
    ...nullAudio,
    hasJaVoice: signal(true),
    speak: (text, o) => {
      calls.push({ text, o });
      return Promise.resolve();
    },
  };
}

async function setup(cards: Record<CardKey, CardTuple>, log: LogEntry[] = []): Promise<void> {
  await makeTestStore({ cards });
  for (const e of log) store.log.push(e);
}

beforeEach(() => {
  fake.loader = createFakeLoader(FIXTURE);
  calls = [];
  installServices({ audio: fakeAudio() });
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'nd-1',
    block: 'reviews',
    exercise: 'nemesis-duel',
    itemId: V.食べる,
    cardKey: null,
    params: {},
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 30,
    estMs: 20000,
    ...over,
  };
}

async function mount(s: Step, item: ContentItem | null = taberu) {
  const onResult = vi.fn<(r: AttemptResult) => void>();
  const onReplay = vi.fn();
  const onHint = vi.fn();
  await act(async () => {
    render(<NemesisDossier step={s} item={item} feel="dojo" furigana="always" jj={false} speedTier={3} exposures={30} onResult={onResult} onHint={onHint} onReplay={onReplay} requestJudge={() => Promise.resolve(true)} />, root);
    await Promise.resolve();
  });
  return { onResult, onReplay, onHint };
}

const q = <T extends Element>(sel: string): T | null => root.querySelector<T>(sel);
function click(el: Element | null): void {
  act(() => {
    (el as HTMLButtonElement | null)?.click();
  });
}
function type(text: string): void {
  const input = q<HTMLInputElement>('.text-answer input') as HTMLInputElement;
  for (const ch of text) {
    act(() => {
      input.value = input.value + ch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

describe('nemesis helpers', () => {
  it('meta follows the D export convention', () => {
    expect(meta).toMatchObject({ id: 'nemesis-duel', facet: null, keys: 'none', selfGraded: false, needsTts: true });
  });

  it('surfaceOf and blank', () => {
    expect(surfaceOf(taberu)).toBe('食べる');
    expect(surfaceOf(shoku)).toBe('食');
    expect(surfaceOf(desu)).toBe('〜です');
    expect(surfaceOf(null)).toBe('');
    expect(blank('パンを{食|た}べます。', '食べる', 'たべる')).toBe('パンを＿＿ます。');
    expect(blank('{水|みず}をください。', '水', 'みず')).toBe('＿＿をください。');
    expect(blank('いぬがいます。', 'ねこ', 'ねこ')).toBe('いぬがいます。');
  });

  it('dossierFor collects history rows, sentences, the confusable and duel progress', () => {
    const cards = { prod: nemesisCard(3), rec: card({ s: 40, reps: 12, lapses: 1, state: 2, last: today - 1 }) };
    const log: LogEntry[] = [
      [DEFAULT_TEST_NOW - 3 * DAY, K_PROD, 1, 2000, 0, 0],
      [DEFAULT_TEST_NOW - 10 * DAY, K_PROD, 1, 2000, 0, 0],
      [DEFAULT_TEST_NOW - 2 * DAY, K_PROD, 3, 1500, DUEL_IDX, 0],
      [DEFAULT_TEST_NOW - 2 * DAY + 1000, K_PROD, 3, 1500, DUEL_IDX, 0], // same day: counts once
    ];
    const d = dossierFor(taberu, V.食べる, cards, log, 'UTC', lookup);
    expect(d.rows).toEqual([
      { facet: 'prod', lapses: 8, reps: 30, lastMiss: today - 3, nemesis: true },
      { facet: 'rec', lapses: 1, reps: 12, lastMiss: null, nemesis: false },
    ]);
    expect(d.sentences).toEqual([{ ja: 'パンを{食|た}べます。', en: 'I eat bread.' }]);
    expect(d.confusables).toEqual([{ id: V.飲む, surface: '飲む', sub: 'のむ', gloss: 'to drink' }]);
    expect(d.wins).toBe(1);
    expect(d.next).toBe('prod'); // chain filtered to the item's facets (prod only → prod again)
    const k = dossierFor(shoku, 'j-食', {}, [], 'UTC', lookup);
    expect(k.sentences[0]).toEqual({ ja: '食べる', en: 'たべる — to eat' });
    expect(k.confusables).toEqual([]);
  });

  it('duelPrompt per facet: prod blanks the word, listen speaks it, rec asks the meaning; grammar cloze / prod; kanji read', () => {
    const prod = duelPrompt(taberu, 'prod', {}, mulberry32(1));
    expect(prod).toMatchObject({ mode: 'ja', promptJa: 'パンを＿＿ます。', promptEn: 'to eat', hint: 'I eat bread.' });
    expect(prod?.accept).toEqual(['食べる', 'たべる']);
    const listen = duelPrompt(taberu, 'listen', {}, mulberry32(1));
    expect(listen).toMatchObject({ mode: 'ja', speak: { text: '食べる', kana: 'たべる' }, accept: ['食べる', 'たべる'], missTags: ['listening'] });
    const rec = duelPrompt(taberu, 'rec', {}, mulberry32(1));
    expect(rec).toMatchObject({ mode: 'en', promptJa: '食べる', promptEn: 'たべる', accept: ['to eat'] });
    const cloze = duelPrompt(desu, 'cloze', {}, mulberry32(2));
    expect(cloze?.mode).toBe('ja');
    expect(cloze?.promptJa).toMatch(/＿＿。$/);
    expect(cloze?.accept[0]).toBe('です');
    const gprod = duelPrompt(desu, 'prod', {}, mulberry32(2));
    expect(gprod?.accept.length).toBeGreaterThanOrEqual(2);
    expect(gprod?.promptEn).toContain('〜です');
    const read = duelPrompt(shoku, 'read', {}, mulberry32(3));
    expect(read).toMatchObject({ mode: 'ja', missTags: ['kanji-reading'], particleSlip: false });
    expect(['たべる', 'たべもの']).toContain(read?.accept[0]);
    expect(duelPrompt(shoku, 'comp', {}, mulberry32(3))).toMatchObject({ mode: 'en', promptJa: '食', accept: ['eat', 'food'] });
    expect(duelPrompt(null, 'prod', {}, mulberry32(3))).toBeNull();
  });

  it('daysUntilDuel counts from the context window', () => {
    expect(daysUntilDuel(nemesisCard(5), [], today, K_PROD, 'UTC')).toBe(9);
    expect(daysUntilDuel(nemesisCard(20), [], today, K_PROD, 'UTC')).toBe(0);
  });
});

describe('<NemesisDossier> dossier', () => {
  it('renders the item, three-or-fewer sentences, the confusable side by side and the lapse history; Continue → correct:true', async () => {
    await setup({ [K_PROD]: nemesisCard(0), [K_REC]: card({ s: 40, reps: 12, lapses: 1, state: 2, last: today - 1 }) }, [[DEFAULT_TEST_NOW - 3 * DAY, K_PROD, 1, 2000, 0, 0]]);
    const { onResult } = await mount(step());
    expect(q('.nemesis')?.classList.contains('nemesis--dossier')).toBe(true);
    expect(q('.nemesis__surface')?.textContent).toBe('食べる');
    expect(q('.nemesis__intro')?.textContent).toBe('This one keeps slipping. Study the dossier; the duel comes later.');
    expect(q('.nemesis__sentences rt')?.textContent).toBe('た');
    const heads = Array.from(root.querySelectorAll('.nemesis__compare th')).map((th) => th.textContent);
    expect(heads).toEqual(['食べる', '飲む']);
    expect(q('.nemesis__compare tbody')?.textContent).toContain('to drink');
    expect(q('.nemesis__compare tbody')?.textContent).toContain('のむ');
    const history = Array.from(root.querySelectorAll('.nemesis__history li')).map((li) => li.textContent);
    expect(history[0]).toContain('production card');
    expect(history[0]).toContain('8 lapses');
    expect(history[0]).toContain('last missed 3 days ago');
    expect(history[1]).toContain('never missed');
    expect(q('.chip--accent')?.textContent).toBe('Duel 1 of 3');
    click(q('.nemesis__continue'));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, guard: false, hintUsed: false, errorTags: [] });
    expect(q('.nemesis__continue')).toBeNull();
    click(q('.nemesis__continue'));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('a context-phase card shows the dossier with the days until the duel; no confusable → honest line', async () => {
    await setup({ [`${V.人}#prod`]: nemesisCard(5) });
    await mount(step({ itemId: V.人, cardKey: `${V.人}#prod` }), FIXTURE.items[V.人] as VocabItem);
    expect(q('.nemesis')?.classList.contains('nemesis--dossier')).toBe(true);
    expect(q('.nemesis__intro')?.textContent).toBe('In context only for now. The duel opens in 9 days.');
    expect(q('.nemesis__none')?.textContent).toContain('No confusable');
  });

  it('a missing item still offers Continue', async () => {
    await setup({});
    const { onResult } = await mount(step({ itemId: 'v-n5-9999' }), null);
    expect(q('.nemesis__missing')).not.toBeNull();
    click(q('.nemesis__continue'));
    expect(onResult).toHaveBeenCalledTimes(1);
  });
});

describe('<NemesisDossier> duel', () => {
  it('runs a prod duel rep once the phase is duel: typed word → Good, progress line shown', async () => {
    await setup({ [K_PROD]: nemesisCard(20) }, [[DEFAULT_TEST_NOW - 2 * DAY, K_PROD, 3, 1500, DUEL_IDX, 0]]);
    const { onResult } = await mount(step({ cardKey: K_PROD }));
    expect(q('.nemesis')?.classList.contains('nemesis--duel')).toBe(true);
    expect(q('.chip--accent')?.textContent).toBe('Duel 2 of 3');
    expect(q('.nemesis__intro')?.textContent).toBe('Duel 2 of 3. Win on three different days to defeat it.');
    expect(q('.nemesis__ja')?.textContent).toBe('パンを＿＿ます。');
    expect(q('.nemesis__en')?.textContent).toBe('to eat');
    type('taberu');
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, errorTags: [], answer: 'たべる' });
    expect(q('.nemesis__line')?.textContent).toBe('Duel won. One step closer.');
    expect(q('.nemesis__line')?.getAttribute('data-kind')).toBe('correct');
  });

  it('a wrong duel answer is Again with the facet tag; hint caps at Hard', async () => {
    await setup({ [K_PROD]: nemesisCard(20) });
    const { onResult, onHint } = await mount(step({ cardKey: K_PROD }));
    click(q('.nemesis__tools button'));
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(q('.nemesis__hint')?.textContent).toContain('I eat bread.');
    type('nomu');
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, hintUsed: true, errorTags: ['word-choice'] });
    expect(q('.nemesis__line')?.textContent).toBe('The nemesis holds. Tomorrow again.');
  });

  it('a listen duel speaks the word on mount, replays on demand and forwards onReplay', async () => {
    await setup({ [K_LISTEN]: nemesisCard(20) });
    const { onReplay, onResult } = await mount(step({ cardKey: K_LISTEN }));
    expect(calls).toEqual([{ text: '食べる', o: { kana: 'たべる' } }]);
    expect(q('.nemesis__ja')).toBeNull();
    await act(async () => {
      (q('.nemesis__play') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(calls).toHaveLength(2);
    expect(onReplay).toHaveBeenCalledTimes(1);
    type('taberu');
    expect(onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
  });

  it('a card that is not flagged still duels, with the honest intro', async () => {
    await setup({ [K_REC]: card({ s: 40, reps: 12, lapses: 1, state: 2, last: today - 1 }) });
    await mount(step({ cardKey: K_REC }));
    expect(q('.nemesis')?.classList.contains('nemesis--duel')).toBe(true);
    expect(q('.nemesis__intro')?.textContent).toBe('Not a Nemesis yet. A review, then.');
    expect(q('.text-answer')?.getAttribute('data-mode')).toBe('en');
  });
});
