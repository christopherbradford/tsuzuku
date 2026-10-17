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
