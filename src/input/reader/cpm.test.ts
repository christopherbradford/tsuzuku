import { STORY } from '../../content/fixtures';
import type { StoryLine } from '../../content/types';
import {
  CPM_TARGETS,
  bindVisibility,
  charCount,
  cpm,
  cpmBand,
  cpmTargetForStation,
  createReadingTimer,
  levelForStation,
  msPerLine,
  plainChars,
  type VisibilityDoc,
} from './cpm';

const line = (ja: string): StoryLine => ({ ja, kana: ja, en: '', tokens: [ja] });

describe('plainChars / charCount', () => {
  it('counts plain characters, excluding punctuation and whitespace, with ruby stripped', () => {
    expect(plainChars('おはよう。')).toBe(4);
    expect(plainChars('{私|わたし}はハナです。')).toBe(6); // 私はハナです
    expect(plainChars('はい、{私|わたし}も{水|みず}を{飲|の}みます。')).toBe(10); // はい私も水を飲みます
    expect(plainChars('「{犬|いぬ}」！？…　 ')).toBe(1);
    expect(plainChars('コーヒー')).toBe(4); // ー is a character, not punctuation
    expect(plainChars('')).toBe(0);
    expect(plainChars('。、！？')).toBe(0);
  });

  it('charCount sums the story lines and matches the fixture', () => {
    expect(charCount([line('おはよう。'), line('{私|わたし}はハナです。')])).toBe(10);
    expect(charCount([])).toBe(0);
    const n = charCount(STORY.lines);
    expect(n).toBe(STORY.lines.reduce((a, l) => a + plainChars(l.ja), 0));
    expect(n).toBeGreaterThan(80);
  });
});

describe('cpm', () => {
  it('chars per minute, rounded', () => {
    expect(cpm(100, 60_000)).toBe(100);
    expect(cpm(50, 30_000)).toBe(100);
    expect(cpm(333, 120_000)).toBe(167); // 166.5 → 167
    expect(cpm(1, 60_000 / 7)).toBe(7);
  });

  it('is 0 for no chars, no time, or nonsense', () => {
    expect(cpm(0, 1000)).toBe(0);
    expect(cpm(100, 0)).toBe(0);
    expect(cpm(100, -5)).toBe(0);
    expect(cpm(Number.NaN, 1000)).toBe(0);
  });
});

describe('targets and banding', () => {
  it('targets table (design 04 §7)', () => {
    expect(CPM_TARGETS).toEqual({ n5: 80, n4: 150, n3: 250, n2: 350, n1: 450 });
  });

  it('levelForStation follows the belt table', () => {
    expect(levelForStation(1)).toBeNull();
    expect(levelForStation(3)).toBeNull();
    expect(levelForStation(4)).toBe('n5');
    expect(levelForStation(15)).toBe('n5');
    expect(levelForStation(16)).toBe('n4');
    expect(levelForStation(25)).toBe('n3');
    expect(levelForStation(38)).toBe('n3');
    expect(levelForStation(39)).toBe('n2');
    expect(levelForStation(53)).toBe('n1');
    expect(levelForStation(54)).toBeNull();
    expect(levelForStation(0)).toBeNull();
  });

  it('cpmTargetForStation falls back to N5 for the kana stations', () => {
    expect(cpmTargetForStation(2)).toBe(80);
    expect(cpmTargetForStation(20)).toBe(150);
    expect(cpmTargetForStation(45)).toBe(350);
  });

  it('bands against the level target', () => {
    expect(cpmBand(40, 'n5')).toBe('below'); // < 48
    expect(cpmBand(47, 'n5')).toBe('below');
    expect(cpmBand(48, 'n5')).toBe('near');
    expect(cpmBand(79, 'n5')).toBe('near');
    expect(cpmBand(80, 'n5')).toBe('at');
    expect(cpmBand(103, 'n5')).toBe('at');
    expect(cpmBand(104, 'n5')).toBe('above');
    expect(cpmBand(300, 'n1')).toBe('near');
    expect(cpmBand(600, 'n1')).toBe('above');
    expect(cpmBand(0, 'n4')).toBe('below');
  });

  it('msPerLine paces the reveal with a 600 ms floor', () => {
    expect(msPerLine(80, 80)).toBe(60_000);
    expect(msPerLine(20, 80)).toBe(15_000);
    expect(msPerLine(1, 450)).toBe(600);
    expect(msPerLine(0, 80)).toBe(600);
    expect(msPerLine(50, 0)).toBe(0);
  });
});

