import { render } from 'preact';
import { act } from 'preact/test-utils';
import { findBanned } from '../../i18n/banned-phrases';
import { MISSIONS } from '../../shared/catalog';
import { bus } from '../../shared/events';
import { epochDay } from '../../shared/time';
import { resetStoreForTests, store } from '../../store/store';
import { DEFAULT_TEST_NOW, captureEvents, makeTestStore } from '../../store/testing';
import LedgerPage, { QUICK_MINUTES, availableMissions } from './LedgerPage';

const TODAY = epochDay(DEFAULT_TEST_NOW, 'UTC');
const ROUTE = { name: 'ledger' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  bus.reset();
});

function mount(): void {
  act(() => render(<LedgerPage route={ROUTE} />, root));
}

function form(): HTMLFormElement {
  return root.querySelector('form.ledger__form') as HTMLFormElement;
}

function submit(f: HTMLFormElement): void {
  act(() => {
    f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string, event: 'input' | 'change'): void {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

describe('<LedgerPage> add entry', () => {
  it('a quick tap plus submit calls addLedgerEntry: row in the slice, ledger:entry on the bus, status line', async () => {
    await makeTestStore();
    const cap = captureEvents();
    mount();
    const taps = Array.from(root.querySelectorAll('.ledger__quick-btn')) as HTMLButtonElement[];
    expect(taps.map((b) => b.textContent)).toEqual(QUICK_MINUTES.map(String));
    act(() => taps[2]!.click()); // 30
    expect(taps[2]!.getAttribute('aria-pressed')).toBe('true');
    const select = form().querySelector('select') as HTMLSelectElement;
    setValue(select, 'watch', 'change');
    submit(form());
    expect(store.ledger.value.entries).toEqual([[TODAY, 30, 2, 1]]);
    expect(cap.events).toContainEqual(['ledger:entry', { minutes: 30, kind: 2, source: 1 }]);
    expect(root.querySelector('.ledger__form .ledger__status')?.textContent).toBe('Logged. 30 minutes of watching on the ledger.');
    cap.stop();
    // The new row appears under Today with an edit button; app rows have none.
    expect(root.querySelector('.ledger__today-text')?.textContent).toBe('30 min watching · Outside');
    expect(root.querySelector('.ledger__today .btn')).not.toBeNull();
  });

  it('a typed minute count and a note land in the ledger and the bookmarks', async () => {
    await makeTestStore();
    mount();
    const minutes = form().querySelector('input[type="number"]') as HTMLInputElement;
    setValue(minutes, '45', 'input');
    const note = form().querySelector('textarea') as HTMLTextAreaElement;
    setValue(note, 'いただきます', 'input');
    submit(form());
    expect(store.ledger.value.entries).toEqual([[TODAY, 45, 0, 1, 'いただきます']]);
    expect(store.bookmarks.value).toEqual([`${TODAY}: いただきます`]);
    expect(root.textContent).toContain('いただきます');
  });

  it('zero minutes adds nothing and says so', async () => {
    await makeTestStore();
    const cap = captureEvents();
    mount();
    const minutes = form().querySelector('input[type="number"]') as HTMLInputElement;
    setValue(minutes, '0', 'input');
    submit(form());
    expect(store.ledger.value.entries).toEqual([]);
    expect(cap.events.filter((e) => e[0] === 'ledger:entry')).toHaveLength(0);
    expect(root.querySelector('.ledger__form .ledger__status')?.textContent).toBe('Minutes must be above zero.');
    cap.stop();
  });

  it('today rows can have their minutes edited in place', async () => {
    await makeTestStore({ save: { ledger: { entries: [[TODAY - 1, 10, 0, 1], [TODAY, 20, 1, 1], [TODAY, 8, 0, 0]] } } });
    mount();
    const rows = Array.from(root.querySelectorAll('.ledger__today-row'));
    expect(rows).toHaveLength(2);
    const edit = rows[0]?.querySelector('button') as HTMLButtonElement;
    act(() => edit.click());
    const input = root.querySelector('.ledger__edit input') as HTMLInputElement;
    setValue(input, '25', 'input');
    submit(root.querySelector('form.ledger__edit') as HTMLFormElement);
    expect(store.ledger.value.entries[1]).toEqual([TODAY, 25, 1, 1]);
    expect(store.ledger.value.entries[0]).toEqual([TODAY - 1, 10, 0, 1]);
    expect(rows[1]?.querySelector('button')).toBeNull(); // app rows are not editable
  });
});

describe('<LedgerPage> missions', () => {
  it('filters missions by belt: White sees one open mission, the rest locked with their belt', async () => {
    await makeTestStore({ save: { profile: { belt: 'white' } } });
    mount();
    expect(root.querySelectorAll('.mission--available')).toHaveLength(1);
    expect(root.querySelectorAll('.mission--locked')).toHaveLength(4);
    expect(root.querySelector('.mission--available .mission__title')?.textContent).toContain('Read a sign aloud');
    const locked = Array.from(root.querySelectorAll('.mission--locked .chip')).map((c) => c.textContent);
    expect(locked).toContain('From Yellow belt');
    expect(locked).toContain('From Blue belt');
    expect(root.querySelectorAll('.mission--locked form')).toHaveLength(0);
    expect(availableMissions('green', 0).map((m) => m.tier)).toEqual([1, 2, 3, 4]);
    expect(availableMissions('white', 1)).toHaveLength(MISSIONS.length);
  });

  it('logging the conversation mission sets conversation: true and emits field-mission:done', async () => {
    await makeTestStore({ save: { profile: { belt: 'blue' }, progress: { station: 25 } } });
    const cap = captureEvents();
    mount();
    expect(root.querySelectorAll('.mission--available')).toHaveLength(5);
    const conv = root.querySelector('.mission[data-tier="5"]') as HTMLElement;
    const input = conv.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('15');
    setValue(input, '18', 'input');
    submit(conv.querySelector('form') as HTMLFormElement);
    expect(store.ledger.value.missions).toEqual([{ day: TODAY, tier: 5, conversation: true }]);
    expect(store.ledger.value.entries).toEqual([[TODAY, 18, 3, 1]]);
    expect(cap.events).toContainEqual(['field-mission:done', { tier: 5, minutes: 18, conversation: true }]);
    cap.stop();
    expect(root.textContent).toContain('Reported. 18 minutes on the ledger.');
    expect(root.textContent).toContain('1 mission reported · 1 conversation');
    expect(root.querySelector('.ledger__log')?.textContent).toContain('tier 5, a conversation');
  });
});

describe('<LedgerPage> summaries', () => {
  it('shows hours by kind and source with the (reported) label, the week ring and twelve stacked weeks', async () => {
    await makeTestStore({
      save: {
        profile: { belt: 'green' },
        ledger: {
          entries: [
            [TODAY, 60, 0, 1],
            [TODAY - 1, 30, 1, 0],
            [TODAY - 20, 120, 2, 1],
          ],
        },
      },
    });
    mount();
    const text = root.textContent ?? '';
    expect(text).toContain('(reported)');
    expect(text).toContain('3 h at Green');
    expect(root.querySelectorAll('.ledger__bars .bar')).toHaveLength(4);
    expect(root.querySelector('.ring__fill')).not.toBeNull();
    expect(root.querySelectorAll('.chart--stack rect.chart__seg').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.chart--stack .chart__legend li')).toHaveLength(4);
    const tiles = Array.from(root.querySelectorAll('.ledger__tiles .tile__value')).map((t) => t.textContent);
    expect(tiles[0]).toBe('3.5 h');
    expect(tiles[1]).toBe('3 h');
    expect(tiles[2]).toBe('0.5 h');
    expect(root.querySelector('a[href="#/records"]')).not.toBeNull();
    expect(findBanned(text)).toEqual([]);
    expect(text).not.toContain('!');
  });
});
