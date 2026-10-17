import { render } from 'preact';
import { act } from 'preact/test-utils';
import { bus } from '@/shared/events';
import { IMPORT_MAX_BYTES, STORE_STRINGS, buildBackup, resetStoreForTests, store, type BackupDocument } from '@/store';
import { captureEvents, card, makeTestStore } from '@/store/testing';
import BackupPage, { downloadBlob, hasCompressionStream, kbOf, storageLevelText } from './BackupPage';
import { S, fmt } from './strings';

/** Lets one test make `applyImport` throw mid-apply (a malformed slice the preview did not catch). */
const applyHook = vi.hoisted(() => ({ throwing: false }));
/** Counts `previewImportBlob` calls: an oversize file must be refused before the store ever sees it. */
const previewSpy = vi.hoisted(() => vi.fn());
vi.mock('@/store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/store')>();
  return {
    ...mod,
    applyImport: (...args: Parameters<typeof mod.applyImport>) => {
      if (applyHook.throwing) throw new TypeError('e.join is not a function');
      return mod.applyImport(...args);
    },
    previewImportBlob: (...args: Parameters<typeof mod.previewImportBlob>) => {
      previewSpy();
      return mod.previewImportBlob(...args);
    },
  };
});

const ROUTE = { name: 'backup' } as const;

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
  applyHook.throwing = false;
  previewSpy.mockClear();
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 2));
const settle = async (): Promise<void> => {
  await act(async () => {
    await tick();
    await tick();
    await tick();
  });
};

function mount(o: { download?: (blob: Blob, filename: string) => Promise<boolean> | boolean; reload?: () => void } = {}): void {
  act(() => render(<BackupPage route={ROUTE} download={o.download} reload={o.reload} />, root));
}

const q = <T extends Element = HTMLElement>(sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const click = (sel: string): void => {
  act(() => {
    q<HTMLButtonElement>(sel).click();
  });
};

async function chooseFile(file: File): Promise<void> {
  const input = q<HTMLInputElement>('[data-file-input]');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
  });
  await settle();
}

/** A backup document from a second learner's point of view (cloned: `buildBackup` returns the live slices). */
function otherBackup(over: (doc: BackupDocument) => void): File {
  const doc = JSON.parse(JSON.stringify(buildBackup())) as BackupDocument;
  over(doc);
  return new File([JSON.stringify(doc)], 'tsuzuku-backup-2026-01-10.json', { type: 'application/json' });
}

