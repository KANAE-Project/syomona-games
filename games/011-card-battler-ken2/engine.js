/* カードバトラー★ケン2 ゲームエンジン（画面なし・ブラウザ/Node両対応）
 * カードID: 0〜20 = キャラ(0..2)*7 + 段階k(0素,1-3光,4-6闇)、21 = 涅槃（ワイルド1枚）
 * 手札は「IDごとの枚数配列(長さ21)」＋ワイルド枚数w で持つ */
(function (root) {
  'use strict';

  var ULTRA = 21;
  var CHARS = [
    { key: 'reddragon', name: 'レッドドラゴン' },
    { key: 'metalknight', name: 'メタルナイト' },
    { key: 'waterslime', name: 'ウォータースライム' }
  ];
  var TIER_KEYS = ['base', 'light1', 'light2', 'light3', 'dark1', 'dark2', 'dark3'];
  var TIER_NAMES = ['素', '光1', '光2', '光3', '闇1', '闇2', '闇3'];
  var CLASS_OF = [1, 2, 3, 4, 2, 3, 4];
  var COPIES = 3;
  var HAND_SIZE = 9;
  var STEAL_COST = 3;

  function kOf(id) { return id % 7; }
  function charOf(id) { return id === ULTRA ? -1 : Math.floor(id / 7); }
  function isDark(id) { return id !== ULTRA && kOf(id) >= 4; }
  function isLight(id) { var k = kOf(id); return id !== ULTRA && k >= 1 && k <= 3; }
  function classOf(id) { return id === ULTRA ? 5 : CLASS_OF[kOf(id)]; }

  // ---- 3枚組テンプレート（階段 / 3きょうだい） ----
  var TEMPLATES = (function () {
    var list = [], seen = {};
    function add(cards, kind) {
      var key = cards.join(',');
      if (seen[key]) return;
      seen[key] = 1;
      list.push({ cards: cards, kind: kind });
    }
    var c, b;
    for (c = 0; c < 3; c++) {
      b = c * 7;
      add([b, b + 1, b + 2], 'stair');
      add([b + 1, b + 2, b + 3], 'stair');
      add([b, b + 4, b + 5], 'stair');
      add([b + 4, b + 5, b + 6], 'stair');
    }
    add([0, 7, 14], 'kyodai');
    for (var cl = 2; cl <= 4; cl++) {
      add([0, 1, 2].map(function (ch) { return ch * 7 + (cl - 1); }), 'kyodai');
      add([0, 1, 2].map(function (ch) { return ch * 7 + (cl + 2); }), 'kyodai');
    }
    return list;
  })();

  // ---- 役 ----
  var YAKU = {
    nehan: { name: '涅槃入り', bonus: 3 },
    stair3: { name: '階段×3', bonus: 3 },
    lightish: { name: '光系', bonus: 3 },
    kyodai3: { name: '3きょうだい×3', bonus: 6 },
    darkish: { name: '闇系', bonus: 6 },
    lightAll: { name: '光一色', bonus: 10 },
    charAll: { name: '同キャラ一色', bonus: 10 },
    darkAll: { name: '闇一色', bonus: 12 },
    classAll: { name: '同クラス一色', bonus: 15 }
  };

  // ---- 乱数 ----
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---- 上がり判定・余り札 ----
  // 手札(counts, w)から「3枚組を最大3つ作る」最良の組み方を探す。
  // 返り値: { m: 使えた枚数(9なら上がり), left: 余りcounts, wLeft: 余りワイルド }
  // 同じ枚数なら余りダークが多い組み方を優先する。
  function bestCover(counts, w) {
    var c = counts.slice();
    var best = { m: -1, dl: -1 };
    var done = false;
    var path = [];
    function darkLeft() {
      var n = 0;
      for (var i = 0; i < 21; i++) if (isDark(i)) n += c[i];
      return n;
    }
    function record(m, wl) {
      var dl = darkLeft();
      if (m > best.m || (m === best.m && dl > best.dl)) {
        best = { m: m, dl: dl, left: c.slice(), wLeft: wl,
          groups: path.map(function (g) { return { tpl: g.tpl, got: g.got.slice(), wild: g.wild }; }) };
      }
    }
    function rec(depth, start, m, wl) {
      record(m, wl);
      if (m === 9) { done = true; return; }
      if (depth === 3) return;
      for (var i = start; i < TEMPLATES.length && !done; i++) {
        var t = TEMPLATES[i].cards, taken = [], w2 = wl, m2 = m;
        for (var j = 0; j < 3; j++) {
          var x = t[j];
          if (c[x] > 0) { c[x]--; taken.push(x); m2++; }
          else if (w2 > 0) { w2--; m2++; }
        }
        if (m2 > m) { path.push({ tpl: i, got: taken.slice(), wild: wl - w2 }); rec(depth + 1, i, m2, w2); path.pop(); }
        for (var k = 0; k < taken.length; k++) c[taken[k]]++;
      }
    }
    rec(0, 0, 0, w);
    return best;
  }

  // 手札の見せ方: 2枚以上つながっている組(テンプレ順に並べ、涅槃は入る位置に置く)と、余りの札
  function layoutHand(counts, w) {
    var cv = bestCover(counts, w), groups = [], singles = [], i;
    (cv.groups || []).forEach(function (g) {
      var pool = g.got.slice(), wild = g.wild, cards = [];
      TEMPLATES[g.tpl].cards.forEach(function (x) {
        var k = pool.indexOf(x);
        if (k >= 0) { pool.splice(k, 1); cards.push(x); }
        else if (wild > 0) { wild--; cards.push(ULTRA); }
      });
      if (cards.length >= 2) groups.push({ cards: cards, full: cards.length === 3, kind: TEMPLATES[g.tpl].kind });
      else cards.forEach(function (x) { singles.push(x); });
    });
    groups.sort(function (a, b) { return (b.full ? 1 : 0) - (a.full ? 1 : 0); });
    var rest = [];
    for (i = 0; i < 21; i++) for (var n = 0; n < cv.left[i]; n++) rest.push(i);
    for (i = 0; i < cv.wLeft; i++) rest.push(ULTRA);
    return { groups: groups, singles: singles.concat(rest), matched: cv.m, left: cv.left, wLeft: cv.wLeft };
  }

  function total(counts, w) {
    var n = w;
    for (var i = 0; i < 21; i++) n += counts[i];
    return n;
  }

  // 10枚（手札9＋引いた1）から9枚が3組に分かれるか
  function isWinning(counts, w) { return bestCover(counts, w).m === 9; }

  // 上がりに使わない余りダーク札の枚数
  function spareDark(counts, w) {
    var cv = bestCover(counts, w), n = 0;
    for (var i = 0; i < 21; i++) if (isDark(i)) n += cv.left[i];
    return n;
  }

  // ---- 得点（基本点＋役） ----
  // 上がれる組み方をすべて試して、合計点が最大のものを採用。涅槃で埋めた枠は5点として数える
  function scoreWin(counts, w) {
    var best = null, n = TEMPLATES.length;
    for (var a = 0; a < n; a++) for (var b = a; b < n; b++) for (var d = b; d < n; d++) {
      var idx = [a, b, d], need = {}, i, j;
      for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) {
        var x = TEMPLATES[idx[i]].cards[j];
        need[x] = (need[x] || 0) + 1;
      }
      var miss = 0, base = 0, cards = [];
      for (var key in need) {
        var id = +key, lack = Math.max(0, need[id] - counts[id]);
        miss += lack;
        base += (need[id] - lack) * CLASS_OF[kOf(id)];
        for (var q = 0; q < need[id]; q++) cards.push(id);
      }
      if (miss > w) continue;
      base += miss * 5;
      var kinds = idx.map(function (t) { return TEMPLATES[t].kind; });
      var chars = {}, cls = {}, hasL = false, hasD = false, allL = true, allD = true;
      cards.forEach(function (id) {
        chars[charOf(id)] = 1; cls[classOf(id)] = 1;
        if (isLight(id)) hasL = true; else allL = false;
        if (isDark(id)) hasD = true; else allD = false;
      });
      var ys = [];
      if (Object.keys(chars).length === 1) ys.push('charAll');
      if (allL) ys.push('lightAll');
      if (allD) ys.push('darkAll');
      if (!hasD && !allL) ys.push('lightish');
      if (!hasL && !allD) ys.push('darkish');
      if (Object.keys(cls).length === 1) ys.push('classAll');
      if (kinds.every(function (k) { return k === 'kyodai'; })) ys.push('kyodai3');
      if (kinds.every(function (k) { return k === 'stair'; })) ys.push('stair3');
      if (miss > 0) ys.push('nehan');
      var bonus = ys.reduce(function (s, y) { return s + YAKU[y].bonus; }, 0);
      var res = { base: base, bonus: bonus, total: base + bonus, yaku: ys.map(function (y) { return { id: y, name: YAKU[y].name, bonus: YAKU[y].bonus }; }) };
      if (!best || res.total > best.total) best = res;
    }
    return best;
  }

  // ---- 引き分けバトル: 1=aの勝ち, -1=bの勝ち, 0=引き直し ----
  function battleCompare(a, b) {
    var aBase = a !== ULTRA && kOf(a) === 0, bBase = b !== ULTRA && kOf(b) === 0;
    if (aBase && b === ULTRA) return 1;
    if (bBase && a === ULTRA) return -1;
    var ca = classOf(a), cb = classOf(b);
    return ca > cb ? 1 : ca < cb ? -1 : 0;
  }

  // ---- 局 ----
  function createRound(opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var deck = [];
    for (var id = 0; id < 21; id++) for (var n = 0; n < COPIES; n++) deck.push(id);
    deck.push(ULTRA);
    shuffle(deck, rng);
    function newPlayer() {
      var h = []; for (var i = 0; i < 21; i++) h.push(0);
      return { h: h, w: 0, disc: [], debt: 0, spent: [], steals: 0 };
    }
    var r = { rng: rng, deck: deck, p: [newPlayer(), newPlayer()], turn: opts.first || 0,
      lastDiscard: null, turnCount: 0, over: false };
    for (var pi = 0; pi < 2; pi++) for (var k = 0; k < HAND_SIZE; k++) takeCard(r.p[pi], deck.pop());
    return r;
  }
  function takeCard(p, id) { if (id === ULTRA) p.w++; else p.h[id]++; }
  function removeCard(p, id) { if (id === ULTRA) p.w--; else p.h[id]--; }
  function hasCard(p, id) { return id === ULTRA ? p.w > 0 : p.h[id] > 0; }

  // 手番の頭に山から引く（相手に奪われていれば多めに）。山札が空なら引けない。
  function drawFor(r, pi) {
    var p = r.p[pi], need = 1 + p.debt, got = [];
    p.debt = 0;
    while (need-- > 0 && r.deck.length) { var id = r.deck.pop(); takeCard(p, id); got.push(id); }
    r.turnCount++;
    return got;
  }
  function canTsumo(r, pi) { var p = r.p[pi]; return isWinning(p.h, p.w); }

  // 捨てる。相手がこの札でロンできるか(true/false)を返す
  function discard(r, pi, id) {
    var p = r.p[pi];
    removeCard(p, id);
    p.disc.push(id);
    r.lastDiscard = { p: pi, id: id };
    return canRon(r, 1 - pi, id);
  }
  function canRon(r, pi, id) {
    var p = r.p[pi], h = p.h.slice(), w = p.w;
    if (id === ULTRA) w++; else h[id]++;
    return isWinning(h, w);
  }
  // ロン（討伐）: 捨てられた札を取り込んで上がり形を返す
  function takeForRon(r, pi) {
    var ld = r.lastDiscard, p = r.p[pi], from = r.p[ld.p];
    from.disc.pop();
    takeCard(p, ld.id);
    return scoreWin(p.h, p.w);
  }

  // ---- ダーク略奪 ----
  function canSteal(r, pi) { var p = r.p[pi]; return spareDark(p.h, p.w) >= STEAL_COST; }
  // 選べる相手の捨て札（種類ごと）。空なら相手の手札からランダム
  function stealChoices(r, pi) {
    var seen = {}, list = [];
    r.p[1 - pi].disc.forEach(function (id) { if (!seen[id]) { seen[id] = 1; list.push(id); } });
    return list;
  }
  // choice: 捨て札から取る札ID / null=相手の手札からランダム
  function steal(r, pi, choice) {
    var me = r.p[pi], opp = r.p[1 - pi];
    if (!canSteal(r, pi)) throw new Error('steal not allowed');
    var cv = bestCover(me.h, me.w), left = cv.left.slice(), n = STEAL_COST, spent = [], i;
    for (i = 0; i < 21 && n > 0; i++) if (isDark(i)) while (n > 0 && left[i] > 0) { left[i]--; me.h[i]--; spent.push(i); n--; }
    me.spent = me.spent.concat(spent);
    var result = { spent: spent, from: null, card: null };
    if (choice !== null && choice !== undefined && opp.disc.indexOf(choice) >= 0) {
      opp.disc.splice(opp.disc.lastIndexOf(choice), 1);
      takeCard(me, choice);
      result.from = 'discard'; result.card = choice;
      me.debt += 2;
    } else {
      var pool = [];
      for (i = 0; i < 21; i++) for (var q = 0; q < opp.h[i]; q++) pool.push(i);
      if (!pool.length) throw new Error('no card to steal');
      var pick = pool[Math.floor(r.rng() * pool.length)];
      opp.h[pick]--; takeCard(me, pick);
      opp.debt += 1; me.debt += 2;
      result.from = 'hand'; result.card = pick;
    }
    me.steals++;
    // 自分は山から2枚補充
    result.drew = [];
    while (me.debt > 0 && r.deck.length) { var d = r.deck.pop(); takeCard(me, d); result.drew.push(d); me.debt--; }
    me.debt = 0;
    return result;
  }

  // ---- CPU ----
  function gain(p, id) {
    var h = p.h.slice(), w = p.w;
    if (id === ULTRA) w++; else h[id]++;
    return bestCover(h, w).m;
  }
  function cpuStealChoice(r, pi) {
    var list = stealChoices(r, pi);
    if (!list.length) return null;
    var me = r.p[pi], bestId = null, bestG = -1;
    list.forEach(function (id) {
      var g = gain(me, id) + r.rng() * 0.01;
      if (g > bestG) { bestG = g; bestId = id; }
    });
    return bestId;
  }
  function cpuDiscardChoice(r, pi, careful) {
    var p = r.p[pi], cv = bestCover(p.h, p.w), cands = [], i;
    for (i = 0; i < 21; i++) if (cv.left[i] > 0) cands.push(i);
    if (!cands.length) return cv.wLeft > 0 ? ULTRA : null;
    if (careful) {
      var safe = cands.filter(function (id) { return !canRon(r, 1 - pi, id); });
      if (safe.length) cands = safe;
    }
    return cands[Math.floor(r.rng() * cands.length)];
  }
  // CPUの1手番。戻り値: {type:'tsumo'|'ron-target'|'continue'|'empty', ...}
  function cpuTurn(r, pi, opts) {
    opts = opts || {};
    var got = drawFor(r, pi), events = [];
    if (!got.length && !r.deck.length && total(r.p[pi].h, r.p[pi].w) <= HAND_SIZE) return { type: 'empty' };
    if (canTsumo(r, pi)) return { type: 'tsumo', score: scoreWin(r.p[pi].h, r.p[pi].w) };
    var stealOn = Array.isArray(opts.steal) ? opts.steal[pi] : opts.steal !== false;
    if (stealOn && canSteal(r, pi)) {
      var res = steal(r, pi, cpuStealChoice(r, pi));
      events.push({ type: 'steal', result: res });
      if (canTsumo(r, pi)) return { type: 'tsumo', score: scoreWin(r.p[pi].h, r.p[pi].w), events: events };
    }
    var id = cpuDiscardChoice(r, pi, opts.careful);
    var ron = discard(r, pi, id);
    return { type: 'discard', card: id, ronPossible: ron, events: events };
  }

  // CPU同士で1局を最後まで（テスト用）。ロンは両者自動で宣言
  function playRoundCpu(r, opts) {
    opts = opts || {};
    var pi = r.turn;
    while (true) {
      if (!r.deck.length) return { winner: null, turns: r.turnCount };
      var res = cpuTurn(r, pi, opts);
      if (res.type === 'empty') return { winner: null, turns: r.turnCount };
      if (res.type === 'tsumo') return { winner: pi, how: 'tsumo', score: res.score, turns: r.turnCount };
      if (res.ronPossible) {
        var score = takeForRon(r, 1 - pi);
        return { winner: 1 - pi, how: 'ron', score: score, turns: r.turnCount };
      }
      pi = 1 - pi;
    }
  }

  var api = {
    ULTRA: ULTRA, CHARS: CHARS, TIER_KEYS: TIER_KEYS, TIER_NAMES: TIER_NAMES, CLASS_OF: CLASS_OF,
    HAND_SIZE: HAND_SIZE, STEAL_COST: STEAL_COST, TEMPLATES: TEMPLATES, YAKU: YAKU,
    kOf: kOf, charOf: charOf, isDark: isDark, isLight: isLight, classOf: classOf,
    mulberry32: mulberry32, shuffle: shuffle,
    bestCover: bestCover, layoutHand: layoutHand, isWinning: isWinning, spareDark: spareDark, scoreWin: scoreWin,
    battleCompare: battleCompare,
    createRound: createRound, drawFor: drawFor, canTsumo: canTsumo, discard: discard, canRon: canRon,
    takeForRon: takeForRon, canSteal: canSteal, stealChoices: stealChoices, steal: steal,
    cpuTurn: cpuTurn, playRoundCpu: playRoundCpu, hasCard: hasCard, total: total
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KenEngine = api;
})(typeof window !== 'undefined' ? window : this);
