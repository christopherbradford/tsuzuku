import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONJ_FORMS, type ConjForm, type ConjugablePos, type ConjugationGoldenEntry, type ContentFile } from '../content/types';
import { ADJ_FORMS, VERB_FORMS, acceptedSurfaces, applicableForms, applicableFormsFor, conjugate, conjugateAll, isConjugable } from './conjugate';

type Row = [word: string, kana: string, pos: ConjugablePos, forms: Partial<Record<ConjForm, string>>];

/* ──────────────────────────────────────────────────────────────────────────
 * In-test golden table: 64 verbs × key forms, 25 adjectives × all 6 forms.
 * Values are the primary `answer` (plain surface).
 * ────────────────────────────────────────────────────────────────────────── */
const VERBS: Row[] = [
  // godan く
  ['書く', 'かく', 'v5', { masu: '書きます', masen: '書きません', mashita: '書きました', 'masen-deshita': '書きませんでした', masho: '書きましょう', te: '書いて', nai: '書かない', ta: '書いた', nakatta: '書かなかった', potential: '書ける', volitional: '書こう', passive: '書かれる', causative: '書かせる', 'causative-passive': '書かせられる', imperative: '書け', prohibitive: '書くな', ba: '書けば', tara: '書いたら', tai: '書きたい', 'te-iru': '書いている' }],
  ['聞く', 'きく', 'v5', { te: '聞いて', nai: '聞かない', ta: '聞いた', potential: '聞ける', masu: '聞きます' }],
  ['歩く', 'あるく', 'v5', { te: '歩いて', nai: '歩かない', ta: '歩いた', potential: '歩ける', masu: '歩きます' }],
  ['働く', 'はたらく', 'v5', { te: '働いて', nai: '働かない', ta: '働いた', potential: '働ける', masu: '働きます' }],
  ['行く', 'いく', 'v5', { masu: '行きます', te: '行って', nai: '行かない', ta: '行った', nakatta: '行かなかった', potential: '行ける', volitional: '行こう', passive: '行かれる', causative: '行かせる', imperative: '行け', prohibitive: '行くな', ba: '行けば', tara: '行ったら', tai: '行きたい', 'te-iru': '行っている' }],
  // godan ぐ
  ['泳ぐ', 'およぐ', 'v5', { te: '泳いで', nai: '泳がない', ta: '泳いだ', potential: '泳げる', masu: '泳ぎます', tara: '泳いだら' }],
  ['急ぐ', 'いそぐ', 'v5', { te: '急いで', nai: '急がない', ta: '急いだ', potential: '急げる', masu: '急ぎます' }],
  ['脱ぐ', 'ぬぐ', 'v5', { te: '脱いで', nai: '脱がない', ta: '脱いだ', potential: '脱げる', masu: '脱ぎます' }],
  // godan す
  ['話す', 'はなす', 'v5', { te: '話して', nai: '話さない', ta: '話した', potential: '話せる', masu: '話します', volitional: '話そう', passive: '話される', causative: '話させる', 'causative-passive': '話させられる', imperative: '話せ', ba: '話せば', tara: '話したら' }],
  ['貸す', 'かす', 'v5', { te: '貸して', nai: '貸さない', ta: '貸した', potential: '貸せる', masu: '貸します' }],
  ['出す', 'だす', 'v5', { te: '出して', nai: '出さない', ta: '出した', potential: '出せる', masu: '出します' }],
  ['消す', 'けす', 'v5', { te: '消して', nai: '消さない', ta: '消した', potential: '消せる', masu: '消します' }],
  // godan う
  ['買う', 'かう', 'v5', { masu: '買います', te: '買って', nai: '買わない', ta: '買った', nakatta: '買わなかった', potential: '買える', volitional: '買おう', passive: '買われる', causative: '買わせる', 'causative-passive': '買わせられる', imperative: '買え', prohibitive: '買うな', ba: '買えば', tara: '買ったら', tai: '買いたい', 'te-iru': '買っている' }],
  ['言う', 'いう', 'v5', { te: '言って', nai: '言わない', ta: '言った', potential: '言える', masu: '言います' }],
  ['会う', 'あう', 'v5', { te: '会って', nai: '会わない', ta: '会った', potential: '会える', masu: '会います' }],
  ['使う', 'つかう', 'v5', { te: '使って', nai: '使わない', ta: '使った', potential: '使える', masu: '使います' }],
  ['洗う', 'あらう', 'v5', { te: '洗って', nai: '洗わない', ta: '洗った', potential: '洗える', masu: '洗います' }],
  ['習う', 'ならう', 'v5', { te: '習って', nai: '習わない', ta: '習った', potential: '習える', masu: '習います' }],
  ['歌う', 'うたう', 'v5', { te: '歌って', nai: '歌わない', ta: '歌った', potential: '歌える', masu: '歌います' }],
  // う-onbin (問う → 問うて, never 問って); 雇う stays regular
  ['問う', 'とう', 'v5', { masu: '問います', te: '問うて', nai: '問わない', ta: '問うた', tara: '問うたら', 'te-iru': '問うている', potential: '問える', volitional: '問おう', ba: '問えば' }],
  ['請う', 'こう', 'v5', { te: '請うて', ta: '請うた', tara: '請うたら', nai: '請わない', masu: '請います' }],
  ['乞う', 'こう', 'v5', { te: '乞うて', ta: '乞うた' }],
  ['雇う', 'やとう', 'v5', { te: '雇って', ta: '雇った', tara: '雇ったら', nai: '雇わない' }],
  // godan つ
  ['待つ', 'まつ', 'v5', { te: '待って', nai: '待たない', ta: '待った', potential: '待てる', masu: '待ちます', volitional: '待とう', passive: '待たれる', causative: '待たせる', imperative: '待て', ba: '待てば', tara: '待ったら' }],
  ['持つ', 'もつ', 'v5', { te: '持って', nai: '持たない', ta: '持った', potential: '持てる', masu: '持ちます' }],
  ['立つ', 'たつ', 'v5', { te: '立って', nai: '立たない', ta: '立った', potential: '立てる', masu: '立ちます' }],
  ['勝つ', 'かつ', 'v5', { te: '勝って', nai: '勝たない', ta: '勝った', potential: '勝てる', masu: '勝ちます' }],
  // godan ぬ
  ['死ぬ', 'しぬ', 'v5', { te: '死んで', nai: '死なない', ta: '死んだ', potential: '死ねる', masu: '死にます', volitional: '死のう', passive: '死なれる', causative: '死なせる', imperative: '死ね', ba: '死ねば', tara: '死んだら' }],
  // godan ぶ
  ['遊ぶ', 'あそぶ', 'v5', { te: '遊んで', nai: '遊ばない', ta: '遊んだ', potential: '遊べる', masu: '遊びます', volitional: '遊ぼう', passive: '遊ばれる', causative: '遊ばせる', imperative: '遊べ', ba: '遊べば', tara: '遊んだら' }],
  ['呼ぶ', 'よぶ', 'v5', { te: '呼んで', nai: '呼ばない', ta: '呼んだ', potential: '呼べる', masu: '呼びます' }],
  ['飛ぶ', 'とぶ', 'v5', { te: '飛んで', nai: '飛ばない', ta: '飛んだ', potential: '飛べる', masu: '飛びます' }],
  // godan む
  ['読む', 'よむ', 'v5', { masu: '読みます', te: '読んで', nai: '読まない', ta: '読んだ', potential: '読める', volitional: '読もう', passive: '読まれる', causative: '読ませる', 'causative-passive': '読ませられる', imperative: '読め', prohibitive: '読むな', ba: '読めば', tara: '読んだら', tai: '読みたい', 'te-iru': '読んでいる' }],
  ['飲む', 'のむ', 'v5', { te: '飲んで', nai: '飲まない', ta: '飲んだ', potential: '飲める', masu: '飲みます' }],
  ['休む', 'やすむ', 'v5', { te: '休んで', nai: '休まない', ta: '休んだ', potential: '休める', masu: '休みます' }],
  ['住む', 'すむ', 'v5', { te: '住んで', nai: '住まない', ta: '住んだ', potential: '住める', masu: '住みます' }],
  // godan る (incl. the ichidan look-alikes)
  ['帰る', 'かえる', 'v5', { te: '帰って', nai: '帰らない', ta: '帰った', potential: '帰れる', masu: '帰ります', volitional: '帰ろう', passive: '帰られる', causative: '帰らせる', imperative: '帰れ', ba: '帰れば', tara: '帰ったら' }],
  ['切る', 'きる', 'v5', { te: '切って', nai: '切らない', ta: '切った', potential: '切れる', masu: '切ります' }],
  ['知る', 'しる', 'v5', { te: '知って', nai: '知らない', ta: '知った', potential: '知れる', masu: '知ります' }],
  ['入る', 'はいる', 'v5', { te: '入って', nai: '入らない', ta: '入った', potential: '入れる', masu: '入ります' }],
  ['走る', 'はしる', 'v5', { te: '走って', nai: '走らない', ta: '走った', potential: '走れる', masu: '走ります' }],
  ['乗る', 'のる', 'v5', { te: '乗って', nai: '乗らない', ta: '乗った', potential: '乗れる', masu: '乗ります' }],
  ['作る', 'つくる', 'v5', { te: '作って', nai: '作らない', ta: '作った', potential: '作れる', masu: '作ります' }],
  ['取る', 'とる', 'v5', { te: '取って', nai: '取らない', ta: '取った', potential: '取れる', masu: '取ります' }],
  ['分かる', 'わかる', 'v5', { te: '分かって', nai: '分からない', ta: '分かった', potential: '分かれる', masu: '分かります' }],
  ['座る', 'すわる', 'v5', { te: '座って', nai: '座らない', ta: '座った', potential: '座れる', masu: '座ります' }],
  ['要る', 'いる', 'v5', { masu: '要ります', masen: '要りません', mashita: '要りました', 'masen-deshita': '要りませんでした', masho: '要りましょう', te: '要って', nai: '要らない', ta: '要った', nakatta: '要らなかった', potential: '要れる', ba: '要れば', tara: '要ったら' }],
  ['ある', 'ある', 'v5', { masu: 'あります', masen: 'ありません', mashita: 'ありました', 'masen-deshita': 'ありませんでした', masho: 'ありましょう', te: 'あって', nai: 'ない', ta: 'あった', nakatta: 'なかった', ba: 'あれば', tara: 'あったら' }],
  ['くださる', 'くださる', 'v5', { masu: 'くださいます', imperative: 'ください', te: 'くださって', nai: 'くださらない', ta: 'くださった' }],
  // ichidan
  ['食べる', 'たべる', 'v1', { masu: '食べます', masen: '食べません', mashita: '食べました', 'masen-deshita': '食べませんでした', masho: '食べましょう', te: '食べて', nai: '食べない', ta: '食べた', nakatta: '食べなかった', potential: '食べられる', volitional: '食べよう', passive: '食べられる', causative: '食べさせる', 'causative-passive': '食べさせられる', imperative: '食べろ', prohibitive: '食べるな', ba: '食べれば', tara: '食べたら', tai: '食べたい', 'te-iru': '食べている' }],
  ['見る', 'みる', 'v1', { te: '見て', nai: '見ない', ta: '見た', potential: '見られる', masu: '見ます' }],
  ['寝る', 'ねる', 'v1', { te: '寝て', nai: '寝ない', ta: '寝た', potential: '寝られる', masu: '寝ます' }],
  ['起きる', 'おきる', 'v1', { te: '起きて', nai: '起きない', ta: '起きた', potential: '起きられる', masu: '起きます' }],
  ['教える', 'おしえる', 'v1', { te: '教えて', nai: '教えない', ta: '教えた', potential: '教えられる', masu: '教えます' }],
  ['出る', 'でる', 'v1', { te: '出て', nai: '出ない', ta: '出た', potential: '出られる', masu: '出ます' }],
  ['開ける', 'あける', 'v1', { te: '開けて', nai: '開けない', ta: '開けた', potential: '開けられる', masu: '開けます' }],
  ['閉める', 'しめる', 'v1', { te: '閉めて', nai: '閉めない', ta: '閉めた', potential: '閉められる', masu: '閉めます' }],
  ['借りる', 'かりる', 'v1', { te: '借りて', nai: '借りない', ta: '借りた', potential: '借りられる', masu: '借ります' }],
  ['着る', 'きる', 'v1', { te: '着て', nai: '着ない', ta: '着た', potential: '着られる', masu: '着ます' }],
  ['いる', 'いる', 'v1', { te: 'いて', nai: 'いない', ta: 'いた', potential: 'いられる', masu: 'います', volitional: 'いよう', imperative: 'いろ' }],
  ['忘れる', 'わすれる', 'v1', { te: '忘れて', nai: '忘れない', ta: '忘れた', potential: '忘れられる', masu: '忘れます' }],
  ['覚える', 'おぼえる', 'v1', { te: '覚えて', nai: '覚えない', ta: '覚えた', potential: '覚えられる', masu: '覚えます' }],
  ['考える', 'かんがえる', 'v1', { te: '考えて', nai: '考えない', ta: '考えた', potential: '考えられる', masu: '考えます' }],
  ['できる', 'できる', 'v1', { te: 'できて', nai: 'できない', ta: 'できた', masu: 'できます' }],
  // irregular
  ['する', 'する', 'v-irr', { masu: 'します', masen: 'しません', mashita: 'しました', 'masen-deshita': 'しませんでした', masho: 'しましょう', te: 'して', nai: 'しない', ta: 'した', nakatta: 'しなかった', potential: 'できる', volitional: 'しよう', passive: 'される', causative: 'させる', 'causative-passive': 'させられる', imperative: 'しろ', prohibitive: 'するな', ba: 'すれば', tara: 'したら', tai: 'したい', 'te-iru': 'している' }],
  ['来る', 'くる', 'v-irr', { masu: '来ます', masen: '来ません', mashita: '来ました', 'masen-deshita': '来ませんでした', masho: '来ましょう', te: '来て', nai: '来ない', ta: '来た', nakatta: '来なかった', potential: '来られる', volitional: '来よう', passive: '来られる', causative: '来させる', 'causative-passive': '来させられる', imperative: '来い', prohibitive: '来るな', ba: '来れば', tara: '来たら', tai: '来たい', 'te-iru': '来ている' }],
  ['勉強する', 'べんきょうする', 'v-irr', { masu: '勉強します', te: '勉強して', nai: '勉強しない', ta: '勉強した', potential: '勉強できる', volitional: '勉強しよう', passive: '勉強される', imperative: '勉強しろ' }],
  ['持ってくる', 'もってくる', 'v-irr', { masu: '持ってきます', te: '持ってきて', nai: '持ってこない', ta: '持ってきた', potential: '持ってこられる', imperative: '持ってこい' }],
  ['連れて来る', 'つれてくる', 'v-irr', { masu: '連れて来ます', te: '連れて来て', nai: '連れて来ない', ta: '連れて来た', ba: '連れて来れば' }],
];

