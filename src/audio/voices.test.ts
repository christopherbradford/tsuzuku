import { S } from './strings';
import {
  PAIR_OFFSET,
  detectPlatform,
  installGuide,
  isJaVoice,
  pickPair,
  preferenceTier,
  rankVoices,
  toVoiceInfo,
  voiceLabel,
  type VoiceLike,
} from './voices';

const v = (name: string, o: Partial<VoiceLike> = {}): VoiceLike => ({
  voiceURI: o.voiceURI ?? `uri:${name}`,
  name,
  lang: o.lang ?? 'ja-JP',
  localService: o.localService ?? true,
  default: o.default ?? false,
});

describe('isJaVoice', () => {
  it.each([
    ['ja-JP', true],
    ['ja', true],
    ['ja_JP', true],
    ['JA-JP', true],
    ['jav', false],
    ['en-US', false],
    ['zh-CN', false],
    ['', false],
  ])('%s → %s', (lang, want) => {
    expect(isJaVoice({ lang })).toBe(want);
  });
});

describe('rankVoices', () => {
  it('orders a synthetic list by the preference table, local before network inside a tier', () => {
    const list: VoiceLike[] = [
      v('Microsoft Keita Online (Natural) - Japanese (Japan)', { localService: false }),
      v('Alex', { lang: 'en-US' }),
      v('Kyoko'),
      v('Microsoft Haruka Desktop - Japanese'),
      v('Google 日本語', { localService: false }),
      v('Microsoft Nanami Online (Natural) - Japanese (Japan)', { localService: false }),
      v('O-Ren'),
      v('Yuna', { lang: 'ko-KR' }),
      v('Some Random ja voice', { localService: false }),
      v('Another local ja voice'),
    ];
    const ranked = rankVoices(list).map((r) => r.name);
    expect(ranked).toEqual([
      'Google 日本語',
      'Microsoft Nanami Online (Natural) - Japanese (Japan)',
      'Microsoft Keita Online (Natural) - Japanese (Japan)',
      'Kyoko',
      'O-Ren',
      'Microsoft Haruka Desktop - Japanese',
      'Another local ja voice',
      'Some Random ja voice',
    ]);
  });

  it('flags network voices from localService and keeps local ones unflagged', () => {
    const ranked = rankVoices([v('Google 日本語', { localService: false }), v('Kyoko')]);
    expect(ranked[0]).toMatchObject({ name: 'Google 日本語', local: false, network: true });
    expect(ranked[1]).toMatchObject({ name: 'Kyoko', local: true, network: false });
  });

  it('prefers the system default inside a tier and dedupes by URI', () => {
    const ranked = rankVoices([v('Zeta ja', { voiceURI: 'u1' }), v('Alpha ja', { voiceURI: 'u2', default: true }), v('Zeta ja', { voiceURI: 'u1' })]);
    expect(ranked.map((r) => r.uri)).toEqual(['u2', 'u1']);
    expect(ranked[0]?.isDefault).toBe(true);
  });

  it('returns [] when nothing is Japanese', () => {
    expect(rankVoices([v('Alex', { lang: 'en-US' }), v('Thomas', { lang: 'fr-FR' })])).toEqual([]);
  });

  it('is stable: equal tiers fall back to name order', () => {
    const ranked = rankVoices([v('B voice'), v('A voice'), v('C voice')]);
    expect(ranked.map((r) => r.name)).toEqual(['A voice', 'B voice', 'C voice']);
  });

  it('preferenceTier matches the table case-insensitively', () => {
    expect(preferenceTier('google 日本語')).toBe(0);
    expect(preferenceTier('Google Japanese')).toBe(0);
    expect(preferenceTier('Microsoft Nanami')).toBe(1);
    expect(preferenceTier('Oren')).toBe(4);
    expect(preferenceTier('Otoya')).toBe(5);
    expect(preferenceTier('Mystery')).toBe(6);
  });

  it('toVoiceInfo maps localService to local/network', () => {
    expect(toVoiceInfo(v('X', { localService: false }))).toEqual({ uri: 'uri:X', name: 'X', lang: 'ja-JP', local: false, network: true });
  });
});

describe('pickPair', () => {
  const two = rankVoices([v('Kyoko'), v('O-Ren')]);
  const one = rankVoices([v('Kyoko')]);

  it('returns two distinct voices when at least two exist, no offset', () => {
    const p = pickPair(two);
    expect(p.a?.name).toBe('Kyoko');
    expect(p.b?.name).toBe('O-Ren');
    expect(p.offset).toBeUndefined();
  });

  it('honours the learner picks for both slots', () => {
    const p = pickPair(two, 'uri:O-Ren', 'uri:Kyoko');
    expect(p.a?.name).toBe('O-Ren');
    expect(p.b?.name).toBe('Kyoko');
  });

  it('ignores a stale preferred URI and a second pick equal to the first', () => {
    const p = pickPair(two, 'uri:gone', 'uri:Kyoko');
    expect(p.a?.name).toBe('Kyoko');
    expect(p.b?.name).toBe('O-Ren');
  });

  it('with one voice returns the same voice twice plus the rate/pitch offset', () => {
    const p = pickPair(one);
    expect(p.a?.uri).toBe('uri:Kyoko');
    expect(p.b?.uri).toBe('uri:Kyoko');
    expect(p.offset).toEqual(PAIR_OFFSET);
    expect(p.offset?.rate).toBeLessThan(1);
    expect(p.offset?.pitch).toBeLessThan(1);
  });

  it('returns {} for an empty list', () => {
    expect(pickPair([])).toEqual({});
  });
});

describe('installGuide / detectPlatform', () => {
  const UA = {
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
    cros: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
  };

  it.each([
    [UA.windows, 'windows'],
    [UA.mac, 'mac'],
    [UA.iphone, 'ios'],
    [UA.ipad, 'ios'],
    [UA.android, 'android'],
    [UA.linux, 'linux'],
    [UA.cros, 'android'],
    ['', 'unknown'],
  ])('detectPlatform(%s) → %s', (ua, want) => {
    expect(detectPlatform(ua)).toBe(want);
  });

  it('returns the matching guide per platform', () => {
    expect(installGuide(UA.windows)).toBe(S.installWindows);
    expect(installGuide(UA.mac)).toBe(S.installMac);
    expect(installGuide(UA.iphone)).toBe(S.installIos);
    expect(installGuide(UA.android)).toBe(S.installAndroid);
    expect(installGuide(UA.linux)).toBe(S.installLinux);
    expect(installGuide('curl/8.0')).toBe(S.installGeneric);
  });

  it('every guide mentions reloading or restarting and never uses an exclamation mark', () => {
    for (const g of [S.installWindows, S.installMac, S.installIos, S.installAndroid, S.installLinux, S.installGeneric]) {
      expect(g).toMatch(/reload|restart/i);
      expect(g).not.toContain('!');
    }
  });
});

describe('voiceLabel', () => {
  it('marks network voices for the picker', () => {
    expect(voiceLabel({ uri: 'u', name: 'Google 日本語', lang: 'ja-JP', local: false, network: true })).toBe(`Google 日本語 (${S.networkVoice})`);
    expect(voiceLabel({ uri: 'u', name: 'Kyoko', lang: 'ja-JP', local: true, network: false })).toBe('Kyoko');
  });
});