describe('<BackupPage>', () => {
  it('export triggers a download with the dated filename and emits backup:exported', async () => {
    await makeTestStore({ save: { profile: { xp: 120 } } });
    const download = vi.fn(() => Promise.resolve(true));
    const cap = captureEvents();
    mount({ download });
    click('[data-export]');
    await settle();
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, filename] = download.mock.calls[0] as unknown as [Blob, string];
    expect(filename).toBe('tsuzuku-backup-2026-01-15.json');
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBeGreaterThan(100);
    expect(store.stats.value.exports).toBe(1);
    expect(cap.events.map(([n]) => n)).toContain('backup:exported');
    expect(q('[data-export-status]').textContent).toBe(S.bakExported);
    cap.stop();
  });

  it('a failed download says so calmly', async () => {
    await makeTestStore();
    mount({ download: () => false });
    click('[data-export]');
    await settle();
    expect(q('[data-export-status]').textContent).toBe(S.bakDownloadFailed);
  });

  it('gzip export (where CompressionStream exists) names the file .tsuzuku.json.gz', async () => {
    await makeTestStore();
    const download = vi.fn(() => true);
    mount({ download });
    if (!hasCompressionStream()) {
      expect(root.querySelector('[data-gzip]')).toBeNull();
      return;
    }
    click('[data-gzip]');
    click('[data-export]');
    await settle();
    const [, filename] = download.mock.calls[0] as unknown as [Blob, string];
    expect(filename).toBe('tsuzuku-backup-2026-01-15.tsuzuku.json.gz');
  });

  it('import shows the preview before applying; Merge keeps the higher values', async () => {
    await makeTestStore({ save: { profile: { xp: 100 }, streak: { current: 2, totalDays: 10 } }, cards: { 'v-n5-0001#rec': card({ due: 5, s: 3, state: 2, reps: 2, last: 4 }) } });
    const file = otherBackup((doc) => {
      doc.meta.profile.xp = 900;
      doc.meta.streak.current = 7;
      doc.meta.streak.totalDays = 40;
      doc.meta.collections.badges = { 'first-step': 3 };
      const shard = Object.values(doc.shards)[0];
      if (shard) shard.cards['v-n5-0002#rec'] = card({ due: 6, s: 4, state: 2, reps: 3, last: 5 });
    });
    const reload = vi.fn();
    mount({ reload });
    await chooseFile(file);
    const preview = q('[data-import-preview]');
    expect(preview.textContent).toContain(file.name);
    const xpRow = q(`[data-row="${S.bakPreviewXp}"]`);
    expect(xpRow.textContent).toContain('100');
    expect(xpRow.textContent).toContain('900');
    expect(q(`[data-row="${S.bakPreviewStreak}"]`).textContent).toContain('7');
    expect(q(`[data-row="${S.bakPreviewBadges}"]`).textContent).toContain('1');
    expect(preview.textContent).toContain(fmt(S.bakCardsGained, { n: '1' }));
    // Nothing has changed yet.
    expect(store.profile.value.xp).toBe(100);
    expect(store.streak.value.current).toBe(2);

    click('[data-merge]');
    expect(store.profile.value.xp).toBe(900);
    expect(store.streak.value.current).toBe(7);
    expect(store.streak.value.totalDays).toBe(40);
    expect(store.collections.value.badges['first-step']).toBe(3);
    expect(store.cards.count()).toBe(2);
    expect(store.stats.value.imports).toBe(1);
    expect(q('[data-import-applied]').textContent).toContain(S.bakApplied);
    click('[data-reload]');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the storage hint names no second usage figure (only the meter shows KB of MB)', async () => {
    await makeTestStore();
    mount();
    const text = q('[data-storage]').textContent ?? '';
    expect(text.match(/KB of/g)).toHaveLength(1);
    expect(text).toContain(S.bakAdvice);
  });

  it('the Replace dialog manages focus: Cancel first, Tab wraps, Escape closes and returns focus to Replace', async () => {
    await makeTestStore({ save: { profile: { xp: 500 } } });
    const file = otherBackup((doc) => {
      doc.meta.profile.xp = 50;
      doc.shards = {};
    });
    mount();
    await chooseFile(file);
    act(() => q<HTMLButtonElement>('[data-replace]').focus());
    click('[data-replace]');
    const dialog = q('[data-confirm="replace"]');
    const yes = q<HTMLButtonElement>('[data-confirm-yes]');
    const no = q<HTMLButtonElement>('[data-confirm-no]');
    expect(document.activeElement).toBe(no);
    // Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last.
    act(() => {
      no.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(yes);
    act(() => {
      yes.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(no);
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(root.querySelector('[data-confirm="replace"]')).toBeNull();
    expect(store.profile.value.xp).toBe(500);
    expect(document.activeElement).toBe(q('[data-replace]'));
  });

  it('Replace confirms first, then takes the file as is', async () => {
    await makeTestStore({ save: { profile: { xp: 500 }, streak: { current: 9 } }, cards: { 'v-n5-0001#rec': card({ due: 5, s: 3, state: 2 }) } });
    const file = otherBackup((doc) => {
      doc.meta.profile.xp = 50;
      doc.meta.streak.current = 1;
      doc.shards = {};
    });
    mount();
    await chooseFile(file);
    click('[data-replace]');
    expect(q('[data-confirm="replace"]').textContent).toContain(S.bakReplaceConfirm);
    expect(store.profile.value.xp).toBe(500);
    click('[data-confirm-no]');
    expect(root.querySelector('[data-confirm="replace"]')).toBeNull();
    expect(store.profile.value.xp).toBe(500);
    click('[data-replace]');
    click('[data-confirm-yes]');
    expect(store.profile.value.xp).toBe(50);
    expect(store.streak.value.current).toBe(1);
    expect(store.cards.count()).toBe(0);
    expect(q('[data-import-applied]')).toBeDefined();
  });

  it('Cancel drops the preview without applying', async () => {
    await makeTestStore({ save: { profile: { xp: 5 } } });
    mount();
    await chooseFile(otherBackup((doc) => void (doc.meta.profile.xp = 999)));
    expect(root.querySelector('[data-import-preview]')).not.toBeNull();
    click('[data-cancel-import]');
    expect(root.querySelector('[data-import-preview]')).toBeNull();
    expect(store.profile.value.xp).toBe(5);
  });

  it('an invalid file shows a calm error and never applies', async () => {
    await makeTestStore({ save: { profile: { xp: 5 } } });
    mount();
    await chooseFile(new File(['this is not a backup'], 'notes.txt', { type: 'text/plain' }));
    const err = q('[data-import-error]');
    expect(err.textContent?.length).toBeGreaterThan(0);
    expect(err.textContent).not.toMatch(/!/);
    expect(root.querySelector('[data-import-preview]')).toBeNull();
    expect(root.querySelector('[data-merge]')).toBeNull();
    expect(store.profile.value.xp).toBe(5);
    expect(store.stats.value.imports).toBe(0);

    await chooseFile(new File([JSON.stringify({ hello: 'world' })], 'other.json', { type: 'application/json' }));
    expect(q('[data-import-error]').textContent?.length).toBeGreaterThan(0);
    expect(store.profile.value.xp).toBe(5);
  });

  it('a file over IMPORT_MAX_BYTES is refused by its size before it is read, with the store’s own line', async () => {
    await makeTestStore({ save: { profile: { xp: 5 } } });
    mount();
    const file = new File(['{}'], 'huge.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: IMPORT_MAX_BYTES + 1, configurable: true });
    await chooseFile(file);
    expect(previewSpy).not.toHaveBeenCalled();
    expect(q('[data-import-error]').textContent).toContain(STORE_STRINGS.importTooLarge);
    expect(root.querySelector('[data-import-preview]')).toBeNull();
    expect(q<HTMLButtonElement>('[data-choose-file]').disabled).toBe(false);
    expect(q<HTMLButtonElement>('[data-export]').disabled).toBe(false);
    expect(store.profile.value.xp).toBe(5);

    // Exactly at the cap the file is read as usual (the store validates the contents).
    const atCap = new File([JSON.stringify({ hello: 'world' })], 'other.json', { type: 'application/json' });
    Object.defineProperty(atCap, 'size', { value: IMPORT_MAX_BYTES, configurable: true });
    await chooseFile(atCap);
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(q('[data-import-error]').textContent).not.toContain(STORE_STRINGS.importTooLarge);
  });

  it('an import that throws while applying shows the calm error and re-enables Export and Choose-file (Merge and Replace alike)', async () => {
    await makeTestStore({ save: { profile: { xp: 5 } } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      mount();
      await chooseFile(otherBackup((doc) => void (doc.meta.profile.xp = 999)));
      applyHook.throwing = true;
      click('[data-merge]');
      expect(q('[data-import-error]').textContent).toContain(S.bakInvalid);
      expect(q<HTMLButtonElement>('[data-export]').disabled).toBe(false);
      expect(q<HTMLButtonElement>('[data-choose-file]').disabled).toBe(false);
      expect(root.querySelector('[data-import-applied]')).toBeNull();
      expect(store.profile.value.xp).toBe(5);
      expect(warn).toHaveBeenCalledWith('[backup] apply failed', expect.any(TypeError));

      applyHook.throwing = false;
      await chooseFile(otherBackup((doc) => void (doc.meta.profile.xp = 999)));
      applyHook.throwing = true;
      click('[data-replace]');
      click('[data-confirm-yes]');
      expect(q('[data-import-error]').textContent).toContain(S.bakInvalid);
      expect(q<HTMLButtonElement>('[data-choose-file]').disabled).toBe(false);
      expect(store.profile.value.xp).toBe(5);
    } finally {
      warn.mockRestore();
    }
  });

  it('storage meter shows bytes and level and the advice', async () => {
    await makeTestStore();
    mount();
    const bytes = store.storage.value.bytes;
    expect(q('[data-storage]').getAttribute('data-level')).toBe('ok');
    expect(q('[data-storage-text]').textContent).toContain(`${kbOf(bytes).toLocaleString('en-US')} KB`);
    expect(root.textContent).toContain(S.bakAdvice);
    act(() => {
      store.storage.value = { bytes: 4.6 * 1024 * 1024, level: 'ceiling' };
    });
    expect(q('[data-storage]').getAttribute('data-level')).toBe('ceiling');
    expect(storageLevelText('ceiling')).toBe(S.setStorageLevelCeiling);
    expect(storageLevelText('warn')).toBe(S.setStorageLevelWarn);
    expect(storageLevelText('ok')).toBe(S.setStorageLevelOk);
  });

  it('downloadBlob creates and clicks a download anchor, and returns false without a document', async () => {
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(`${this.download}|${this.href.slice(0, 5)}`);
    };
    try {
      const ok = await downloadBlob(new Blob(['{}'], { type: 'application/json' }), 'x.json');
      expect(ok).toBe(true);
      expect(clicks.length).toBe(1);
      expect(clicks[0]?.startsWith('x.json|')).toBe(true);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
    expect(await downloadBlob(new Blob(['{}']), 'x.json', null)).toBe(false);
  });
});
