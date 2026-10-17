import { fnv1a32 } from '../shared/hash';
import { bristles, brushPolygon, brushStroke, brushStrokeSmooth, dashWrite, dryBrush, enso, inkBleed, PRESSURE, sealFrame, splatter, tangents } from './brush';
import { pointInPolygon, polygonArea, type Pt } from './geom';
import { el, svgDoc } from './svg';

function parses(markup: string): Document {
  const svg = markup.startsWith('<svg') ? markup : svgDoc({ w: 200, h: 200, body: [markup] });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(svg).not.toMatch(/NaN|Infinity/);
  return doc;
}

const SPINE: Pt[] = Array.from({ length: 12 }, (_, i) => [10 + i * 15, 100 + Math.sin(i / 2) * 30]);

describe('pressure envelopes', () => {
  it('stay within (0, 1] over t ∈ [0, 1]', () => {
    for (const p of Object.values(PRESSURE)) {
      for (let i = 0; i <= 20; i++) {
        const v = p(i / 20);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(PRESSURE.taper(0.3)).toBe(1);
    expect(PRESSURE.taper(1)).toBeLessThan(0.1);
  });
});

describe('brushPolygon / brushStroke', () => {
  it('has exactly 2n points for an n-point spine', () => {
    const poly = brushPolygon(SPINE, { width: 20, pressure: PRESSURE.taper, seed: 1 });
    expect(poly.length).toBe(SPINE.length * 2);
    expect(brushPolygon([[0, 0]], { width: 10, seed: 1 }).length).toBe(2);
    expect(brushPolygon([], { width: 10, seed: 1 })).toEqual([]);
    const d = brushStroke(SPINE, { width: 20, seed: 1 });
    expect(d.split(/[ML]/).length - 1).toBe(SPINE.length * 2);
    expect(d.endsWith('Z')).toBe(true);
    parses(el('path', { d }));
  });
  it('is deterministic per seed and encloses the spine', () => {
    const a = brushPolygon(SPINE, { width: 24, seed: 9 });
    const b = brushPolygon(SPINE, { width: 24, seed: 9 });
    expect(a).toEqual(b);
    expect(brushPolygon(SPINE, { width: 24, seed: 10 })).not.toEqual(a);
    expect(Math.abs(polygonArea(a))).toBeGreaterThan(0);
    for (let i = 1; i < SPINE.length - 1; i++) expect(pointInPolygon(SPINE[i]!, a)).toBe(true);
  });
  it('width follows pressure: widest in the body, thin at the taper', () => {
    const n = SPINE.length;
    const poly = brushPolygon(SPINE, { width: 30, pressure: PRESSURE.taper, seed: 2, bristle: 0 });
    const widthAt = (i: number): number => Math.hypot(poly[i]![0] - poly[2 * n - 1 - i]![0], poly[i]![1] - poly[2 * n - 1 - i]![1]);
    expect(widthAt(4)).toBeCloseTo(30, 5);
    expect(widthAt(n - 1)).toBeLessThan(5);
  });
  it('smooth variant resamples the spine', () => {
    const d = brushStrokeSmooth([[0, 0], [100, 50], [200, 0]], { width: 12, seed: 3, samples: 10 });
    expect(d.split(/[ML]/).length - 1).toBe(20);
  });
  it('tangents are unit length', () => {
    for (const t of tangents(SPINE)) expect(Math.hypot(t[0], t[1])).toBeCloseTo(1);
    expect(tangents([[1, 1]])).toEqual([[1, 0]]);
  });
});

describe('dry brush', () => {
  it('bristles produce seeded hair paths with gaps', () => {
    const hairs = bristles(SPINE, { width: 20, seed: 4, count: 5 });
    expect(hairs.length).toBeGreaterThan(0);
    expect(hairs.length).toBeLessThanOrEqual(5);
    expect(hairs.some((d) => d.split('M').length > 2)).toBe(true);
    expect(bristles(SPINE, { width: 20, seed: 4, count: 5 })).toEqual(hairs);
    expect(bristles([[0, 0]], { width: 10, seed: 1 })).toEqual([]);
    for (const d of hairs) parses(el('path', { d }));
  });
  it('dryBrush renders a group with the body and hairs', () => {
    const doc = parses(dryBrush(SPINE, { width: 20, seed: 5, fill: '#0B0B10', hairs: 4 }));
    const paths = doc.querySelectorAll('g > path');
    expect(paths.length).toBeGreaterThanOrEqual(2);
    expect(paths[0]?.getAttribute('fill')).toBe('#0B0B10');
    expect(paths[1]?.getAttribute('stroke')).toBe('#0B0B10');
  });
});

describe('ink texture', () => {
  it('inkBleed is a well-formed filter with displacement and seed', () => {
    const doc = parses(svgDoc({ w: 10, h: 10, defs: [inkBleed('bleed', 77, { scale: 4 })], body: [] }));
    const f = doc.querySelector('filter#bleed');
    expect(f).not.toBeNull();
    expect(f?.querySelector('feTurbulence')?.getAttribute('seed')).toBe('77');
    expect(f?.querySelector('feDisplacementMap')?.getAttribute('scale')).toBe('4');
  });
  it('splatter is deterministic and parses', () => {
    const d = splatter(50, 50, 30, 3, 20);
    expect(d.split('Z').length - 1).toBe(20);
    expect(splatter(50, 50, 30, 3, 20)).toBe(d);
    expect(splatter(50, 50, 30, 4, 20)).not.toBe(d);
    parses(el('path', { d }));
    expect(splatter(0, 0, 10, 1, 0)).toBe('');
  });
});

describe('enso', () => {
  it('is one closed stroke that leaves a gap and parses', () => {
    const d = enso(100, 100, 60, 11);
    expect(d.endsWith('Z')).toBe(true);
    parses(el('path', { d }));
    const pts = d
      .slice(1, -1)
      .split(/[ML]/)
      .filter(Boolean)
      .map((s) => s.split(' ').map(Number) as Pt);
    expect(pts.length).toBe(144);
    // the opening: no point near the gap direction (−115° + 2π − gap/2 … start) at radius ≈ 60
    const angles = pts.map((p) => Math.atan2(p[1] - 100, p[0] - 100));
    const gapCentre = (-115 * Math.PI) / 180 - 0.275;
    const near = angles.filter((a) => Math.abs(Math.atan2(Math.sin(a - gapCentre), Math.cos(a - gapCentre))) < 0.15);
    expect(near.length).toBe(0);
    expect(enso(100, 100, 60, 11)).toBe(d);
  });
});

describe('sealFrame', () => {
  it('is deterministic (snapshot hash) and an evenodd band', () => {
    const d = sealFrame({ x: 10, y: 10, size: 120, round: false, seed: 1 });
    expect(sealFrame({ x: 10, y: 10, size: 120, round: false, seed: 1 })).toBe(d);
    expect(d.split('Z').length - 1).toBe(2);
    parses(el('path', { d, 'fill-rule': 'evenodd' }));
    // stable fingerprint so a silent algorithm change is noticed
    expect(fnv1a32(d).toString(16)).toMatchInlineSnapshot(`"a66ee1e"`);
    const round = sealFrame({ x: 0, y: 0, size: 80, round: true, seed: 2 });
    expect(round).not.toBe(d);
    parses(el('path', { d: round }));
  });
  it('erosion keeps the outer edge near the nominal square', () => {
    const d = sealFrame({ x: 0, y: 0, size: 100, round: false, seed: 3 });
    const outer = d.split('Z')[0]!;
    const xs = outer
      .slice(1)
      .split(/[ML]/)
      .filter(Boolean)
      .map((s) => Number(s.split(' ')[0]));
    expect(Math.min(...xs)).toBeGreaterThan(-4);
    expect(Math.max(...xs)).toBeLessThan(104);
  });
});

describe('dashWrite', () => {
  it('yields dasharray attrs and a keyframes rule', () => {
    const w = dashWrite(320, { dur: 900, delay: 100, cls: 'kanji' });
    expect(w.attrs['stroke-dasharray']).toBe(320);
    expect(w.attrs['stroke-dashoffset']).toBe(320);
    expect(String(w.attrs.style)).toContain('kanji-draw 900ms');
    expect(String(w.attrs.style)).toContain('100ms forwards');
    expect(w.css).toBe('@keyframes kanji-draw{to{stroke-dashoffset:0}}');
    expect(dashWrite(0, { dur: 1 }).attrs['stroke-dasharray']).toBe(1);
  });
});
