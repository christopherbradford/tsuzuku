/**
 * capture.ts — over `makeTestStore` + `bus.reset()`.
 */
import { V } from '../../content/fixtures';
import { bus } from '../../shared/events';
import { epochDay } from '../../shared/time';
import { resetStoreForTests, store } from '../../store';
import { DEFAULT_TEST_NOW, captureEvents, card, makeTestStore } from '../../store/testing';
import {
  GLOSS_DUE_WINDOW,
  bookmarkText,
  captureItem,
  glossFacetFor,
  isCapturableId,
  isCaptured,
  onGlossTap,
  releaseCapture,
} from './capture';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const SESSION = 'sess-1';

afterEach(() => {
  resetStoreForTests();
  bus.reset();
});

describe('isCapturableId', () => {
  it('accepts item ids, rejects stories / stations / nothing', () => {
    expect(isCapturableId(V.犬)).toBe(true);
    expect(isCapturableId('j-食')).toBe(true);
    expect(isCapturableId('g-n5-001')).toBe(true);
    expect(isCapturableId('k-h-a')).toBe(true);
    expect(isCapturableId('c-person')).toBe(true);
    expect(isCapturableId('s-04-1')).toBe(false);
    expect(isCapturableId('st-04')).toBe(false);
    expect(isCapturableId('m-04-1')).toBe(false);
    expect(isCapturableId('cj-0001')).toBe(false);
    expect(isCapturableId(null)).toBe(false);
    expect(isCapturableId(undefined)).toBe(false);
    expect(isCapturableId('')).toBe(false);
    expect(isCapturableId('weird')).toBe(false);
  });
});

describe('onGlossTap — unintroduced word', () => {
  it('captures once (dedupe) and reports already-captured on the second tap', async () => {
    await makeTestStore();
    const cap = captureEvents();
    const first = onGlossTap({ token: '犬', itemId: V.犬, introduced: false, dueWithin3: false, sessionId: SESSION });
    expect(first).toEqual({ kind: 'captured', itemId: V.犬 });
    expect(store.captured.value).toEqual([V.犬]);
    expect(isCaptured(V.犬)).toBe(true);

    const second = onGlossTap({ token: '犬', itemId: V.犬, introduced: false, dueWithin3: true, sessionId: SESSION });
    expect(second.kind).toBe('already-captured');
    expect(store.captured.value).toEqual([V.犬]);
    cap.stop();
    // no attempt:graded, no bookmarks, no cards created
    expect(cap.events.map((e) => e[0])).not.toContain('attempt:graded');
    expect(store.bookmarks.value).toEqual([]);
    expect(store.cards.count()).toBe(0);
  });

  it('keeps earlier captures and appends in tap order', async () => {
    await makeTestStore({ save: { captured: [V.水] } });
    onGlossTap({ token: '犬', itemId: V.犬, introduced: false, dueWithin3: false, sessionId: SESSION });
    onGlossTap({ token: 'パン', itemId: V.パン, introduced: false, dueWithin3: false, sessionId: SESSION });
    expect(store.captured.value).toEqual([V.水, V.犬, V.パン]);
  });

  it('a token without an item id becomes a free-text bookmark, deduped', async () => {
    await makeTestStore();
    expect(onGlossTap({ token: 'りんご', introduced: false, dueWithin3: false, sessionId: SESSION })).toEqual({ kind: 'bookmarked', itemId: null });
    expect(onGlossTap({ token: 'りんご', itemId: null, introduced: false, dueWithin3: false, sessionId: SESSION }).kind).toBe('already-bookmarked');
    expect(store.bookmarks.value).toEqual(['りんご']);
    expect(store.captured.value).toEqual([]);
  });

  it('a non-item id (story) is treated like no id', async () => {
    await makeTestStore();
    expect(onGlossTap({ token: 'ケン', itemId: 's-04-1', introduced: false, dueWithin3: false, sessionId: SESSION }).kind).toBe('bookmarked');
    expect(store.captured.value).toEqual([]);
  });
});

