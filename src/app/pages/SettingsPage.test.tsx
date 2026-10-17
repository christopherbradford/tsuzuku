import { signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { installServices, nullAudio, resetServices, type VoiceInfo } from '@/shared/audio';
import { bus } from '@/shared/events';
import { route, syncRouteFromLocation } from '@/shared/routes';
import type { Settings } from '@/shared/store-types';
import { INTENSITY_PRESETS, newPerDayFor, resetStoreForTests, store } from '@/store';
import { makeTestStore, card } from '@/store/testing';
import SettingsPage, { applyFeel, japaneseVoices, kbOf, parseTime, resetSave } from './SettingsPage';
import { S, fmt } from './strings';

const ROUTE = { name: 'settings' } as const;

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  location.hash = '#/settings';
  syncRouteFromLocation();
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  bus.reset();
});

function mount(download?: (text: string, filename: string) => boolean): void {
  act(() => render(<SettingsPage route={ROUTE} download={download} />, root));
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const settings = (): Settings => store.settings.value;

function radio(name: string, value: string): void {
  act(() => {
    q<HTMLInputElement>(`input[data-setting="${name}"][value="${value}"]`).click();
  });
}
function toggle(name: string): void {
  act(() => {
    q<HTMLInputElement>(`input[data-setting="${name}"]`).click();
  });
}
function select(name: string, value: string): void {
  act(() => {
    const el = q<HTMLSelectElement>(`select[data-setting="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function numberInput(name: string, value: string): void {
  act(() => {
    const el = q<HTMLInputElement>(`input[data-setting="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function rangeInput(name: string, value: string): void {
  act(() => {
    const el = q<HTMLInputElement>(`input[data-setting="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('<SettingsPage>', () => {
  it('each radio and switch patches the matching settings key', async () => {
    await makeTestStore();
    mount();
    radio('theme', 'dark');
    expect(settings().theme).toBe('dark');
    radio('feel', 'arcade');
    expect(settings().feel).toBe('arcade');
    radio('speaking', 'recognition');
    expect(settings().speaking).toBe('recognition');
    radio('speaking', 'off');
    expect(settings().speaking).toBe('off');
    toggle('classicGrading');
    expect(settings().classicGrading).toBe(true);
    toggle('jj');
    expect(settings().jj).toBe(true);
    toggle('writing');
    expect(settings().writing).toBe(true);
    toggle('verticalText');
    expect(settings().verticalText).toBe(true);
    toggle('reducedMotion');
    expect(settings().reducedMotion).toBe(true);
    toggle('crt');
    expect(settings().crt).toBe(true);
    toggle('speedGrading');
    expect(settings().speedGrading).toBe(false);
  });

  it('selects, numbers and the range patch their keys', async () => {
    await makeTestStore();
    const setVolume = vi.fn();
    installServices({ audio: { ...nullAudio, setVolume } });
    mount();
    select('furigana', 'tap');
    expect(settings().furigana).toBe('tap');
    select('retention', '0.95');
    expect(settings().retention).toBe(0.95);
    select('speedTier', '4');
    expect(settings().speedTier).toBe(4);
    select('restDay', '0');
    expect(settings().restDay).toBe(0);
    select('restDay', '');
    expect(settings().restDay).toBeNull();
    rangeInput('sound', '40');
    expect(settings().sound).toBeCloseTo(0.4);
    expect(setVolume).toHaveBeenCalledWith(0.4);
    numberInput('newPerDay.vocab', '9.5');
    expect(settings().newPerDay.vocab).toBe(9.5);
    expect(settings().intensity).toBe('custom');
    numberInput('maxReviews', '220');
    expect(settings().maxReviews).toBe(220);
    numberInput('maxReviews', '3');
    expect(settings().maxReviews).toBe(220);
  });

  it('CRT is disabled outside the Arcade feel', async () => {
    await makeTestStore();
    mount();
    expect(q<HTMLInputElement>('input[data-setting="crt"]').disabled).toBe(true);
    radio('feel', 'arcade');
    expect(q<HTMLInputElement>('input[data-setting="crt"]').disabled).toBe(false);
  });

  it('feel change applies the speed-grading default: off in Zen, on otherwise', async () => {
    await makeTestStore();
    mount();
    radio('feel', 'zen');
    expect(settings().feel).toBe('zen');
    expect(settings().speedGrading).toBe(false);
    radio('feel', 'dojo');
    expect(settings().speedGrading).toBe(true);
    applyFeel('dojo');
    expect(settings().speedGrading).toBe(true);
  });

  it('a preset applies rates for the current belt, the cap and retention', async () => {
    await makeTestStore({ save: { profile: { belt: 'green' } } });
    mount();
    radio('intensity', 'casual');
    expect(settings().intensity).toBe('casual');
    expect(settings().newPerDay).toEqual(newPerDayFor('green', 'casual'));
    expect(settings().maxReviews).toBe(INTENSITY_PRESETS.casual.maxReviews);
    expect(settings().retention).toBe(INTENSITY_PRESETS.casual.retention);
    radio('intensity', 'custom');
    expect(settings().intensity).toBe('custom');
    expect(settings().newPerDay).toEqual(newPerDayFor('green', 'casual'));
  });

  it('intense confirms before applying', async () => {
    await makeTestStore();
    mount();
    radio('intensity', 'intense');
    expect(settings().intensity).toBe('standard');
    const dialog = q('[data-confirm="intense"]');
    expect(dialog.textContent).toContain('reviews a day in a year');
    act(() => {
      q<HTMLButtonElement>('[data-confirm-no]').click();
    });
    expect(root.querySelector('[data-confirm="intense"]')).toBeNull();
    expect(settings().intensity).toBe('standard');
    expect(q<HTMLInputElement>('input[data-setting="intensity"][value="standard"]').checked).toBe(true);
    radio('intensity', 'intense');
    act(() => {
      q<HTMLButtonElement>('[data-confirm-yes]').click();
    });
    expect(settings().intensity).toBe('intense');
    expect(settings().maxReviews).toBe(INTENSITY_PRESETS.intense.maxReviews);
  });

  it('Escape closes the confirm dialog without applying', async () => {
    await makeTestStore();
    mount();
    radio('intensity', 'intense');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(root.querySelector('[data-confirm="intense"]')).toBeNull();
    expect(settings().intensity).toBe('standard');
  });

  it('storage meter shows bytes and level', async () => {
    await makeTestStore();
    mount();
    const bytes = store.storage.value.bytes;
    expect(bytes).toBeGreaterThan(0);
    expect(q('[data-storage]').getAttribute('data-level')).toBe('ok');
    expect(q('[data-storage-text]').textContent).toContain(`${kbOf(bytes).toLocaleString('en-US')} KB`);
    expect(q('[data-storage-text]').textContent).toContain(S.setStorageLevelOk);
    act(() => {
      store.storage.value = { bytes: 4 * 1024 * 1024, level: 'warn' };
    });
    expect(q('[data-storage]').getAttribute('data-level')).toBe('warn');
    expect(q('[data-storage-text]').textContent).toContain('4,096 KB');
    expect(q('[data-storage-text]').textContent).toContain(S.setStorageLevelWarn);
    act(() => {
      store.storage.value = { bytes: 4.6 * 1024 * 1024, level: 'ceiling' };
    });
    expect(q('[data-storage-text]').textContent).toContain(S.setStorageLevelCeiling);
    expect(q('[data-slot]').textContent).toBe(fmt(S.setSlotCurrent, { n: 0 }));
  });

  it('voice picker lists Japanese voices with their network mark and patches ttsVoiceURI', async () => {
    await makeTestStore();
    const voices: VoiceInfo[] = [
      { uri: 'v-local', name: 'Kyoko', lang: 'ja-JP', local: true, network: false },
      { uri: 'v-net', name: 'Cloud', lang: 'ja-JP', local: false, network: true },
      { uri: 'v-en', name: 'Samantha', lang: 'en-US', local: true, network: false },
    ];
    const speak = vi.fn(() => Promise.resolve());
    installServices({ audio: { ...nullAudio, voices: () => voices, hasJaVoice: signal(true), speak } });
    expect(japaneseVoices(voices).map((v) => v.uri)).toEqual(['v-local', 'v-net']);
    mount();
    const options = Array.from(q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options).map((o) => o.textContent);
    expect(options).toEqual([S.setVoiceDefault, `Kyoko · ${S.setVoiceLocal}`, `Cloud · ${S.setVoiceNetwork}`]);
    select('ttsVoiceURI', 'v-net');
    expect(settings().ttsVoiceURI).toBe('v-net');
    select('ttsVoiceURI2', 'v-local');
    expect(settings().ttsVoiceURI2).toBe('v-local');
    act(() => {
      q<HTMLButtonElement>('[data-voice-test]').click();
    });
    expect(speak).toHaveBeenCalledWith('こんにちは', { kana: 'こんにちは', voiceURI: 'v-net' });
    select('ttsVoiceURI', '');
    expect(settings().ttsVoiceURI).toBeUndefined();
  });

  it('with no Japanese voice the picker says so', async () => {
    await makeTestStore();
    mount();
    expect(Array.from(q<HTMLSelectElement>('select[data-setting="ttsVoiceURI"]').options).map((o) => o.textContent)).toEqual([S.setVoiceNone]);
  });

  it('reminder download builds a neutral daily .ics at the chosen time', async () => {
    await makeTestStore({ save: { profile: { tz: 'Asia/Tokyo' } } });
    const download = vi.fn(() => true);
    mount(download);
    act(() => {
      const t = q<HTMLInputElement>('[data-reminder-time]');
      t.value = '07:30';
      t.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      q<HTMLButtonElement>('[data-ics-download]').click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    const [text, filename] = download.mock.calls[0] as unknown as [string, string];
    expect(filename).toBe('tsuzuku-reminder.ics');
    expect(text).toContain('SUMMARY:The dojo is open.');
    expect(text).toContain('RRULE:FREQ=DAILY');
    expect(text).toContain('DTSTART;TZID=Asia/Tokyo:20260115T073000');
    expect(root.textContent).toContain(S.setReminderDownloaded);
  });

  it('shows the calendar text when a download is not possible', async () => {
    await makeTestStore();
    mount(() => false);
    act(() => {
      q<HTMLButtonElement>('[data-ics-download]').click();
    });
    expect(root.textContent).toContain(S.setReminderFailed);
    expect(q('[data-ics-text]').textContent).toContain('BEGIN:VCALENDAR');
  });

  it('parseTime clamps and falls back', () => {
    expect(parseTime('07:30')).toEqual({ hour: 7, minute: 30 });
    expect(parseTime('25:99')).toEqual({ hour: 23, minute: 59 });
    expect(parseTime('nonsense')).toEqual({ hour: 19, minute: 0 });
  });

  it('reset requires typing つづく, confirms, then replaces the save and goes to onboarding', async () => {
    await makeTestStore({
      save: { profile: { name: 'はな', xp: 900, tz: 'Asia/Tokyo' }, streak: { totalDays: 30, current: 4 }, stats: { sessions: 12 } },
      cards: { 'v-n5-0001#rec': card({ due: 1, s: 3, state: 2 }) },
    });
    store.session.save({
      schema: 'tsuzuku.session/1',
      plan: { id: 'p', mode: 'kata', day: 1, createdAt: 0, station: 1, steps: [], blocks: [], meta: { dueTotal: 0, dueTaken: 0, backlog: false, newCount: 0, scrollIds: [] } },
      cursor: 0,
      results: [],
      kiai: { ki: 0, combo: 0, bestCombo: 0, kiaiLeft: 0, ippon: 0, recoveryQueue: [] },
    });
    mount();
    const button = q<HTMLButtonElement>('[data-reset]');
    expect(button.disabled).toBe(true);
    const input = q<HTMLInputElement>('.set__danger .kana-input__field');
    for (const ch of 'tsudu') {
      act(() => {
        input.value = input.value + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(root.textContent).toContain(S.setResetMismatch);
    expect(q<HTMLButtonElement>('[data-reset]').disabled).toBe(true);
    for (const ch of 'ku') {
      act(() => {
        input.value = input.value + ch;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(input.value).toBe('つづく');
    expect(q<HTMLButtonElement>('[data-reset]').disabled).toBe(false);
    act(() => {
      q<HTMLButtonElement>('[data-reset]').click();
    });
    expect(q('[data-confirm="reset"]')).toBeDefined();
    act(() => {
      q<HTMLButtonElement>('[data-confirm-yes]').click();
    });
    expect(store.profile.value.name).toBe('無名');
    expect(store.profile.value.xp).toBe(0);
    expect(store.profile.value.tz).toBe('Asia/Tokyo');
    expect(store.streak.value.totalDays).toBe(0);
    expect(store.stats.value.sessions).toBe(0);
    expect(store.cards.count()).toBe(0);
    expect(store.session.load()).toBeNull();
    expect(route.value.name).toBe('onboarding');
  });

  it('resetSave keeps the time zone and clears cards', async () => {
    await makeTestStore({ save: { profile: { tz: 'Europe/Paris', xp: 5 } }, cards: { 'k-h-a#rec': card({ due: 1 }) } });
    resetSave();
    expect(store.profile.value.tz).toBe('Europe/Paris');
    expect(store.profile.value.xp).toBe(0);
    expect(store.cards.count()).toBe(0);
  });
});
