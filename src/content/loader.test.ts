import type { GrammarItem, KanjiItem, StoryItem, VocabItem } from './types';
import { ContentError, createLoader, isChunk, type ContentLoader } from './loader';
import * as loaderModule from './loader';
import { FIXTURE, FIXTURE_REDIRECT_FROM, G, PATHS, V, createFakeLoader, fixtureFetch, type FixtureFetchOptions } from './fixtures';

function make(opts?: FixtureFetchOptions): { loader: ContentLoader; fetch: ReturnType<typeof fixtureFetch> } {
  const fetch = fixtureFetch(FIXTURE, opts);
  return { loader: createLoader(fetch, './content/'), fetch };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe('manifest()', () => {
  it('fetches manifest.json once and sets the version signal', async () => {
    const { loader, fetch } = make();
    expect(loader.version.value).toBeNull();
    const [a, b] = await Promise.all([loader.manifest(), loader.manifest()]);
    expect(a).toBe(b);
    expect(a.contentVersion).toBe(FIXTURE.manifest.contentVersion);
    expect(loader.version.value).toBe(FIXTURE.manifest.contentVersion);
    expect(fetch.calls).toEqual([PATHS.manifest]);
    await loader.manifest();
    expect(fetch.calls).toHaveLength(1);
  });

  it('rejects with a typed error and can retry after a failure', async () => {
    const { loader, fetch } = make({ missing: [PATHS.manifest] });
    await expect(loader.manifest()).rejects.toBeInstanceOf(ContentError);
    await expect(loader.manifest()).rejects.toMatchObject({ code: 'http', status: 404, path: PATHS.manifest });
    expect(fetch.calls).toHaveLength(2); // the slot is cleared, so a retry fetches again
  });

  it('rejects a file with the wrong schema', async () => {
    const bad = { ...FIXTURE, files: { ...FIXTURE.files, [PATHS.manifest]: { schema: 'nope' } } };
    const loader = createLoader(fixtureFetch(bad));
    await expect(loader.manifest()).rejects.toMatchObject({ code: 'schema' });
  });

  it('uses the base url (trailing slash optional)', async () => {
    const fetch = fixtureFetch();
    const loader = createLoader(fetch, 'https://example.test/app/content');
    await loader.manifest();
    expect(fetch.calls).toEqual([PATHS.manifest]);
  });
});

describe('lazy resolution', () => {
  it('get() is undefined before load and defined after; load fetches the one file', async () => {
    const { loader, fetch } = make();
    expect(loader.get(V.飲む)).toBeUndefined();
    await loader.load([V.飲む, V.人]);
    const item = loader.get<VocabItem>(V.飲む);
    expect(item?.word).toBe('飲む');
    expect(loader.get(V.人)).toBeDefined();
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.vocab2]);
  });

  it('getAsync(id) fetches exactly one file and reuses it for its siblings', async () => {
    const { loader, fetch } = make();
    const k = await loader.getAsync<KanjiItem>('j-飲');
    expect(k?.char).toBe('飲');
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.kanji]);
    const k2 = await loader.getAsync<KanjiItem>('j-食');
    expect(k2?.char).toBe('食');
    expect(fetch.calls).toHaveLength(2);
  });

  it('vocab ids pick the file by level + sequence estimate (gap-tolerant)', async () => {
    const { loader, fetch } = make();
    await loader.getAsync(V.犬); // seq 2 → first file (count 5)
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.vocab1]);
    await loader.getAsync(V.おいしい); // seq 13 > total 12 → last file
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.vocab1, PATHS.vocab2]);
  });

  it('falls back to scanning the level when the estimate misses', async () => {
    // Pretend the second file is huge so seq 13 is estimated into the first; it must still be found.
    const files = FIXTURE.manifest.files.map((f) => (f.path === PATHS.vocab1 ? { ...f, count: 100 } : f));
    const manifest = { ...FIXTURE.manifest, files };
    const fx = { ...FIXTURE, manifest, files: { ...FIXTURE.files, [PATHS.manifest]: manifest } };
    const fetch = fixtureFetch(fx);
    const loader = createLoader(fetch);
    const item = await loader.getAsync<VocabItem>(V.おいしい);
    expect(item?.kana).toBe('おいしい');
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.vocab1, PATHS.vocab2]);
  });

  it('story, michikusa, grammar and kana ids resolve to their files', async () => {
    const { loader, fetch } = make();
    const s = await loader.getAsync<StoryItem>('s-04-1');
    expect(s?.lines).toHaveLength(12);
    const m = await loader.getAsync('m-04-2');
    expect(m?.id).toBe('m-04-2');
    const g = await loader.getAsync<GrammarItem>(G.ます);
    expect(g?.clozeHints).toEqual(['ます']);
    const k = await loader.getAsync('k-h-ne');
    expect(k?.id).toBe('k-h-ne');
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.stories, PATHS.michikusa, PATHS.grammar, PATHS.hiragana]);
  });

  it('ids with no candidate file resolve undefined without fetching', async () => {
    const { loader, fetch } = make();
    expect(await loader.getAsync('k-k-shi')).toBeUndefined(); // no katakana file in the fixture
    expect(await loader.getAsync('st-04')).toBeUndefined();
    expect(await loader.getAsync('cj-0001')).toBeUndefined();
    expect(await loader.getAsync('v-n4-0001')).toBeUndefined(); // no n4 files
    expect(await loader.getAsync('g-n3-001')).toBeUndefined();
    expect(await loader.getAsync('s-07-1')).toBeUndefined(); // no station-7 story file
    expect(await loader.getAsync('m-07-1')).toBeUndefined();
    expect(await loader.getAsync('x-nope')).toBeUndefined();
    expect(fetch.calls).toEqual([PATHS.manifest]);
  });

  it('a missing id scans the level once and never refetches loaded files', async () => {
    const { loader, fetch } = make();
    expect(await loader.getAsync('v-n5-0099')).toBeUndefined();
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.vocab2, PATHS.vocab1]);
    expect(await loader.getAsync('v-n5-0099')).toBeUndefined();
    expect(fetch.calls).toHaveLength(3);
  });

  it('concurrent requests for the same file fetch it once', async () => {
    const { loader, fetch } = make();
    await Promise.all([loader.getAsync(V.飲む), loader.getAsync(V.人), loader.load([V.日, V.パン])]);
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.vocab2]);
  });

  it('load() ignores unknown ids but propagates network errors', async () => {
    const { loader } = make();
    await expect(loader.load(['v-n5-0099', 'cj-0001'])).resolves.toBeUndefined();
    const broken = make({ missing: [PATHS.kanji] });
    await expect(broken.loader.load(['j-食'])).rejects.toMatchObject({ code: 'http', status: 404 });
  });
});

