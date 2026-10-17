/**
 * RoadNav.tsx — 53 markers, state classes, seeded vignettes, keyboard walking.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATIONS } from '../content/types';
import { RoadNav, stationState, vignetteFor } from './RoadNav';

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

function mount(p: Partial<Parameters<typeof RoadNav>[0]> = {}): ReturnType<typeof vi.fn> {
  const onPick = vi.fn();
  act(() => render(<RoadNav current={p.current ?? 4} cleared={p.cleared ?? [1, 2, 3]} assisted={p.assisted ?? []} perfect={p.perfect} onPick={onPick} />, root));
  return onPick;
}

const stations = (): HTMLAnchorElement[] => Array.from(root.querySelectorAll<HTMLAnchorElement>('a.tokaido__station'));

describe('<RoadNav>', () => {
  it('renders 53 station links with names visible and station hrefs', () => {
    mount();
    const links = stations();
    expect(links).toHaveLength(53);
    expect(links[0]?.getAttribute('href')).toBe('#/station/1');
    expect(links[52]?.getAttribute('href')).toBe('#/station/53');
    expect(links[0]?.querySelector('.tokaido__name')?.textContent).toBe('品川');
    expect(links[52]?.querySelector('.tokaido__name')?.textContent).toBe('大津');
    // locked stations keep their name readable
    expect(links[52]?.querySelector('.tokaido__name')?.textContent?.length).toBeGreaterThan(0);
    // start and arrival nodes are not stations
    expect(root.querySelector('.tokaido__node--start')).not.toBeNull();
    expect(root.querySelector('.tokaido__node--arrival')).not.toBeNull();
  });

  it('cleared = seal, assisted = grey corner, perfect = gold frame, current = lantern, ahead = locked', () => {
    mount({ current: 5, cleared: [1, 2, 3, 4], assisted: [3], perfect: [2] });
    const links = stations();
    expect(links[0]?.dataset.state).toBe('cleared');
    expect(links[0]?.querySelector('.seal')).not.toBeNull();
    expect(links[0]?.querySelector('.seal--locked')).toBeNull();
    expect(links[1]?.dataset.state).toBe('perfect');
    expect(links[1]?.querySelector('.seal--perfect')).not.toBeNull();
    expect(links[2]?.dataset.state).toBe('assisted');
    expect(links[2]?.querySelector('.tokaido__seal--assisted')).not.toBeNull();
    expect(links[4]?.dataset.state).toBe('current');
    expect(links[4]?.querySelector('.tokaido__lantern')).not.toBeNull();
    expect(links[4]?.getAttribute('aria-current')).toBe('step');
    expect(links[5]?.dataset.state).toBe('locked');
    expect(links[5]?.querySelector('.seal--locked')).not.toBeNull();
    expect(root.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('paints belt bands and belt-coloured segments, and says where you are', () => {
    mount({ current: 10, cleared: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    expect(root.querySelectorAll('.tokaido__band')).toHaveLength(8);
    expect(root.querySelector('.tokaido__row[data-belt="orange"]')).not.toBeNull();
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('Station 10');
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('箱根');
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('9 of 53');
  });

  it('station 0 (Nihonbashi) is summarised as the start and focuses station 1', () => {
    mount({ current: 0, cleared: [] });
    expect(root.querySelector('.tokaido__where')?.textContent).toContain('Nihonbashi');
    expect(stations()[0]?.tabIndex).toBe(0);
    expect(root.querySelector('[aria-current="step"]')).toBeNull();
  });

  it('is keyboard navigable: one tab stop, arrows walk, Home/End jump, Enter picks', () => {
    const onPick = mount({ current: 4 });
    const links = stations();
    const tabbable = links.filter((a) => a.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.dataset.station).toBe('4');
    const key = (el: HTMLElement, k: string): void => {
      act(() => {
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      });
    };
    key(links[3] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(links[4]);
    expect(links[4]?.tabIndex).toBe(0);
    expect(links[3]?.tabIndex).toBe(-1);
    key(links[4] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(links[3]);
    key(links[3] as HTMLElement, 'End');
    expect(document.activeElement).toBe(links[52]);
    key(links[52] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(links[52]);
    key(links[52] as HTMLElement, 'Home');
    expect(document.activeElement).toBe(links[0]);
    act(() => {
      (links[0] as HTMLElement).click();
    });
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it('every station has an accessible label naming its belt and state', () => {
    mount({ current: 16, cleared: Array.from({ length: 15 }, (_, i) => i + 1) });
    for (const a of stations()) {
      const label = a.getAttribute('aria-label') ?? '';
      expect(label).toMatch(/Station \d+:/);
      expect(label).toMatch(/belt/);
    }
    expect(stations()[15]?.getAttribute('aria-label')).toContain('Green belt');
    expect(stations()[15]?.getAttribute('aria-label')).toContain('you are here');
  });
});

describe('stationState / vignetteFor', () => {
  it('derives the marker state from progress', () => {
    const p = { current: 5, cleared: [1, 2, 3, 4], assisted: [4], perfect: [1] };
    expect(stationState(1, p)).toBe('perfect');
    expect(stationState(2, p)).toBe('cleared');
    expect(stationState(4, p)).toBe('assisted');
    expect(stationState(5, p)).toBe('current');
    expect(stationState(6, p)).toBe('locked');
  });

  it('vignettes are seeded per station: stable, varied, and well-formed paths', () => {
    const a = vignetteFor(STATIONS[0]!);
    const b = vignetteFor(STATIONS[0]!);
    expect(a).toEqual(b);
    const motifs = new Set(STATIONS.map((st) => vignetteFor(st).motif));
    expect(motifs.size).toBeGreaterThan(1);
    for (const st of STATIONS) {
      const v = vignetteFor(st);
      expect(v.hill).toMatch(/^M0 34 Q[\d. ]+Q[\d. ]+48 34 Z$/);
      for (const d of [...v.strokes, ...v.fills]) expect(d).toMatch(/^M[\d.]+ /);
    }
  });
});
