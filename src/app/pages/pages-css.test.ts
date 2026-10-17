import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/app/pages/pages.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('pages.css', () => {
  it('the Japanese half of a page title never shrinks (so 仕組み cannot break mid-word next to a long English title)', () => {
    expect(block('.page__title-ja')).toMatch(/flex-shrink:\s*0/);
    expect(block('.page__title')).toMatch(/display:\s*flex/);
  });

  it('uses no color literals (tokens only)', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});

describe('pages.css contrast and phone layout', () => {
  it('hanko session-card text carries no opacity (--bg on --shu is ~4.6:1; any alpha fails AA)', () => {
    expect(block('.dojo__session-desc')).not.toMatch(/opacity/);
    expect(block('.dojo__session-count')).not.toMatch(/opacity/);
    expect(block('.dojo__session-count')).toMatch(/font-size:\s*var\(--fs-2\)/);
  });

  it('the About definition list stacks by default and becomes two columns only from 560 px', () => {
    expect(block('.about__dl')).toMatch(/grid-template-columns:\s*1fr\s*;/);
    expect(block('.about__dl dt')).toMatch(/margin-top:\s*var\(--sp-2\)/);
    const wide = /@media \(min-width: 560px\)\s*\{\s*\.about__dl\s*\{([^}]*)\}\s*\.about__dl dt\s*\{([^}]*)\}/.exec(css);
    expect(wide, 'wide about__dl rule').not.toBeNull();
    expect(wide![1]).toMatch(/grid-template-columns:\s*auto 1fr/);
    expect(wide![2]).toMatch(/margin-top:\s*0/);
  });
});
