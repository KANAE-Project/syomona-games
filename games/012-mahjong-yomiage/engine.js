/* 麻雀 読み上げ点数計算 ─ 出題・点数計算エンジン（画面に依存しない純粋ロジック）
 * ブラウザでは window.MjEngine、Nodeでは module.exports として使える（test-engine.js参照）。
 *
 * 固定ルール（関東一般・テンパネ考慮なし・符は「最低ライン」で固定）
 *   ピンフ ツモ 20符 / ピンフ ロン 30符 / 七対子 25符
 *   門前ロン（ピンフ以外）40符 / 門前ツモ（ピンフ以外）30符 / 鳴き 30符
 *   満貫以上は符不要、切り上げ満貫あり（30符4翻＝1920→2000）、門前ツモは自動で1翻
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MjEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 役の定義 ----------
  // closed: 門前の翻 / open: 鳴きの翻（null=鳴きでは成立しない） / agari: 'tsumo'|'ron'限定 / w: 出題の重み
  const YAKU = [
    { id: 'riichi',         name: 'リーチ',       speech: 'リーチ',              closed: 1, open: null, w: 3 },
    { id: 'dblriichi',      name: 'ダブルリーチ', speech: 'ダブルリーチ',        closed: 2, open: null, w: 0.6 },
    { id: 'ippatsu',        name: '一発',         speech: 'イッパツ',            closed: 1, open: null, w: 1.5, needs: ['riichi', 'dblriichi'] },
    { id: 'pinfu',          name: 'ピンフ',       speech: 'ピンフ',              closed: 1, open: null, w: 3 },
    { id: 'tanyao',         name: 'タンヤオ',     speech: 'タンヤオ',            closed: 1, open: 1,    w: 3 },
    { id: 'iipeikou',       name: 'イーペーコー', speech: 'イーペーコー',        closed: 1, open: null, w: 1.5 },
    { id: 'haku',           name: '役牌白',       speech: 'ヤクハイ、ハク',      closed: 1, open: 1,    w: 2 },
    { id: 'hatsu',          name: '役牌發',       speech: 'ヤクハイ、ハツ',      closed: 1, open: 1,    w: 2 },
    { id: 'chun',           name: '役牌中',       speech: 'ヤクハイ、チュン',    closed: 1, open: 1,    w: 2 },
    { id: 'bakaze',         name: '場風',         speech: 'ばかぜ',              closed: 1, open: 1,    w: 1.5 },
    { id: 'jikaze',         name: '自風',         speech: 'じかぜ',              closed: 1, open: 1,    w: 1.5 },
    { id: 'haitei',         name: '海底',         speech: 'ハイテイ',            closed: 1, open: 1,    w: 0.7, agari: 'tsumo' },
    { id: 'houtei',         name: '河底',         speech: 'ホウテイ',            closed: 1, open: 1,    w: 0.7, agari: 'ron' },
    { id: 'rinshan',        name: '嶺上開花',     speech: 'リンシャンカイホウ',  closed: 1, open: 1,    w: 0.7, agari: 'tsumo' },
    { id: 'chankan',        name: '槍槓',         speech: 'チャンカン',          closed: 1, open: 1,    w: 0.7, agari: 'ron' },
    { id: 'chiitoi',        name: '七対子',       speech: 'チートイツ',          closed: 2, open: null, w: 1.5 },
    { id: 'toitoi',         name: '対々和',       speech: 'トイトイ',            closed: 2, open: 2,    w: 1.2 },
    { id: 'sanankou',       name: '三暗刻',       speech: 'サンアンコウ',        closed: 2, open: 2,    w: 1 },
    { id: 'sanshokudoukou', name: '三色同刻',     speech: 'サンショクドウコウ',  closed: 2, open: 2,    w: 0.7 },
    { id: 'sankantsu',      name: '三槓子',       speech: 'サンカンツ',          closed: 2, open: 2,    w: 0.5 },
    { id: 'shousangen',     name: '小三元',       speech: 'ショウサンゲン',      closed: 2, open: 2,    w: 0.8 },
    { id: 'honroutou',      name: '混老頭',       speech: 'ホンロウトウ',        closed: 2, open: 2,    w: 0.8 },
    { id: 'chanta',         name: 'チャンタ',     speech: 'チャンタ',            closed: 2, open: 1,    w: 1.2 },
    { id: 'ittsu',          name: '一気通貫',     speech: 'イッキツウカン',      closed: 2, open: 1,    w: 1.2 },
    { id: 'sanshokujun',    name: '三色同順',     speech: 'サンショクドウジュン', closed: 2, open: 1,   w: 1.2 },
    { id: 'junchan',        name: 'ジュンチャン', speech: 'ジュンチャン',        closed: 3, open: 2,    w: 1 },
    { id: 'honitsu',        name: 'ホンイツ',     speech: 'ホンイツ',            closed: 3, open: 2,    w: 1.5 },
    { id: 'ryanpeiko',      name: 'リャンペーコー', speech: 'リャンペーコー',    closed: 3, open: null, w: 0.7 },
    { id: 'chinitsu',       name: 'チンイツ',     speech: 'チンイツ',            closed: 6, open: 5,    w: 1 }
  ];
  const YAKU_BY_ID = {};
  YAKU.forEach(function (y, i) { y.order = i; YAKU_BY_ID[y.id] = y; });

  const YAKUMAN = [
    { id: 'kokushi',        name: '国士無双',   speech: 'コクシムソウ',       closedOnly: true },
    { id: 'suuankou',       name: '四暗刻',     speech: 'スーアンコウ',       closedOnly: true },
    { id: 'daisangen',      name: '大三元',     speech: 'ダイサンゲン' },
    { id: 'tsuuiisou',      name: '字一色',     speech: 'ツーイーソー' },
    { id: 'ryuuiisou',      name: '緑一色',     speech: 'リューイーソー' },
    { id: 'shousuushii',    name: '小四喜',     speech: 'ショウスーシー' },
    { id: 'daisuushii',     name: '大四喜',     speech: 'ダイスーシー' },
    { id: 'chinroutou',     name: '清老頭',     speech: 'チンロウトウ' },
    { id: 'chuuren',        name: '九蓮宝燈',   speech: 'チューレンポートウ', closedOnly: true },
    { id: 'suukantsu',      name: '四槓子',     speech: 'スーカンツ' },
    { id: 'tenhou',         name: '天和',       speech: 'テンホー',           closedOnly: true, dealerOnly: true, tsumoOnly: true },
    { id: 'chihou',         name: '地和',       speech: 'チーホー',           closedOnly: true, nonDealerOnly: true, tsumoOnly: true }
  ];

  // ---------- 役の併用ルール（併用できない組み合わせ。迷うものは併用不可＝出題しない側に倒す） ----------
  const DRAGONS = ['haku', 'hatsu', 'chun'];
  const YAKUHAI = DRAGONS.concat(['bakaze', 'jikaze']);
  const SEQ = ['pinfu', 'iipeikou', 'ryanpeiko', 'ittsu', 'sanshokujun'];
  const TRIP = ['toitoi', 'sanankou', 'sanshokudoukou', 'sankantsu', 'honroutou', 'shousangen'];

  const CONFLICT = new Set();
  function con(a, b) { CONFLICT.add(a + '|' + b); CONFLICT.add(b + '|' + a); }
  function conAll(A, B) { A.forEach(function (a) { B.forEach(function (b) { if (a !== b) con(a, b); }); }); }

  conAll(SEQ, TRIP);
  const SEQ_NO_PINFU = SEQ.filter(function (x) { return x !== 'pinfu'; });
  conAll(SEQ_NO_PINFU, SEQ_NO_PINFU);
  const HONOR_TRIP = YAKUHAI.concat(['shousangen']);
  conAll(HONOR_TRIP, ['tanyao', 'junchan', 'chinitsu', 'chiitoi', 'pinfu', 'ryanpeiko']);
  con('shousangen', 'sanshokudoukou');
  conAll(['tanyao'], ['chanta', 'junchan', 'honroutou', 'honitsu', 'ittsu']);
  conAll(['chanta'], ['junchan', 'honroutou', 'ittsu', 'chinitsu', 'chiitoi'].concat(TRIP));
  conAll(['junchan'], ['honroutou', 'honitsu', 'ittsu', 'chiitoi'].concat(TRIP));
  conAll(['honitsu'], ['chinitsu', 'sanshokujun', 'sanshokudoukou']);
  conAll(['chinitsu'], ['honroutou', 'sanshokujun', 'sanshokudoukou']);
  conAll(['chiitoi'], SEQ.concat(TRIP));
  con('riichi', 'dblriichi');
  conAll(['ippatsu'], ['rinshan', 'chankan', 'sankantsu']);
  conAll(['haitei'], ['rinshan', 'dblriichi']);
  conAll(['houtei'], ['chankan', 'dblriichi']);
  conAll(['rinshan'], ['pinfu', 'ryanpeiko', 'chiitoi', 'dblriichi']);

  function validSet(ids) {
    const has = {};
    ids.forEach(function (id) { has[id] = true; });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (CONFLICT.has(ids[i] + '|' + ids[j])) return false;
      }
    }
    if (has.ippatsu && !has.riichi && !has.dblriichi) return false;
    // 面子数の帳尻：刻子（役牌）の数と、順子・刻子を必要とする役が4面子に収まるか
    let honorTrips = 0, dragons = 0;
    YAKUHAI.forEach(function (id) { if (has[id]) honorTrips++; });
    DRAGONS.forEach(function (id) { if (has[id]) dragons++; });
    if (dragons >= 3) return false;
    if (has.shousangen && dragons !== 2) return false;
    let seqNeed = 0;
    if (has.ryanpeiko) seqNeed = 4;
    else if (has.ittsu || has.sanshokujun) seqNeed = 3;
    else if (has.iipeikou) seqNeed = 2;
    else if (has.chanta || has.junchan) seqNeed = 1;
    if (has.pinfu) seqNeed = 4;
    if (honorTrips > 4 - seqNeed) return false;
    if (has.sanshokudoukou && honorTrips > 1) return false;
    if (honorTrips > 3) return false;
    return true;
  }

  function hanOf(y, menzen) { return menzen ? y.closed : y.open; }

  // ---------- 符・点数 ----------
  function fuFor(o) {
    if (o.chiitoi) return 25;
    if (o.pinfu) return o.tsumo ? 20 : 30;
    if (o.menzen) return o.tsumo ? 30 : 40;
    return 30;
  }

  function ceil100(x) { return Math.ceil(x / 100) * 100; }

  // noKiriage=true：切り上げ満貫を使わない計算（4択の「うっかり」誤答を作る用）
  function calcScore(han, fu, dealer, tsumo, yakumanCount, noKiriage) {
    let base, rank = null, kiriage = false;
    if (yakumanCount > 0) { base = 8000 * yakumanCount; rank = yakumanCount > 1 ? yakumanCount + '倍役満' : '役満'; }
    else if (han >= 13) { base = 8000; rank = '数え役満'; }
    else if (han >= 11) { base = 6000; rank = '三倍満'; }
    else if (han >= 8) { base = 4000; rank = '倍満'; }
    else if (han >= 6) { base = 3000; rank = '跳満'; }
    else if (han >= 5) { base = 2000; rank = '満貫'; }
    else {
      const raw = fu * Math.pow(2, han + 2);
      if (raw >= 2000) { base = 2000; rank = '満貫'; }
      else if (raw === 1920 && !noKiriage) { base = 2000; rank = '満貫'; kiriage = true; } // 30符4翻の切り上げ満貫
      else base = raw;
    }
    const r = { base: base, rank: rank, kiriage: kiriage, dealer: dealer, tsumo: tsumo };
    if (!tsumo) {
      r.rawRon = base * (dealer ? 6 : 4);
      r.ron = ceil100(r.rawRon);
      r.text = String(r.ron);
    } else if (dealer) {
      r.rawAll = base * 2;
      r.all = ceil100(r.rawAll);
      r.text = r.all + 'オール';
    } else {
      r.ko = ceil100(base);
      r.oya = ceil100(base * 2);
      r.text = r.ko + '/' + r.oya;
    }
    return r;
  }

  // ---------- 出題 ----------
  function pickWeighted(list, rng) {
    return list
      .map(function (y) { return { y: y, k: -Math.log(1 - rng()) / (y.w || 1) }; })
      .sort(function (a, b) { return a.k - b.k; })
      .map(function (o) { return o.y; });
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function candidatesFor(ctx) {
    return YAKU.filter(function (y) {
      if (hanOf(y, ctx.menzen) == null) return false;
      if (y.agari && y.agari !== (ctx.tsumo ? 'tsumo' : 'ron')) return false;
      return true;
    });
  }

  function autosFor(y, chosenIds, rng) {
    const add = [];
    if (y.id === 'shousangen') {
      shuffle(DRAGONS, rng).slice(0, 2).forEach(function (id) { add.push(YAKU_BY_ID[id]); });
    }
    if (y.id === 'honroutou' && chosenIds.indexOf('toitoi') < 0) add.push(YAKU_BY_ID.toitoi);
    return add;
  }

  function pickYakuSet(ctx, rng) {
    const r = rng();
    const target = r < 0.4 ? 1 : r < 0.75 ? 2 : r < 0.93 ? 3 : 4;
    const chosen = [];
    const ids = function () { return chosen.map(function (y) { return y.id; }); };
    pickWeighted(candidatesFor(ctx), rng).forEach(function (y) {
      if (chosen.length >= target) return;
      if (ids().indexOf(y.id) >= 0) return;
      const autos = autosFor(y, ids(), rng).filter(function (a) {
        return ids().indexOf(a.id) < 0 && hanOf(a, ctx.menzen) != null;
      });
      const tentative = ids().concat([y.id], autos.map(function (a) { return a.id; }));
      if (!validSet(tentative)) return;
      chosen.push(y);
      autos.forEach(function (a) { chosen.push(a); });
    });
    chosen.sort(function (a, b) { return a.order - b.order; });
    return chosen;
  }

  function weightedInt(rng, weights) {
    const total = weights.reduce(function (a, b) { return a + b; }, 0);
    let x = rng() * total;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
    return weights.length - 1;
  }

  const DORA_SPEECH = ['', 'ドラ', 'ドラドラ', 'ドラサン', 'ドラヨン'];
  const AKA_SPEECH = ['', 'アカ', 'アカアカ', 'アカサン', 'アカヨン'];
  const URA_SPEECH = ['', 'ウラ', 'ウラウラ', 'ウラサン', 'ウラヨン'];
  function multiLabel(ch, n) { return n <= 2 ? new Array(n + 1).join(ch) : ch + n; }
  function doraLabel(n) { return n <= 2 ? new Array(n + 1).join('ドラ') : 'ドラ' + n; }

  function agariWord(tsumo) { return tsumo ? 'ツモ' : 'ロン'; }

  function generateYakuman(rng) {
    const ym = YAKUMAN[Math.floor(rng() * YAKUMAN.length)];
    let dealer = rng() < 0.4;
    let tsumo = rng() < 0.5;
    if (ym.dealerOnly) { dealer = true; tsumo = true; }
    if (ym.nonDealerOnly) { dealer = false; tsumo = true; }
    if (ym.tsumoOnly) tsumo = true;
    const menzen = ym.closedOnly ? true : rng() < 0.5;
    const score = calcScore(0, 0, dealer, tsumo, 1);
    const parts = [], sp = [];
    if (!menzen) { parts.push('鳴き'); sp.push('ナキ'); }
    parts.push(agariWord(tsumo)); sp.push(agariWord(tsumo));
    parts.push(ym.name); sp.push(ym.speech);
    return {
      dealer: dealer, tsumo: tsumo, menzen: menzen,
      yakumanCount: 1, yakuman: ym, yaku: [], dora: { omote: 0, aka: 0, ura: 0 },
      lines: [{ label: ym.name, han: '役満' }],
      han: 0, fu: 0, pinfu: false, chiitoi: false,
      score: score, seat: dealer ? '親' : '子',
      parts: parts, speechParts: sp
    };
  }

  // 満貫以上が出すぎないよう調整（役満の出題率／満貫以上になった時に採用する確率）
  const YAKUMAN_RATE = 0.03;
  const LIMIT_ACCEPT = 0.12;

  function generate(rng) {
    rng = rng || Math.random;
    if (rng() < YAKUMAN_RATE) return generateYakuman(rng);
    for (let attempt = 0; attempt < 200; attempt++) {
      const dealer = rng() < 0.4;
      const tsumo = rng() < 0.5;
      const menzen = rng() < 0.7;
      const ctx = { dealer: dealer, tsumo: tsumo, menzen: menzen };
      const yaku = pickYakuSet(ctx, rng);
      const menzenTsumo = menzen && tsumo;
      if (yaku.length === 0 && !menzenTsumo) continue;

      const ids = yaku.map(function (y) { return y.id; });
      const riichi = ids.indexOf('riichi') >= 0 || ids.indexOf('dblriichi') >= 0;
      const omote = weightedInt(rng, [50, 25, 13, 7, 5]);
      const aka = weightedInt(rng, [70, 20, 7, 3]);
      const ura = riichi ? weightedInt(rng, [60, 25, 10, 5]) : 0;

      const lines = [];
      let han = 0;
      if (menzenTsumo) { lines.push({ label: '門前ツモ', han: 1 }); han += 1; }
      yaku.forEach(function (y) {
        const h = hanOf(y, menzen);
        lines.push({ label: y.name, han: h });
        han += h;
      });
      if (omote) { lines.push({ label: doraLabel(omote), han: omote }); han += omote; }
      if (aka) { lines.push({ label: multiLabel('赤', aka), han: aka }); han += aka; }
      if (ura) { lines.push({ label: multiLabel('裏', ura), han: ura }); han += ura; }
      if (han >= 13) continue;

      const pinfu = ids.indexOf('pinfu') >= 0;
      const chiitoi = ids.indexOf('chiitoi') >= 0;
      const fu = fuFor({ pinfu: pinfu, chiitoi: chiitoi, menzen: menzen, tsumo: tsumo });
      const score = calcScore(han, fu, dealer, tsumo, 0);
      if (score.rank && rng() > LIMIT_ACCEPT) continue; // 満貫以上は間引く

      const parts = [], sp = [];
      if (!menzen) { parts.push('鳴き'); sp.push('ナキ'); }
      // リーチ・ダブルリーチはロン/ツモの前に読む
      yaku.forEach(function (y) { if (y.id === 'riichi' || y.id === 'dblriichi') { parts.push(y.name); sp.push(y.speech); } });
      parts.push(agariWord(tsumo)); sp.push(agariWord(tsumo));
      yaku.forEach(function (y) { if (y.id !== 'riichi' && y.id !== 'dblriichi') { parts.push(y.name); sp.push(y.speech); } });
      if (omote) { parts.push(doraLabel(omote)); sp.push(DORA_SPEECH[omote]); }
      if (aka) { parts.push(multiLabel('赤', aka)); sp.push(AKA_SPEECH[aka]); }
      if (ura) { parts.push(multiLabel('裏', ura)); sp.push(URA_SPEECH[ura]); }

      return {
        dealer: dealer, tsumo: tsumo, menzen: menzen,
        yakumanCount: 0, yakuman: null, yaku: yaku,
        dora: { omote: omote, aka: aka, ura: ura },
        lines: lines, han: han, fu: fu, pinfu: pinfu, chiitoi: chiitoi,
        score: score, seat: dealer ? '親' : '子',
        parts: parts, speechParts: sp
      };
    }
    throw new Error('generate: 出題に失敗しました');
  }

  // 満貫・跳満などの呼び名（なければ空文字）
  function rankLabel(q) {
    const s = q.score;
    if (!s.rank) return '';
    return s.kiriage ? '切り上げ満貫' : s.rank;
  }

  function questionText(q) { return q.parts.join('、') + '　' + q.seat; }
  function questionSpeech(q) { return q.speechParts.join('、') + '、' + (q.dealer ? 'おや' : 'こ'); }

  // ---------- 4択 ----------
  function choicesFor(q, rng) {
    rng = rng || Math.random;
    const correct = q.score.text;
    const tier1 = [], tier2 = [];
    const push = function (list, han, fu, dealer, tsumo, yk) {
      if (!yk && han < 1) return;
      list.push(calcScore(han, fu, dealer, tsumo, yk).text);
    };
    const d = q.dealer, t = q.tsumo;
    if (q.yakumanCount > 0) {
      push(tier1, 0, 0, !d, t, 1);
      push(tier1, 0, 0, d, !t, 1);
      push(tier1, 11, 30, d, t, 0);
      push(tier1, 8, 30, d, t, 0);
      push(tier2, 6, 30, d, t, 0);
      push(tier2, 0, 0, !d, !t, 1);
      push(tier2, 11, 30, !d, t, 0);
    } else {
      const h = q.han, f = q.fu;
      const altTsumoFu = fuFor({ pinfu: q.pinfu, chiitoi: q.chiitoi, menzen: q.menzen, tsumo: !t });
      if (q.score.kiriage) tier1.push(calcScore(h, f, d, t, 0, true).text); // 切り上げ忘れ（7700など）
      push(tier1, h - 1, f, d, t, 0);
      push(tier1, h + 1, f, d, t, 0);
      push(tier1, h, f, !d, t, 0);
      push(tier1, h, altTsumoFu, d, !t, 0);
      [20, 25, 30, 40, 50].forEach(function (alt) { if (alt !== f) push(tier1, h, alt, d, t, 0); });
      push(tier2, h - 2, f, d, t, 0);
      push(tier2, h + 2, f, d, t, 0);
      push(tier2, h + 1, f, !d, t, 0);
      push(tier2, h - 1, f, !d, t, 0);
      push(tier2, h, altTsumoFu, !d, !t, 0);
      push(tier2, h - 1, altTsumoFu, d, !t, 0);
    }
    const seen = {};
    seen[correct] = true;
    const pool = [];
    shuffle(tier1, rng).concat(shuffle(tier2, rng)).forEach(function (txt) {
      if (!seen[txt]) { seen[txt] = true; pool.push(txt); }
    });
    // 万一足りない時は近い翻・符の組み合わせで補充
    let guard = 0;
    while (pool.length < 3 && guard++ < 200) {
      const hh = 1 + Math.floor(rng() * 12);
      const ff = [20, 25, 30, 40, 50][Math.floor(rng() * 5)];
      const txt = calcScore(hh, ff, rng() < 0.5, rng() < 0.5, 0).text;
      if (!seen[txt]) { seen[txt] = true; pool.push(txt); }
    }
    const options = shuffle([correct].concat(pool.slice(0, 3)), rng);
    return { options: options, correctIndex: options.indexOf(correct) };
  }

  // ---------- 答え合わせの解説 ----------
  function fuReason(q) {
    if (q.chiitoi) return '七対子は25符';
    if (q.pinfu) return q.tsumo ? 'ピンフのツモは20符' : 'ピンフのロンは30符';
    if (q.menzen) {
      return q.tsumo
        ? '門前ツモ（ピンフ以外）は最低30符'
        : '門前ロン（ピンフ以外）は最低40符（副底20＋門前加符10＋待ち・雀頭・刻子などの加符を切り上げ）';
    }
    return '鳴きは最低30符';
  }

  // 答え合わせの解説：翻数・符のところまでを文章で、あとは「親/子 × ロン/ツモ」の点数表を返す
  function explain(q) {
    const s = q.score;
    const out = { steps: [], hanLines: q.lines, total: null, table: null };
    let caption;
    if (q.yakumanCount > 0) {
      out.total = '役満';
      out.steps.push('役満（符・翻は不要）');
      caption = '役満の点数';
    } else {
      out.total = q.han + '翻';
      out.steps.push('翻数：' + q.lines.map(function (l) { return l.label + '（' + l.han + '翻）'; }).join(' ＋ ') + ' ＝ ' + q.han + '翻');
      if (s.rank && q.han >= 5) {
        out.steps.push(s.rank + '（符は不要）');
        caption = s.rank + 'の点数';
      } else {
        out.steps.push('符：' + q.fu + '符（' + fuReason(q) + '）');
        caption = q.fu + '符' + q.han + '翻の点数';
        if (s.kiriage) { out.steps.push(q.fu + '符' + q.han + '翻は切り上げ満貫（基本点1920→2000）'); caption = q.fu + '符' + q.han + '翻（切り上げ満貫）の点数'; }
        else if (s.rank) { out.steps.push(q.fu + '符' + q.han + '翻は基本点が2000を超えるので満貫'); caption = q.fu + '符' + q.han + '翻（満貫）の点数'; }
      }
    }
    const ym = q.yakumanCount;
    const at = function (dealer, tsumo) { return q.yakumanCount > 0 ? calcScore(0, 0, dealer, tsumo, ym).text : calcScore(q.han, q.fu, dealer, tsumo, 0).text; };
    out.table = {
      caption: caption,
      rows: [
        { who: '親', ron: at(true, false), tsumo: at(true, true) },
        { who: '子', ron: at(false, false), tsumo: at(false, true) }
      ],
      active: { who: q.dealer ? '親' : '子', kind: q.tsumo ? 'tsumo' : 'ron' }
    };
    return out;
  }

  const TITLES = [
    { min: 10, name: '点数計算の神' },
    { min: 9,  name: '雀荘のマスター' },
    { min: 8,  name: '卓のご意見番' },
    { min: 6,  name: 'そこそこ打てる人' },
    { min: 4,  name: '点数は後で数えるタイプ' },
    { min: 2,  name: '親のツモ、いくらだっけ？' },
    { min: 0,  name: 'まずは牌を触ろう' }
  ];
  function titleFor(score) {
    for (let i = 0; i < TITLES.length; i++) if (score >= TITLES[i].min) return TITLES[i].name;
    return TITLES[TITLES.length - 1].name;
  }

  return {
    YAKU: YAKU, YAKUMAN: YAKUMAN, CONFLICT: CONFLICT,
    validSet: validSet, fuFor: fuFor, calcScore: calcScore,
    generate: generate, choicesFor: choicesFor, explain: explain,
    rankLabel: rankLabel, questionText: questionText, questionSpeech: questionSpeech, titleFor: titleFor
  };
});