describe('stations', () => {
  it('station(n) loads only the bundle, not the item files', async () => {
    const { loader, fetch } = make();
    const b = await loader.station(4);
    expect(b.number).toBe(4);
    expect(b.files).toContain(PATHS.vocab2);
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.station4]);
    expect(loader.get(V.飲む)).toBeUndefined();
    await loader.station(4);
    expect(fetch.calls).toHaveLength(2);
  });

  it('station(n) rejects for a station the manifest lacks', async () => {
    const { loader } = make();
    await expect(loader.station(2)).rejects.toMatchObject({ code: 'missing-station' });
  });

  it('cumulative(n) is monotonic and unions every bundle <= n', async () => {
    const { loader } = make();
    let prev = await loader.cumulative(0);
    for (const key of ['kanaIds', 'vocabIds', 'kanjiIds', 'grammarIds'] as const) expect(prev[key].size).toBe(0);
    for (const n of [1, 2, 3, 4, 5, 53]) {
      const cur = await loader.cumulative(n);
      for (const key of ['kanaIds', 'vocabIds', 'kanjiIds', 'grammarIds'] as const) {
        for (const id of prev[key]) expect(cur[key].has(id)).toBe(true);
        expect(cur[key].size).toBeGreaterThanOrEqual(prev[key].size);
      }
      prev = cur;
    }
    const c1 = await loader.cumulative(1);
    expect(c1.kanaIds.size).toBe(10);
    expect(c1.vocabIds.size).toBe(5);
    expect(c1.kanjiIds.size).toBe(0);
    const c4 = await loader.cumulative(4);
    expect(c4.vocabIds.size).toBe(12);
    expect(c4.kanjiIds.size).toBe(4);
    expect(c4.grammarIds.size).toBe(3);
    expect([...c4.vocabIds].sort()).toEqual([...FIXTURE.manifest.files.filter((f) => f.type === 'vocab')].length === 2 ? Object.values(V).sort() : []);
  });

  it('cumulative returns fresh sets each call', async () => {
    const { loader } = make();
    const a = await loader.cumulative(4);
    a.vocabIds.add('v-n5-9999');
    const b = await loader.cumulative(4);
    expect(b.vocabIds.has('v-n5-9999')).toBe(false);
  });

  it('a loaded bundle hints the file for its ids', async () => {
    const { loader, fetch } = make();
    await loader.station(4);
    expect(loader.stationOf(V.飲む)).toBe(4);
    expect(loader.stationOf('c-eat')).toBe(4);
    await loader.getAsync('j-人');
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.station4, PATHS.kanji]);
  });

  it('preloadStation(n) makes every station item get()-able, components included', async () => {
    const { loader, fetch } = make();
    await loader.preloadStation(4);
    const b = FIXTURE.stations[1]!;
    for (const id of [...b.vocabIds, ...b.kanjiIds, ...b.grammarIds, ...b.storyIds, ...b.michikusaIds, ...b.componentIds]) expect(loader.get(id)).toBeDefined();
    expect(new Set(fetch.calls)).toEqual(new Set([PATHS.manifest, PATHS.station4, ...b.files]));
    expect(fetch.calls).toHaveLength(2 + b.files.length);
  });

  it('prefetchStation(n) returns at once and loads in the background; errors are swallowed', async () => {
    const { loader, fetch } = make();
    expect(loader.prefetchStation(4)).toBeUndefined();
    expect(fetch.calls).toEqual([]);
    await tick();
    expect(loader.get(V.飲む)).toBeDefined();
    const broken = make({ missing: [PATHS.station4] });
    expect(() => broken.loader.prefetchStation(4)).not.toThrow();
    await tick();
    expect(broken.loader.get(V.飲む)).toBeUndefined();
  });
});

