/**
 * TSUZUKU — kakejiku 'kanji-stars' 漢字星座 (design 06 §3).
 *
 * The learner's Mastered kanji as stars on a night sky: Poisson-disc
 * positions relaxed apart, brightness and size by stability rank, a fBm
 * Milky Way band, a dust of background stars. Constellation lines join
 * kanji that share a component (a compact component table lives in this
 * file), and the three components the learner's kanji use most are
 * labelled near their groups. Black belts see the brightest stars in kin.
 *
 * Seed → star field, Milky Way angle, which point each kanji takes, the
 * sky tint. Component labels, name and date are `TextLayer`s.
 */
import { hashSeed, mulberry32, shuffle, uniform } from '../../shared/hash';
import { INK_WASH, NIGHT, PALETTE, WASHI, WASHI_LIGHT, alpha, beltColor, mix } from '../color';
import { type Pt } from '../geom';
import { FONTS, eraDate, fitSize, textWidth, type TextLayer } from '../jtext';
import { poisson } from '../noise';
import { el, feTurbulence, filter, g, line, linearGradient, mask, path, radialGradient, rect, svgDoc, text, url } from '../svg';
import { WALLPAPER_NAMES } from '../strings';
import { safeRect, sizeOf, type Composition, type WallpaperData, type WallpaperSize, type WallpaperSpec } from './spec';

const P = 'ks';

/** Component → kanji that visibly contain it (common N5–N3 set). A kanji may belong to several. */
export const COMPONENTS: readonly (readonly [string, string])[] = [
  ['日', '日明時晴曜暗昨春書早朝間昼晩曇旧易星是昔暑者音意'],
  ['月', '月明朝期有服前青育胸肉'],
  ['木', '木本校林森村休東親新机桜柱横様集案楽業'],
  ['言', '言語読話記計試説訳詞語論議談調'],
  ['門', '門間聞開閉関問'],
  ['田', '田男町画界思番留細略'],
  ['口', '口古話語名各右知品問員台号'],
  ['女', '女好安始姉妹婚要'],
  ['人', '人休何体住使作他今会以仕令全入'],
  ['水', '水海池泳酒洗決汽泣活流温港湖油注'],
  ['火', '火秋焼煙災炎'],
  ['土', '土場地走去寺社幸'],
  ['金', '金銀鉄銭録'],
  ['車', '車転軽輪連運'],
  ['貝', '貝買売員貸貨質賞'],
  ['目', '目見眼直省相県真'],
  ['耳', '耳聞取最職'],
  ['手', '手持投打指押拾'],
  ['足', '足路跳走'],
  ['雨', '雨電雪雲霧需'],
  ['糸', '糸紙終絵続経結組練給'],
  ['心', '心思忘念急悪意息愛感'],
  ['宀', '安家字室客実写宿守定完官寒富'],
  ['艹', '花草茶英薬菜若落葉'],
  ['竹', '竹筆答笑第算節箱'],
  ['立', '立音新親童産章競'],
  ['刀', '刀分切前別利初到'],
  ['力', '力男動働助勉勝加'],
  ['大', '大太天夫奥美'],
  ['小', '小少省尖'],
  ['山', '山岩島崎岸炭'],
  ['石', '石研砂岩'],
  ['米', '米料数番精'],
  ['食', '食飲飯館'],
  ['馬', '馬駅験駐'],
  ['鳥', '鳥鳴島'],
  ['寸', '寸時待持特寺守対'],
  ['王', '王玉国理現球'],
  ['工', '工左空江紅功'],
  ['止', '止歩正歳武'],
  ['辶', '道近週進遠通送運返速連'],
  ['牛', '牛物特件'],
  ['犬', '犬独猫'],
  ['虫', '虫強風独'],
  ['囗', '国回図園四因困'],
  ['示', '示社神祭礼祈福'],
  ['青', '青晴清静精情'],
  ['寺', '寺時持待特'],
  ['可', '可何河歌'],
  ['主', '主住注柱'],
  ['白', '白百泊拍'],
  ['中', '中仲忠'],
  ['化', '化花貨'],
  ['今', '今念含'],
  ['方', '方放訪防'],
  ['自', '自息'],
];

