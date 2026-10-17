import { render } from 'preact';
import { nullAudio, resetServices, services } from '@/shared/audio';
import { route, syncRouteFromLocation } from '@/shared/routes';
import { resetStoreForTests, store } from '@/store';
import { DEFAULT_TEST_NOW, MemoryStorage, makeTestStore, type DeepPartial } from '@/store/testing';
import type { SaveMeta } from '@/shared/store-types';
import { boot, isFirstRun } from './main';

const now = (): number => DEFAULT_TEST_NOW;

/** Seeds a MemoryStorage with a save, then hands the store back to "not booted". */
async function seeded(save: DeepPartial<SaveMeta> = {}): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await makeTestStore({ save, storage, now });
  resetStoreForTests();
  return storage;
}

const ACTIVE: DeepPartial<SaveMeta> = { profile: { name: 'Hana', xp: 120 }, stats: { sessions: 3 }, streak: { totalDays: 3, current: 1 } };

let root: HTMLDivElement;
beforeEach(() => {
  root = document.createElement('div');
  root.id = 'app';
  document.body.appendChild(root);
  location.hash = '#/';
  syncRouteFromLocation();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  render(null, root);
  root.remove();
  resetStoreForTests();
  resetServices();
  vi.restoreAllMocks();
  location.hash = '';
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('boot()', () => {
  it('renders the shell into #app from a fake Storage with nullAudio installed', async () => {
    const storage = await seeded(ACTIVE);
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    await flush();
    expect(store.ready.value).toBe(true);
    expect(store.profile.value.name).toBe('Hana');
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(root.querySelector('main#main')).not.toBeNull();
    expect(services.audio).toBe(nullAudio);
    expect(route.value.name).toBe('dojo');
  });

  it('an empty profile.name routes to onboarding (replacing the dojo entry)', async () => {
    const storage = await seeded({ profile: { name: '' } });
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    expect(route.value.name).toBe('onboarding');
    expect(location.hash).toBe('#/onboarding');
  });

  it('a fresh save with no activity routes to onboarding; an existing learner stays on the dojo', async () => {
    const fresh = await seeded();
    await boot(root, { storage: fresh, now, audio: false, overlays: false, sw: false });
    expect(isFirstRun()).toBe(true);
    expect(route.value.name).toBe('onboarding');

    render(null, root);
    resetStoreForTests();
    location.hash = '#/';
    syncRouteFromLocation();
    const active = await seeded(ACTIVE);
    await boot(root, { storage: active, now, audio: false, overlays: false, sw: false });
    expect(isFirstRun()).toBe(false);
    expect(route.value.name).toBe('dojo');
  });

  it('leaves a deep link alone even on first run', async () => {
    const storage = await seeded();
    location.hash = '#/about';
    syncRouteFromLocation();
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    expect(route.value.name).toBe('about');
  });

  it('never throws when speechSynthesis is undefined and optional barrels are loaded', async () => {
    expect((globalThis as { speechSynthesis?: unknown }).speechSynthesis).toBeUndefined();
    const storage = await seeded(ACTIVE);
    await expect(boot(root, { storage, now, audio: true, overlays: true, sw: false })).resolves.toBeUndefined();
    await flush();
    expect(root.querySelector('.layout')).not.toBeNull();
    expect(typeof services.audio.speak).toBe('function');
    expect(typeof services.audio.cancel).toBe('function');
  });

  it('paints the loading mark before the store is ready: nothing else blocks first paint', async () => {
    const storage = await seeded(ACTIVE);
    expect(store.ready.value).toBe(false);
    const booting = boot(root, { storage, now, audio: true, overlays: true, sw: false });
    // Synchronously after the call: the shell has rendered its loading state (no blank screen).
    expect(root.querySelector('.app-loading')).not.toBeNull();
    expect(root.querySelector('.layout')).toBeNull();
    await booting;
    await flush();
    expect(root.querySelector('.app-loading')).toBeNull();
    expect(root.querySelector('.layout')).not.toBeNull();
  });

  it('uses an injected clock for store.now()', async () => {
    const storage = await seeded(ACTIVE);
    await boot(root, { storage, now: () => 1234, audio: false, overlays: false, sw: false });
    expect(store.now()).toBe(1234);
  });

  it('starts the monthly Perapera snapshot once the store is ready', async () => {
    const storage = await seeded(ACTIVE);
    await boot(root, { storage, now, audio: false, overlays: false, sw: false });
    const months = store.meta().perapera.months;
    expect(Object.keys(months)).toHaveLength(1);
    expect(Object.values(months)[0]).toHaveLength(5);
  });
});