const ADJECTIVES: Row[] = [
  ['いい', 'いい', 'adj-i', { 'adj-neg': 'よくない', 'adj-past': 'よかった', 'adj-past-neg': 'よくなかった', 'adj-te': 'よくて', 'adj-adv': 'よく', 'adj-ba': 'よければ' }],
  ['よい', 'よい', 'adj-i', { 'adj-neg': 'よくない', 'adj-past': 'よかった', 'adj-past-neg': 'よくなかった', 'adj-te': 'よくて', 'adj-adv': 'よく', 'adj-ba': 'よければ' }],
  ['良い', 'よい', 'adj-i', { 'adj-neg': '良くない', 'adj-past': '良かった', 'adj-past-neg': '良くなかった', 'adj-te': '良くて', 'adj-adv': '良く', 'adj-ba': '良ければ' }],
  ['かっこいい', 'かっこいい', 'adj-i', { 'adj-neg': 'かっこよくない', 'adj-past': 'かっこよかった', 'adj-past-neg': 'かっこよくなかった', 'adj-te': 'かっこよくて', 'adj-adv': 'かっこよく', 'adj-ba': 'かっこよければ' }],
  ['かわいい', 'かわいい', 'adj-i', { 'adj-neg': 'かわいくない', 'adj-past': 'かわいかった', 'adj-past-neg': 'かわいくなかった', 'adj-te': 'かわいくて', 'adj-adv': 'かわいく', 'adj-ba': 'かわいければ' }],
  ['ない', 'ない', 'adj-i', { 'adj-neg': 'なくない', 'adj-past': 'なかった', 'adj-past-neg': 'なくなかった', 'adj-te': 'なくて', 'adj-adv': 'なく', 'adj-ba': 'なければ' }],
  ['高い', 'たかい', 'adj-i', { 'adj-neg': '高くない', 'adj-past': '高かった', 'adj-past-neg': '高くなかった', 'adj-te': '高くて', 'adj-adv': '高く', 'adj-ba': '高ければ' }],
  ['安い', 'やすい', 'adj-i', { 'adj-neg': '安くない', 'adj-past': '安かった', 'adj-past-neg': '安くなかった', 'adj-te': '安くて', 'adj-adv': '安く', 'adj-ba': '安ければ' }],
  ['大きい', 'おおきい', 'adj-i', { 'adj-neg': '大きくない', 'adj-past': '大きかった', 'adj-past-neg': '大きくなかった', 'adj-te': '大きくて', 'adj-adv': '大きく', 'adj-ba': '大きければ' }],
  ['新しい', 'あたらしい', 'adj-i', { 'adj-neg': '新しくない', 'adj-past': '新しかった', 'adj-past-neg': '新しくなかった', 'adj-te': '新しくて', 'adj-adv': '新しく', 'adj-ba': '新しければ' }],
  ['暑い', 'あつい', 'adj-i', { 'adj-neg': '暑くない', 'adj-past': '暑かった', 'adj-past-neg': '暑くなかった', 'adj-te': '暑くて', 'adj-adv': '暑く', 'adj-ba': '暑ければ' }],
  ['寒い', 'さむい', 'adj-i', { 'adj-neg': '寒くない', 'adj-past': '寒かった', 'adj-past-neg': '寒くなかった', 'adj-te': '寒くて', 'adj-adv': '寒く', 'adj-ba': '寒ければ' }],
  ['忙しい', 'いそがしい', 'adj-i', { 'adj-neg': '忙しくない', 'adj-past': '忙しかった', 'adj-past-neg': '忙しくなかった', 'adj-te': '忙しくて', 'adj-adv': '忙しく', 'adj-ba': '忙しければ' }],
  ['美味しい', 'おいしい', 'adj-i', { 'adj-neg': '美味しくない', 'adj-past': '美味しかった', 'adj-past-neg': '美味しくなかった', 'adj-te': '美味しくて', 'adj-adv': '美味しく', 'adj-ba': '美味しければ' }],
  ['静か', 'しずか', 'adj-na', { 'adj-neg': '静かじゃない', 'adj-past': '静かだった', 'adj-past-neg': '静かじゃなかった', 'adj-te': '静かで', 'adj-adv': '静かに', 'adj-ba': '静かなら' }],
  ['元気', 'げんき', 'adj-na', { 'adj-neg': '元気じゃない', 'adj-past': '元気だった', 'adj-past-neg': '元気じゃなかった', 'adj-te': '元気で', 'adj-adv': '元気に', 'adj-ba': '元気なら' }],
  ['便利', 'べんり', 'adj-na', { 'adj-neg': '便利じゃない', 'adj-past': '便利だった', 'adj-past-neg': '便利じゃなかった', 'adj-te': '便利で', 'adj-adv': '便利に', 'adj-ba': '便利なら' }],
  ['有名', 'ゆうめい', 'adj-na', { 'adj-neg': '有名じゃない', 'adj-past': '有名だった', 'adj-past-neg': '有名じゃなかった', 'adj-te': '有名で', 'adj-adv': '有名に', 'adj-ba': '有名なら' }],
  ['好き', 'すき', 'adj-na', { 'adj-neg': '好きじゃない', 'adj-past': '好きだった', 'adj-past-neg': '好きじゃなかった', 'adj-te': '好きで', 'adj-adv': '好きに', 'adj-ba': '好きなら' }],
  ['綺麗', 'きれい', 'adj-na', { 'adj-neg': '綺麗じゃない', 'adj-past': '綺麗だった', 'adj-past-neg': '綺麗じゃなかった', 'adj-te': '綺麗で', 'adj-adv': '綺麗に', 'adj-ba': '綺麗なら' }],
  ['親切', 'しんせつ', 'adj-na', { 'adj-neg': '親切じゃない', 'adj-past': '親切だった', 'adj-past-neg': '親切じゃなかった', 'adj-te': '親切で', 'adj-adv': '親切に', 'adj-ba': '親切なら' }],
  ['簡単', 'かんたん', 'adj-na', { 'adj-neg': '簡単じゃない', 'adj-past': '簡単だった', 'adj-past-neg': '簡単じゃなかった', 'adj-te': '簡単で', 'adj-adv': '簡単に', 'adj-ba': '簡単なら' }],
  ['大変', 'たいへん', 'adj-na', { 'adj-neg': '大変じゃない', 'adj-past': '大変だった', 'adj-past-neg': '大変じゃなかった', 'adj-te': '大変で', 'adj-adv': '大変に', 'adj-ba': '大変なら' }],
  ['丁寧', 'ていねい', 'adj-na', { 'adj-neg': '丁寧じゃない', 'adj-past': '丁寧だった', 'adj-past-neg': '丁寧じゃなかった', 'adj-te': '丁寧で', 'adj-adv': '丁寧に', 'adj-ba': '丁寧なら' }],
  ['暇', 'ひま', 'adj-na', { 'adj-neg': '暇じゃない', 'adj-past': '暇だった', 'adj-past-neg': '暇じゃなかった', 'adj-te': '暇で', 'adj-adv': '暇に', 'adj-ba': '暇なら' }],
];

const KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/;

describe('in-test golden table', () => {
  it('covers ≥ 60 verbs and ≥ 10 adjectives', () => {
    expect(VERBS.length).toBeGreaterThanOrEqual(60);
    expect(ADJECTIVES.length).toBeGreaterThanOrEqual(10);
  });

  const rows = [...VERBS, ...ADJECTIVES].flatMap(([word, kana, pos, forms]) =>
    (Object.entries(forms) as [ConjForm, string][]).map(([form, answer]) => ({ word, kana, pos, form, answer })),
  );

  it.each(rows)('$word ($pos) $form → $answer', ({ word, kana, pos, form, answer }) => {
    const c = conjugate(word, kana, pos, form);
    expect(c).not.toBeNull();
    expect(c!.answer).toBe(answer);
    expect(c!.answerKana).toMatch(KANA_ONLY);
    expect(c!.alt).not.toContain(c!.answer);
    expect(new Set(c!.alt).size).toBe(c!.alt.length);
  });

  it('kana-only head words give answer === answerKana', () => {
    for (const [word, kana, pos] of [...VERBS, ...ADJECTIVES]) {
      if (word !== kana) continue;
      for (const f of applicableFormsFor(word, kana, pos)) {
        const c = conjugate(word, kana, pos, f);
        if (c) expect(c.answer).toBe(c.answerKana);
      }
    }
  });
});

