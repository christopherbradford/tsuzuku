# TSUZUKU — Station Allocation (V1)

Per-station absorption of new items, consistent with `docs/design/02-progression.md` §1 and `STATIONS` in `src/content/types.ts`. `scripts/assign-stations.ts` walks each level's items **in corpus order** (file order × item order as listed in `docs/content-plan.json`; by `frequencyRank` when the items carry it) and fills stations in road order with the counts below. Kanji are additionally reordered so a character is never assigned before all of its components; **components** are placed one station ahead of the first kanji that uses them (the N5 set across Stations 2–3); grammar is already in syllabus order. Vocab stations also satisfy **part-of-speech floors** (`DEFAULT_POS_FLOORS` in the assigner, §5 step 3): the N5 briefs put every verb and adjective in `vocab-n5-003`, so Station 6 (Vます / Nを V / Nで V / Nへ V) pulls the first 12 core verbs forward and Station 7 (い/な-adjective predicates) the first 8 い-adjectives and 6 な-adjectives; the displaced items move to the next station and the running totals are unchanged, so the shift ends at Station 9. The id ranges are therefore *nominal*: dedupe gaps, the component reorder and the floors shift them slightly, and V34 accepts ±10 %.

Totals: kana 238 · vocab 6,350 · kanji 1,000 · grammar 450 · stories 137 (3 per station for 1–31, 2 for 32–53) · components ≈ 250 · Michikusa 212 (4 per station, `michikusa/michikusa-sNN.json`, not shown in the table).

## 1. Absorption table

