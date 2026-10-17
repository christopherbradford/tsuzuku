import { S } from './strings';

describe('shell copy: one name per thing, no contradictions (design 01 §3)', () => {
  it('the Library nav glyph matches the page heading (書庫), 道草 stays the Michikusa shelf', () => {
    expect(S.navLibraryJa).toBe('書庫');
  });

  it('the About page names the honesty check the way every other screen does: the inspector', () => {
    expect(S.aboutJudgeTitle).toMatch(/inspector/);
    expect(S.aboutJudge).toMatch(/inspector/);
    // rule 9 mirrors design 06 verbatim, so the body links both names
    expect(S.aboutJudge).toMatch(/Judge/);
    expect(S.aboutRule9).toMatch(/the Judge/);
  });

  it('the onboarding intro does not promise a number the pace presets then contradict', () => {
    expect(S.onbIntro).toMatch(/to start\.$/);
    expect(S.onbIntro).not.toMatch(/Twenty minutes a day\./);
  });

  it('the save-slot hint promises nothing the app does not have yet', () => {
    expect(S.setSlotHint).not.toMatch(/Three slots/);
    expect(S.setSlotHint).toMatch(/One save slot/);
  });
});
