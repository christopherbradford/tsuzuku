import { createFakeLoader, DIALOGUE, FIXTURE_STORY_ID, G, STORY, V } from '../../content/fixtures';
import { COVERAGE_TARGETS, type StoryItem, type StoryLine } from '../../content/types';
import {
  CAST_NAMES,
  FUNCTION_TOKENS,
  isExemptToken,
  isIPlusOne,
  isNameToken,
  isNumeralToken,
  isPunctToken,
  isReadable,
  lineCoverage,
  pickEpisode,
  previewLine,
  storyCoverage,
  thresholdFor,
} from './coverage';

const ALL_VOCAB = new Set(Object.values(V));
const ALL_IDS = new Set([...ALL_VOCAB, ...Object.values(G)]);

const line = (tokens: string[], tokenIds?: (string | null)[], extra: Partial<StoryLine> = {}): StoryLine => ({
  ja: tokens.join(''),
  kana: tokens.join(''),
  en: '',
  tokens,
  ...(tokenIds ? { tokenIds } : {}),
  ...extra,
});

const story = (id: string, lines: StoryLine[], extra: Partial<StoryItem> = {}): StoryItem => ({
  id,
  stationId: `st-${id.slice(2, 4)}`,
  titleJa: 't',
  titleEn: 't',
  kind: 'story',
  register: 'polite',
  lines,
  vocabIds: [],
  grammarIds: [],
  comprehension: [],
  recapEn: '',
  ...extra,
});

describe('exempt tokens (CONTENT_GUIDE §14.2)', () => {
  it('function tokens, punctuation, numerals and names are exempt', () => {
    for (const t of ['は', 'が', 'を', 'です', 'ます', 'います', 'さん', 'って', 'ませんでした']) expect(isExemptToken(t)).toBe(true);
    for (const t of ['。', '、', '「', '」', '！', '？', ' ', '…']) {
      expect(isPunctToken(t)).toBe(true);
      expect(isExemptToken(t)).toBe(true);
    }
    for (const t of ['三人', '一', '十二', '２０', '2024', '二つ', '十二時', '３枚', '五分', '百円']) {
      expect(isNumeralToken(t)).toBe(true);
      expect(isExemptToken(t)).toBe(true);
    }
    for (const t of ['ハナ', 'ケン', 'アオ', '田中さん', 'ケンさん', 'ハナも', 'ハナちゃん']) expect(isNameToken(t)).toBe(true);
    expect(isNameToken('ミカ')).toBe(false);
    expect(isNameToken('ミカ', ['ミカ'])).toBe(true);
    expect(isNameToken('ミカさん', ['ミカ'])).toBe(true);
    expect(isExemptToken('コーヒー')).toBe(false);
    expect(isExemptToken('飲みます')).toBe(false);
    expect(isNumeralToken('人')).toBe(false);
    expect(isNumeralToken('三人前')).toBe(false);
    expect(FUNCTION_TOKENS.has('の')).toBe(true);
    expect(CAST_NAMES.has('ハナ')).toBe(true);
  });
});