describe('errors leave the cache intact', () => {
  it('a 404 chunk rejects with ContentError and earlier loads survive', async () => {
    const { loader, fetch } = make({ missing: [PATHS.kanji] });
    await loader.load([V.飲む]);
    await expect(loader.getAsync('j-飲')).rejects.toMatchObject({ code: 'http', status: 404, path: PATHS.kanji });
    expect(loader.get(V.飲む)).toBeDefined();
    expect(loader.version.value).toBe(FIXTURE.manifest.contentVersion);
    expect(await loader.getAsync(G.です)).toBeDefined();
    // the failed path is not marked loaded, so a retry fetches again
    await expect(loader.getAsync('j-飲')).rejects.toBeInstanceOf(ContentError);
    expect(fetch.calls.filter((p) => p === PATHS.kanji)).toHaveLength(2);
  });

  it('corrupt JSON rejects with a parse error', async () => {
    const { loader } = make({ corrupt: [PATHS.grammar] });
    await expect(loader.getAsync(G.です)).rejects.toMatchObject({ code: 'parse', path: PATHS.grammar });
  });
});

describe('redirects, kinds, stations of ids', () => {
  it('resolveId follows manifest.redirects once the manifest is loaded', async () => {
    const { loader } = make();
    expect(loader.resolveId(FIXTURE_REDIRECT_FROM)).toBe(FIXTURE_REDIRECT_FROM); // identity before the manifest
    await loader.manifest();
    expect(loader.resolveId(FIXTURE_REDIRECT_FROM)).toBe(V.コーヒー);
    expect(loader.resolveId(V.コーヒー)).toBe(V.コーヒー);
    const item = await loader.getAsync<VocabItem>(FIXTURE_REDIRECT_FROM);
    expect(item?.id).toBe(V.コーヒー);
    expect(loader.get(FIXTURE_REDIRECT_FROM)).toBe(item);
    expect(loader.kindOf(FIXTURE_REDIRECT_FROM)).toBe('vocab');
  });

  it('kindOf matches kindOfId and upgrades loaded set-phrase/aizuchi vocab to chunk', async () => {
    const { loader } = make();
    expect(loader.kindOf(V.おはよう)).toBe('vocab');
    expect(loader.kindOf('k-h-a')).toBe('kana');
    expect(loader.kindOf('j-食')).toBe('kanji');
    expect(loader.kindOf(G.は)).toBe('grammar');
    expect(loader.kindOf('c-eat')).toBe('component');
    expect(loader.kindOf('s-04-1')).toBe('story');
    expect(loader.kindOf('m-04-1')).toBe('michikusa');
    expect(loader.kindOf('cj-0001')).toBe('conjugation');
    expect(loader.kindOf('st-04')).toBe('station');
    expect(() => loader.kindOf('zzz')).toThrow(RangeError);
    await loader.load([V.おはよう, V.はい, V.飲む]);
    expect(loader.kindOf(V.おはよう)).toBe('chunk');
    expect(loader.kindOf(V.はい)).toBe('chunk');
    expect(loader.kindOf(V.飲む)).toBe('vocab');
    expect(isChunk(loader.get(V.おはよう)!)).toBe(true);
    expect(isChunk(loader.get(V.飲む)!)).toBe(false);
  });

  it('stationOf reads the id, then the loaded item, then the bundle hint', async () => {
    const { loader } = make();
    expect(loader.stationOf('s-04-1')).toBe(4);
    expect(loader.stationOf('m-04-2')).toBe(4);
    expect(loader.stationOf('st-07')).toBe(7);
    expect(loader.stationOf(V.犬)).toBeUndefined();
    await loader.load([V.犬]);
    expect(loader.stationOf(V.犬)).toBe(1);
    expect(loader.stationOf('c-sun')).toBeUndefined();
    await loader.station(4);
    expect(loader.stationOf('c-sun')).toBe(4);
  });

  it('components() returns the map and caches the file', async () => {
    const { loader, fetch } = make();
    const map = await loader.components();
    expect(map.size).toBe(4);
    expect(map.get('c-person')?.name).toBe('person');
    expect(loader.get('c-person')).toBeDefined();
    await loader.components();
    expect(fetch.calls).toEqual([PATHS.manifest, PATHS.components]);
  });

  it('does not expose the conjugation table', () => {
    expect('conjugationTable' in loaderModule).toBe(false);
    expect(Object.keys(loaderModule).some((k) => /conjugation/i.test(k))).toBe(false);
  });
});

