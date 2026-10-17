import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FIXTURE, G, V } from '@/content/fixtures';
import type { GrammarItem, VocabItem } from '@/content/types';
import { installServices, nullAudio, resetServices, type AudioService } from '@/shared/audio';
import { Gloss, headwordRuby, isGrammarItem, isKanjiItem, isVocabItem, pitchMorae, pitchType } from './Gloss';
import { S } from './strings';

const NOMU = FIXTURE.items[V.飲む] as VocabItem; // 飲む のむ pitch 1, collocations
const MIZU = FIXTURE.items[V.水] as VocabItem; // 水 みず pitch 0
const WA = FIXTURE.items[G.は] as GrammarItem;
const NOMU_JJ: VocabItem = { ...NOMU, definitionJa: { ja: '{水|みず}やお{茶|ちゃ}を{口|くち}に{入|い}れること', kana: 'みずやおちゃをくちにいれること' } };

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetServices();
});

const q = (sel: string): HTMLElement | null => root.querySelector(sel);
const text = (sel: string): string => q(sel)?.textContent ?? '';

function mount(over: Partial<Parameters<typeof Gloss>[0]> = {}): { onCapture: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const onCapture = vi.fn();
  const onClose = vi.fn();
  act(() => render(<Gloss item={NOMU} token="飲みます" jj={false} onCapture={onCapture} onClose={onClose} {...over} />, root));
  return { onCapture, onClose };
}

describe('Gloss helpers', () => {
  it('guards tell vocab, grammar and kanji apart', () => {
    expect(isVocabItem(NOMU)).toBe(true);
    expect(isGrammarItem(NOMU)).toBe(false);
    expect(isGrammarItem(WA)).toBe(true);
    expect(isKanjiItem(FIXTURE.items['j-飲'])).toBe(true);
    expect(isKanjiItem(NOMU)).toBe(false);
    expect(isVocabItem(null)).toBe(false);
  });

  it('pitchType follows the nucleus: 0 flat, 1 head-high, n = mora count tail-high, else mid-high', () => {
    expect(pitchType(0, 'みず')).toBe('heiban');
    expect(pitchType(1, 'のむ')).toBe('atamadaka');
    expect(pitchType(2, 'いぬ')).toBe('odaka');
    expect(pitchType(2, 'たべる')).toBe('nakadaka');
    expect(pitchType(3, 'コーヒー')).toBe('nakadaka'); // コ ー ヒ ー = 4 morae
  });

  it('pitchMorae marks highs per mora', () => {
    expect(pitchMorae(0, 'みず').map((m) => m.high)).toEqual([false, true]);
    expect(pitchMorae(1, 'のむ').map((m) => m.high)).toEqual([true, false]);
    expect(pitchMorae(2, 'たべる').map((m) => m.high)).toEqual([false, true, false]);
    expect(pitchMorae(2, 'たべる').map((m) => m.mora)).toEqual(['た', 'べ', 'る']);
  });

  it('headwordRuby wraps kanji headwords and leaves kana words plain', () => {
    expect(headwordRuby(NOMU)).toBe('{飲む|のむ}');
    expect(headwordRuby(FIXTURE.items[V.おいしい] as VocabItem)).toBe('おいしい');
    expect(headwordRuby(FIXTURE.items[V.コーヒー] as VocabItem)).toBe('コーヒー');
  });
});

