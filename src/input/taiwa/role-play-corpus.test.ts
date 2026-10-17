/**
 * Corpus sweep (review round 2, #1 / #2): every learner gold line of every
 * real dialogue under public/content/stories must be acceptable to the Taiwa
 * grader under the register it is shown with, and that shown register must
 * never contradict the line itself. Read from disk, never via the loader
 * (ARCHITECTURE §3); skipped when the corpus is absent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPlain } from '@/content/ruby';
import type { ContentFile, StoryItem } from '@/content/types';
import { registerAcceptable } from './options';
import { registerMatches } from './register';
import { goldRegisterTag, resolveLearnerSpeaker, turnPlan } from './role-play-logic';

const here = dirname(fileURLToPath(import.meta.url));
const STORIES_DIR = resolve(here, '../../../public/content/stories');

function loadDialogues(): StoryItem[] {
  if (!existsSync(STORIES_DIR)) return [];
  const out: StoryItem[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.json')) {
        const file = JSON.parse(readFileSync(full, 'utf8')) as ContentFile<StoryItem>;
        for (const s of file.items) if (s.kind === 'dialogue') out.push(s);
      }
    }
  };
  walk(STORIES_DIR);
  return out;
}

const dialogues = loadDialogues();

describe.skipIf(dialogues.length === 0)('Taiwa corpus: learner gold lines and their register', () => {
  const rows: [string, StoryItem, number][] = [];
  for (const s of dialogues) {
    const learner = resolveLearnerSpeaker(s);
    if (!learner) continue;
    s.lines.forEach((l, i) => {
      if (l.speaker === learner) rows.push([`${s.id}#${i}`, s, i]);
    });
  }

  it('covers the real dialogues', () => {
    expect(dialogues.length).toBeGreaterThan(50);
    expect(rows.length).toBeGreaterThan(500);
  });

  it.each(rows)('%s: the gold line is never a register slip and its chip never contradicts it', (_id, story, i) => {
    const learner = resolveLearnerSpeaker(story) as string;
    const turn = turnPlan(story, learner, story.register)[i];
    const line = story.lines[i];
    if (!turn || !line) throw new Error('missing turn');
    const gold = toPlain(line.ja);
    expect(registerAcceptable(gold, gold, turn.lineRegister)).toBe(true);
    // without an explicit target the chip is the line's own register (or the story's when the line has none)
    const explicit = story.lines.slice(0, i + 1).some((l) => l.registerTarget);
    if (!explicit) {
      const own = goldRegisterTag(line);
      if (own) expect(turn.lineRegister).toBe(own);
      else expect(turn.lineRegister).toBe(story.register);
    }
    if (goldRegisterTag(line) !== null && !explicit) expect(registerMatches(gold, turn.lineRegister)).toBe(true);
  });
});
