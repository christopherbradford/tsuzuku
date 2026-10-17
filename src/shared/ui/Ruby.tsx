/**
 * TSUZUKU — `<Ruby>`: CONTENT_GUIDE ruby markup → `<ruby><rb/><rt/>` (ARCHITECTURE §4).
 *
 * Modes follow `Settings['furigana']`:
 *   always  every reading shown
 *   fog     a reading is hidden when `fog(base)` is true (its kanji's `read` card
 *           is mature, design 05 §12); tap reveals it and calls `onReveal(base)`
 *           (= a hint). Without a predicate nothing is fogged.
 *   tap     every reading hidden until tapped (`onReveal` fires)
 *   off     plain text, no `<ruby>` at all
 * Hidden readings stay in the layout (`visibility: hidden`) so a reveal never
 * shifts the line. With `tokens` (a story line's word tokens, V19) each token
 * becomes a tappable span for glosses; a fog reveal inside a token stops the
 * token tap, so the first tap on a fogged kanji is a hint, not a gloss.
 */
import { h, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { parseRuby, segmentsToTokens, type RubySegment } from '../../content/ruby';
import type { FuriganaMode } from '../store-types';
import { S } from './strings';
import './ui.css';

export interface RubyProps {
  /** Japanese with `{base|reading}` markup. */
  ja: string;
  mode: FuriganaMode;
  /** `true` → this base's furigana starts hidden in `fog` mode. */
  fog?: (base: string) => boolean;
  /** A hidden reading was tapped open (counts as a hint). */
  onReveal?: (base: string) => void;
  /** Token (word) tapped — gloss / capture. Only with `tokens`. */
  onTokenTap?: (token: string, index: number) => void;
  /** Word tokens whose concatenation is `toPlain(ja)`. */
  tokens?: string[];
  /** Tategaki (vertical) rendering. */
  vertical?: boolean;
  class?: string;
}

function isActivate(e: KeyboardEvent): boolean {
  return e.key === 'Enter' || e.key === ' ';
}

export function Ruby(p: RubyProps): JSX.Element {
  const [revealed, setRevealed] = useState<Record<string, true>>({});
  useEffect(() => {
    setRevealed({});
  }, [p.ja, p.mode]);

  const hiddenFor = (seg: RubySegment, key: string): boolean => {
    if (seg.reading === null || p.mode === 'always' || p.mode === 'off') return false;
    if (revealed[key]) return false;
    if (p.mode === 'tap') return true;
    return p.fog ? p.fog(seg.base) : false;
  };

  const reveal = (seg: RubySegment, key: string): void => {
    setRevealed((r) => (r[key] ? r : { ...r, [key]: true }));
    p.onReveal?.(seg.base);
  };

  const renderSeg = (seg: RubySegment, key: string): JSX.Element => {
    if (seg.reading === null || p.mode === 'off') {
      return (
        <span key={key} class="ruby__plain">
          {seg.base}
        </span>
      );
    }
    const hidden = hiddenFor(seg, key);
    const rb = h('rb', { class: 'ruby__rb' }, seg.base);
    const rt = (
      <rt class={hidden ? 'ruby__rt ruby__rt--fog' : 'ruby__rt'} aria-hidden={hidden ? 'true' : undefined}>
        {seg.reading}
      </rt>
    );
    if (!hidden) {
      return (
        <ruby key={key} class="ruby__seg" data-revealed={revealed[key] ? 'true' : undefined}>
          {rb}
          {rt}
        </ruby>
      );
    }
    return (
      <ruby
        key={key}
        class="ruby__seg ruby__seg--fog"
        role="button"
        tabIndex={0}
        title={S.reveal}
        data-fog="true"
        onClick={(e) => {
          e.stopPropagation();
          reveal(seg, key);
        }}
        onKeyDown={(e) => {
          if (!isActivate(e)) return;
          e.preventDefault();
          e.stopPropagation();
          reveal(seg, key);
        }}
      >
        {rb}
        {rt}
      </ruby>
    );
  };

  const cls = ['ruby', `ruby--${p.mode}`, p.vertical ? 'ruby--vertical tategaki' : '', p.class ?? '']
    .filter(Boolean)
    .join(' ');

  if (p.tokens && p.tokens.length > 0) {
    const toks = segmentsToTokens(p.ja, p.tokens);
    const tappable = typeof p.onTokenTap === 'function';
    return (
      <span lang="ja" class={cls}>
        {toks.map((t, ti) => {
          const segs = parseRuby(t.ja);
          const inner = segs.map((seg, si) => renderSeg(seg, `${ti}:${si}`));
          if (!tappable) {
            return (
              <span key={ti} class="ruby__token" data-token={ti}>
                {inner}
              </span>
            );
          }
          return (
            <span
              key={ti}
              class="ruby__token ruby__token--tap"
              role="button"
              tabIndex={0}
              data-token={ti}
              onClick={() => p.onTokenTap?.(t.token, ti)}
              onKeyDown={(e) => {
                if (!isActivate(e)) return;
                e.preventDefault();
                p.onTokenTap?.(t.token, ti);
              }}
            >
              {inner}
            </span>
          );
        })}
      </span>
    );
  }

  const segs = parseRuby(p.ja);
  return (
    <span lang="ja" class={cls}>
      {segs.map((seg, si) => renderSeg(seg, `0:${si}`))}
    </span>
  );
}