describe('onGlossTap — introduced word', () => {
  it('due → recordImplicit Hard on the rec card: card rescheduled, log row, no attempt:graded', async () => {
    const key = `${V.犬}#rec` as const;
    await makeTestStore({ cards: { [key]: card({ due: TODAY, s: 5, d: 5, reps: 4, state: 2, last: TODAY - 5 }) } });
    const before = store.cards.get(key);
    const cap = captureEvents();
    const r = onGlossTap({ token: '犬', itemId: V.犬, introduced: true, dueWithin3: true, sessionId: SESSION });
    cap.stop();
    expect(r.kind).toBe('implicit-hard');
    expect(r.cardKey).toBe(key);
    expect(r.implicit?.card).toBeDefined();
    const after = store.cards.get(key);
    expect(after).not.toEqual(before);
    expect(after?.[3]).toBe(5); // reps + 1
    expect(after?.[0]).toBeGreaterThan(TODAY); // rescheduled forward
    const log = store.log.recent(10);
    expect(log.length).toBe(1);
    expect(log[0]?.[1]).toBe(key);
    expect(log[0]?.[2]).toBe(2); // Hard
    expect(cap.events.map((e) => e[0])).not.toContain('attempt:graded');
    expect(store.captured.value).toEqual([]);
  });

  it('not in the caller window (dueWithin3 false) → none, nothing written', async () => {
    const key = `${V.犬}#rec` as const;
    await makeTestStore({ cards: { [key]: card({ due: TODAY, s: 5, reps: 4, state: 2, last: TODAY - 5 }) } });
    const before = store.cards.get(key);
    const r = onGlossTap({ token: '犬', itemId: V.犬, introduced: true, dueWithin3: false, sessionId: SESSION });
    expect(r).toEqual({ kind: 'none', itemId: V.犬 });
    expect(store.cards.get(key)).toEqual(before);
    expect(store.log.recent(10)).toEqual([]);
  });

  it('the writer re-checks the 3-day window: a card due far in the future is skipped', async () => {
    const key = `${V.犬}#rec` as const;
    await makeTestStore({ cards: { [key]: card({ due: TODAY + GLOSS_DUE_WINDOW + 1, s: 30, reps: 4, state: 2, last: TODAY - 5 }) } });
    const before = store.cards.get(key);
    const r = onGlossTap({ token: '犬', itemId: V.犬, introduced: true, dueWithin3: true, sessionId: SESSION });
    expect(r.kind).toBe('none');
    expect(r.cardKey).toBe(key);
    expect(store.cards.get(key)).toEqual(before);
  });

  it('a card due exactly 3 days out is inside the window', async () => {
    const key = `${V.犬}#rec` as const;
    await makeTestStore({ cards: { [key]: card({ due: TODAY + GLOSS_DUE_WINDOW, s: 10, reps: 4, state: 2, last: TODAY - 5 }) } });
    expect(onGlossTap({ token: '犬', itemId: V.犬, introduced: true, dueWithin3: true, sessionId: SESSION }).kind).toBe('implicit-hard');
  });

  it('a chunk (prod-only item) is graded on its prod card', async () => {
    const key = `${V.はい}#prod` as const;
    await makeTestStore({ cards: { [key]: card({ due: TODAY, s: 5, reps: 4, state: 2, last: TODAY - 5 }) } });
    expect(glossFacetFor(V.はい)).toBe('prod');
    const r = onGlossTap({ token: 'はい', itemId: V.はい, introduced: true, dueWithin3: true, sessionId: SESSION });
    expect(r.kind).toBe('implicit-hard');
    expect(r.cardKey).toBe(key);
  });

  it('introduced but no base card at all → none', async () => {
    await makeTestStore({ cards: { [`${V.犬}#listen`]: card({ due: TODAY, s: 5, reps: 2, state: 2 }) } });
    expect(glossFacetFor(V.犬)).toBeNull();
    expect(onGlossTap({ token: '犬', itemId: V.犬, introduced: true, dueWithin3: true, sessionId: SESSION }).kind).toBe('none');
  });

  it('the exercise on the log row defaults to story-read', async () => {
    const key = `${V.犬}#rec` as const;
    await makeTestStore({ cards: { [key]: card({ due: TODAY, s: 5, reps: 4, state: 2, last: TODAY - 5 }) } });
    onGlossTap({ token: '犬', itemId: V.犬, introduced: true, dueWithin3: true, sessionId: SESSION });
    const row = store.log.recent(1)[0];
    // DRILL_IDS index of 'story-read'
    expect(row?.[4]).toBe(28);
  });
});

describe('captureItem / releaseCapture / bookmarkText', () => {
  it('capture returns true once; release removes; re-capture works', async () => {
    await makeTestStore();
    expect(captureItem(V.水)).toBe(true);
    expect(captureItem(V.水)).toBe(false);
    expect(releaseCapture(V.水)).toBe(true);
    expect(releaseCapture(V.水)).toBe(false);
    expect(store.captured.value).toEqual([]);
    expect(captureItem(V.水)).toBe(true);
  });

  it('bookmarks trim, ignore empty, and dedupe', async () => {
    await makeTestStore();
    expect(bookmarkText('  ')).toBe(false);
    expect(bookmarkText(' つい ')).toBe(true);
    expect(bookmarkText('つい')).toBe(false);
    expect(store.bookmarks.value).toEqual(['つい']);
  });
});