describe('createFakeLoader()', () => {
  it('serves everything synchronously and mirrors the real API', async () => {
    const fake = createFakeLoader();
    expect(fake.get<VocabItem>(V.私)?.kana).toBe('わたし');
    expect(fake.get(FIXTURE_REDIRECT_FROM)?.id).toBe(V.コーヒー);
    expect(await fake.getAsync('j-日')).toBeDefined();
    expect((await fake.manifest()).contentVersion).toBe(FIXTURE.manifest.contentVersion);
    expect(fake.version.value).toBe(FIXTURE.manifest.contentVersion);
    expect((await fake.station(1)).kanaIds).toHaveLength(10);
    await expect(fake.station(3)).rejects.toMatchObject({ code: 'missing-station' });
    const c4 = await fake.cumulative(4);
    expect(c4.vocabIds.size).toBe(12);
    expect((await fake.cumulative(1)).vocabIds.size).toBe(5);
    expect((await fake.components()).size).toBe(4);
    expect(fake.kindOf(V.はい)).toBe('chunk');
    expect(fake.kindOf(V.水)).toBe('vocab');
    expect(fake.stationOf(V.水)).toBe(1);
    expect(fake.stationOf('c-eat')).toBe(4);
    expect(fake.stationOf('s-04-2')).toBe(4);
    await expect(fake.load([V.水])).resolves.toBeUndefined();
    await expect(fake.preloadStation(4)).resolves.toBeUndefined();
    expect(fake.prefetchStation(4)).toBeUndefined();
  });

  it('the real loader over fixtureFetch agrees with the fake loader', async () => {
    const fake = createFakeLoader();
    const { loader } = make();
    await loader.preloadStation(1);
    await loader.preloadStation(4);
    for (const id of Object.keys(FIXTURE.items)) expect(loader.get(id)).toEqual(fake.get(id));
    expect(await loader.cumulative(4)).toEqual(await fake.cumulative(4));
  });
});
