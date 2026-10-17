import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ComponentDef, KanjiItem } from '@/content/types';
import type { AttemptResult, ExerciseProps } from '@/shared/exercise-types';
import { mulberry32 } from '@/shared/hash';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { makeTestStore } from '@/store/testing';

// The component pool comes from the content singleton; serve the fixture's components from it.
const H = vi.hoisted(() => ({ defs: [] as { id: string; char: string; name: string; variants?: string[]; hint?: string }[], fail: false }));
vi.mock('@/content/loader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/content/loader')>();
  return {
    ...orig,
    content: {
      ...orig.content,
      components: () => (H.fail ? Promise.reject(new Error('offline')) : Promise.resolve(new Map(H.defs.map((d) => [d.id, d])))),
    },
  };
});

import { FIXTURE } from '@/content/fixtures';
import { ComponentAssembly, TILE_COUNT, buildTiles, fastTiles, isKanjiItem, meta, resolveParts, sameSet } from './ComponentAssembly';

const DEFS = new Map(FIXTURE.components.map((c) => [c.id, c]));
/** Ten components so eight tiles can be filled from a real pool. */
const EXTRA: ComponentDef[] = [
  { id: 'c-tree', char: '木', name: 'tree' },
  { id: 'c-water', char: '水', name: 'water' },
  { id: 'c-fire', char: '火', name: 'fire' },
  { id: 'c-mouth', char: '口', name: 'mouth' },
  { id: 'c-earth', char: '土', name: 'earth' },
  { id: 'c-moon', char: '月', name: 'moon' },
];
const POOL = new Map([...DEFS, ...EXTRA.map((c) => [c.id, c] as const)]);
const DRINK = FIXTURE.items['j-飲'] as KanjiItem; // components: eat, yawn
const PERSON = FIXTURE.items['j-人'] as KanjiItem; // components: person