interface Star {
  kanji: string;
  p: Pt;
  rank: number;
}

/** Components of a kanji from the table (possibly none). */
export function componentsOf(kanji: string): string[] {
  const out: string[] = [];
  for (const [c, members] of COMPONENTS) if (members.includes(kanji) && c !== kanji) out.push(c);
  return out;
}

function compose(seed: number, data: WallpaperData, size: WallpaperSize): Composition {
  const { w, h } = sizeOf(size);
  const phone = size === 'phone';
  const rng = mulberry32(seed);
  const safe = safeRect(size, phone ? 48 : 40);
  const D = PALETTE.dark;
  const kin = D.kin;
  const defs: string[] = [];
  const body: string[] = [];
  const texts: TextLayer[] = [];

  /* Sky */
  const tintX = uniform(rng, 0.2, 0.8);
  const tintY = uniform(rng, 0.2, 0.8);
  defs.push(radialGradient(`${P}-sky`, [[0, mix(NIGHT, D.kon, 0.22)], [0.6, NIGHT], [1, mix(NIGHT, '#000000', 0.4)]], { cx: tintX, cy: tintY, r: 0.9 }));
  body.push(rect(0, 0, w, h, { fill: url(`${P}-sky`) }));

  /* Milky Way: a turbulence-filled band, rotated, faded at its edges by a mask */
  const angle = uniform(rng, -40, 40) + (phone ? 70 : 0);
  const bandW = Math.hypot(w, h) * 1.2;
  const bandH = Math.min(w, h) * uniform(rng, 0.42, 0.6);
  defs.push(
    filter(`${P}-mw`, [
      feTurbulence({ baseFrequency: [phone ? 0.0032 : 0.0028, 0.0042], octaves: 4, seed: hashSeed(seed, 'mw'), result: 'n' }),
      el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0.85  0 0 0 0 0.86  0 0 0 0 1  0 0 0 0.75 -0.18' }),
    ]),
  );
  defs.push(linearGradient(`${P}-fade`, [[0, '#000000'], [0.5, '#ffffff'], [1, '#000000']], 90));
  defs.push(mask(`${P}-mask`, rect(w / 2 - bandW / 2, h / 2 - bandH / 2, bandW, bandH, { fill: url(`${P}-fade`) }), { x: -w * 2, y: -h * 2, width: w * 5, height: h * 5 }));
  body.push(
    g(
      { transform: `rotate(${angle.toFixed(1)} ${w / 2} ${h / 2})`, mask: url(`${P}-mask`) },
      rect(w / 2 - bandW / 2, h / 2 - bandH / 2, bandW, bandH, { fill: WASHI, filter: url(`${P}-mw`), opacity: 0.3 }),
    ),
  );

  /* Dust: hundreds of faint stars as one path; a few bright twinkles */
  const dRng = mulberry32(hashSeed(seed, 'dust'));
  let dust = '';
  const dustN = phone ? 420 : 520;
  for (let i = 0; i < dustN; i++) {
    const x = uniform(dRng, 0, w);
    const y = uniform(dRng, 0, h);
    const s = uniform(dRng, 0.8, 2.2);
    dust += `M${x.toFixed(1)} ${y.toFixed(1)}h${s.toFixed(1)}v${s.toFixed(1)}h-${s.toFixed(1)}Z`;
  }
  body.push(path(dust, { fill: WASHI, opacity: 0.55 }));
  defs.push(radialGradient(`${P}-tw`, [[0, WASHI_LIGHT, 0.9], [0.3, WASHI, 0.35], [1, WASHI, 0]]));
  const twinkles: string[] = [];
  for (let i = 0; i < (phone ? 18 : 24); i++) {
    const x = uniform(dRng, 0, w);
    const y = uniform(dRng, 0, h);
    const r = uniform(dRng, 6, 14);
    twinkles.push(el('circle', { cx: x, cy: y, r, fill: url(`${P}-tw`) }));
  }
  body.push(g(undefined, twinkles));

  /* Kanji stars */
  const kanji = data.mastered.kanji.filter((k) => Array.from(k).length === 1);
  const maxStars = phone ? 90 : 120;
  const N = Math.min(kanji.length, maxStars);
  const margin = phone ? 70 : 60;
  const fieldW = w - 2 * margin;
  const fieldH = h - 2 * margin;
  const minDist = Math.sqrt((fieldW * fieldH) / Math.max(1, N)) * 0.62;
  const field = N > 0 ? poisson(hashSeed(seed, 'poisson'), fieldW, fieldH, minDist, 2, { k: 24 }) : [];
  // keep the bottom text strip clear of stars
  const clearY = safe.y + safe.h - (phone ? 150 : 120) - margin;
  const pool: Pt[] = shuffle(mulberry32(hashSeed(seed, 'order')), field)
    .filter((p) => p[1] < clearY)
    .map((p) => [p[0] + margin, p[1] + margin] as Pt);
  const chosen = kanji.slice(0, Math.min(N, pool.length));
  // cluster each component family around an anchor so constellations stay compact
  const primary = (k: string): string | null => componentsOf(k)[0] ?? null;
  const families = new Map<string, string[]>();
  for (const k of chosen) {
    const c = primary(k);
    if (c) (families.get(c) ?? families.set(c, []).get(c)!).push(k);
  }
  const bySize = [...families.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const aRng = mulberry32(hashSeed(seed, 'anchor'));
  const placed = new Map<string, Pt>();
  const free = pool.slice();
  for (const [, members] of bySize) {
    if (members.length < 2 || free.length === 0) continue;
    const anchor = free[Math.floor(uniform(aRng, 0, free.length))]!;
    free.sort((a, b) => Math.hypot(a[0] - anchor[0], a[1] - anchor[1]) - Math.hypot(b[0] - anchor[0], b[1] - anchor[1]));
    for (const k of members) {
      const p = free.shift();
      if (p) placed.set(k, p);
    }
  }
  const loose = shuffle(mulberry32(hashSeed(seed, 'loose')), free);
  const stars: Star[] = [];
  chosen.forEach((k, i) => {
    const p = placed.get(k) ?? loose.pop();
    if (p) stars.push({ kanji: k, p, rank: i });
  });
  const count = stars.length;
  const sizeOfRank = (r: number): number => (phone ? 46 : 48) - (phone ? 22 : 24) * (count > 1 ? r / (count - 1) : 0);
  const opacityOfRank = (r: number): number => 1 - 0.55 * (count > 1 ? r / (count - 1) : 0);
  const black = data.belt === 'black';

  /* Constellation edges: the component families placed above, strongest seven each, joined in angular order */
  const groups = new Map<string, Star[]>();
  for (const s of stars) {
    const c = primary(s.kanji);
    if (c) (groups.get(c) ?? groups.set(c, []).get(c)!).push(s);
  }
  const ranked = [...groups.entries()].filter(([, m]) => m.length >= 2).sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const edgeColors = [kin, D.ai, D.sakura, D['neon-c'], D.matcha];
  const edges: string[] = [];
  ranked.forEach(([, members], gi) => {
    const m = members.slice(0, 7);
    const cx = m.reduce((a, s) => a + s.p[0], 0) / m.length;
    const cy = m.reduce((a, s) => a + s.p[1], 0) / m.length;
    const ordered = [...m].sort((a, b) => Math.atan2(a.p[1] - cy, a.p[0] - cx) - Math.atan2(b.p[1] - cy, b.p[0] - cx));
    const col = edgeColors[gi % edgeColors.length]!;
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i]!;
      const b = ordered[(i + 1) % ordered.length]!;
      if (ordered.length === 2 && i === 1) break;
      edges.push(line(a.p[0], a.p[1], b.p[0], b.p[1], { stroke: alpha(col, 0.42), 'stroke-width': phone ? 1.8 : 1.5 }));
    }
  });
  body.push(g(undefined, edges));

  /* The stars themselves: a halo and the glyph */
  defs.push(radialGradient(`${P}-halo`, [[0, WASHI, 0.55], [0.5, WASHI, 0.12], [1, WASHI, 0]]));
  defs.push(radialGradient(`${P}-halo-kin`, [[0, kin, 0.6], [0.5, kin, 0.14], [1, kin, 0]]));
  const halos: string[] = [];
  const glyphs: string[] = [];
  for (const s of stars) {
    const sz = sizeOfRank(s.rank);
    const golden = black && s.rank < Math.ceil(count / 3);
    halos.push(el('circle', { cx: s.p[0], cy: s.p[1], r: sz * 1.1, fill: url(golden ? `${P}-halo-kin` : `${P}-halo`) }));
    glyphs.push(text(s.kanji, { x: s.p[0], y: s.p[1], 'font-size': sz, fill: golden ? kin : mix(WASHI_LIGHT, D.kon, 0.1), opacity: opacityOfRank(s.rank) }));
  }
  body.push(g(undefined, halos));
  body.push(g({ 'font-family': FONTS.mincho, 'text-anchor': 'middle', 'dominant-baseline': 'central', lang: 'ja' }, glyphs));

  /* Labels: the three most used components, near their groups, kept inside the safe area */
  const labelSize = phone ? 34 : 30;
  for (const [comp, members] of ranked.slice(0, 3)) {
    const m = members.slice(0, 7);
    const cx = m.reduce((a, s) => a + s.p[0], 0) / m.length;
    const minY = Math.min(...m.map((s) => s.p[1]));
    const maxX = Math.max(...m.map((s) => s.p[0]));
    const lx = Math.max(safe.x + labelSize, Math.min(safe.x + safe.w - labelSize, (cx + maxX) / 2 + labelSize * 1.6));
    const ly = Math.max(safe.y + labelSize, Math.min(safe.y + safe.h - labelSize * 0.4, minY - labelSize * 0.9));
    body.push(el('circle', { cx: lx, cy: ly - labelSize * 0.32, r: labelSize * 0.85, fill: 'none', stroke: alpha(kin, 0.55), 'stroke-width': 1.2, 'stroke-dasharray': '3 4' }));
    texts.push({ text: comp, x: lx, y: ly, size: labelSize, font: FONTS.mincho, fill: kin, anchor: 'middle', lang: 'ja' });
  }

  /* Name and date, bottom left; belt accent as a thin rule */
  const ns = phone ? 34 : 30;
  const ds = phone ? 26 : 22;
  const baseY = safe.y + safe.h - ds * 0.3;
  const nameSize = Math.min(ns, fitSize(data.nameKana, safe.w * 0.5, ns, { max: ns }));
  texts.push({ text: data.nameKana, x: safe.x, y: baseY - ds * 2, size: nameSize, font: FONTS.brush, fill: WASHI, lang: 'ja' });
  texts.push({ text: eraDate(data.date), x: safe.x, y: baseY, size: ds, font: FONTS.mincho, fill: mix(WASHI, INK_WASH, 0.3), opacity: 0.9, lang: 'ja' });
  body.push(line(safe.x, baseY - ds * 2 + 10, safe.x + Math.max(textWidth(data.nameKana, nameSize), 120), baseY - ds * 2 + 10, { stroke: beltColor(data.belt), 'stroke-width': 2, opacity: 0.9 }));
  const titleSize = phone ? 30 : 26;
  texts.push({ text: WALLPAPER_NAMES['kanji-stars'].ja, x: safe.x + safe.w, y: baseY, size: titleSize, font: FONTS.mincho, fill: alpha(WASHI, 0.7), anchor: 'end', lang: 'ja' });

  const svg = svgDoc({ w, h, defs, body, title: WALLPAPER_NAMES['kanji-stars'].en, attrs: { 'data-piece': 'kanji-stars' } });
  return { svg, texts, post: 'none' };
}

export const spec: WallpaperSpec = { id: 'kanji-stars', compose };