describe('う-onbin', () => {
  it('問う te/ta/tara kana surfaces are とうて / とうた / とうたら', () => {
    expect(conjugate('問う', 'とう', 'v5', 'te')!.answerKana).toBe('とうて');
    expect(conjugate('問う', 'とう', 'v5', 'ta')!.answerKana).toBe('とうた');
    expect(conjugate('問う', 'とう', 'v5', 'tara')!.answerKana).toBe('とうたら');
    expect(conjugate('請う', 'こう', 'v5', 'te')!.answer).toBe('請うて');
    expect(conjugate('雇う', 'やとう', 'v5', 'te')!.answerKana).toBe('やとって');
  });
});

describe('alternates', () => {
  it('ら抜き potentials for ichidan and 来る, and the kana surfaces', () => {
    const t = conjugate('食べる', 'たべる', 'v1', 'potential')!;
    expect(t.alt).toEqual(expect.arrayContaining(['食べれる', 'たべれる']));
    expect(t.answerKana).toBe('たべられる');
    expect(conjugate('来る', 'くる', 'v-irr', 'potential')!.alt).toEqual(expect.arrayContaining(['来れる', 'これる']));
    expect(conjugate('いる', 'いる', 'v1', 'potential')!.alt).toContain('いれる');
    expect(conjugate('着る', 'きる', 'v1', 'potential')!.alt).toContain('着れる');
  });
  it('imperative alternates: 食べよ, せよ', () => {
    expect(conjugate('食べる', 'たべる', 'v1', 'imperative')!.alt).toContain('食べよ');
    expect(conjugate('する', 'する', 'v-irr', 'imperative')!.alt).toContain('せよ');
  });
  it('short causative-passive for godan except す-verbs', () => {
    expect(conjugate('書く', 'かく', 'v5', 'causative-passive')!.alt).toContain('書かされる');
    expect(conjugate('話す', 'はなす', 'v5', 'causative-passive')!.alt).not.toContain('話さされる');
  });
  it('な-adjective ではない / ではなかった / であれば; ない → なくはない', () => {
    expect(conjugate('静か', 'しずか', 'adj-na', 'adj-neg')!.alt).toContain('静かではない');
    expect(conjugate('静か', 'しずか', 'adj-na', 'adj-past-neg')!.alt).toContain('静かではなかった');
    expect(conjugate('静か', 'しずか', 'adj-na', 'adj-ba')!.alt).toContain('静かであれば');
    expect(conjugate('ない', 'ない', 'adj-i', 'adj-neg')!.alt).toContain('なくはない');
  });
  it('acceptedSurfaces lists answer, kana and alts once', () => {
    const s = acceptedSurfaces(conjugate('食べる', 'たべる', 'v1', 'potential')!);
    expect(s[0]).toBe('食べられる');
    expect(new Set(s).size).toBe(s.length);
    expect(s).toContain('たべられる');
  });
});