| # | Station | Belt | JLPT | Kana | Vocab | Vocab ids (nominal) | Kanji | Grammar | Grammar ids | Stories |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 品川 Shinagawa | white | kana | hiragana basic 46 + dakuten 20 + handakuten 5 (71) | 20 | v-n5-0001…0020 | 0 | 0 | — | 3 (s-01-1 s-01-2 s-01-3) |
| 2 | 川崎 Kawasaki | white | kana | hiragana yōon 33 + katakana basic 46 (79) | 20 | v-n5-0021…0040 | 0 | 0 | — | 3 (s-02-1 s-02-2 s-02-3) |
| 3 | 神奈川 Kanagawa | white | kana | katakana dakuten 20 + handakuten 5 + yōon 33 + extended 30 (88) | 40 | v-n5-0041…0080 | 0 | 0 | — | 3 (s-03-1 s-03-2 s-03-3) |
| 4 | 保土ヶ谷 Hodogaya | yellow | N5 | — | 60 | v-n5-0081…0140 | 8 | 8 | g-n5-001…008 | 3 (s-04-1 s-04-2 s-04-3) |
| 5 | 戸塚 Totsuka | yellow | N5 | — | 60 | v-n5-0141…0200 | 8 | 8 | g-n5-009…016 | 3 (s-05-1 s-05-2 s-05-3) |
| 6 | 藤沢 Fujisawa | yellow | N5 | — | 60 | v-n5-0201…0248 + 0271…0282 (verb floor) | 8 | 7 | g-n5-017…023 | 3 (s-06-1 s-06-2 s-06-3) |
| 7 | 平塚 Hiratsuka | yellow | N5 | — | 60 | v-n5-0249…0270, 0283…0308 + 0350…0355, 0386…0391 (adjective floors) | 8 | 8 | g-n5-024…031 | 3 (s-07-1 s-07-2 s-07-3) |
| 8 | 大磯 Ōiso | yellow | N5 | — | 60 | v-n5-0309…0349, 0356…0374 | 8 | 7 | g-n5-032…038 | 3 (s-08-1 s-08-2 s-08-3) |
| 9 | 小田原 Odawara | yellow | N5 | — | 60 | v-n5-0375…0385, 0392…0440 | 8 | 7 | g-n5-039…045 | 3 (s-09-1 s-09-2 s-09-3) |
| 10 | 箱根 Hakone | orange | N5 | — | 60 | v-n5-0441…0500 | 9 | 8 | g-n5-046…053 | 3 (s-10-1 s-10-2 s-10-3) |
| 11 | 三島 Mishima | orange | N5 | — | 60 | v-n5-0501…0560 | 9 | 8 | g-n5-054…061 | 3 (s-11-1 s-11-2 s-11-3) |
| 12 | 沼津 Numazu | orange | N5 | — | 60 | v-n5-0561…0620 | 9 | 7 | g-n5-062…068 | 3 (s-12-1 s-12-2 s-12-3) |
| 13 | 原 Hara | orange | N5 | — | 60 | v-n5-0621…0680 | 9 | 8 | g-n5-069…076 | 3 (s-13-1 s-13-2 s-13-3) |
| 14 | 吉原 Yoshiwara | orange | N5 | — | 60 | v-n5-0681…0740 | 8 | 7 | g-n5-077…083 | 3 (s-14-1 s-14-2 s-14-3) |
| 15 | 蒲原 Kanbara | orange | N5 | — | 60 | v-n5-0741…0800 | 8 | 7 | g-n5-084…090 | 3 (s-15-1 s-15-2 s-15-3) |
| 16 | 由比 Yui | green | N4 | — | 72 | v-n4-0001…0072 | 22 | 10 | g-n4-001…010 | 3 (s-16-1 s-16-2 s-16-3) |
| 17 | 興津 Okitsu | green | N4 | — | 72 | v-n4-0073…0144 | 22 | 10 | g-n4-011…020 | 3 (s-17-1 s-17-2 s-17-3) |
| 18 | 江尻 Ejiri | green | N4 | — | 72 | v-n4-0145…0216 | 22 | 10 | g-n4-021…030 | 3 (s-18-1 s-18-2 s-18-3) |
| 19 | 府中 Fuchū | green | N4 | — | 72 | v-n4-0217…0288 | 22 | 10 | g-n4-031…040 | 3 (s-19-1 s-19-2 s-19-3) |
| 20 | 鞠子 Mariko | green | N4 | — | 72 | v-n4-0289…0360 | 22 | 10 | g-n4-041…050 | 3 (s-20-1 s-20-2 s-20-3) |
| 21 | 岡部 Okabe | green | N4 | — | 72 | v-n4-0361…0432 | 22 | 10 | g-n4-051…060 | 3 (s-21-1 s-21-2 s-21-3) |
| 22 | 藤枝 Fujieda | green | N4 | — | 72 | v-n4-0433…0504 | 22 | 10 | g-n4-061…070 | 3 (s-22-1 s-22-2 s-22-3) |
| 23 | 島田 Shimada | green | N4 | — | 72 | v-n4-0505…0576 | 22 | 10 | g-n4-071…080 | 3 (s-23-1 s-23-2 s-23-3) |
| 24 | 金谷 Kanaya | green | N4 | — | 74 | v-n4-0577…0650 | 24 | 10 | g-n4-081…090 | 3 (s-24-1 s-24-2 s-24-3) |
| 25 | 日坂 Nissaka | blue | N3 | — | 121 | v-n3-0001…0121 | 25 | 8 | g-n3-001…008 | 3 (s-25-1 s-25-2 s-25-3) |
| 26 | 掛川 Kakegawa | blue | N3 | — | 121 | v-n3-0122…0242 | 25 | 8 | g-n3-009…016 | 3 (s-26-1 s-26-2 s-26-3) |
| 27 | 袋井 Fukuroi | blue | N3 | — | 121 | v-n3-0243…0363 | 25 | 8 | g-n3-017…024 | 3 (s-27-1 s-27-2 s-27-3) |
| 28 | 見付 Mitsuke | blue | N3 | — | 121 | v-n3-0364…0484 | 25 | 8 | g-n3-025…032 | 3 (s-28-1 s-28-2 s-28-3) |
| 29 | 浜松 Hamamatsu | blue | N3 | — | 121 | v-n3-0485…0605 | 25 | 8 | g-n3-033…040 | 3 (s-29-1 s-29-2 s-29-3) |
| 30 | 舞坂 Maisaka | blue | N3 | — | 121 | v-n3-0606…0726 | 25 | 8 | g-n3-041…048 | 3 (s-30-1 s-30-2 s-30-3) |
| 31 | 新居 Arai | blue | N3 | — | 121 | v-n3-0727…0847 | 25 | 8 | g-n3-049…056 | 3 (s-31-1 s-31-2 s-31-3) |
| 32 | 白須賀 Shirasuka | purple | N3 | — | 122 | v-n3-0848…0969 | 25 | 8 | g-n3-057…064 | 2 (s-32-1 s-32-2) |
| 33 | 二川 Futagawa | purple | N3 | — | 122 | v-n3-0970…1091 | 25 | 8 | g-n3-065…072 | 2 (s-33-1 s-33-2) |
| 34 | 吉田 Yoshida | purple | N3 | — | 122 | v-n3-1092…1213 | 25 | 8 | g-n3-073…080 | 2 (s-34-1 s-34-2) |
| 35 | 御油 Goyu | purple | N3 | — | 122 | v-n3-1214…1335 | 25 | 8 | g-n3-081…088 | 2 (s-35-1 s-35-2) |
| 36 | 赤坂 Akasaka | purple | N3 | — | 122 | v-n3-1336…1457 | 25 | 7 | g-n3-089…095 | 2 (s-36-1 s-36-2) |
| 37 | 藤川 Fujikawa | purple | N3 | — | 122 | v-n3-1458…1579 | 25 | 7 | g-n3-096…102 | 2 (s-37-1 s-37-2) |
| 38 | 岡崎 Okazaki | purple | N3 | — | 121 | v-n3-1580…1700 | 25 | 8 | g-n3-103…110 | 2 (s-38-1 s-38-2) |
| 39 | 池鯉鮒 Chiryū | brown | N2 | — | 212 | v-n2-0001…0212 | 44 | 12 | g-n2-001…012 | 2 (s-39-1 s-39-2) |
| 40 | 鳴海 Narumi | brown | N2 | — | 212 | v-n2-0213…0424 | 44 | 11 | g-n2-013…023 | 2 (s-40-1 s-40-2) |
| 41 | 宮 Miya | brown | N2 | — | 212 | v-n2-0425…0636 | 44 | 11 | g-n2-024…034 | 2 (s-41-1 s-41-2) |
| 42 | 桑名 Kuwana | brown | N2 | — | 212 | v-n2-0637…0848 | 44 | 11 | g-n2-035…045 | 2 (s-42-1 s-42-2) |
| 43 | 四日市 Yokkaichi | brown | N2 | — | 213 | v-n2-0849…1061 | 44 | 11 | g-n2-046…056 | 2 (s-43-1 s-43-2) |
| 44 | 石薬師 Ishiyakushi | brown | N2 | — | 213 | v-n2-1062…1274 | 44 | 11 | g-n2-057…067 | 2 (s-44-1 s-44-2) |
| 45 | 庄野 Shōno | brown | N2 | — | 213 | v-n2-1275…1487 | 43 | 11 | g-n2-068…078 | 2 (s-45-1 s-45-2) |
| 46 | 亀山 Kameyama | brown | N2 | — | 213 | v-n2-1488…1700 | 43 | 12 | g-n2-079…090 | 2 (s-46-1 s-46-2) |
| 47 | 関 Seki | black | N1 | — | 214 | v-n1-0001…0214 | 0 | 10 | g-n1-001…010 | 2 (s-47-1 s-47-2) |
| 48 | 坂下 Sakashita | black | N1 | — | 214 | v-n1-0215…0428 | 0 | 10 | g-n1-011…020 | 2 (s-48-1 s-48-2) |
| 49 | 土山 Tsuchiyama | black | N1 | — | 214 | v-n1-0429…0642 | 0 | 10 | g-n1-021…030 | 2 (s-49-1 s-49-2) |
| 50 | 水口 Minakuchi | black | N1 | — | 214 | v-n1-0643…0856 | 0 | 10 | g-n1-031…040 | 2 (s-50-1 s-50-2) |
| 51 | 石部 Ishibe | black | N1 | — | 214 | v-n1-0857…1070 | 0 | 10 | g-n1-041…050 | 2 (s-51-1 s-51-2) |
| 52 | 草津 Kusatsu | black | N1 | — | 215 | v-n1-1071…1285 | 0 | 10 | g-n1-051…060 | 2 (s-52-1 s-52-2) |
| 53 | 大津 Ōtsu | black | N1 | — | 215 | v-n1-1286…1500 | 0 | 10 | g-n1-061…070 | 2 (s-53-1 s-53-2) |
| | **Total** | | | 238 | **6350** | | **1000** | **450** | | **137** |