describe('<Gloss>', () => {
  it('shows the J-E meaning, kana, pitch and collocations through Green (jj off)', () => {
    mount();
    expect(q('[role="dialog"]')).not.toBeNull();
    expect(text('[data-field="meanings"]')).toContain('to drink');
    expect(text('[data-field="reading"]')).toBe('のむ');
    expect(text('[data-field="pitch"]')).toContain(S.pitchType.atamadaka);
    expect(q('[data-field="collocations"]')?.querySelectorAll('li').length).toBe(2);
    expect(q('[data-field="definition"]')).toBeNull();
    expect(q('[data-action="show-en"]')).toBeNull();
    // Japanese carries lang="ja"
    expect(q('.gloss__word')?.getAttribute('lang')).toBe('ja');
  });

  it('jj hides English behind a tap when a J-J definition exists', () => {
    mount({ item: NOMU_JJ, jj: true });
    expect(q('[data-field="definition"]')).not.toBeNull();
    expect(q('[data-field="meanings"]')).toBeNull();
    const show = q('[data-action="show-en"]') as HTMLButtonElement;
    expect(show.textContent).toBe(S.glossShowEnglish);
    act(() => show.click());
    expect(text('[data-field="meanings"]')).toContain('to drink');
    expect(q('[data-action="show-en"]')).toBeNull();
  });

  it('jj without a definitionJa falls back to the English meaning', () => {
    mount({ item: NOMU, jj: true });
    expect(q('[data-field="definition"]')).toBeNull();
    expect(text('[data-field="meanings"]')).toContain('to drink');
  });

  it('offers Capture for an unknown word and calls onCapture', () => {
    const { onCapture } = mount({ item: MIZU, token: '水', capture: 'capture' });
    const btn = q('[data-action="capture"]') as HTMLButtonElement;
    expect(btn.textContent).toContain(S.capture);
    act(() => btn.click());
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('defaults to Capture for a vocab item and disables the button once captured', () => {
    mount({ item: MIZU, token: '水' });
    expect(q('[data-action="capture"]')).not.toBeNull();
    render(null, root);
    mount({ item: MIZU, token: '水', capture: 'captured' });
    const btn = q('[data-action="captured"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(q('[data-action="capture"]')).toBeNull();
  });

  it('an introduced word shows "In training" and no capture button', () => {
    mount({ capture: 'introduced' });
    expect(q('[data-field="in-training"]')).not.toBeNull();
    expect(q('[data-action="capture"]')).toBeNull();
    expect(q('[data-action="bookmark"]')).toBeNull();
  });

  it('a token without an item shows the surface, its reading and a Bookmark', () => {
    const { onCapture } = mount({ item: null, token: 'います', reading: 'います' });
    expect(text('.gloss__word')).toBe('います');
    expect(q('[data-field="no-item"]')?.textContent).toBe(S.glossNoItem);
    const btn = q('[data-action="bookmark"]') as HTMLButtonElement;
    act(() => btn.click());
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it('shows the ruby reading of a kanji token the corpus lacks', () => {
    mount({ item: null, token: '三人', reading: 'さんにん' });
    expect(text('[data-field="reading"]')).toBe('さんにん');
  });

  it('shows the loading line while the item is fetched', () => {
    mount({ item: null, loading: true });
    expect(q('[role="status"]')?.textContent).toBe(S.glossLoading);
    expect(q('[data-field="no-item"]')).toBeNull();
  });

  it('renders a grammar point as pattern, meaning and formation', () => {
    mount({ item: WA, token: 'は' });
    expect(text('[data-field="pattern"]')).toBe('〜は');
    expect(text('[data-field="meanings"]')).toContain('topic');
    expect(text('[data-field="formation"]')).toBe(WA.formation[0] as string);
  });

  it('renders a kanji item with meanings and readings', () => {
    mount({ item: FIXTURE.items['j-飲'] ?? null, token: '飲' });
    expect(text('[data-field="meanings"]')).toBe('drink');
    expect(text('[data-field="readings"]')).toContain('イン');
  });

  it('Say it speaks the word with its kana reading', () => {
    const spoken: [string, unknown][] = [];
    const audio: AudioService = { ...nullAudio, speak: (t, o) => ((spoken.push([t, o]), Promise.resolve())) };
    installServices({ audio });
    mount();
    act(() => (q('[data-action="speak"]') as HTMLButtonElement).click());
    expect(spoken).toEqual([['飲む', { kana: 'のむ' }]]);
  });

  it('Say it on a bare token uses the token and its reading', () => {
    const spoken: [string, unknown][] = [];
    const audio: AudioService = { ...nullAudio, speak: (t, o) => ((spoken.push([t, o]), Promise.resolve())) };
    installServices({ audio });
    mount({ item: null, token: '三人', reading: 'さんにん' });
    act(() => (q('[data-action="speak"]') as HTMLButtonElement).click());
    expect(spoken).toEqual([['三人', { kana: 'さんにん' }]]);
  });

  it('closes on Escape, the close button and the backdrop', () => {
    const { onClose } = mount();
    const dialog = q('[role="dialog"]') as HTMLElement;
    expect(document.activeElement).toBe(dialog);
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => (q('[data-action="close"]') as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => (q('[data-testid="gloss-backdrop"]') as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('resets the English reveal when the item changes', () => {
    const onCapture = vi.fn();
    const onClose = vi.fn();
    act(() => render(<Gloss item={NOMU_JJ} token="飲みます" jj onCapture={onCapture} onClose={onClose} />, root));
    act(() => (q('[data-action="show-en"]') as HTMLButtonElement).click());
    expect(q('[data-field="meanings"]')).not.toBeNull();
    const other: VocabItem = { ...MIZU, definitionJa: { ja: '{飲|の}むもの', kana: 'のむもの' } };
    act(() => render(<Gloss item={other} token="水" jj onCapture={onCapture} onClose={onClose} />, root));
    expect(q('[data-field="meanings"]')).toBeNull();
    expect(q('[data-action="show-en"]')).not.toBeNull();
  });
});
