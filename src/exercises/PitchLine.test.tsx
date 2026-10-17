import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { moraCount } from '@/shared/jp';
import type { Step } from '@/shared/session-types';
import { ExerciseFrame } from '@/shared/ui/ExerciseFrame';
import { GLYPH_NUCLEUS, PITCH_TYPES, PitchGlyph, PitchLine, pitchContour, pitchType, pitchTypeFor } from './PitchLine';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const step: Step = {
  id: 's1',
  block: 'reviews',
  exercise: 'pitch-ear',
  itemId: 'v-n5-0007',
  cardKey: 'v-n5-0007#pitch',
  params: {},
  timed: false,
  isNew: false,
  stepTag: null,
  exposures: 3,
  estMs: 6000,
};

function inFrame(children: preact.ComponentChildren): preact.JSX.Element {
  return (
    <ExerciseFrame
      step={step}
      index={0}
      total={5}
      ki={10}
      combo={0}
      comboTier={0}
      timer={null}
      feel="dojo"
      feedback={null}
      now={() => 0}
      onGuard={() => undefined}
      onHint={() => undefined}
      onPause={() => undefined}
      onContinue={() => undefined}
    >
      {children}
    </ExerciseFrame>
  );
}

function press(key: string): void {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function svg(): SVGSVGElement {
  return root.querySelector('svg.pitch-svg') as SVGSVGElement;
}

describe('pitchType', () => {
  it.each([
    ['あめ', 1, 'atamadaka'], // 雨
    ['あめ', 0, 'heiban'], // 飴
    ['おとこ', 3, 'odaka'], // 男 (3 morae, drop after the last)
    ['おとこのこ', 3, 'nakadaka'], // 3 of 5 morae
    ['はな', 2, 'odaka'], // 花
    ['はな', 0, 'heiban'], // 鼻
    ['ひ', 0, 'heiban'],
    ['き', 1, 'atamadaka'],
    ['きょう', 1, 'atamadaka'], // きょ is one mora: 2 morae total
    ['コーヒー', 3, 'nakadaka'],
    ['ガッコウ', 0, 'heiban'],
  ] as const)('pitchType(%s, %i) = %s', (kana, pitch, want) => {
    expect(pitchType(kana, pitch)).toBe(want);
  });

  it('pitchTypeFor: 3 of 4 morae is nakadaka; out-of-range nuclei are clamped', () => {
    expect(pitchTypeFor(4, 3)).toBe('nakadaka');
    expect(pitchTypeFor(4, 4)).toBe('odaka');
    expect(pitchTypeFor(4, 9)).toBe('odaka');
    expect(pitchTypeFor(4, -2)).toBe('heiban');
    expect(pitchTypeFor(2, 2)).toBe('odaka');
    expect(pitchTypeFor(1, 1)).toBe('atamadaka');
  });
});

describe('pitchContour', () => {
  it('follows the Tokyo rules: first mora low unless the nucleus is 1, high up to the nucleus, particle high only in heiban', () => {
    expect(pitchContour(3, 0)).toEqual({ high: [false, true, true], particleHigh: true, drop: null });
    expect(pitchContour(3, 1)).toEqual({ high: [true, false, false], particleHigh: false, drop: 1 });
    expect(pitchContour(4, 3)).toEqual({ high: [false, true, true, false], particleHigh: false, drop: 3 });
    expect(pitchContour(2, 2)).toEqual({ high: [false, true], particleHigh: false, drop: 2 });
    expect(pitchContour(1, 0)).toEqual({ high: [false], particleHigh: true, drop: null });
    expect(pitchContour(1, 1)).toEqual({ high: [true], particleHigh: false, drop: 1 });
  });
  it('glyph nuclei produce the four distinct schematic shapes', () => {
    const shapes = PITCH_TYPES.map((t) => JSON.stringify(pitchContour(4, GLYPH_NUCLEUS[t])));
    expect(new Set(shapes).size).toBe(4);
    expect(PITCH_TYPES.every((t) => pitchTypeFor(4, GLYPH_NUCLEUS[t]) === t)).toBe(true);
  });
});

describe('<PitchLine>', () => {
  it('draws one polyline point and one dot per mora, plus a particle dot, with kana labels', () => {
    for (const [kana, pitch] of [
      ['おとこのこ', 3],
      ['きょう', 1],
      ['コーヒー', 3],
      ['ひ', 0],
    ] as const) {
      act(() => render(<PitchLine kana={kana} pitch={pitch} />, root));
      const n = moraCount(kana);
      const points = svg().querySelector('polyline')?.getAttribute('points')?.split(' ') ?? [];
      expect(points.length).toBe(n);
      expect(svg().querySelectorAll('circle[data-mora]').length).toBe(n);
      expect(svg().querySelectorAll('circle[data-particle]').length).toBe(1);
      expect(svg().getAttribute('data-morae')).toBe(String(n));
      const labels = Array.from(svg().querySelectorAll('text.pitch-svg__label:not(.pitch-svg__label--particle)')).map((t) => t.textContent);
      expect(labels.join('')).toBe(kana);
      expect(svg().querySelector('text')?.getAttribute('lang')).toBe('ja');
    }
  });

  it('marks high/low dots by shape class and places the drop marker only when there is a nucleus', () => {
    act(() => render(<PitchLine kana="あめ" pitch={1} />, root));
    const dots = Array.from(svg().querySelectorAll('circle[data-mora]'));
    expect(dots.map((d) => d.getAttribute('data-high'))).toEqual(['true', 'false']);
    expect(dots[0]?.classList.contains('pitch-svg__dot--high')).toBe(true);
    expect(dots[1]?.classList.contains('pitch-svg__dot--low')).toBe(true);
    expect(svg().querySelector('[data-drop-marker]')).not.toBeNull();
    expect(svg().getAttribute('data-drop')).toBe('1');
    expect(root.querySelector('.pitch-line')?.getAttribute('data-type')).toBe('atamadaka');

    act(() => render(<PitchLine kana="あめ" pitch={0} />, root));
    expect(svg().querySelector('[data-drop-marker]')).toBeNull();
    expect(svg().getAttribute('data-drop')).toBe('none');
    expect(root.querySelector('.pitch-line')?.getAttribute('data-type')).toBe('heiban');
  });

  it('has an accessible name naming the type and the drop, and a visible EN + 漢字 label', () => {
    act(() => render(<PitchLine kana="おとこ" pitch={3} />, root));
    expect(svg().getAttribute('role')).toBe('img');
    expect(svg().getAttribute('aria-label')).toBe('Pitch Tail-high (尾高): drop after mora 3 of 3');
    expect(root.querySelector('.pitch-line__type')?.textContent).toBe('Tail-high 尾高');
    act(() => render(<PitchLine kana="はな" pitch={0} showLabel={false} />, root));
    expect(svg().getAttribute('aria-label')).toBe('Pitch Flat (平板): no drop, 2 morae');
    expect(root.querySelector('.pitch-line__type')).toBeNull();
  });

  it('a one-mora word still renders a single point and the particle', () => {
    act(() => render(<PitchLine kana="き" pitch={1} />, root));
    expect(svg().querySelector('polyline')?.getAttribute('points')?.split(' ').length).toBe(1);
    expect(svg().querySelectorAll('circle').length).toBe(2);
  });
});

describe('<PitchLine> input mode', () => {
  function Harness(p: { kana: string; pitch: number; onPick: (n: number) => void }) {
    const [picked, setPicked] = useState<number | undefined>(undefined);
    return (
      <PitchLine
        kana={p.kana}
        pitch={p.pitch}
        picked={picked}
        revealed={picked !== undefined}
        onPick={(n) => {
          p.onPick(n);
          setPicked(n);
        }}
      />
    );
  }
  const btns = (): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('.pitch-picker__btn'));

  it('hides the contour until revealed and offers one button per mora plus "No drop"', () => {
    act(() => render(<PitchLine kana="おとこ" pitch={3} onPick={() => undefined} />, root));
    expect(svg().getAttribute('data-neutral')).toBe('true');
    expect(svg().querySelector('polyline')).toBeNull();
    expect(svg().querySelector('[data-drop-marker]')).toBeNull();
    expect(root.querySelector('.pitch-line')?.getAttribute('data-type')).toBeNull();
    const b = btns();
    expect(b.length).toBe(4);
    expect(b.map((x) => x.getAttribute('data-nucleus'))).toEqual(['1', '2', '3', '0']);
    expect(b[3]?.textContent).toContain('No drop');
    expect(b[0]?.getAttribute('aria-label')).toBe('Drop after お');
    expect(b.every((x) => !x.disabled)).toBe(true);
  });

  it('tapping the drop mora fires onPick once with the nucleus, then locks and shows the verdict', () => {
    const onPick = vi.fn();
    act(() => render(inFrame(<Harness kana="おとこ" pitch={3} onPick={onPick} />), root));
    act(() => btns()[2]?.click());
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(3);
    expect(btns().every((x) => x.disabled)).toBe(true);
    expect(btns()[2]?.getAttribute('data-state')).toBe('correct');
    expect(svg().getAttribute('data-neutral')).toBeNull();
    expect(svg().querySelector('polyline')).not.toBeNull();
    act(() => btns()[0]?.click());
    press('1');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('a wrong pick shows wrong + missed; digits map 1..n to morae and n+1 to no drop', () => {
    const onPick = vi.fn();
    act(() => render(inFrame(<Harness kana="あめ" pitch={1} onPick={onPick} />), root));
    press('3'); // 2 morae → digit 3 = no drop
    expect(onPick).toHaveBeenCalledWith(0);
    expect(btns().map((x) => x.getAttribute('data-state'))).toEqual(['missed', 'idle', 'wrong']);

    const onPick2 = vi.fn();
    act(() => render(null, root)); // fresh harness (state would otherwise persist)
    act(() => render(inFrame(<Harness kana="あめ" pitch={1} onPick={onPick2} />), root));
    press('1');
    expect(onPick2).toHaveBeenCalledWith(1);
    expect(btns()[0]?.getAttribute('data-state')).toBe('correct');
  });

  it('digits beyond the option count are ignored', () => {
    const onPick = vi.fn();
    act(() => render(inFrame(<Harness kana="あめ" pitch={1} onPick={onPick} />), root));
    press('5');
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('<PitchGlyph>', () => {
  it('renders the four types as distinct shapes with role=img labels', () => {
    const labels: string[] = [];
    const shapes: string[] = [];
    for (const t of PITCH_TYPES) {
      act(() => render(<PitchGlyph type={t} label />, root));
      const s = svg();
      labels.push(s.getAttribute('aria-label') ?? '');
      // the mora line plus the particle dot: heiban and odaka differ only at the particle
      shapes.push(`${s.querySelector('polyline')?.getAttribute('points')}|${s.querySelector('circle[data-particle]')?.getAttribute('cy')}`);
      expect(s.getAttribute('data-morae')).toBe('4');
      expect(root.querySelector('.pitch-glyph')?.getAttribute('data-type')).toBe(t);
      expect(root.querySelector('.pitch-glyph__label [lang="ja"]')).not.toBeNull();
    }
    expect(labels).toEqual([
      'Pitch contour: Flat (平板)',
      'Pitch contour: Head-high (頭高)',
      'Pitch contour: Mid-high (中高)',
      'Pitch contour: Tail-high (尾高)',
    ]);
    expect(new Set(shapes).size).toBe(4);
  });
  it('heiban and odaka share the mora line but differ at the particle dot (shape, not color)', () => {
    act(() => render(<PitchGlyph type="heiban" />, root));
    const particleHeiban = svg().querySelector('circle[data-particle]')?.getAttribute('cy');
    const lineHeiban = svg().querySelector('polyline')?.getAttribute('points');
    act(() => render(<PitchGlyph type="odaka" />, root));
    const particleOdaka = svg().querySelector('circle[data-particle]')?.getAttribute('cy');
    expect(svg().querySelector('polyline')?.getAttribute('points')).toBe(lineHeiban);
    expect(particleHeiban).not.toBe(particleOdaka);
    expect(svg().querySelector('[data-drop-marker]')).not.toBeNull();
    expect(root.querySelector('.pitch-glyph__label')).toBeNull();
  });
});