describe('lineCoverage', () => {
  it('counts non-punctuation tokens, function tokens never unknown, linked ids known iff in the set', () => {
    const l = STORY.lines[3] as StoryLine; // 私はコーヒーを飲みます。
    const full = lineCoverage(l, ALL_IDS);
    expect(full.total).toBe(5);
    expect(full.known).toBe(5);
    expect(full.unknown).toEqual([]);

    const partial = lineCoverage(l, new Set([V.私]));
    expect(partial.total).toBe(5);
    expect(partial.known).toBe(3); // 私, は, を
    expect(partial.unknown.map((u) => u.token)).toEqual(['コーヒー', '飲みます']);
    expect(partial.unknown.map((u) => u.itemId)).toEqual([V.コーヒー, V.飲む]);
    expect(partial.unknown.map((u) => u.index)).toEqual([2, 4]);
  });

  it('a null-linked, non-exempt token is unknown with itemId null', () => {
    const l = line(['ミカ', 'は', 'りんご', 'を', '食べます', '。'], [null, G.は, null, null, V.食べる, null]);
    const c = lineCoverage(l, new Set([V.食べる]));
    expect(c.total).toBe(5);
    expect(c.unknown).toEqual([
      { token: 'ミカ', itemId: null, index: 0 },
      { token: 'りんご', itemId: null, index: 2 },
    ]);
    // story names exempt the name
    expect(lineCoverage(l, new Set([V.食べる]), { names: ['ミカ'] }).unknown.map((u) => u.token)).toEqual(['りんご']);
  });

  it('names and numerals inside the fixture story never count as unknown', () => {
    const l = STORY.lines[9] as StoryLine; // 人が三人います。
    const c = lineCoverage(l, new Set());
    expect(c.total).toBe(4);
    expect(c.unknown.map((u) => u.token)).toEqual(['人']);
    const l2 = STORY.lines[2] as StoryLine; // ケンもいます。
    expect(lineCoverage(l2, new Set()).unknown).toEqual([]);
  });

  it('without tokenIds the surfaces map resolves tokens (exact and stem prefix); without either, content tokens are unknown', () => {
    const l = line(['コーヒー', 'を', '飲みます', '。']);
    const noMap = lineCoverage(l, ALL_IDS);
    expect(noMap.unknown.map((u) => u.token)).toEqual(['コーヒー', '飲みます']);
    expect(noMap.unknown.every((u) => u.itemId === null)).toBe(true);
    const mapped = lineCoverage(l, ALL_IDS, { surfaces: { コーヒー: V.コーヒー, 飲む: V.飲む, 飲み: V.飲む } });
    expect(mapped.unknown).toEqual([]);
    const half = lineCoverage(l, new Set([V.コーヒー]), { surfaces: { コーヒー: V.コーヒー, 飲み: V.飲む } });
    expect(half.unknown).toEqual([{ token: '飲みます', itemId: V.飲む, index: 2 }]);
  });

  it('an empty or punctuation-only line has total 0', () => {
    expect(lineCoverage(line(['。']), new Set())).toEqual({ known: 0, total: 0, unknown: [] });
    expect(lineCoverage(line([]), new Set())).toEqual({ known: 0, total: 0, unknown: [] });
  });
});

describe('storyCoverage (fixture, no loader)', () => {
  it('is 1.0 when every vocab and grammar id is known', () => {
    const c = storyCoverage(STORY, ALL_IDS);
    expect(c.ratio).toBe(1);
    expect(c.unknown).toEqual([]);
    expect(c.unknownIds).toEqual([]);
    expect(c.total).toBeGreaterThan(30);
  });

  it('is computed from tokenIds alone — no loader involved — and lists distinct unknown tokens and ids', () => {
    const known = new Set([...ALL_IDS].filter((id) => id !== V.飲む && id !== V.コーヒー));
    const c = storyCoverage(STORY, known);
    expect(c.unknown).toEqual(['コーヒー', '飲みます']);
    expect(c.unknownIds).toEqual([V.コーヒー, V.飲む]);
    // 飲みます appears 3×, コーヒー 2× → 5 unknown token occurrences
    expect(c.total - c.known).toBe(5);
    expect(c.ratio).toBeCloseTo((c.total - 5) / c.total, 9);
    // the fake loader is never needed, but agrees on the ids if consulted
    const loader = createFakeLoader();
    expect(loader.get(c.unknownIds[0] as string)).toBeDefined();
  });

  it('an empty known set leaves only the exempt tokens known', () => {
    const c = storyCoverage(STORY, new Set());
    expect(c.ratio).toBeLessThan(0.6);
    expect(c.ratio).toBeGreaterThan(0.2);
    // every vocab id surfaces; は / です are function tokens, so their grammar ids never do
    expect(c.unknownIds.length).toBe(STORY.vocabIds.length);
    for (const id of [V.私, V.コーヒー, V.飲む, V.はい, V.日]) expect(c.unknownIds).toContain(id);
    expect(c.unknownIds).not.toContain(G.は);
    expect(c.unknownIds).not.toContain(G.です);
  });

  it('plusOneUnknown lists the designed i+1 ids the learner lacks', () => {
    const s = story('s-05-1', [line(['パン', 'を', '食べます', '。'], [V.パン, null, V.食べる, null], { plusOne: [V.パン] })]);
    expect(storyCoverage(s, new Set([V.食べる])).plusOneUnknown).toEqual([V.パン]);
    expect(storyCoverage(s, new Set([V.食べる, V.パン])).plusOneUnknown).toEqual([]);
  });

  it('a story with no content tokens has ratio 1', () => {
    expect(storyCoverage(story('s-01-1', [line(['。'])]), new Set()).ratio).toBe(1);
  });

  it('story names come from StoryItem.names by default', () => {
    const s = story('s-05-1', [line(['ミカ', 'は', 'ハナ', 'です', '。'], [null, G.は, null, G.です, null])], { names: ['ミカ', 'ハナ'] });
    expect(storyCoverage(s, new Set([G.は, G.です])).ratio).toBe(1);
  });
});

