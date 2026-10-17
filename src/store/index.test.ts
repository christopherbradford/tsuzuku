import * as barrel from './index';

describe('store barrel', () => {
  it('exports the ARCHITECTURE §1 names', () => {
    expect(typeof barrel.store).toBe('object');
    expect(typeof barrel.initStore).toBe('function');
    expect(typeof barrel.resetStoreForTests).toBe('function');
    expect(typeof barrel.freshSave).toBe('function');
    expect(typeof barrel.migrateMeta).toBe('function');
    expect(Array.isArray(barrel.STAT_KEYS)).toBe(true);
    for (const k of ['ready', 'meta', 'seed', 'now', 'today', 'patch', 'cards', 'log', 'session', 'storage', 'flush'] as const) {
      expect(barrel.store).toHaveProperty(k);
    }
    for (const k of ['profile', 'settings', 'streak', 'progress', 'quests', 'collections', 'kage', 'weakPoints', 'ledger', 'stats', 'medianMs', 'captured', 'bookmarks', 'perapera', 'daily'] as const) {
      expect(barrel.store[k]).toHaveProperty('value');
    }
  });

  it('does not import src/learn (module graph check)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname);
    const seen = new Set<string>();
    const queue = [path.join(root, 'index.ts')];
    while (queue.length) {
      const file = queue.pop() as string;
      if (seen.has(file) || !fs.existsSync(file)) continue;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1];
        expect(spec.startsWith('@/learn')).toBe(false);
        expect(spec.includes('/learn/')).toBe(false);
        if (spec.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), spec);
          queue.push(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});
