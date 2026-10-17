import {
  A,
  arcPath,
  attrs,
  blur,
  circlePath,
  displace,
  el,
  esc,
  fmt,
  glowTwin,
  innerOf,
  linearGradient,
  pattern,
  polyPath,
  radialGradient,
  roundedRectPath,
  safeRect,
  safeZone,
  SIZES,
  sizeOf,
  svgDataUrl,
  svgDoc,
  text,
  turbulence,
  uid,
  viewBoxOf,
} from './svg';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`XML parse error: ${err.textContent}`);
  return doc;
}

describe('fmt', () => {
  it('prints at most two decimals and strips zeros', () => {
    expect(fmt(1.23456)).toBe('1.23');
    expect(fmt(2)).toBe('2');
    expect(fmt(2.5)).toBe('2.5');
    expect(fmt(-0.004)).toBe('0');
    expect(fmt(-3.456)).toBe('-3.46');
  });
  it('never prints NaN or Infinity', () => {
    expect(fmt(Number.NaN)).toBe('0');
    expect(fmt(Infinity)).toBe('0');
    expect(fmt(-Infinity)).toBe('0');
  });
});

describe('esc / attrs', () => {
  it('escapes quotes, ampersands and angle brackets', () => {
    expect(esc(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&#39;e&#39;');
  });
  it('skips null/undefined/false, prints true as empty, formats numbers', () => {
    expect(attrs({ a: 1.016, b: undefined, c: null, d: false, e: true, f: 'x"y' })).toBe(' a="1.02" e="" f="x&quot;y"');
  });
});

describe('el', () => {
  it('self-closes without children and nests with them', () => {
    expect(el('rect', { x: 1, y: 2 })).toBe('<rect x="1" y="2"/>');
    expect(el('g', undefined, ['<a/>', '<b/>'])).toBe('<g><a/><b/></g>');
    expect(el('g', { id: 'k' }, '')).toBe('<g id="k"/>');
  });
  it('text escapes content', () => {
    expect(text('<つづく> & more', { x: 0 })).toBe('<text x="0">&lt;つづく&gt; &amp; more</text>');
  });
});

describe('svgDoc', () => {
  it('is a well-formed XML document with xmlns, size and viewBox', () => {
    const svg = svgDoc({
      w: 1920,
      h: 1080,
      title: 'Torii & "dawn"',
      bg: '#000',
      defs: [linearGradient('sky', [[0, '#1F3A93'], [1, '#C9718A']], 90), glowTwin('glow', 6), blur('mist', 20)],
      body: [el('rect', { x: 0, y: 0, width: 10, height: 10, fill: 'url(#sky)' }), text('朝の鳥居', { x: 5, y: 5, 'font-family': '"Yuji Syuku", serif' })],
    });
    const doc = parse(svg);
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 1920 1080');
    expect(root.getAttribute('width')).toBe('1920');
    expect(doc.querySelector('title')?.textContent).toBe('Torii & "dawn"');
    expect(doc.querySelectorAll('defs > *').length).toBe(3);
    expect(viewBoxOf(svg)).toEqual({ w: 1920, h: 1080 });
    expect(innerOf(svg).startsWith('<title>')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });
  it('rounds sizes and refuses zero', () => {
    expect(viewBoxOf(svgDoc({ w: 0.2, h: 1079.6, body: [] }))).toEqual({ w: 1, h: 1080 });
  });
  it('every def helper parses', () => {
    const svg = svgDoc({
      w: 100,
      h: 100,
      defs: [
        radialGradient('r', [[0, '#fff', 1], [1, '#000', 0]]),
        turbulence('t', { baseFrequency: [0.01, 0.02], octaves: 3, seed: 7 }),
        displace('d', { baseFrequency: 0.02, scale: 12, seed: 3 }),
        pattern('p', 8, 8, el('rect', { width: 4, height: 4 })),
        glowTwin('g2', 4, { spread: 1, opacity: 0.6 }),
      ],
      body: [],
    });
    const doc = parse(svg);
    expect(doc.querySelector('feTurbulence')?.getAttribute('baseFrequency')).toBe('0.01 0.02');
    expect(doc.querySelector('feDisplacementMap')?.getAttribute('scale')).toBe('12');
    expect(doc.querySelector('#g2 feMorphology')).not.toBeNull();
  });
});

describe('paths', () => {
  it('polyPath, roundedRectPath, circlePath, arcPath produce valid path data', () => {
    expect(polyPath([[0, 0], [10, 0], [10, 10]], true)).toBe('M0 0L10 0L10 10Z');
    expect(polyPath([])).toBe('');
    const rr = roundedRectPath(0, 0, 100, 50, 10);
    expect(rr.startsWith('M10 0')).toBe(true);
    expect(rr.split('A').length - 1).toBe(4);
    expect(roundedRectPath(0, 0, 10, 10, 0)).toBe('M0 0L10 0L10 10L0 10Z');
    expect(circlePath(0, 0, 5)).toBe('M5 0A5 5 0 1 1 -5 0A5 5 0 1 1 5 0Z');
    expect(arcPath(0, 0, 10, 0, Math.PI / 2)).toMatch(/^M10 0A10 10 0 0 1 0 10$/);
    expect(A(1, 2, 0, 1, 0, 3, 4)).toBe('A1 2 0 1 0 3 4');
  });
  it('a path with NaN input still parses', () => {
    const d = polyPath([[Number.NaN, 0], [1, Infinity]]);
    expect(d).toBe('M0 0L1 0');
    parse(svgDoc({ w: 10, h: 10, body: [el('path', { d })] }));
  });
});

describe('sizes and safe zones', () => {
  it('desktop 16:9 and phone 9:19.5', () => {
    expect(SIZES.desktop).toEqual([1920, 1080]);
    expect(SIZES.phone).toEqual([1080, 2340]);
    expect(1080 / 2340).toBeCloseTo(9 / 19.5, 6);
    expect(sizeOf('phone')).toEqual({ w: 1080, h: 2340 });
  });
  it('phone safe zones honour both 12 %/10 % and 220/300 px; desktop has none', () => {
    const z = safeZone('phone');
    expect(z.top).toBeGreaterThanOrEqual(0.12 * 2340);
    expect(z.bottom).toBeGreaterThanOrEqual(0.1 * 2340);
    expect(z.top).toBeGreaterThanOrEqual(220);
    expect(z.bottom).toBeGreaterThanOrEqual(300);
    expect(z).toEqual({ top: 281, bottom: 300 });
    expect(safeZone('desktop')).toEqual({ top: 0, bottom: 0 });
    expect(safeRect('phone', 20)).toEqual({ x: 20, y: 301, w: 1040, h: 2340 - 281 - 300 - 40 });
    expect(safeRect('desktop')).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
});

describe('misc', () => {
  it('svgDataUrl is a data URL that round-trips', () => {
    const svg = svgDoc({ w: 2, h: 2, body: [] });
    const u = svgDataUrl(svg);
    expect(u.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(u.slice('data:image/svg+xml;charset=utf-8,'.length))).toBe(svg);
  });
  it('uid sanitises', () => {
    expect(uid('wp', 'glow', 3)).toBe('wp-glow-3');
    expect(uid('a b', 'c#d')).toBe('a_b-c_d');
  });
});
