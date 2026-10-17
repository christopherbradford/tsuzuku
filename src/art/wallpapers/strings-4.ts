/**
 * TSUZUKU — fixed captions of the group-4 kakejiku (waveform, golden-screen,
 * festival, station-sign, kyoto-arrival, road-continues, end-card).
 *
 * Personal text (name, streak, mastered words, dates…) comes from
 * `WallpaperData`; only the fixed Japanese captions and the oscilloscope
 * readouts live here. `{n}` placeholders go through `fill()` from
 * `src/art/strings.ts`. Sensei voice: terse, warm, never a countdown.
 */
export const S = {
  waveform: {
    /** Oscilloscope readouts (decorative pixel text in the SVG). */
    channel: 'CH1',
    volts: '2.0 V/div',
    time: '5 ms/div',
    /** The run that earned the piece: a perfect dictation. */
    perfect: '聴写 100%',
    /** Shown on the trace when no dictated sentence has been chosen yet. */
    noSignal: '聴写を待っています',
  },
  goldenScreen: {
    /** Formal congratulations on the Nidan promotion (panel six, tategaki). */
    occasion: '弐段昇段御祝',
    greeting: '謹んで御祝い申し上げます',
    /** Honorific after the learner's name. */
    honorific: '殿',
  },
  festival: {
    /** The great lantern on the taiko tower. */
    matsuri: '祭',
    /** Banner words when no mastered vocabulary is available yet. */
    fallbackWords: ['夏', '花火', '太鼓', '夜店'],
  },
  stationSign: {
    /** Suffix after the current station's name on the small line. */
    eki: '駅',
  },
  kyotoArrival: {
    /** The rank the piece celebrates (Shodan Shinsa at Sanjō Ōhashi). */
    shodan: '初段',
    /** "Arrived in Kyoto" after the era date. */
    arrived: '京都着',
  },
  roadContinues: {
    tsuzuku: 'つづく',
    streak: '{n}日連続',
    total: '通算{n}日',
  },
  endCard: {
    tsuzuku: 'つづく',
    streak: '連続{n}日',
  },
} as const;
