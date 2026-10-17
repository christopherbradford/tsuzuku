import { BELT_IDS, type Belt } from '../../content/types';
import { fnv1a32 } from '../../shared/hash';
import { svgDoc } from '../svg';
import {
  LANTERN_MAX,
  MON_SLOTS,
  OVERLAY_OPACITY,
  TATAMI_BY_BELT,
  lanternCount,
  lanternsLit,
  roomLayout,
  roomSvg,
  seasonOf,
  skyPhase,
  tatamiCount,
  tok,
  type RoomOptions,
} from './room';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

const BASE: RoomOptions = {
  belt: 'green',
  level: 23,
  chosenKanji: '続',
  badgeCategories: 4,
  latestStamp: '戸塚',
  kageBeaten: true,
  hour: 21,
  month: 4,
  seed: 1234,
  w: 960,
  h: 540,
};

function doc(o: Partial<RoomOptions> = {}): Document {
  const r = roomSvg({ ...BASE, ...o });
  return parse(svgDoc({ w: r.layout.w, h: r.layout.h, defs: r.defs, body: r.layers }));
}

function count(d: Document, selector: string): number {
  return d.querySelectorAll(selector).length;
}

describe('tables', () => {
  it('tatami count by belt: 2 → 10, non-decreasing along the road', () => {
    expect(TATAMI_BY_BELT).toEqual({ white: 2, yellow: 3, orange: 4, green: 5, blue: 6, purple: 7, brown: 8, black: 10 });
    let prev = 0;
    for (const b of BELT_IDS) {
      const n = tatamiCount(b);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(tatamiCount('white')).toBe(2);
    expect(tatamiCount('black')).toBe(10);
  });

  it('renders exactly that many mats for every belt', () => {
    for (const belt of BELT_IDS) {
      const d = doc({ belt });
      expect(count(d, '.room__tatami')).toBe(TATAMI_BY_BELT[belt]);
      expect(d.querySelector('.room__mats')?.getAttribute('data-count')).toBe(String(TATAMI_BY_BELT[belt]));
      expect(d.querySelector(`.room__belt--${belt}`)).not.toBeNull();
    }
  });

  it('lanterns: one per 10 levels, capped', () => {
    expect(lanternCount(1)).toBe(0);
    expect(lanternCount(9)).toBe(0);
    expect(lanternCount(10)).toBe(1);
    expect(lanternCount(35)).toBe(3);
    expect(lanternCount(99)).toBe(9);
    expect(lanternCount(1000)).toBe(LANTERN_MAX);
    expect(lanternCount(-5)).toBe(0);
    expect(lanternCount(Number.NaN)).toBe(0);
    expect(count(doc({ level: 1 }), '.room__lantern')).toBe(0);
    expect(count(doc({ level: 47 }), '.room__lantern')).toBe(4);
  });

  it('sky phase by hour', () => {
    expect(skyPhase(5)).toBe('dawn');
    expect(skyPhase(7)).toBe('dawn');
    expect(skyPhase(8)).toBe('day');
    expect(skyPhase(12)).toBe('day');
    expect(skyPhase(16)).toBe('day');
    expect(skyPhase(17)).toBe('dusk');
    expect(skyPhase(19)).toBe('dusk');
    expect(skyPhase(20)).toBe('night');
    expect(skyPhase(23)).toBe('night');
    expect(skyPhase(0)).toBe('night');
    expect(skyPhase(4)).toBe('night');
    expect(skyPhase(27)).toBe('night'); // wraps to 03:00
    expect(skyPhase(30)).toBe('dawn'); // wraps to 06:00
    expect(skyPhase(Number.NaN)).toBe('day');
    expect(lanternsLit('night')).toBe(true);
    expect(lanternsLit('dusk')).toBe(true);
    expect(lanternsLit('day')).toBe(false);
    expect(OVERLAY_OPACITY.day).toBe(0);
    expect(OVERLAY_OPACITY.night).toBeGreaterThan(OVERLAY_OPACITY.dusk);
  });

  it('season by month', () => {
    expect(seasonOf(3)).toBe('spring');
    expect(seasonOf(5)).toBe('spring');
    expect(seasonOf(6)).toBe('summer');
    expect(seasonOf(8)).toBe('summer');
    expect(seasonOf(9)).toBe('autumn');
    expect(seasonOf(11)).toBe('autumn');
    expect(seasonOf(12)).toBe('winter');
    expect(seasonOf(1)).toBe('winter');
    expect(seasonOf(2)).toBe('winter');
    expect(seasonOf(13)).toBe('winter'); // wraps to January
  });

  it('tok() yields a themed custom property with the Dojo Morning fallback', () => {
    expect(tok('shu')).toBe('var(--shu, #C9302C)');
    expect(tok('fg-muted')).toBe('var(--fg-muted, #5E5A52)');
  });
});

describe('lighting by hour', () => {
  it('night: stars, moon, lit lanterns with glow, indigo overlay', () => {
    const d = doc({ hour: 23, level: 20 });
    expect(d.querySelector('.room__sky--night')).not.toBeNull();
    expect(d.querySelector('.room__stars')).not.toBeNull();
    expect(d.querySelector('.room__moon')).not.toBeNull();
    expect(count(d, '.room__lantern--lit')).toBe(2);
    expect(d.querySelector('.room__lanterns')?.getAttribute('filter')).toBe('url(#dj-lantern-glow)');
    expect(d.querySelector('.room__light--night')).not.toBeNull();
  });

  it('day: no stars, unlit lanterns, no overlay layer', () => {
    const r = roomSvg({ ...BASE, hour: 12, level: 20 });
    expect(r.phase).toBe('day');
    expect(r.layers[r.overlayIndex]).toBe('');
    const d = doc({ hour: 12, level: 20 });
    expect(d.querySelector('.room__stars')).toBeNull();
    expect(count(d, '.room__lantern')).toBe(2);
    expect(count(d, '.room__lantern--lit')).toBe(0);
    expect(d.querySelector('.room__lanterns')?.getAttribute('filter')).toBeNull();
    expect(d.querySelector('.room__cloud')).not.toBeNull();
  });

  it('dawn and dusk show a sun; the gradient follows the phase', () => {
    expect(doc({ hour: 6 }).querySelector('.room__sun')).not.toBeNull();
    expect(doc({ hour: 18 }).querySelector('.room__sun')).not.toBeNull();
    const dawn = roomSvg({ ...BASE, hour: 6 }).defs[0]!;
    const dusk = roomSvg({ ...BASE, hour: 18 }).defs[0]!;
    expect(dawn).not.toBe(dusk);
    expect(dawn).toContain('#F7B2C4');
    expect(dusk).toContain('#E0B341');
  });
});

describe('state → picture', () => {
  it('chosen kanji on the scroll; an ensō while none is chosen', () => {
    const withKanji = doc({ chosenKanji: '続' });
    expect(withKanji.querySelector('.room__kanji')).not.toBeNull();
    expect(withKanji.querySelector('.room__kanji text')?.textContent).toBe('続');
    expect(withKanji.querySelector('.room__kanji [lang="ja"]')).not.toBeNull();
    expect(withKanji.querySelector('.room__enso')).toBeNull();
    const empty = doc({ chosenKanji: undefined });
    expect(empty.querySelector('.room__enso')).not.toBeNull();
    expect(empty.querySelector('.room__kanji')).toBeNull();
    expect(empty.querySelector('.room__scroll')?.getAttribute('data-empty')).toBe('true');
    const two = doc({ chosenKanji: '継続' });
    expect(count(two, '.room__kanji text')).toBe(2);
  });

  it('Mon shelf: earned slots filled, the rest empty, clamped to the slot count', () => {
    const d = doc({ badgeCategories: 4 });
    expect(count(d, '.room__mon--earned')).toBe(4);
    expect(count(d, '.room__mon--empty')).toBe(MON_SLOTS - 4);
    const all = doc({ badgeCategories: 99 });
    expect(count(all, '.room__mon--earned')).toBe(MON_SLOTS);
    expect(count(all, '.room__mon--empty')).toBe(0);
    const none = doc({ badgeCategories: 0 });
    expect(count(none, '.room__mon--earned')).toBe(0);
    expect(none.querySelector('.room__shelf')?.getAttribute('data-earned')).toBe('0');
  });

  it('stamp rack: the latest goshuin open, or a closed book', () => {
    const open = doc({ latestStamp: '保土ヶ谷' });
    expect(open.querySelector('.room__goshuin')).not.toBeNull();
    expect(count(open, '.room__goshuin text')).toBe(4);
    expect(open.querySelector('.room__stamps')?.getAttribute('data-empty')).toBeNull();
    const closed = doc({ latestStamp: undefined });
    expect(closed.querySelector('.room__goshuin')).toBeNull();
    expect(closed.querySelector('.room__book--closed')).not.toBeNull();
    expect(closed.querySelector('.room__stamps')?.getAttribute('data-empty')).toBe('true');
  });

  it('Kage sits in the corner only when beaten this week', () => {
    expect(doc({ kageBeaten: true }).querySelector('.room__kage')).not.toBeNull();
    expect(doc({ kageBeaten: false }).querySelector('.room__kage')).toBeNull();
  });

  it('black belt shows dan ticks in gold', () => {
    expect(count(doc({ belt: 'black', dan: 3 }), '.room__dan line')).toBe(3);
    expect(doc({ belt: 'black', dan: 0 }).querySelector('.room__dan')).toBeNull();
    expect(doc({ belt: 'brown', dan: 3 }).querySelector('.room__dan')).toBeNull();
  });

  it('seasonal tree: foliage in three seasons, bare with snow in winter', () => {
    for (const [month, season] of [
      [4, 'spring'],
      [7, 'summer'],
      [10, 'autumn'],
    ] as const) {
      const d = doc({ month });
      expect(d.querySelector(`.room__tree--${season}`)).not.toBeNull();
      expect(count(d, '.room__tree ellipse')).toBeGreaterThanOrEqual(4);
    }
    const winter = doc({ month: 1 });
    expect(winter.querySelector('.room__tree--winter')).not.toBeNull();
    const snow = Array.from(winter.querySelectorAll('.room__tree ellipse'));
    expect(snow.length).toBeGreaterThan(0);
    for (const e of snow) expect(e.getAttribute('fill')).toBe('#F4EDE0');
  });
});

describe('composition', () => {
  it('is deterministic for a fixed state (hash snapshot) and varies with the seed', () => {
    const a = roomSvg(BASE);
    const b = roomSvg(BASE);
    const joined = a.defs.join('') + a.layers.join('');
    expect(joined).toBe(b.defs.join('') + b.layers.join(''));
    expect(fnv1a32(joined).toString(16)).toMatchInlineSnapshot(`"1e02d0f5"`);
    const other = roomSvg({ ...BASE, seed: 99 });
    expect(other.defs.join('') + other.layers.join('')).not.toBe(joined);
  });

  it('every layer is well-formed XML and the last layer is the overlay', () => {
    const r = roomSvg(BASE);
    expect(r.overlayIndex).toBe(r.layers.length - 1);
    expect(r.layers[r.overlayIndex]).toContain('room__light');
    const d = doc();
    expect(d.documentElement.tagName).toBe('svg');
    expect(d.querySelector('#dj-sky')).not.toBeNull();
    expect(d.querySelector('#dj-tatami')).not.toBeNull();
    expect(d.querySelector('#dj-lattice')).not.toBeNull();
    expect(d.querySelector('#dj-window-clip rect')).not.toBeNull();
    expect(d.querySelector('.room__window [clip-path="url(#dj-window-clip)"] .room__tree')).not.toBeNull();
  });

  it('never prints NaN and uses themed tokens for interior surfaces', () => {
    const r = roomSvg({ ...BASE, hour: Number.NaN, month: Number.NaN, level: Number.NaN });
    const s = r.defs.join('') + r.layers.join('');
    expect(s).not.toContain('NaN');
    expect(s).toContain('var(--surface, #FFFBF3)');
    expect(s).toContain('var(--shu, #C9302C)');
  });

  it('layout scales proportionally and stays inside the canvas', () => {
    const L = roomLayout(960, 540);
    expect(L.sx).toBe(1);
    expect(L.sy).toBe(1);
    const half = roomLayout(480, 270);
    expect(half.scroll.x).toBeCloseTo(L.scroll.x / 2);
    expect(half.floorTop).toBeCloseTo(L.floorTop / 2);
    for (const box of [L.window, L.scroll, L.rack, L.shelf, L.stamps, L.hearth, L.kage, L.hall]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(960);
      expect(box.y + box.h).toBeLessThanOrEqual(540);
    }
    expect(L.bonsai.y).toBeLessThanOrEqual(540);
    // a compact stage keeps the same structure
    const compact = roomSvg({ ...BASE, w: 960, h: 400 });
    expect(compact.layout.h).toBe(400);
    expect(count(parse(svgDoc({ w: 960, h: 400, defs: compact.defs, body: compact.layers })), '.room__tatami')).toBe(TATAMI_BY_BELT[BASE.belt as Belt]);
  });

  it('keeps the node budget modest (room alone under 170 elements at the richest state)', () => {
    const d = doc({ belt: 'black', level: 99, badgeCategories: 9, kageBeaten: true, hour: 22 });
    expect(count(d, '*')).toBeLessThan(170);
  });
});
