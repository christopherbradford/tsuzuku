/**
 * TSUZUKU — 仮名鍛造 Kana Forge (design 04 §1): the voice says the kana (or,
 * without a Japanese voice, the romaji is the prompt) → type the kana through
 * the IME. Exact kana required: カタカナ and ひらがな are different answers
 * (`allowKatakanaFold: false`), katakana mode switches on by itself for a
 * katakana item, a small-kana or long-vowel slip is a Block tagged by kind.
 * With a voice available the romaji sits behind 「Show romaji」, which counts
 * as a hint (`onHint`, Hard ceiling). Space replays; replays are counted.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { services, speak } from '@/shared/audio';
import type { AttemptResult, ExerciseMeta, ExerciseProps } from '@/shared/exercise-types';
import { TextAnswer, type TextAnswerResult } from '../TextAnswer';
import { acceptForms, attempt } from '../check';
import { S as X } from '../strings';
import { MissingItem, isKanaItem, missingResult, useDrillKeys, useLatency } from './KanaFlash';
import { S } from './strings';
import './kana.css';

export const meta: ExerciseMeta = {
  id: 'kana-forge',
  facet: 'prod',
  needsTts: true,
  needsStt: false,
  selfGraded: false,
  timeable: true,
  keys: 'kana',
};

export function KanaForge(p: ExerciseProps): JSX.Element {
  return <KanaForgeBody key={p.step.id} {...p} />;
}

function KanaForgeBody(p: ExerciseProps): JSX.Element {
  const item = isKanaItem(p.item) ? p.item : null;
  const kana = item?.kana ?? '';
  const ms = useLatency(p.step.id);
  const root = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<AttemptResult | null>(null);
  const [romajiShown, setRomajiShown] = useState(false);
  const [replays, setReplays] = useState(0);
  const replaysRef = useRef(0);
  const fired = useRef(false);
  const hasVoice = services.audio.hasJaVoice.value;
  const romaji = p.step.params.promptEn ?? item?.romaji ?? '';
  const showRomaji = !hasVoice || romajiShown;
  const hintUsed = hasVoice && romajiShown;
  const accept = acceptForms(item, p.step.params);

  const play = (): void => {
    if (kana) void speak(kana, { kana });
  };
  useEffect(() => {
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kana]);

  const replay = (): void => {
    if (fired.current || !item) return;
    replaysRef.current += 1;
    setReplays(replaysRef.current);
    play();
    p.onReplay();
  };
  useDrillKeys(root, { onReplay: replay });

  const finish = (r: AttemptResult): void => {
    if (fired.current) return;
    fired.current = true;
    setDone(r);
    p.onResult(r);
  };

  const reveal = (): void => {
    if (romajiShown || fired.current) return;
    setRomajiShown(true);
    if (hasVoice) p.onHint();
  };

  const submit = (r: TextAnswerResult): void => {
    finish(attempt({ ms: ms(), correct: r.correct, nearMiss: r.nearMiss, errorTags: r.tags, answer: r.given, hintUsed, replays: replaysRef.current }));
  };

  if (!item) return <MissingItem onContinue={() => finish(missingResult(ms()))} />;

  return (
    <div class="drill kana-forge" data-exercise="kana-forge" data-script={item.script} ref={root}>
      <div class="drill__row drill__row--between">
        <p class="drill__prompt">{hasVoice ? S.forgePromptAudio : S.forgePromptRomaji}</p>
        <span class="chip">{item.script === 'katakana' ? S.katakanaItem : S.hiraganaItem}</span>
      </div>

      <div class="drill__row drill__row--between">
        {showRomaji ? (
          <p class="drill__glyph kana-forge__romaji" lang="en">
            {romaji}
          </p>
        ) : (
          <button type="button" class="btn btn--ghost" onClick={reveal} disabled={done !== null}>
            {S.showRomaji}
          </button>
        )}
        <button type="button" class="kana-ear__speaker" onClick={replay} disabled={done !== null} aria-keyshortcuts="Space" aria-label={X.replay}>
          <span class="kana-ear__glyph" aria-hidden="true" lang="ja">
            耳
          </span>
          <span>{replays > 0 ? X.replay : S.listen}</span>
        </button>
      </div>
      {hintUsed ? (
        <p class="drill__hint" role="status">
          {S.romajiShown}
        </p>
      ) : null}

      <TextAnswer mode="ja" accept={accept} katakana={item.script === 'katakana'} allowKatakanaFold={false} particleSlip={false} autoFocus label={X.answerField} onSubmit={submit} />

      {done ? (
        <div class="drill__after" data-correct={done.nearMiss ? 'near' : done.correct ? 'true' : 'false'}>
          <p>
            <span class="drill__label">{S.kanaLabel}</span>{' '}
            <span class="drill__ja" lang="ja">
              {item.kana}
            </span>{' '}
            <span>{item.romaji}</span>
          </p>
          <p>
            <span class="drill__label">{S.seenIn}</span>{' '}
            <span class="drill__ja" lang="ja">
              {item.exampleWord.word}
            </span>{' '}
            <span>{item.exampleWord.en}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
