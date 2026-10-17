import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { bus } from '@/shared/events';
import { href } from '@/shared/routes';
import { resetStoreForTests } from '@/store';
import { makeTestStore } from '@/store/testing';
import AboutPage, { APP_VERSION, RULES, contentVersionLine } from './AboutPage';
import { S, fmt } from './strings';

const ROUTE = { name: 'about' } as const;

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
  act(() => render(<AboutPage route={ROUTE} />, root));
}

describe('<AboutPage>', () => {
  it('renders all 10 rules in order', async () => {
    await makeTestStore();
    mount();
    const rules = Array.from(root.querySelectorAll('[data-rule]'));
    expect(rules.length).toBe(10);
    expect(RULES.length).toBe(10);
    rules.forEach((li, i) => {
      expect(li.getAttribute('data-rule')).toBe(String(i + 1));
      expect(li.querySelector('p')?.textContent).toBe(RULES[i]);
    });
    expect(root.textContent).toContain(S.aboutRule1);
    expect(root.textContent).toContain(S.aboutRule10);
    expect(root.textContent).toContain('XP cannot buy a belt');
  });

  it('shows the content version from the save and the app version', async () => {
    await makeTestStore({ save: { contentVersion: '2026.10.1' } });
    mount();
    expect(root.querySelector('[data-content-version]')?.textContent).toBe(fmt(S.aboutContentVersion, { v: '2026.10.1' }));
    expect(contentVersionLine()).toBe('Content 2026.10.1');
    expect(root.querySelector('[data-app-version]')?.textContent).toBe(fmt(S.aboutAppVersion, { v: APP_VERSION }));
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('says when content has not loaded yet', async () => {
    await makeTestStore({ save: { contentVersion: '' } });
    mount();
    expect(root.querySelector('[data-content-version]')?.textContent).toBe(S.aboutContentNone);
  });

  it('lists how it teaches, the licences and privacy with links to backup and settings', async () => {
    await makeTestStore();
    mount();
    expect(root.textContent).toContain(S.aboutFsrs);
    expect(root.textContent).toContain(S.aboutGrading);
    expect(root.textContent).toContain(S.aboutKi);
    expect(root.textContent).toContain(S.aboutJudge);
    expect(root.textContent).toContain(S.aboutGovernor);
    const licences = Array.from(root.querySelectorAll('[data-licenses] li')).map((li) => li.textContent);
    expect(licences).toContain(S.aboutLicenseCode);
    expect(licences).toContain(S.aboutLicenseContent);
    expect(licences).toContain(S.aboutLicenseFonts);
    expect(licences).toContain(S.aboutLicenseWanakana);
    expect(root.textContent).toContain(S.onbPrivacy);
    const hrefs = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(href({ name: 'backup' }));
    expect(hrefs).toContain(href({ name: 'settings' }));
  });

  it('the licence copy is backed by the repository: LICENSE (MIT), CONTENT_LICENSE.md (CC BY-SA 4.0, fonts OFL) and package.json "license"', () => {
    const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
    expect(S.aboutLicenseCode).toContain('LICENSE');
    expect(S.aboutLicenseContent).toContain('CONTENT_LICENSE.md');
    const code = read('LICENSE');
    expect(code).toMatch(/^MIT License/);
    expect(code).toContain('Copyright (c) 2026 Christopher Bradford');
    const content = read('CONTENT_LICENSE.md');
    expect(content).toMatch(/Attribution-ShareAlike 4\.0/);
    expect(content).toContain('public/content/');
    expect(content).toContain('docs/allowlists/');
    expect(content).toMatch(/SIL Open Font License/);
    expect(content).toContain('public/fonts/OFL-');
    expect((JSON.parse(read('package.json')) as { license?: string }).license).toBe('MIT');
  });

  it('debug panel: no load errors and the recent bus events, newest first', async () => {
    await makeTestStore();
    bus.emit('xp:gained', { amount: 5, reason: 'review', total: 5 });
    bus.emit('level:up', { level: 2 });
    mount();
    expect(root.querySelector('[data-no-load-errors]')?.textContent).toBe(S.aboutNoLoadErrors);
    const events = Array.from(root.querySelectorAll('[data-events] li')).map((li) => li.textContent ?? '');
    expect(events.length).toBe(2);
    expect(events[0]).toContain('level:up');
    expect(events[1]).toContain('xp:gained');
    expect(events[1]).toContain('"amount":5');
  });

  it('with no events the panel says nothing yet', async () => {
    await makeTestStore();
    mount();
    expect(root.textContent).toContain(S.aboutNoEvents);
  });

  it('never mentions a franchise', async () => {
    await makeTestStore();
    mount();
    expect(root.textContent).not.toMatch(/pok[eé]mon|nintendo|duolingo|street fighter|dragon ball|naruto/i);
  });
});