Not in the table: every station also carries **4 Michikusa** fragments (`m-NN-1…4`, 212 total, written in Pass 1 from the station theme) and, for Stations 2–45, the **components** of the next station's kanji (`StationBundle.componentIds`, ≈ 250 in all; the N5 set of ≈ 60 primitives is split across Stations 2 and 3 beside the kana). Stories for Stations 1–3 draw on one shared allowlist — the full 80-word White set — rather than the 20/20/40 slices.

## 2. Per-level streams

| Level | Vocab items → stations | Kanji → stations | Grammar → stations |
|---|---|---|---|
| N5 | 800 items → st 1–15 | 100 items → st 4–15 | 90 items → st 4–15 |
| N4 | 650 items → st 16–24 | 200 items → st 16–24 | 90 items → st 16–24 |
| N3 | 1700 items → st 25–38 | 350 items → st 25–38 | 110 items → st 25–38 |
| N2 | 1700 items → st 39–46 | 350 items → st 39–46 | 90 items → st 39–46 |
| N1 | 1500 items → st 47–53 | — | 70 items → st 47–53 |
| components | — | ≈ 60 (N5 kanji) → st 2–3; the rest one station ahead of their first kanji → st 15–45 | — |

White stations 1–3 take the first 80 N5 vocab items (the kana-friendly starter set in `vocab-n5-001`); N5 stations 4–15 take items 81–800. The three White stations' texts use the whole 80-word set as one allowlist. N1 stations add no kanji in V1 (jōyō remainder is the `kanji/n1/*` content hook).

