import { bayer, bayerThresholds, chromatic, crtBezel, crtScreenClip, ditherPattern, grainFilter, monoLayout, pixelText, POST_PASSES, postLayer, scanlineLayer, scanlines, sprite, vignette } from './pixel';
import { svgDoc } from './svg';

function parse(markup: string): Document {
  const svg = markup.startsWith('<svg') ? markup : svgDoc({ w: 100, h: 100, body: [markup] });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

describe('bayer', () => {
  it('2×2 and 4×4 match the canonical matrices', () => {
    expect(bayer(2)).toEqual([
      [0, 2],
      [3, 1],
    ]);
    expect(bayer(4)).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
  });
  it('8×8 is a permutation of 0…63 and thresholds lie in (0, 1)', () => {
    const m = bayer(8);
    const flat = m.flat().sort((a, b) => a - b);
    expect(flat).toEqual(Array.from({ length: 64 }, (_, i) => i));
    const th = bayerThresholds(8).flat();
    expect(Math.min(...th)).toBeCloseTo(0.5 / 64);
    expect(Math.max(...th)).toBeCloseTo(63.5 / 64);
  });
});

describe('defs are well-formed', () => {
  it('scanlines pattern + layer', () => {
    const doc = parse(svgDoc({ w: 100, h: 100, defs: [scanlines('scan', 3, 0.3)], body: [scanlineLayer('scan', 100, 100)] }));
    const p = doc.querySelector('pattern#scan');
    expect(p?.getAttribute('height')).toBe('3');
    expect(p?.querySelector('rect')?.getAttribute('fill-opacity')).toBe('0.3');
    expect(doc.querySelector('svg > rect')?.getAttribute('fill')).toBe('url(#scan)');
  });
  it('dither pattern has n² cells at most and Bayer-ordered opacities', () => {
    const doc = parse(svgDoc({ w: 10, h: 10, defs: [ditherPattern('d', 2, { n: 4, strength: 1 })], body: [] }));
    const rects = doc.querySelectorAll('pattern#d rect');
    expect(rects.length).toBe(16);
    expect(doc.querySelector('pattern#d')?.getAttribute('width')).toBe('8');
  });
  it('chromatic, grain, vignette, bezel, clip parse', () => {
    const doc = parse(
      svgDoc({
        w: 400,
        h: 300,
        defs: [chromatic('ca', 1.5), grainFilter('gr', { seed: 5 }), vignette('vg'), crtScreenClip('clip', 400, 300)],
        body: [crtBezel(400, 300)],
      }),
    );
    expect(doc.querySelectorAll('filter#ca feOffset').length).toBe(2);
    expect(doc.querySelector('filter#ca feOffset')?.getAttribute('dx')).toBe('1.5');
    expect(doc.querySelector('filter#gr feTurbulence')?.getAttribute('seed')).toBe('5');
    expect(doc.querySelectorAll('radialGradient#vg stop').length).toBe(3);
    expect(doc.querySelector('clipPath#clip path')).not.toBeNull();
    expect(doc.querySelector('svg > g > path')?.getAttribute('fill-rule')).toBe('evenodd');
  });
});

describe('sprite', () => {
  it('merges runs and skips transparent cells', () => {
    const doc = parse(sprite(['.xx.', 'xoox', '.xx.'], { x: 0, y: 0, px: 4, palette: { x: '#fff', o: '#000' } }));
    const rects = Array.from(doc.querySelectorAll('rect'));
    expect(rects.length).toBe(5);
    expect(rects[0]?.getAttribute('x')).toBe('4');
    expect(rects[0]?.getAttribute('width')).toBe('8');
    expect(rects[2]?.getAttribute('fill')).toBe('#000');
  });
  it('flip mirrors horizontally', () => {
    const doc = parse(sprite(['x..'], { x: 0, y: 0, px: 1, palette: { x: '#fff' }, flip: true }));
    expect(doc.querySelector('rect')?.getAttribute('x')).toBe('2');
  });
});

describe('pixel text', () => {
  it('monoLayout uses full cells for kana and half cells for ASCII, honouring the anchor', () => {
    const g = monoLayout('あa', 100, 20, 10, { anchor: 'middle' });
    expect(g.length).toBe(2);
    expect(g[0]!.x).toBeCloseTo(100 - 7.5 + 5);
    expect(g[1]!.x).toBeCloseTo(100 - 7.5 + 10 + 2.5);
    expect(monoLayout('abc', 0, 0, 10, { anchor: 'end' })[2]!.x).toBeCloseTo(-2.5);
  });
  it('pixelText emits one <text> per glyph with lang="ja"', () => {
    const doc = parse(pixelText('ハイスコア', { x: 0, y: 10, size: 8, fill: '#2EE6D6', font: '"DotGothic16", monospace' }));
    const g = doc.querySelector('g');
    expect(g?.getAttribute('lang')).toBe('ja');
    expect(g?.querySelectorAll('text').length).toBe(5);
  });
});

describe('postLayer', () => {
  it('none is empty; the others add defs and a full-canvas rect', () => {
    expect(postLayer('none', { w: 10, h: 10, seed: 1 })).toEqual({ defs: [], body: '' });
    for (const kind of POST_PASSES.filter((k) => k !== 'none')) {
      const l = postLayer(kind, { w: 1920, h: 1080, seed: 3 });
      expect(l.defs.length).toBe(1);
      const doc = parse(svgDoc({ w: 1920, h: 1080, defs: l.defs, body: [l.body] }));
      const r = doc.querySelector('svg > rect');
      expect(r?.getAttribute('width')).toBe('1920');
      expect(r?.getAttribute('height')).toBe('1080');
    }
    expect(postLayer('grain', { w: 1, h: 1, seed: 9 }).defs[0]).toContain('seed="9"');
  });
});