describe('applicability', () => {
  it('verbs 20 forms, adjectives 6', () => {
    expect(applicableForms('v5')).toHaveLength(20);
    expect(applicableForms('v1')).toHaveLength(20);
    expect(applicableForms('v-irr')).toHaveLength(20);
    expect(applicableForms('adj-i')).toHaveLength(6);
    expect(applicableForms('adj-na')).toHaveLength(6);
    expect(VERB_FORMS.length + ADJ_FORMS.length).toBe(CONJ_FORMS.length);
  });
  it('ある has 11 rows, 要る 12', () => {
    expect(applicableFormsFor('ある', 'ある', 'v5')).toHaveLength(11);
    expect(applicableFormsFor('要る', 'いる', 'v5')).toHaveLength(12);
    expect(applicableFormsFor('いる', 'いる', 'v1')).toHaveLength(20);
    expect(Object.keys(conjugateAll('ある', 'ある', 'v5'))).toHaveLength(11);
    expect(Object.keys(conjugateAll('書く', 'かく', 'v5'))).toHaveLength(20);
    expect(Object.keys(conjugateAll('高い', 'たかい', 'adj-i'))).toHaveLength(6);
  });
  it('defective and inapplicable forms return null', () => {
    for (const f of ['potential', 'volitional', 'passive', 'causative', 'causative-passive', 'imperative', 'prohibitive', 'tai', 'te-iru'] as ConjForm[]) expect(conjugate('ある', 'ある', 'v5', f)).toBeNull();
    for (const f of ['volitional', 'imperative', 'prohibitive', 'tai', 'passive', 'causative', 'causative-passive', 'te-iru'] as ConjForm[]) expect(conjugate('要る', 'いる', 'v5', f)).toBeNull();
    expect(conjugate('高い', 'たかい', 'adj-i', 'te')).toBeNull();
    expect(conjugate('書く', 'かく', 'v5', 'adj-neg')).toBeNull();
    expect(conjugate('書く', 'かく', 'v5', 'nonsense' as ConjForm)).toBeNull();
    expect(conjugate('', '', 'v5', 'te')).toBeNull();
    expect(conjugate('高い', 'たかい', 'adj-i', 'nonsense' as ConjForm)).toBeNull();
  });
  it('isConjugable', () => {
    expect(isConjugable('v1')).toBe(true);
    expect(isConjugable('adj-na')).toBe(true);
    expect(isConjugable('n')).toBe(false);
    expect(isConjugable('n-suru')).toBe(false);
  });
  it('a kanji-less verb surface falls back to kana', () => {
    expect(conjugate('食べる', 'たべる', 'v1', 'te')!.answerKana).toBe('たべて');
    expect(conjugate('タベル', 'たべる', 'v1', 'te')!.answer).toBe('たべて');
  });
});

