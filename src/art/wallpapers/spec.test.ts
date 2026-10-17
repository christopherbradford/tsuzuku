import { SUMI, WASHI } from '../color';
import { FONTS, type TextLayer } from '../jtext';
import { el, rect, svgDoc, text } from '../svg';
import {
  appendPostLayer,
  finalize,
  hasCanvasSize,
  isComposition,
  isSelfContained,
  quadrantBox,
  quadrantOf,
  revealQuadrants,
  safeZone,
  safeZoneViolations,
  SIZES,
  sizeOf,
  sumiFilter,
  sumiSilhouette,
  usesReservedIds,
  type Composition,
  type WallpaperSize,
} from './spec';

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(err.textContent ?? 'parse error');
  return doc;
}

function scene(size: WallpaperSize, post: Composition['post'] = 'none'): Composition {
  const { w, h } = sizeOf(size);
  const texts: TextLayer[] = [
    { text: 'ハナ', x: w * 0.25, y: h * 0.3, size: 60, font: FONTS.brush, fill: SUMI, anchor: 'middle' },
    { text: 'つづく', x: w * 0.75, y: h * 0.7, size: 48, font: FONTS.mincho, fill: '#C9302C', anchor: 'middle' },
  ];
  return {
    svg: svgDoc({
      w,
      h,
      bg: '#1F3A93',
      defs: [el('linearGradient', { id: 'sky' }, el('stop', { offset: '0%', 'stop-color': '#fff' }))],
      body: [rect(0, h / 2, w, h / 2, { fill: 'url(#sky)' }), el('circle', { cx: w / 2, cy: h / 2, r: 100, fill: '#C9302C' }), text('鳥居', { x: 10, y: 50, fill: '#fff' })],
    }),
    texts,
    post,
  };
}

describe('contract helpers', () => {
  it('sizes and safe zones re-exported from svg', () => {
    expect(SIZES.desktop).toEqual([1920, 1080]);
    expect(SIZES.phone).toEqual([1080, 2340]);
    expect(safeZone('phone')).toEqual({ top: 281, bottom: 300 });
  });
  it('isComposition / hasCanvasSize / isSelfContained / usesReservedIds', () => {
    const c = scene('desktop');
    expect(isComposition(c)).toBe(true);
    expect(isComposition({ svg: 'nope', texts: [], post: 'none' })).toBe(false);
    expect(isComposition(null)).toBe(false);
    expect(hasCanvasSize(c, 'desktop')).toBe(true);
    expect(hasCanvasSize(c, 'phone')).toBe(false);
    expect(isSelfContained(c.svg)).toBe(true);
    expect(isSelfContained('<svg><image href="x.png"/></svg>')).toBe(false);
    expect(isSelfContained('<svg><a href="https://x"/></svg>')).toBe(false);
    expect(isSelfContained('<svg><rect fill="url(http://evil)"/></svg>')).toBe(false);
    expect(isSelfContained('<svg><foreignObject/></svg>')).toBe(false);
    expect(isSelfContained('<svg><script/></svg>')).toBe(false);
    expect(usesReservedIds(c.svg)).toBe(false);
    expect(usesReservedIds('<g id="wp-x"/>')).toBe(true);
  });
  it('quadrants are reading order and classify layers by centre', () => {
    expect(quadrantBox(1, 'desktop')).toEqual({ x: 0, y: 0, w: 960, h: 540 });
    expect(quadrantBox(4, 'phone')).toEqual({ x: 540, y: 1170, w: 540, h: 1170 });
    const c = scene('desktop');
    expect(quadrantOf(c.texts[0]!, 'desktop')).toBe(1);
    expect(quadrantOf(c.texts[1]!, 'desktop')).toBe(4);
  });
  it('safeZoneViolations finds phone texts in the forbidden bands only', () => {
    const c = scene('phone');
    expect(safeZoneViolations(c, 'phone')).toEqual([]);
    const bad: Composition = { ...c, texts: [{ ...c.texts[0]!, y: 100 }, { ...c.texts[1]!, y: 2330 }] };
    expect(safeZoneViolations(bad, 'phone').length).toBe(2);
    const d = scene('desktop');
    expect(safeZoneViolations({ ...d, texts: [{ ...d.texts[0]!, y: 100 }, { ...d.texts[1]!, y: 1060 }] }, 'desktop')).toEqual([]);
  });
});

