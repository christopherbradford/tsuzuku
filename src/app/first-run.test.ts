import { resetStoreForTests, store } from '@/store';
import { makeTestStore } from '@/store/testing';
import { isFirstRun } from './first-run';

afterEach(() => {
  resetStoreForTests();
});

describe('isFirstRun()', () => {
  it('a fresh save (default name 無名, no activity) is a first run', async () => {
    await makeTestStore();
    expect(isFirstRun()).toBe(true);
  });

  it('any trace of a learner ends the first run', async () => {
    await makeTestStore({ save: { profile: { name: 'Hana' }, stats: { sessions: 1 } } });
    expect(isFirstRun()).toBe(false);
  });

  it('a blank or non-string name is a first run and never throws', async () => {
    await makeTestStore({ save: { profile: { name: '   ' } } });
    expect(isFirstRun()).toBe(true);
    store.profile.value = { ...store.profile.value, name: null as unknown as string };
    expect(() => isFirstRun()).not.toThrow();
    expect(isFirstRun()).toBe(true);
  });
});