/* ──────────────────────────────────────────────────────────────────────────
 * Disk golden table: public/content/conjugation/*.json (when present). Read
 * from disk, never via the loader (ARCHITECTURE §3).
 * ────────────────────────────────────────────────────────────────────────── */
const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(here, '../../public/content/conjugation');

function loadGolden(): ConjugationGoldenEntry[] {
  if (!existsSync(GOLDEN_DIR)) return [];
  const out: ConjugationGoldenEntry[] = [];
  for (const f of readdirSync(GOLDEN_DIR).filter((n) => n.endsWith('.json')).sort()) {
    const file = JSON.parse(readFileSync(join(GOLDEN_DIR, f), 'utf8')) as ContentFile<ConjugationGoldenEntry>;
    out.push(...file.items);
  }
  return out;
}

const golden = loadGolden();

describe.skipIf(golden.length === 0)('disk golden table', () => {
  it('has rows', () => {
    expect(golden.length).toBeGreaterThan(0);
  });
  it.each(golden.map((g) => [g.id, g] as const))('%s', (_id, g) => {
    const c = conjugate(g.word, g.kana, g.pos, g.form);
    expect(c, `${g.word} ${g.form}`).not.toBeNull();
    const rowAccepts = new Set([g.answer, g.answerKana, ...(g.alt ?? [])]);
    const engineAccepts = new Set(acceptedSurfaces(c!));
    // engine answer is one of the row's accepted surfaces …
    expect(rowAccepts.has(c!.answer) || rowAccepts.has(c!.answerKana), `${g.id}: engine ${c!.answer}/${c!.answerKana} not in ${[...rowAccepts].join('/')}`).toBe(true);
    // … and the row's answer is one the engine accepts.
    expect(engineAccepts.has(g.answer), `${g.id}: row ${g.answer} not in ${[...engineAccepts].join('/')}`).toBe(true);
    expect(c!.answerKana).toMatch(KANA_ONLY);
  });
});