describe('sumiSilhouette', () => {
  it('wraps the scene once, filters it to ink on paper and drops personal text', () => {
    const c = scene('desktop');
    const s = sumiSilhouette(c, 'desktop');
    const doc = parse(s.svg);
    expect(s.texts).toEqual([]);
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 1920 1080');
    expect(doc.querySelector('defs > g#wp-scene')).not.toBeNull();
    expect(doc.querySelector('#wp-scene circle')).not.toBeNull();
    expect(doc.querySelector('filter#wp-sumi feComponentTransfer feFuncR[type="table"]')?.getAttribute('tableValues')).toBe('0.04 0.96');
    const uses = Array.from(doc.querySelectorAll('svg > use'));
    expect(uses.length).toBe(1);
    expect(uses[0]?.getAttribute('filter')).toBe('url(#wp-sumi)');
    expect(uses[0]?.getAttribute('href')).toBe('#wp-scene');
    expect(doc.querySelector('svg > rect')?.getAttribute('fill')).toBe(WASHI);
    // inner defs survive inside the scene
    expect(doc.querySelector('#wp-scene linearGradient#sky')).not.toBeNull();
  });
  it('custom ink/paper and a title', () => {
    const s = sumiSilhouette(scene('phone'), 'phone', { ink: '#000000', paper: '#ffffff', title: 'Torii' });
    const doc = parse(s.svg);
    expect(doc.querySelector('svg > title')?.textContent).toBe('Torii');
    expect(doc.querySelector('feFuncG[type="table"]')?.getAttribute('tableValues')).toBe('0 1');
    expect(sumiFilter('x')).toContain('discrete');
  });
  it('scales a scene composed at the other size into the target canvas', () => {
    const s = sumiSilhouette(scene('desktop'), 'phone');
    const doc = parse(s.svg);
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 1080 2340');
    expect(doc.querySelector('#wp-scene > g')?.getAttribute('transform')).toMatch(/^scale\(0\.56 2\.17\)$/);
  });
});

describe('revealQuadrants', () => {
  it('4 is identity, 0 is the silhouette, 1–3 clip the colour scene over the silhouette', () => {
    const c = scene('desktop');
    expect(revealQuadrants(c, 4, 'desktop')).toBe(c);
    expect(revealQuadrants(c, 0, 'desktop').texts).toEqual([]);
    const two = revealQuadrants(c, 2, 'desktop');
    const doc = parse(two.svg);
    const rects = doc.querySelectorAll('clipPath#wp-reveal rect');
    expect(rects.length).toBe(2);
    expect(rects[1]?.getAttribute('x')).toBe('960');
    expect(doc.querySelectorAll('use[href="#wp-scene"]').length).toBe(2);
    expect(doc.querySelector('g[clip-path="url(#wp-reveal)"] > use')).not.toBeNull();
    // the text in quadrant 1 survives, the one in quadrant 4 is hidden
    expect(two.texts.map((t) => t.text)).toEqual(['ハナ']);
    expect(revealQuadrants(c, 3, 'desktop').texts.length).toBe(1);
    expect(revealQuadrants(c, 1, 'desktop').texts.length).toBe(1);
  });
});

describe('appendPostLayer / finalize', () => {
  it('appends defs + a layer before </svg> and leaves none alone', () => {
    const c = scene('desktop', 'scanlines');
    const out = appendPostLayer(c, 'desktop', 5);
    expect(out.svg.endsWith('</svg>')).toBe(true);
    const doc = parse(out.svg);
    expect(doc.querySelector('pattern#wp-post-scan')).not.toBeNull();
    const last = doc.documentElement.lastElementChild;
    expect(last?.tagName).toBe('rect');
    expect(last?.getAttribute('fill')).toBe('url(#wp-post-scan)');
    const none = scene('desktop', 'none');
    expect(appendPostLayer(none, 'desktop', 5)).toBe(none);
    const grain = appendPostLayer(scene('phone', 'grain'), 'phone', 9);
    expect(grain.svg).toContain('seed="9"');
  });
  it('finalize: unlocked svg mode applies the layer and reports post none; raster mode leaves the svg clean', () => {
    const c = scene('desktop', 'dither');
    const a = finalize(c, { size: 'desktop', seed: 1, locked: false, revealed: 2 });
    expect(a.post).toBe('none');
    expect(a.effect).toBe('dither');
    expect(a.revealed).toBe(4);
    expect(a.locked).toBe(false);
    expect(a.svg).toContain('wp-post-dither');
    expect(a.texts).toEqual(c.texts);
    expect(a).toMatchObject({ w: 1920, h: 1080, seed: 1, size: 'desktop' });
    const b = finalize(c, { size: 'desktop', seed: 1, locked: false, revealed: 4, post: 'raster' });
    expect(b.post).toBe('dither');
    expect(b.svg).toBe(c.svg);
    const n = finalize(c, { size: 'desktop', seed: 1, locked: false, revealed: 4, post: 'none' });
    expect(n.post).toBe('none');
    expect(n.svg).toBe(c.svg);
  });
  it('finalize: locked renders the silhouette (or partial reveal) and keeps the flags', () => {
    const c = scene('phone', 'grain');
    const locked = finalize(c, { size: 'phone', seed: 3, locked: true, revealed: 0 });
    expect(locked.locked).toBe(true);
    expect(locked.revealed).toBe(0);
    expect(locked.texts).toEqual([]);
    expect(locked.svg).toContain('wp-sumi');
    expect(locked.svg).toContain('wp-post-grain');
    parse(locked.svg);
    const partial = finalize(c, { size: 'phone', seed: 3, locked: true, revealed: 3 });
    expect(partial.svg).toContain('wp-reveal');
    expect(partial.texts.length).toBe(1);
    expect(partial.w).toBe(1080);
    expect(partial.h).toBe(2340);
  });
  it('is deterministic', () => {
    const c = scene('desktop', 'grain');
    const a = finalize(c, { size: 'desktop', seed: 11, locked: true, revealed: 1 });
    const b = finalize(c, { size: 'desktop', seed: 11, locked: true, revealed: 1 });
    expect(a).toEqual(b);
  });
});
