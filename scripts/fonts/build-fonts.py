#!/usr/bin/env python3
"""Build TSUZUKU webfont subsets (public/fonts/*.woff2 + src/styles/fonts.css).

Usage (one-off, needs fonttools + brotli; not part of npm scripts):
  python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
  # download the four OFL TTFs + OFL.txt from github.com/google/fonts into
  #   <dir>/dotgothic16/DotGothic16-Regular.ttf, <dir>/yujisyuku/YujiSyuku-Regular.ttf,
  #   <dir>/shipporiminchob1/ShipporiMinchoB1-Regular.ttf, <dir>/delagothicone/DelaGothicOne-Regular.ttf
  PATH=/tmp/fontenv/bin:$PATH python3 -I scripts/fonts/build-fonts.py <dir>        # add --plan to only print the slices

Slices per family, declared in this order because later @font-face rules win for an
overlapping unicode-range (CSS Fonts 4 §4.5):
  rest          every other CJK ideograph of the corpus; its range is the whole CJK block, so it
                has the lowest precedence. Not built for the families in NO_REST_FAMILIES.
  n2 n3 n4 n5   the kanji of each JLPT level (public/content/kanji/<level>/*.json; a kanji listed
                at two levels belongs to the lower one), explicit code points, minus the UI
                inventory. The kanji dirs are the only source of level slices.
  base          ASCII, kana, symbols, punctuation (block ranges) + the UI glyph inventory: every
                CJK ideograph, and every other glyph outside the base blocks, that the shell
                itself can render — src/**/*.{ts,tsx,css} (strings files, STATIONS, belt, page
                and reward names, art labels), index.html and public/manifest.webmanifest, minus
                UI_EXCLUDE. Listed as explicit code points and declared last, so a brand-new
                learner renders the header, the Road and the Library from `base` alone and
                never downloads a level slice for shell chrome.
Stale `<stem>-<slice>.woff2` files the run did not build are removed, so the directory always
matches the stylesheet. `--plan` prints the inventory and per-slice glyph counts only.
"""
import glob, json, os, subprocess, sys, shutil, unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
if len(sys.argv) < 2 or sys.argv[1].startswith('--'):
    sys.exit(__doc__)
SRC = sys.argv[1]            # downloaded fonts dir
OUT = os.path.join(ROOT, 'public', 'fonts')
CSS_OUT = os.path.join(ROOT, 'src', 'styles', 'fonts.css')
PLAN = '--plan' in sys.argv

FAMILIES = [
    # (file stem, family, dir, local() names)
    ('DotGothic16', 'DotGothic16', 'dotgothic16', ['DotGothic16', 'DotGothic16-Regular']),
    ('YujiSyuku', 'Yuji Syuku', 'yujisyuku', ['Yuji Syuku', 'YujiSyuku-Regular']),
    ('ShipporiMinchoB1', 'Shippori Mincho B1', 'shipporiminchob1', ['Shippori Mincho B1', 'ShipporiMinchoB1-Regular']),
    ('DelaGothicOne', 'Dela Gothic One', 'delagothicone', ['Dela Gothic One', 'DelaGothicOne-Regular']),
]
SLICE_NAMES = ('rest', 'n2', 'n3', 'n4', 'n5', 'base')

# The brush face (--font-brush) draws shell chrome, station and reward names, never corpus
# text, so its catch-all `rest` slice (815 KB: every N1 / vocabulary-only ideograph of the
# corpus) was fetched by every phone that opened the Road for a handful of glyphs. These
# families ship no `rest` face and emit no @font-face for it; the shell glyphs they need are
# in `base`, and a non-corpus kanji falls back to the system mincho next in the stack.
NO_REST_FAMILIES = frozenset({'YujiSyuku'})

# UI glyph inventory: repo-relative globs scanned, and path fragments left out of the scan.
UI_SOURCES = ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.css', 'index.html', 'public/manifest.webmanifest']
UI_EXCLUDE = (
    '.test.',                             # test fixtures never render
    'src/content/fixtures/',              # contract-tier test doubles (a fixture corpus)
    'src/art/wallpapers/kanji-stars.ts',  # component → kanji index over corpus kanji: a star is drawn only
                                          # for a kanji the learner mastered, whose level slice is present
)
# src/styles/fonts.test.ts mirrors UI_SOURCES / UI_EXCLUDE; change both together.