let root: HTMLDivElement;
beforeAll(async () => {
  await makeTestStore({ now: 50_000 });
});
beforeEach(() => {
  H.defs = [...FIXTURE.components, ...EXTRA];
  H.fail = false;
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function step(over: Partial<Step> = {}): Step {
  return {
    id: 'ca-1',
    block: 'reviews',
    exercise: 'component-assembly',
    itemId: DRINK.id,
    cardKey: 'j-飲#comp',
    params: { layout: 'lr' },
    timed: false,
    isNew: false,
    stepTag: null,
    exposures: 1,
    estMs: 9000,
    ...over,
  };
}

function props(over: Partial<ExerciseProps> = {}): ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> } {
  return {
    step: step(),
    item: DRINK,
    feel: 'dojo',
    furigana: 'always',
    jj: false,
    speedTier: 3,
    exposures: 1,
    onResult: vi.fn<(r: AttemptResult) => void>(),
    onHint: vi.fn(),
    onReplay: vi.fn(),
    requestJudge: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as ExerciseProps & { onResult: ReturnType<typeof vi.fn>; onHint: ReturnType<typeof vi.fn> };
}

function inFrame(children: preact.ComponentChildren, s: Step): preact.JSX.Element {
  return (
    <ExerciseFrame step={s} index={0} total={3} ki={0} combo={0} comboTier={0} timer={null} feel="dojo" feedback={null} now={() => 0} onGuard={() => undefined} onHint={() => undefined} onPause={() => undefined} onContinue={() => undefined}>
      {children}
    </ExerciseFrame>
  );
}

async function mount(pr: ExerciseProps, framed = false): Promise<void> {
  act(() => render(framed ? inFrame(<ComponentAssembly {...pr} />, pr.step) : <ComponentAssembly {...pr} />, root));
  await act(async () => {
    await Promise.resolve();
  });
}

function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const tiles = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.kj-tile'));
const slots = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.kj-slot'));
const tileFor = (ch: string): HTMLButtonElement => tiles().find((b) => b.textContent?.startsWith(ch) || b.textContent?.replace(/^\d/, '').startsWith(ch)) as HTMLButtonElement;
const check = (): HTMLButtonElement => root.querySelector('.hanko') as HTMLButtonElement;
const q = (sel: string): HTMLElement | null => root.querySelector(sel);

describe('ComponentAssembly helpers', () => {
  it('meta: component-assembly on the comp facet with choice keys', () => {
    expect(meta).toMatchObject({ id: 'component-assembly', facet: 'comp', keys: 'choices', selfGraded: false });
    expect(isKanjiItem(DRINK)).toBe(true);
    expect(isKanjiItem(FIXTURE.items['c-eat'])).toBe(false);
  });

  it('resolveParts maps keywords to glyphs by name or by c-<kebab> id and degrades to a text tile', () => {
    const parts = resolveParts(['eat', 'Yawn', 'ladder'], DEFS);
    expect(parts.map((t) => t.char)).toEqual(['食', '欠', 'ladder']);
    expect(parts[2]).toMatchObject({ text: true, key: 'name:ladder' });
    expect(resolveParts(['person'], new Map([['c-person', { id: 'c-person', char: '人', name: 'man' }]]))[0]?.char).toBe('人');
  });

  it('buildTiles yields eight distinct tiles containing the answer, seeded and stable, preferring distractorIds', () => {
    const answer = resolveParts(DRINK.components, POOL);
    const a = buildTiles(answer, POOL, mulberry32(3));
    const b = buildTiles(answer, POOL, mulberry32(3));
    expect(a.map((t) => t.key)).toEqual(b.map((t) => t.key));
    expect(a.length).toBe(TILE_COUNT);
    expect(new Set(a.map((t) => t.key)).size).toBe(TILE_COUNT);
    expect(a.some((t) => t.char === '食')).toBe(true);
    expect(a.some((t) => t.char === '欠')).toBe(true);
    const pref = buildTiles(answer, POOL, mulberry32(3), 4, ['c-moon', 'c-fire']);
    expect(pref.map((t) => t.key).sort()).toEqual(['c-eat', 'c-fire', 'c-moon', 'c-yawn']);
    // a small pool gives fewer tiles, never duplicates
    expect(buildTiles(answer, DEFS, mulberry32(1)).length).toBe(4);
  });

  it('fastTiles builds from params.accept + params.choices and sameSet ignores order', () => {
    expect(fastTiles({})).toBeNull();
    const f = fastTiles({ accept: ['食', '欠'], choices: ['欠', '人', '食', '日'] });
    expect(f?.answer.map((t) => t.char)).toEqual(['食', '欠']);
    expect(f?.tiles.map((t) => t.char)).toEqual(['欠', '人', '食', '日']);
    expect(fastTiles({ accept: ['食'], choices: ['人'] })?.tiles.map((t) => t.char)).toEqual(['人', '食']);
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('<ComponentAssembly>', () => {
  it('shows the loading state, then meaning, reading, two slots and eight tiles from the pool', async () => {
    const pr = props();
    act(() => render(<ComponentAssembly {...pr} />, root));
    expect(root.textContent).toContain('Fetching the parts');
    await act(async () => {
      await Promise.resolve();
    });
    expect(root.textContent).toContain('drink');
    expect(root.textContent).toContain('イン');
    expect(slots().length).toBe(2);
    expect(tiles().length).toBe(TILE_COUNT);
    expect(q('.kj-frame')?.getAttribute('data-layout')).toBe('lr');
    expect(root.textContent).toContain('left and right');
    expect(check().disabled).toBe(true);
  });

  it('the exact set in canonical order → correct, parts and mnemonic revealed, slots marked', async () => {
    const pr = props();
    await mount(pr);
    act(() => tileFor('食').click());
    act(() => tileFor('欠').click());
    expect(slots().map((s) => s.textContent)).toEqual(['食', '欠']);
    expect(check().disabled).toBe(false);
    act(() => check().click());
    expect(pr.onResult).toHaveBeenCalledTimes(1);
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, nearMiss: false, hintUsed: false, errorTags: [], answer: '食欠', ms: 0 });
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('correct');
    expect(q('[data-parts="true"]')?.textContent).toContain('食 eat');
    expect(root.textContent).toContain(DRINK.mnemonic);
    expect(slots().map((s) => s.getAttribute('data-state'))).toEqual(['correct', 'correct']);
    expect(q('[data-order-note="true"]')).toBeNull();
  });

  it('the exact set in swapped order is still correct on a left-right frame, with a note on where the first part sits', async () => {
    const pr = props();
    await mount(pr, true);
    act(() => tileFor('欠').click());
    act(() => tileFor('食').click());
    press('Enter');
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, errorTags: [] });
    expect(q('[data-order-note="true"]')?.textContent).toBe('Right parts. In this kanji, eat sits on the left.');
  });

  it('an enclosure frame accepts any order without a note', async () => {
    const pr = props({ step: step({ params: { layout: 'enc' } }) });
    await mount(pr);
    act(() => tileFor('欠').click());
    act(() => tileFor('食').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true });
    expect(q('[data-order-note="true"]')).toBeNull();
    expect(root.textContent).toContain('outside and inside');
  });

  it('a wrong set → Again tagged kanji-meaning; the wrong slot and the missed tile are marked by shape', async () => {
    const pr = props();
    await mount(pr);
    act(() => tileFor('食').click());
    act(() => tileFor('木').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: false, nearMiss: false, errorTags: ['kanji-meaning'], answer: '食木' });
    expect(slots().map((s) => s.getAttribute('data-state'))).toEqual(['correct', 'wrong']);
    expect(tileFor('欠').getAttribute('data-state')).toBe('missed');
    expect(q('.kj__reveal')?.getAttribute('data-kind')).toBe('wrong');
    // locked afterwards: tiles and slots are inert, the Check button is gone
    expect(tiles().every((t) => t.disabled)).toBe(true);
    expect(slots().every((s) => s.disabled)).toBe(true);
    expect(root.querySelector('.hanko')).toBeNull();
    expect(pr.onResult).toHaveBeenCalledTimes(1);
  });

  it('digits pick tiles through the frame, a filled slot can be removed, Clear empties, a full frame refuses more', async () => {
    const pr = props();
    await mount(pr, true);
    const idx = (ch: string): number => Number(tileFor(ch).getAttribute('data-index'));
    press(String(idx('木') + 1));
    expect(slots()[0]?.textContent).toBe('木');
    act(() => (slots()[0] as HTMLButtonElement).click());
    expect(slots()[0]?.getAttribute('data-filled')).toBe('false');
    press(String(idx('食') + 1));
    press(String(idx('欠') + 1));
    press(String(idx('木') + 1));
    expect(slots().map((s) => s.textContent)).toEqual(['食', '欠']);
    expect(tileFor('木').disabled).toBe(true);
    const clear = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Clear') as HTMLButtonElement;
    act(() => clear.click());
    expect(slots().every((s) => s.getAttribute('data-filled') === 'false')).toBe(true);
    expect(pr.onResult).not.toHaveBeenCalled();
  });

  it('the mnemonic hint calls onHint and sets hintUsed on the result', async () => {
    const pr = props();
    await mount(pr);
    const hint = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Show the mnemonic') as HTMLButtonElement;
    act(() => hint.click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    expect(q('[data-hint="true"]')?.textContent).toContain(DRINK.mnemonic);
    act(() => hint.click());
    expect(pr.onHint).toHaveBeenCalledTimes(1);
    act(() => tileFor('食').click());
    act(() => tileFor('欠').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('a single-part kanji has one slot; the fast path (params.accept + choices) needs no loader', async () => {
    H.fail = true;
    const s = step({ itemId: PERSON.id, cardKey: 'j-人#comp', params: { layout: 'tb', accept: ['人'], choices: ['日', '人', '食', '欠'] } });
    const pr = props({ step: s, item: PERSON });
    await mount(pr);
    expect(slots().length).toBe(1);
    expect(tiles().map((t) => t.textContent?.replace(/^\d/, ''))).toEqual(['日', '人', '食', '欠']);
    act(() => tileFor('人').click());
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, answer: '人' });
  });

  it('when the component pool cannot load it says so and Continue emits a shown-not-tested result', async () => {
    H.fail = true;
    const pr = props();
    await mount(pr);
    expect(q('.kj-asm')?.getAttribute('data-state')).toBe('unavailable');
    expect(root.textContent).toContain('not in the loaded content');
    expect(root.textContent).toContain('飲');
    act(() => check().click());
    expect(pr.onResult.mock.calls[0]?.[0]).toMatchObject({ correct: true, hintUsed: true });
  });

  it('without a kanji item it degrades honestly', async () => {
    const pr = props({ item: null, step: step({ itemId: null, cardKey: null }) });
    await mount(pr);
    expect(root.textContent).toContain('could not be built');
  });
});