describe('thresholdFor', () => {
  it.each([
    [1, false, 0.97],
    [4, false, 0.97],
    [28, false, 0.97],
    [29, false, 0.95],
    [38, false, 0.95],
    [39, false, 0.93],
    [53, false, 0.93],
    [27, true, 0.93],
    [10, true, 0.93],
    [50, true, 0.93],
  ])('station %i bridge %s → %d', (station, bridge, want) => {
    expect(thresholdFor(station, bridge)).toBe(want);
  });

  it('matches COVERAGE_TARGETS', () => {
    expect(thresholdFor(1, false)).toBe(COVERAGE_TARGETS['st-01-28']);
    expect(thresholdFor(30, false)).toBe(COVERAGE_TARGETS['st-29-38']);
    expect(thresholdFor(40, false)).toBe(COVERAGE_TARGETS['st-39-53']);
    expect(thresholdFor(40, true)).toBe(COVERAGE_TARGETS.bridge);
  });
});

describe('isReadable / isIPlusOne', () => {
  it('the fixture story is readable with everything known and not with two words missing at 0.97', () => {
    expect(isReadable(STORY, ALL_IDS, 4)).toBe(true);
    const missingTwo = new Set([...ALL_IDS].filter((id) => id !== V.飲む && id !== V.コーヒー));
    expect(isReadable(STORY, missingTwo, 4)).toBe(false);
  });

  it('i+1 = readable with exactly one unknown item', () => {
    // 20 known tokens + 1 unknown → 0.952 → readable at Station 30 (0.95), not at Station 4 (0.97)
    const tokens: string[] = [];
    const ids: (string | null)[] = [];
    for (let i = 0; i < 20; i++) {
      tokens.push('水');
      ids.push(V.水);
    }
    tokens.push('パン');
    ids.push(V.パン);
    const s = story('s-30-1', [line(tokens, ids)]);
    expect(isIPlusOne(s, new Set([V.水]), 30)).toBe(true);
    expect(isIPlusOne(s, new Set([V.水]), 4)).toBe(false);
    expect(isIPlusOne(s, new Set([V.水, V.パン]), 30)).toBe(false); // nothing unknown
  });
});