CJK_BLOCKS = [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)]
BASE_BLOCKS = [(0x0000, 0x00FF), (0x0100, 0x024F), (0x0370, 0x03FF), (0x2000, 0x206F), (0x2070, 0x20CF),
               (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x23FF), (0x2500, 0x25FF),
               (0x2600, 0x27BF), (0x3000, 0x30FF), (0x31F0, 0x31FF), (0xFF00, 0xFFEF)]

def in_blocks(c, blocks):
    o = ord(c)
    return any(a <= o <= b for a, b in blocks)

def is_cjk(c):
    return in_blocks(c, CJK_BLOCKS)

def printable(c):
    """A glyph worth a code point in a slice: no controls, separators, format characters,
    surrogates, private use, unassigned, and no variation selectors (U+FE00–FE0F)."""
    return ord(c) >= 0x20 and unicodedata.category(c)[0] not in 'CZ' and not 0xFE00 <= ord(c) <= 0xFE0F

def chars_in(paths):
    s = set()
    for p in paths:
        try:
            s.update(open(p, encoding='utf-8').read())
        except Exception:
            pass
    return s

def rel(p):
    return os.path.relpath(p, ROOT).replace(os.sep, '/')

ui_all = sorted({p for pat in UI_SOURCES for p in glob.glob(os.path.join(ROOT, pat), recursive=True)})
ui_files = [p for p in ui_all if not any(x in rel(p) for x in UI_EXCLUDE)]
src_nontest = [p for p in ui_all if '.test.' not in rel(p)]
content_files = glob.glob(f'{ROOT}/public/content/**/*.json', recursive=True)

ui_chars = chars_in(ui_files)
used = chars_in(src_nontest) | chars_in(content_files)
inventory = {c for c in ui_chars if printable(c) and (is_cjk(c) or not in_blocks(c, BASE_BLOCKS))}

levels = {'n5': set(), 'n4': set(), 'n3': set(), 'n2': set()}
for p in glob.glob(f'{ROOT}/public/content/kanji/*/*.json'):
    lvl = p.split('/')[-2]
    d = json.load(open(p, encoding='utf-8'))
    for it in d.get('items', []):
        ch = it.get('char')
        if ch and lvl in levels:
            levels[lvl].add(ch)
# the UI inventory beats every level; a kanji listed at two levels belongs to the lower (earlier) one
seen = set(inventory)
for lvl in ['n5', 'n4', 'n3', 'n2']:
    levels[lvl] -= seen
    seen |= levels[lvl]
rest = {c for c in used if is_cjk(c)} - seen

base = {c for c in used if not is_cjk(c) and printable(c)}
base |= {chr(o) for o in range(0x20, 0x7F)}
base |= {chr(o) for o in range(0x3000, 0x3040)}      # CJK symbols & punctuation (incl. 々〆〇)
base |= {chr(o) for o in range(0x3041, 0x3097)}      # hiragana
base |= {chr(o) for o in range(0x3099, 0x30A0)}      # voicing marks, ゝゞ
base |= {chr(o) for o in range(0x30A0, 0x3100)}      # katakana
base |= {chr(o) for o in range(0x31F0, 0x3200)}      # small katakana
base |= {chr(o) for o in range(0xFF01, 0xFF5F)}      # full-width ASCII
base |= {chr(o) for o in range(0xFF61, 0xFFA0)}      # half-width kana
base |= set('★☆♪♫♡♥○●◎◯△▲▽▼□■◆◇✓✔✕✗→←↑↓↔⇒⇔…‥〜～ー・「」『』【】（）！？：；，．、。¥€£°±×÷≈≠≤≥∞√∑∂∈∪∩⌈⌉─│┌┐└┘├┤┬┴┼█▓▒░▀▄▌▐')
base |= inventory

def ranges(chars):
    cps = sorted(ord(c) for c in chars)
    out = []
    for cp in cps:
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out

def fmt(rs):
    return ', '.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in sorted(rs))

# base's range = the block ranges + an explicit code point for everything else in the slice
# (the UI inventory above all), so every glyph the slice carries is reachable.
base_blocks = [list(b) for b in BASE_BLOCKS] + ranges({c for c in base if not in_blocks(c, BASE_BLOCKS)})

SLICES = {  # name -> (chars, css ranges or None for explicit code points)
    'rest': (rest, CJK_BLOCKS), 'n2': (levels['n2'], None), 'n3': (levels['n3'], None),
    'n4': (levels['n4'], None), 'n5': (levels['n5'], None), 'base': (base, base_blocks),
}

def slices_for(stem):
    """Declaration order: rest first (lowest precedence), then the levels, then base."""
    return [n for n in SLICE_NAMES if not (n == 'rest' and stem in NO_REST_FAMILIES)]