## 3. Nominal kanji per station

Corpus order before the component-dependency reorder. Level sets: N5 100 · N4 200 · N3 350 · N2 350 (the N4 set absorbs ~50 easy kanji from the common N3 list, and N3 absorbs the easiest remainder of the N2 list, so Green/Blue/Purple/Brown quotas are met exactly).

| # | Station | n | Kanji |
|---|---|---|---|
| 4 | 保土ヶ谷 | 8 | 日一国人年大十二 |
| 5 | 戸塚 | 8 | 本中長出三時行見 |
| 6 | 藤沢 | 8 | 月分後前生五間上 |
| 7 | 平塚 | 8 | 東四今金九入学高 |
| 8 | 大磯 | 8 | 円子外八六下来気 |
| 9 | 小田原 | 8 | 小七山話女北午百 |
| 10 | 箱根 | 9 | 書先名川千水半男西 |
| 11 | 三島 | 9 | 電校語土木聞食車何 |
| 12 | 沼津 | 9 | 南万毎白天母火右読 |
| 13 | 原 | 9 | 友左休父雨口目手耳 |
| 14 | 吉原 | 8 | 足安新古多少言飲 |
| 15 | 蒲原 | 8 | 買立会社店駅道花 |
| 16 | 由比 | 22 | 同事自発者地業方場員開力問代明動京通理体田主 |
| 17 | 興津 | 22 | 題意不作用度強公持野以思家世正院心界教文元重 |
| 18 | 江尻 | 22 | 近考画海売知集別物使品計死特私始朝運終台広住 |
| 19 | 府中 | 22 | 無真有町料工建空急止送切転研究楽起着病質待試 |
| 20 | 鞠子 | 22 | 族銀早映親験英医仕去味写字答夜音注帰歌悪図週 |
| 21 | 岡部 | 22 | 室歩風紙黒春赤青館屋色走秋夏習洋旅服夕借曜肉 |
| 22 | 藤枝 | 22 | 貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢石米首声頭光 |
| 23 | 島田 | 22 | 馬王顔絵笑遊草酒寝歯雪洗泳鳴腹箱晩寒忙猫太船 |
| 24 | 金谷 | 24 | 薬園庭曲君夢迷遠窓昔礼杯皆眠忘困暗晴払返便乗歳戸 |
| 25 | 日坂 | 25 | 政議民連対部合市内相定回選実関決全表戦経最現調化当 |
| 26 | 掛川 | 25 | 約法性要制治務成期取都和機平加受続進数記初指権支産 |
| 27 | 袋井 | 25 | 点報済活原共得解交資予向際勝面告反判認参利組信在件 |
| 28 | 見付 | 25 | 側任引求所次昨論官増係感情投示変打直両式確果容必演 |
| 29 | 浜松 | 25 | 争談能位置流格疑過局放常状球職与供役構割費付由説難 |
| 30 | 舞坂 | 25 | 優夫収断違消神番規術備宅害配警育席訪残想念助労例然 |
| 31 | 新居 | 25 | 限追商葉伝働形景落好退負渡失差末守若種美命福望非観 |
| 32 | 白須賀 | 25 | 察段横深申様財港識呼達良阪候程満敗値突路科積他処客 |
| 33 | 二川 | 25 | 否師登易速存飛殺号単座破除完降責捕危給苦迎具辞因愛 |
| 34 | 吉田 | 25 | 富彼未舞亡冷適婦寄込類余妻背熱宿険頼覚途許抜留罪努 |
| 35 | 御油 | 25 | 精散静婚喜浮絶幸押倒等老徒勤遅居雑招欠更刻賛抱犯恐 |
| 36 | 赤坂 | 25 | 息戻願越欲痛互束似列探逃閉緒折暮悲掛到盗吸陽御吹娘 |
| 37 | 藤川 | 25 | 誤慣貧怒祖疲煙怖頂髪才靴恥偶偉幾竹林森池岩谷羽毛皮 |
| 38 | 岡崎 | 25 | 麦油塩玉虫星雲村島県区各皿豆鏡机枝株氷汗湖湯灯灰炭 |
| 39 | 池鯉鮒 | 44 | 党協総領設改府査委軍団革勢減再税営比防補境導副算輸述線農州武象域額欧担準賞辺造被技低復移 |
| 40 | 鳴海 | 44 | 個門課脳極含蔵量型況針専史階管兵接細効丸湾録省旧橋岸周材央券編捜超並療採競介根販歴将幅般 |
| 41 | 宮 | 44 | 貿講装諸劇河航鉄児禁印逆換久短暴輪占植清倍均億圧芸署伸停爆陸波帯延固則乱普測豊厚齢囲卒略 |
| 42 | 桑名 | 44 | 承順練軽了庁城患層版令角絡損募裏仏績築貨混昇血温季永著誌庫刊像香坂底布寺宇巨震希触依籍汚 |
| 43 | 四日市 | 44 | 枚複郵仲栄札板骨傾届巻燃跡包駐弱紹雇替預焼簡章臓律贈照薄群秒奥詰双刺純翌快片敬悩泉漁荒貯 |
| 44 | 石薬師 | 44 | 硬埋柱祭袋筆訓浴童宝封胸砂賢腕兆床緑尊祝柔殿濃紀肩核械棒標樹江泊沖派浜浅涙液涼湿源溶滴潮 |
| 45 | 庄野 | 43 | 激焦煮熟爪牧狂独狭珍班甘畑畳盆盛盤眼看磨祈秘称穴竜符筋策粉粒糖系紅絹綱緊縮罰翼耕肌肝肺 |
| 46 | 亀山 | 43 | 胃脂脚腰舌芝茂荷菜華蒸薦虚衆街衛裁裂製誠誕誘誰謝譲豚貴賃購趣距跳踊軒較載輝辛迫透遇郊郎 |