describe('createReadingTimer', () => {
  let t = 0;
  const now = () => t;
  beforeEach(() => {
    t = 1000;
  });

  it('accumulates only while running', () => {
    const timer = createReadingTimer(now);
    expect(timer.started()).toBe(false);
    expect(timer.elapsedMs()).toBe(0);
    timer.start();
    expect(timer.running()).toBe(true);
    t += 5000;
    expect(timer.elapsedMs()).toBe(5000);
    timer.pause();
    t += 100_000;
    expect(timer.elapsedMs()).toBe(5000);
    expect(timer.running()).toBe(false);
    timer.resume();
    t += 2500;
    expect(timer.stop()).toBe(7500);
    expect(timer.running()).toBe(false);
    expect(timer.elapsedMs()).toBe(7500);
  });

  it('pause/resume are idempotent; a clock running backwards never subtracts', () => {
    const timer = createReadingTimer(now);
    timer.start();
    timer.resume();
    t += 1000;
    timer.pause();
    timer.pause();
    expect(timer.elapsedMs()).toBe(1000);
    timer.resume();
    t -= 5000;
    expect(timer.elapsedMs()).toBe(1000);
    expect(timer.stop()).toBe(1000);
  });

  it('start resets; resume on a fresh timer behaves like start', () => {
    const timer = createReadingTimer(now);
    timer.start();
    t += 3000;
    timer.start();
    t += 1000;
    expect(timer.elapsedMs()).toBe(1000);
    const fresh = createReadingTimer(now);
    fresh.resume();
    expect(fresh.started()).toBe(true);
    t += 400;
    expect(fresh.stop()).toBe(400);
  });

  it('feeds cpm: 120 chars in 60 s → 120 cpm', () => {
    const timer = createReadingTimer(now);
    timer.start();
    t += 60_000;
    expect(cpm(120, timer.stop())).toBe(120);
  });
});

describe('bindVisibility', () => {
  function fakeDoc(): VisibilityDoc & { hidden: boolean; fire(): void } {
    const fns = new Set<() => void>();
    return {
      hidden: false,
      addEventListener: (_t, fn) => fns.add(fn),
      removeEventListener: (_t, fn) => fns.delete(fn),
      fire() {
        for (const fn of fns) fn();
      },
    };
  }

  it('pauses while hidden and resumes on return, only if it was running', () => {
    let t = 0;
    const timer = createReadingTimer(() => t);
    const doc = fakeDoc();
    const off = bindVisibility(timer, doc);
    timer.start();
    t = 1000;
    doc.hidden = true;
    doc.fire();
    expect(timer.running()).toBe(false);
    t = 50_000;
    doc.hidden = false;
    doc.fire();
    expect(timer.running()).toBe(true);
    t = 51_000;
    expect(timer.elapsedMs()).toBe(2000);
    // paused by the learner, hidden/visible must not resume it
    timer.pause();
    doc.hidden = true;
    doc.fire();
    doc.hidden = false;
    doc.fire();
    expect(timer.running()).toBe(false);
    off();
    doc.hidden = true;
    doc.fire();
    expect(timer.elapsedMs()).toBe(2000);
  });

  it('works with the real document (jsdom) without throwing', () => {
    const timer = createReadingTimer(() => 0);
    const off = bindVisibility(timer, document);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(() => off()).not.toThrow();
  });
});