inv_cjk = sum(1 for c in inventory if is_cjk(c))
print(f'UI inventory: {len(inventory)} glyphs ({inv_cjk} CJK ideographs + {len(inventory) - inv_cjk} other) '
      f'from {len(ui_files)} files; excluded: {", ".join(UI_EXCLUDE)}')
for name in SLICE_NAMES:
    chars, blocks = SLICES[name]
    rs = ranges(chars)
    print(f'slice {name:5s} glyphs={len(chars):5d} explicit-ranges={len(rs):5d} css-chars={len(fmt(blocks or rs))}')
for stem, family, _, _ in FAMILIES:
    note = '  (no rest: NO_REST_FAMILIES)' if stem in NO_REST_FAMILIES else ''
    print(f'family {family:20s} faces: {" ".join(slices_for(stem))}{note}')
if PLAN:
    sys.exit(0)

PYFT = os.environ.get('PYFTSUBSET') or shutil.which('pyftsubset') or sys.exit('pyftsubset not found: pip install fonttools brotli')
os.makedirs(OUT, exist_ok=True)
n_faces = sum(len(slices_for(stem)) for stem, _, _, _ in FAMILIES)
css = ['/*',
       ' * TSUZUKU — self-hosted webfonts (SIL Open Font License 1.1; see public/fonts/OFL-*.txt).',
       ' * GENERATED by scripts/fonts/build-fonts.py — do not hand-edit; rerun the script instead.',
       ' * Unicode-range slices per family, declared in precedence order (later rules win for an',
       ' * overlapping range, CSS Fonts 4 §4.5): `rest` first with the whole CJK block (every other',
       ' * corpus ideograph), then n2 / n3 / n4 / n5 (the kanji of each JLPT level as explicit code',
       ' * points, so a learner only downloads the levels they have reached) and `base` last: ASCII,',
       f' * kana, symbols, punctuation + the UI glyph inventory — the {inv_cjk} ideographs the shell',
       ' * itself renders (strings files, station names, belt / page / reward names), listed',
       ' * explicitly so the header, the Road and the Library never pull a level slice.',
       ' * The brush family (Yuji Syuku) ships no `rest` face: it draws shell chrome and proper',
       ' * names, never corpus text, and its catch-all slice weighed 815 KB; a non-corpus kanji in',
       f' * --font-brush falls back to the system mincho. {n_faces} faces in all.',
       ' * Every face lists local() first and uses font-display: swap; the page works without them.',
       ' */']
sizes = {}
for stem, family, d, locals_ in FAMILIES:
    ttf = os.path.join(SRC, d, f'{stem}-Regular.ttf')
    shutil.copyfile(os.path.join(SRC, d, 'OFL.txt'), os.path.join(OUT, f'OFL-{stem}.txt'))
    for name in slices_for(stem):
        chars, blocks = SLICES[name]
        out = os.path.join(OUT, f'{stem}-{name}.woff2')
        uni = ','.join(f'{ord(c):04X}' for c in sorted(chars))
        cmd = [PYFT, ttf, f'--unicodes={uni}', '--flavor=woff2', '--layout-features=kern,palt,pwid,vert,vrt2,liga,ccmp,locl,calt',
               '--no-hinting', '--desubroutinize', "--name-IDs=*", '--notdef-outline', f'--output-file={out}']
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print('FAILED', stem, name, r.stderr[-800:]); sys.exit(1)
        sizes[f'{stem}-{name}'] = os.path.getsize(out)
        rs = fmt(blocks or ranges(chars))
        loc = ', '.join(f'local("{l}")' for l in locals_)
        css += ['@font-face {', f'  font-family: "{family}";', '  font-style: normal;', '  font-weight: 400;',
                '  font-display: swap;', f'  src: {loc}, url("/fonts/{stem}-{name}.woff2") format("woff2");',
                f'  unicode-range: {rs};', '}']
    for name in SLICE_NAMES:                       # prune slices this run did not build (e.g. a dropped rest)
        stale = os.path.join(OUT, f'{stem}-{name}.woff2')
        if name not in slices_for(stem) and os.path.exists(stale):
            os.remove(stale); print(f'removed stale {rel(stale)}')
open(CSS_OUT, 'w', encoding='utf-8').write('\n'.join(css) + '\n')
total = 0
for k, v in sizes.items():
    print(f'{k:28s} {v/1024:8.1f} KB'); total += v
print(f'TOTAL {total/1024/1024:.2f} MB  css {os.path.getsize(CSS_OUT)/1024:.1f} KB  faces {n_faces}')