describe('pickEpisode', () => {
  const full = story('s-04-1', [line(['水', 'を', '飲みます', '。'], [V.水, null, V.飲む, null])]);
  const almost = story('s-04-2', [line(['水', 'と', 'パン', 'と', '犬', 'と', '人', 'と', '日', 'と', '私', 'を', '飲みます', '。'], [V.水, null, V.パン, null, V.犬, null, V.人, null, V.日, null, V.私, null, V.飲む, null])]);
  const bridge = story('s-27-3', [line(['水', 'と', 'パン', 'と', '犬', 'と', '人', 'と', '日', 'と', '私', 'と', 'コーヒー', 'と', 'おいしい', 'を', '飲みます', '。'], [V.水, null, V.パン, null, V.犬, null, V.人, null, V.日, null, V.私, null, V.コーヒー, null, V.おいしい, null, V.飲む, null])], { bridge: true });

  it('prefers the highest coverage at or above the threshold', () => {
    const known = new Set([V.水, V.飲む, V.パン, V.犬, V.人, V.日]);
    // full: 1.0 · almost: 1 unknown of 7 content tokens → 0.857 · bridge: 2 unknown of 9 → 0.78
    expect(pickEpisode([almost, bridge, full], known, 4)?.id).toBe('s-04-1');
  });

  it('returns null when nothing meets the threshold', () => {
    expect(pickEpisode([almost, bridge], new Set([V.水]), 4)).toBeNull();
    expect(pickEpisode([], new Set(), 4)).toBeNull();
  });

  it('a bridge passage qualifies at 0.93 while an ordinary one needs 0.97 at the same station', () => {
    // 15 known + 1 unknown → 0.9375
    const toks: string[] = [];
    const ids: (string | null)[] = [];
    for (let i = 0; i < 15; i++) {
      toks.push('水');
      ids.push(V.水);
    }
    toks.push('パン');
    ids.push(V.パン);
    const ordinary = story('s-27-1', [line(toks, ids)]);
    const br = story('s-27-2', [line(toks, ids)], { bridge: true });
    expect(pickEpisode([ordinary], new Set([V.水]), 27)).toBeNull();
    expect(pickEpisode([br], new Set([V.水]), 27)?.id).toBe('s-27-2');
    expect(pickEpisode([ordinary, br], new Set([V.水]), 27)?.id).toBe('s-27-2');
  });

  it('ties break on fewer unknown tokens, then earlier station, then id', () => {
    const known = new Set([V.水, V.飲む]);
    const a = story('s-05-1', [line(['水', 'を', '飲みます', '。'], [V.水, null, V.飲む, null])]);
    const b = story('s-04-3', [line(['水', 'を', '飲みます', '。'], [V.水, null, V.飲む, null])]);
    const c = story('s-04-2', [line(['水', 'を', '飲みます', '。'], [V.水, null, V.飲む, null])]);
    expect(pickEpisode([a, b, c], known, 4)?.id).toBe('s-04-2');
  });

  it('skips already-read stories unless allowReread and nothing else qualifies', () => {
    const known = new Set([V.水, V.飲む]);
    expect(pickEpisode([full], known, 4, { read: new Set(['s-04-1']) })).toBeNull();
    expect(pickEpisode([full], known, 4, { read: new Set(['s-04-1']), allowReread: true })?.id).toBe('s-04-1');
    const other = story('s-04-9', [line(['水', '。'], [V.水, null])]);
    expect(pickEpisode([full, other], known, 4, { read: new Set(['s-04-1']) })?.id).toBe('s-04-9');
  });

  it('works on the fixture story and dialogue', () => {
    expect(pickEpisode([STORY, DIALOGUE], ALL_IDS, 4)?.id).toBe(FIXTURE_STORY_ID);
  });
});

describe('previewLine (次回予告)', () => {
  it('picks the line with the fewest unknown tokens and masks the first of them', () => {
    const known = new Set([...ALL_IDS].filter((id) => id !== V.飲む && id !== V.パン));
    const p = previewLine(STORY, known);
    expect(p).not.toBeNull();
    // line 3 (私はコーヒーを飲みます。) and others have one unknown; the first such line wins
    expect(p?.lineIndex).toBe(3);
    expect(p?.maskedToken).toBe(4);
    expect(p?.masked).toBe('私はコーヒーを???。');
  });

  it('when everything is known, masks a word due tomorrow; null when none', () => {
    expect(previewLine(STORY, ALL_IDS)).toBeNull();
    const p = previewLine(STORY, ALL_IDS, new Set([V.パン]));
    expect(p?.lineIndex).toBe(5);
    expect(p?.masked).toBe('ケンは???を食べます。');
  });
});
