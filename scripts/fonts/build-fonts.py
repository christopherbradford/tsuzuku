#!/usr/bin/env python3
"""Build TSUZUKU webfont subsets (public/fonts/*.woff2 + src/styles/fonts.css).

Usage (one-off, needs fonttools + brotli; not part of npm scripts):
  python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
  # download the four OFL TTFs + OFL.txt from github.com/google/fonts into
  #   <dir>/dotgothic16/DotGothic16-Regular.ttf, <dir>/yujisyuku/YujiSyuku-Regular.ttf,
  #   <dir>/shipporiminchob1/ShipporiMinchoB1-Regular.ttf, <dir>/delagothicone/DelaGothicOne-Regular.ttf
  PATH=/tmp/fontenv/bin:$PATH python3 -I scripts/fonts/build-fonts.py <dir>        # add --plan to only print the slices

Slices (per family): base (ASCII, kana, symbols, punctuation), n5, n4, n3, n2 (the
kanji of each JLPT level from public/content/kanji), rest (every other CJK
ideograph that appears in the corpus or the UI). Later-declared @font-face rules
take precedence for overlapping unicode-range, so `rest` is declared first with
the whole CJK block and the level slices after it with explicit ranges.
"""
import glob, json, os, subprocess, sys, shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = sys.argv[1]            # downloaded fonts dir
OUT = os.path.join(ROOT, 'public', 'fonts')
PLAN = '--plan' in sys.argv

FAMILIES = [
    # (file stem, family, dir, local() names)
    ('DotGothic16', 'DotGothic16', 'dotgothic16', ['DotGothic16', 'DotGothic16-Regular']),
    ('YujiSyuku', 'Yuji Syuku', 'yujisyuku', ['Yuji Syuku', 'YujiSyuku-Regular']),
    ('ShipporiMinchoB1', 'Shippori Mincho B1', 'shipporiminchob1', ['Shippori Mincho B1', 'ShipporiMinchoB1-Regular']),
    ('DelaGothicOne', 'Dela Gothic One', 'delagothicone', ['Dela Gothic One', 'DelaGothicOne-Regular']),
]

def is_cjk(c):
    o = ord(c)
    return 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or 0xF900 <= o <= 0xFAFF

def chars_in(paths):
    s = set()
    for p in paths:
        try:
            s.update(open(p, encoding='utf-8').read())
        except Exception:
            pass
    return s

src_files = [p for p in glob.glob(f'{ROOT}/src/**/*.*', recursive=True)
             if p.endswith(('.ts', '.tsx', '.css')) and '.test.' not in p]
content_files = glob.glob(f'{ROOT}/public/content/**/*.json', recursive=True)
used = chars_in(src_files) | chars_in(content_files)

levels = {'n5': set(), 'n4': set(), 'n3': set(), 'n2': set()}
for p in glob.glob(f'{ROOT}/public/content/kanji/*/*.json'):
    lvl = p.split('/')[-2]
    d = json.load(open(p, encoding='utf-8'))
    for it in d.get('items', []):
        ch = it.get('char')
        if ch and lvl in levels:
            levels[lvl].add(ch)
# a kanji listed at two levels belongs to the lower (earlier) one
seen = set()
for lvl in ['n5', 'n4', 'n3', 'n2']:
    levels[lvl] -= seen
    seen |= levels[lvl]
rest = {c for c in used if is_cjk(c)} - seen

base = {c for c in used if not is_cjk(c) and ord(c) >= 0x20 and ord(c) not in (0x7F,)}
base |= {chr(o) for o in range(0x20, 0x7F)}
base |= {chr(o) for o in range(0x3000, 0x3040)}      # CJK symbols & punctuation (incl. 々〆〇)
base |= {chr(o) for o in range(0x3041, 0x3097)}      # hiragana
base |= {chr(o) for o in range(0x3099, 0x30A0)}      # voicing marks, ゝゞ
base |= {chr(o) for o in range(0x30A0, 0x3100)}      # katakana
base |= {chr(o) for o in range(0x31F0, 0x3200)}      # small katakana
base |= {chr(o) for o in range(0xFF01, 0xFF5F)}      # full-width ASCII
base |= {chr(o) for o in range(0xFF61, 0xFFA0)}      # half-width kana
base |= set('★☆♪♫♡♥○●◎◯△▲▽▼□■◆◇✓✔✕✗→←↑↓↔⇒⇔…‥〜～ー・「」『』【】（）！？：；，．、。¥€£°±×÷≈≠≤≥∞√∑∂∈∪∩⌈⌉─│┌┐└┘├┤┬┴┼█▓▒░▀▄▌▐')
base = {c for c in base if not c.isspace() or c == ' '}

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
    return ', '.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in rs)

BASE_BLOCKS = [(0x0000, 0x00FF), (0x0100, 0x024F), (0x0370, 0x03FF), (0x2000, 0x206F), (0x2070, 0x20CF),
               (0x2100, 0x214F), (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x23FF), (0x2500, 0x25FF),
               (0x2600, 0x27BF), (0x3000, 0x30FF), (0x31F0, 0x31FF), (0xFF00, 0xFFEF)]
REST_BLOCKS = [(0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)]

slices = [  # declaration order: rest first (lowest precedence), then levels, then base
    ('rest', rest, REST_BLOCKS),
    ('n2', levels['n2'], None), ('n3', levels['n3'], None), ('n4', levels['n4'], None), ('n5', levels['n5'], None),
    ('base', base, BASE_BLOCKS),
]
for name, chars, blocks in slices:
    rs = ranges(chars)
    print(f'slice {name:5s} chars={len(chars):5d} explicit-ranges={len(rs):5d} css-chars={len(fmt(blocks or rs))}')
if PLAN:
    sys.exit(0)

PYFT = os.environ.get('PYFTSUBSET') or shutil.which('pyftsubset') or sys.exit('pyftsubset not found: pip install fonttools brotli')
os.makedirs(OUT, exist_ok=True)
css = ['/*',
       ' * TSUZUKU — self-hosted webfonts (SIL Open Font License 1.1; see public/fonts/OFL-*.txt).',
       ' * Generated by scripts/fonts/build-fonts.py from the corpus + UI glyph inventory: six',
       ' * unicode-range slices per family (base / n5 / n4 / n3 / n2 / rest) so a learner only',
       ' * downloads the kanji of the levels they have reached. Later rules win for overlapping',
       ' * ranges (CSS Fonts 4 §4.5), so `rest` is declared first with the whole CJK block.',
       ' * Every face lists local() first and uses font-display: swap; the page works without them.',
       ' */']
sizes = {}
for stem, family, d, locals_ in FAMILIES:
    ttf = os.path.join(SRC, d, f'{stem}-Regular.ttf')
    shutil.copyfile(os.path.join(SRC, d, 'OFL.txt'), os.path.join(OUT, f'OFL-{stem}.txt'))
    for name, chars, blocks in slices:
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
open(os.path.join(ROOT, 'src', 'styles', 'fonts.css'), 'w', encoding='utf-8').write('\n'.join(css) + '\n')
total = 0
for k, v in sizes.items():
    print(f'{k:28s} {v/1024:8.1f} KB'); total += v
print(f'TOTAL {total/1024/1024:.2f} MB  css {os.path.getsize(os.path.join(ROOT,"src","styles","fonts.css"))/1024:.1f} KB')