## 4. Content-file → station map

| File | Items | Stations |
|---|---|---|
| `vocab/n5/vocab-n5-001.json` | 135 | 1–4 (white/yellow) |
| `vocab/n5/vocab-n5-002.json` | 135 | 4–7 (yellow) |
| `vocab/n5/vocab-n5-003.json` | 135 | 6–9 (yellow; 12 verbs at Station 6 and 12 adjectives at 7 by the POS floors) |
| `vocab/n5/vocab-n5-004.json` | 135 | 9–11 (yellow/orange) |
| `vocab/n5/vocab-n5-005.json` | 130 | 11–13 (orange) |
| `vocab/n5/vocab-n5-006.json` | 130 | 13–15 (orange) |
| `vocab/n4/vocab-n4-001.json` | 130 | 16–17 (green) |
| `vocab/n4/vocab-n4-002.json` | 130 | 17–19 (green) |
| `vocab/n4/vocab-n4-003.json` | 130 | 19–21 (green) |
| `vocab/n4/vocab-n4-004.json` | 130 | 21–23 (green) |
| `vocab/n4/vocab-n4-005.json` | 130 | 23–24 (green) |
| `vocab/n3/vocab-n3-001.json` | 142 | 25–26 (blue) |
| `vocab/n3/vocab-n3-002.json` | 142 | 26–27 (blue) |
| `vocab/n3/vocab-n3-003.json` | 142 | 27–28 (blue) |
| `vocab/n3/vocab-n3-004.json` | 141 | 28–29 (blue) |
| `vocab/n3/vocab-n3-005.json` | 142 | 29–30 (blue) |
| `vocab/n3/vocab-n3-006.json` | 141 | 30–32 (blue/purple) |
| `vocab/n3/vocab-n3-007.json` | 142 | 32–33 (purple) |
| `vocab/n3/vocab-n3-008.json` | 142 | 33–34 (purple) |
| `vocab/n3/vocab-n3-009.json` | 142 | 34–35 (purple) |
| `vocab/n3/vocab-n3-010.json` | 141 | 35–36 (purple) |
| `vocab/n3/vocab-n3-011.json` | 142 | 36–37 (purple) |
| `vocab/n3/vocab-n3-012.json` | 141 | 37–38 (purple) |
| `vocab/n2/vocab-n2-001.json` | 142 | 39–39 (brown) |
| `vocab/n2/vocab-n2-002.json` | 142 | 39–40 (brown) |
| `vocab/n2/vocab-n2-003.json` | 142 | 40–41 (brown) |
| `vocab/n2/vocab-n2-004.json` | 141 | 41–41 (brown) |
| `vocab/n2/vocab-n2-005.json` | 142 | 41–42 (brown) |
| `vocab/n2/vocab-n2-006.json` | 142 | 42–43 (brown) |
| `vocab/n2/vocab-n2-007.json` | 141 | 43–43 (brown) |
| `vocab/n2/vocab-n2-008.json` | 141 | 43–44 (brown) |
| `vocab/n2/vocab-n2-009.json` | 142 | 44–45 (brown) |
| `vocab/n2/vocab-n2-010.json` | 142 | 45–45 (brown) |
| `vocab/n2/vocab-n2-011.json` | 142 | 45–46 (brown) |
| `vocab/n2/vocab-n2-012.json` | 141 | 46–46 (brown) |
| `vocab/n1/vocab-n1-001.json` | 150 | 47–47 (black) |
| `vocab/n1/vocab-n1-002.json` | 150 | 47–48 (black) |
| `vocab/n1/vocab-n1-003.json` | 150 | 48–49 (black) |
| `vocab/n1/vocab-n1-004.json` | 150 | 49–49 (black) |
| `vocab/n1/vocab-n1-005.json` | 150 | 49–50 (black) |
| `vocab/n1/vocab-n1-006.json` | 150 | 50–51 (black) |
| `vocab/n1/vocab-n1-007.json` | 150 | 51–51 (black) |
| `vocab/n1/vocab-n1-008.json` | 150 | 51–52 (black) |
| `vocab/n1/vocab-n1-009.json` | 150 | 52–53 (black) |
| `vocab/n1/vocab-n1-010.json` | 150 | 53–53 (black) |
| `kanji/n5/kanji-n5-001.json` | 100 | 4–15 (yellow/orange) |
| `kanji/n4/kanji-n4-001.json` | 100 | 16–20 (green) |
| `kanji/n4/kanji-n4-002.json` | 100 | 20–24 (green) |
| `kanji/n3/kanji-n3-001.json` | 88 | 25–28 (blue) |
| `kanji/n3/kanji-n3-002.json` | 88 | 28–32 (blue/purple) |
| `kanji/n3/kanji-n3-003.json` | 87 | 32–35 (purple) |
| `kanji/n3/kanji-n3-004.json` | 87 | 35–38 (purple) |
| `kanji/n2/kanji-n2-001.json` | 88 | 39–40 (brown) |
| `kanji/n2/kanji-n2-002.json` | 88 | 41–42 (brown) |
| `kanji/n2/kanji-n2-003.json` | 87 | 43–44 (brown) |
| `kanji/n2/kanji-n2-004.json` | 87 | 44–46 (brown) |
| `grammar/n5/grammar-n5-001.json` | 23 | 4–6 (yellow) |
| `grammar/n5/grammar-n5-002.json` | 22 | 7–9 (yellow) |
| `grammar/n5/grammar-n5-003.json` | 23 | 10–12 (orange) |
| `grammar/n5/grammar-n5-004.json` | 22 | 13–15 (orange) |
| `grammar/n4/grammar-n4-001.json` | 30 | 16–18 (green) |
| `grammar/n4/grammar-n4-002.json` | 30 | 19–21 (green) |
| `grammar/n4/grammar-n4-003.json` | 30 | 22–24 (green) |
| `grammar/n3/grammar-n3-001.json` | 32 | 25–28 (blue) |
| `grammar/n3/grammar-n3-002.json` | 24 | 29–31 (blue) |
| `grammar/n3/grammar-n3-003.json` | 32 | 32–35 (purple) |
| `grammar/n3/grammar-n3-004.json` | 22 | 36–38 (purple) |
| `grammar/n2/grammar-n2-001.json` | 34 | 39–41 (brown) |
| `grammar/n2/grammar-n2-002.json` | 33 | 42–44 (brown) |
| `grammar/n2/grammar-n2-003.json` | 23 | 45–46 (brown) |
| `grammar/n1/grammar-n1-001.json` | 30 | 47–49 (black) |
| `grammar/n1/grammar-n1-002.json` | 20 | 50–51 (black) |
| `grammar/n1/grammar-n1-003.json` | 20 | 52–53 (black) |
| `michikusa/michikusa-sNN.json` ×53 | 4 each | NN |
| `stories/<level>/stories-sNN.json` ×53 | 3 (01–31) / 2 (32–53) | NN |
| `_meta/components.json` | ≈ 250 | 2–45 via `componentIds` |

