import { WRITING_PREFIX, writingSentencesFrom } from './writing';

describe('writing bookmarks', () => {
  it('reads back only the prefixed bookmarks, in order, without the prefix', () => {
    expect(WRITING_PREFIX).toBe('作文: ');
    expect(writingSentencesFrom([`${WRITING_PREFIX}私はハナです。`, '12345: outside note', `${WRITING_PREFIX}パンを食べます。`, '作文:no space'])).toEqual([
      '私はハナです。',
      'パンを食べます。',
    ]);
    expect(writingSentencesFrom([])).toEqual([]);
  });
});
