import { ITEM_KINDS, type ItemKind } from '../../shared/store-types';
import { svgDoc } from '../svg';
import { DRIFT_VARIANTS, FLAME_CAP, FLAME_TOKEN, allocate, emptyCounts, flamesSvg, hearthStateOf, hearthSvg, type HearthState } from './flames';

function parse(inner: string, w = 960, h = 540): Document {
  const doc = new DOMParser().parseFromString(svgDoc({ w, h, body: [inner] }), 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

function counts(p: Partial<Record<ItemKind, number>>): Record<ItemKind, number> {
  return { ...emptyCounts(), ...p };
}

const REGION = { seed: 11, w: 880, h: 290, x: 40, y: 40 };

describe('allocate', () => {
  it('splits the cap proportionally with largest remainders and sums exactly', () => {
    const q = allocate(counts({ vocab: 700, kanji: 200, kana: 100 }), 400);
    expect(q.vocab + q.kanji + q.kana).toBe(400);
    expect(q.vocab).toBe(280);
    expect(q.kanji).toBe(80);
    expect(q.kana).toBe(40);
    const odd = allocate(counts({ vocab: 1, kanji: 1, grammar: 1 }), 2);
    expect(ITEM_KINDS.reduce((a, k) => a + odd[k], 0)).toBe(2);
    expect(allocate(counts({ vocab: 5 }), 10).vocab).toBe(5);
    expect(allocate(counts({}), 10)).toEqual(emptyCounts());
    expect(allocate(counts({ vocab: -3, kanji: Number.NaN, kana: 2.9 }), 10)).toEqual(counts({ kana: 2 }));
  });
});

describe('flamesSvg', () => {
  it('caps at 400 rendered while the counter holds the true total', () => {
    const r = flamesSvg({ ...REGION, counts: counts({ vocab: 900, kanji: 300, grammar: 100, kana: 50, chunk: 25 }), reducedMotion: false });
    expect(r.total).toBe(1375);
    expect(r.rendered).toBe(FLAME_CAP);
    expect(ITEM_KINDS.reduce((a, k) => a + r.byKind[k], 0)).toBe(FLAME_CAP);
    const d = parse(r.svg);
    expect(d.querySelectorAll('use').length).toBe(FLAME_CAP);
    const g = d.querySelector('.dj-kotodama')!;
    expect(g.getAttribute('data-total')).toBe('1375');
    expect(g.getAttribute('data-rendered')).toBe('400');
    // one shared symbol, so the glow costs no per-flame nodes
    expect(d.querySelectorAll('symbol').length).toBe(1);
  });

  it('renders every flame when under the cap; `max` lowers the cap', () => {
    const r = flamesSvg({ ...REGION, counts: counts({ vocab: 12, kanji: 3 }), reducedMotion: false });
    expect(r.rendered).toBe(15);
    expect(r.total).toBe(15);
    expect(parse(r.svg).querySelectorAll('use[data-kind="vocab"]').length).toBe(12);
    expect(parse(r.svg).querySelectorAll('use[data-kind="kanji"]').length).toBe(3);
    const capped = flamesSvg({ ...REGION, counts: counts({ vocab: 1000 }), reducedMotion: false, max: 50 });
    expect(capped.rendered).toBe(50);
    expect(capped.total).toBe(1000);
  });

  it('is deterministic per seed, positions change with the seed', () => {
    const o = { ...REGION, counts: counts({ vocab: 40, kana: 10 }), reducedMotion: false };
    const a = flamesSvg(o);
    expect(a.svg).toBe(flamesSvg(o).svg);
    const b = flamesSvg({ ...o, seed: 12 });
    expect(b.svg).not.toBe(a.svg);
    const xs = (svg: string): string[] => Array.from(parse(svg).querySelectorAll('use')).map((u) => u.getAttribute('x') ?? '');
    expect(xs(a.svg)).not.toEqual(xs(b.svg));
    expect(a.svg).not.toContain('NaN');
  });

  it('positions stay inside the region and colors follow the category tokens', () => {
    const r = flamesSvg({ ...REGION, counts: counts({ vocab: 30, kanji: 30, kana: 30, grammar: 30, chunk: 30, component: 30 }), reducedMotion: false });
    const d = parse(r.svg);
    for (const u of Array.from(d.querySelectorAll('use'))) {
      const x = Number(u.getAttribute('x'));
      const y = Number(u.getAttribute('y'));
      const w = Number(u.getAttribute('width'));
      expect(x + w / 2).toBeGreaterThanOrEqual(REGION.x - 0.01);
      expect(x + w / 2).toBeLessThanOrEqual(REGION.x + REGION.w + 0.01);
      expect(y).toBeGreaterThanOrEqual(REGION.y - 20);
      expect(y).toBeLessThanOrEqual(REGION.y + REGION.h + 0.01);
      const kind = u.getAttribute('data-kind') as ItemKind;
      expect(u.getAttribute('fill')).toContain(`var(--${FLAME_TOKEN[kind]},`);
    }
    // categories mingle: the first six are not all one kind
    const first = Array.from(d.querySelectorAll('use')).slice(0, 6).map((u) => u.getAttribute('data-kind'));
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it('animates with CSS keyframes by default and is static under reduced motion', () => {
    const o = { ...REGION, counts: counts({ vocab: 20 }), reducedMotion: false };
    const live = flamesSvg(o).svg;
    expect(live).toContain('@keyframes dj-kf-drift-0');
    expect(live).toContain(`dj-kf-drift-${DRIFT_VARIANTS - 1}`);
    expect(live).toContain('prefers-reduced-motion');
    expect(live).toContain('.reduced-motion .dj-kf{animation:none}');
    expect(live).toContain('animation-duration:');
    expect(live).not.toContain('<animate');
    const still = flamesSvg({ ...o, reducedMotion: true }).svg;
    expect(still).not.toContain('@keyframes');
    expect(still).not.toContain('animation');
    expect(parse(still).querySelectorAll('use').length).toBe(20);
    // same positions either way
    const xs = (svg: string): string[] => Array.from(parse(svg).querySelectorAll('use')).map((u) => u.getAttribute('x') ?? '');
    expect(xs(still)).toEqual(xs(live));
  });

  it('zero items: an empty group, no style, no defs', () => {
    const r = flamesSvg({ ...REGION, counts: emptyCounts(), reducedMotion: false });
    expect(r.rendered).toBe(0);
    expect(r.total).toBe(0);
    expect(r.svg).not.toContain('<style');
    expect(r.svg).not.toContain('<symbol');
    expect(parse(r.svg).querySelector('.dj-kotodama')).not.toBeNull();
  });

  it('glow off (Zen) drops the halo from the symbol', () => {
    const o = { ...REGION, counts: counts({ vocab: 5 }), reducedMotion: true };
    const glow = parse(flamesSvg(o).svg);
    const zen = parse(flamesSvg({ ...o, glow: false }).svg);
    expect(glow.querySelectorAll('symbol ellipse').length).toBe(2);
    expect(zen.querySelectorAll('symbol ellipse').length).toBe(1);
  });
});

describe('hearth', () => {
  it('maps streak flame states to hearth looks', () => {
    expect(hearthStateOf('lit')).toEqual({ state: 'steady', crystal: false });
    expect(hearthStateOf('gold')).toEqual({ state: 'roaring', crystal: false });
    expect(hearthStateOf('ember')).toEqual({ state: 'ember', crystal: false });
    expect(hearthStateOf('frozen')).toEqual({ state: 'steady', crystal: true });
    expect(hearthStateOf('rest')).toEqual({ state: 'steady', crystal: false });
    expect(hearthStateOf('broken')).toEqual({ state: 'unlit', crystal: false });
  });

  const box = { seed: 3, x: 420, y: 392, w: 120, h: 80 };

  it('renders each state with the right fire', () => {
    const tongues = (state: HearthState, crystal = false): Document => parse(hearthSvg({ ...box, state, crystal, reducedMotion: false }));
    const unlit = tongues('unlit');
    expect(unlit.querySelector('.dj-hf--unlit')).not.toBeNull();
    expect(unlit.querySelectorAll('.dj-hf-tongue, .dj-hf-ember').length).toBe(0);
    expect(hearthSvg({ ...box, state: 'unlit', reducedMotion: false })).not.toContain('<style');
    const ember = tongues('ember');
    expect(ember.querySelectorAll('.dj-hf-ember').length).toBe(3);
    expect(ember.querySelectorAll('.dj-hf-tongue').length).toBe(0);
    const steady = tongues('steady');
    expect(steady.querySelectorAll('.dj-hf-tongue').length).toBe(4); // 2 tongues × (outer + core)
    const roaring = tongues('roaring');
    expect(roaring.querySelectorAll('.dj-hf-tongue').length).toBe(8);
    expect(roaring.querySelector('.dj-hf--roaring')).not.toBeNull();
    expect(steady.querySelector('.dj-hf-crystal')).toBeNull();
    const frozen = tongues('steady', true);
    expect(frozen.querySelector('.dj-hf-crystal')).not.toBeNull();
    expect(frozen.querySelector('.dj-hf')?.getAttribute('data-crystal')).toBe('true');
  });

  it('flickers slowly with CSS only; static under reduced motion', () => {
    const live = hearthSvg({ ...box, state: 'roaring', reducedMotion: false });
    expect(live).toContain('@keyframes dj-hf-flicker');
    expect(live).toContain('prefers-reduced-motion');
    expect(live).not.toContain('<animate');
    // nothing faster than ~0.7 Hz: every duration ≥ 1.4 s
    for (const m of live.matchAll(/animation(?:-duration)?:[^;}]*?([\d.]+)s/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1.4);
    const still = hearthSvg({ ...box, state: 'roaring', reducedMotion: true });
    expect(still).not.toContain('@keyframes');
    expect(still).not.toContain('animation');
    expect(parse(still).querySelectorAll('.dj-hf-tongue').length).toBe(8);
  });

  it('is deterministic and NaN-free', () => {
    const a = hearthSvg({ ...box, state: 'steady', reducedMotion: false });
    expect(a).toBe(hearthSvg({ ...box, state: 'steady', reducedMotion: false }));
    expect(a).not.toContain('NaN');
    expect(a).not.toBe(hearthSvg({ ...box, seed: 4, state: 'steady', reducedMotion: false }));
  });
});