## 5. Assignment algorithm (for `scripts/assign-stations.ts`)

1. Load `docs/content-plan.json`; for each level concatenate the vocab / kanji / grammar files in plan order; items keep file order, except that vocab items carrying `frequencyRank` are sorted by it within the level.
2. Kanji: stable topological sort so every item whose `components` map to another kanji in the same level comes after it (components that are not kanji items are ignored).
2b. Components: for each `ComponentDef` in `_meta/components.json`, find the first station (after step 3) whose kanji use it and place the component at the **preceding** station (`componentIds`); components first used by N5 kanji are spread over Stations 2 and 3 in order of first use. A component is never placed at Station 1.
3. Walk `STATIONS` in road order; for each station pop `quota.vocab` / `quota.kanji` / `quota.grammar` items from the matching level stream (N5 vocab stream also feeds Stations 1–3). If a stream runs short (dedupe), the last station of that level absorbs the deficit; V34 tolerates ±10 %.
   **POS floors** (vocab only; `DEFAULT_POS_FLOORS`, `--no-pos-floors` disables): before filling from the head of the stream, a station first takes the first `min` still-unassigned items whose `pos` is in the floor's set, wherever they sit in the stream — N5 Stations 6–8 ≥ 12 verbs (`v1 v5 v-irr`), Station 7 ≥ 8 `adj-i` and ≥ 6 `adj-na`. Items pulled forward displace the same number of items from the station's natural tail into the next station; the count consumed after each station is unchanged, so the shift ends as soon as a station's natural range covers where the pulled items came from (Station 9 for the current corpus). Floors exist so no grammar point lands on an empty word class (CONTENT_GUIDE §8 i+1): the briefs put every N5 verb and adjective in `vocab-n5-003`, while Station 6 teaches Vます and Station 7 the adjective predicates.
4. Kana: Station 1 ← hiragana basic/dakuten/handakuten (71); Station 2 ← hiragana yōon (33) + katakana basic (46); Station 3 ← remaining katakana (88).
5. Write `station` onto each item; emit `stations/NN.json` bundles (`kanaIds vocabIds kanjiIds grammarIds componentIds storyIds michikusaIds files`, plus `surfaces` = surface/kana/altForm → id for the cumulative allowlist ≤ NN) and the cumulative allowlists consumed by Pass 2 story packets and Pass 3 (`definitionJa`). Michikusa ids are `m-NN-1…4` by construction. The linker step that follows Pass 2 writes `StoryLine.tokenIds` from the V20 match.
