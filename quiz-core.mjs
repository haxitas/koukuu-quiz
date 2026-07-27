// quiz-core.mjs — 採点と成績記録の純粋関数(ブラウザ/テスト共用・副作用なし)。
//
// データ規約(実物サンプル R8-02 準拠):
//  - answer / blanks[].answer は options への 1始まり index。
//  - 問題型: 'single'(単一選択) / 'truefalse_list' / 'fill_blanks'(複合=blanks配列)。
//  - 複合型は「全ブランク一致」で正解、1つでも外れれば不正解。
//
// 応答(response)の形:
//  - single: 選んだ選択肢の 1始まり index(未回答は null)。
//  - 複合型: { ラベル: 1始まりindex } のオブジェクト(未回答ラベルは欠落)。
//
// 成績(store)の形: { attempts: Attempt[] } … append-only。既存要素は決して書き換えない。

export function isComposite(q) {
  return q.type === 'truefalse_list' || q.type === 'fill_blanks';
}

// 1問の正誤を返す(boolean)。
export function gradeQuestion(q, response) {
  if (isComposite(q)) {
    if (!response || typeof response !== 'object') return false;
    return q.blanks.every((b) => response[b.label] === b.answer);
  }
  // single: 1始まり index の一致。未回答(null/undefined)は不正解。
  return response === q.answer;
}

// 試験1回分を採点。responses は { questionId: response } のオブジェクト。
// wrong は誤答問題の id の配列(出題順)。id 基準なので、後でデータの問題順が
// 変わっても「前回どの問題を間違えたか」を正しく突き合わせられる。
export function gradeExam(questions, responses) {
  const src = responses || {};
  let score = 0;
  const wrong = [];
  for (const q of questions) {
    if (gradeQuestion(q, src[q.id])) score += 1;
    else wrong.push(q.id);
  }
  return { score, total: questions.length, wrong };
}

// 採点結果を localStorage 追記用の1レコードへ整形。
// presented はその回に出題した問題idの一覧(通常回=科目の全問、復習回=出題した誤答のみ)。
// これを記録しておくことで、誤答バンク(currentMistakes)を可変ストア無しに導出できる。
export function makeAttempt(key, date, examResult, presented) {
  return {
    key,
    date,
    score: examResult.score,
    total: examResult.total,
    wrong: examResult.wrong,
    presented: presented || [],
  };
}

// append-only: 既存 attempts を変更せず、新配列に1件足したストアを返す。
export function appendResult(store, attempt) {
  const prev = store && Array.isArray(store.attempts) ? store.attempts : [];
  return { attempts: [...prev, attempt] };
}

// 指定キー(例 "R8-02-無線工学")の統計。rate = score/total。
// last=最新回の正答率, best=最高正答率, count=挑戦回数。記録なしは {count:0,last:null,best:null}。
export function statsForKey(store, key) {
  const all = store && Array.isArray(store.attempts) ? store.attempts : [];
  const hits = all.filter((a) => a.key === key);
  if (hits.length === 0) return { count: 0, last: null, best: null };
  const rate = (a) => (a.total > 0 ? a.score / a.total : 0);
  const last = rate(hits[hits.length - 1]);
  const best = Math.max(...hits.map(rate));
  return { count: hits.length, last, best };
}

// 誤答バンク(「過去に間違えた問題集」の実体)を attempts から都度導出する。可変ストアを持たない。
// id は元々 {examCode}-{subject}-{no} でグローバルに一意なので、key での絞り込みはしない
// (科目・期をまたいで attempts 全体を横断走査してよい)。
// 判定規則: あるidについて、直近の出題(presentedに含まれた回)時に誤答だったら
// 「現在の誤答」とみなす。正解すれば次回は含まれず自然に消え、誤答すれば残り続ける。
// 一度も再提示されていない誤答は未解決のまま残る。attempts の並び順(=append-only なので
// 挿入順=時系列)をそのまま Map の「後勝ち」に使う。
// presented を持たない旧形式の記録は判定不能として無視する(安全側に倒す)。
export function currentMistakes(store) {
  const all = store && Array.isArray(store.attempts) ? store.attempts : [];
  const lastWrong = new Map(); // id -> boolean(直近の出題で誤答だったか)
  for (const a of all) {
    if (!Array.isArray(a.presented)) continue; // 旧形式は判定できないためスキップ
    const wrongSet = new Set(a.wrong || []);
    for (const id of a.presented) {
      lastWrong.set(id, wrongSet.has(id));
    }
  }
  const result = [];
  for (const [id, isWrong] of lastWrong) {
    if (isWrong) result.push(id);
  }
  return result;
}

// 復習回の出題リストを作る。questions の元の並び順を保ったまま、
// mistakeIds に含まれるものだけを最大 max 件まで返す(既定10件)。
export function pickReviewQuestions(questions, mistakeIds, max = 10) {
  const set = new Set(mistakeIds);
  const picked = questions.filter((q) => set.has(q.id));
  return picked.slice(0, max);
}

// 各問題を通算で何回間違えたかを attempts から集計する({ id: 回数 })。
// 誤答バンク(currentMistakes)が「今まちがえた状態か」を見るのに対し、こちらは履歴の累計。
// 記録は append-only なので、この関数は既存の attempts を読むだけで新しい保存項目を要らない。
export function mistakeCounts(store) {
  const all = store && Array.isArray(store.attempts) ? store.attempts : [];
  const counts = {};
  for (const a of all) {
    for (const id of (a.wrong || [])) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

// questions から最大 max 問をランダムに選ぶ。選ぶ対象はランダムだが、
// 並びは元の順序(期・問番号順)を保つ。rng はテストから差し替えられるようにしてある。
export function pickRandomQuestions(questions, max, rng = Math.random) {
  if (!Array.isArray(questions) || questions.length === 0 || !(max > 0)) return [];
  if (questions.length <= max) return [...questions];
  const idx = questions.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { // Fisher-Yates
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, max).sort((a, b) => a - b).map((i) => questions[i]);
}

// 検索結果から出題するときに選べる問題数を返す。全件は常に末尾に入り、重複はしない。
// 例: 3件→[3] / 7件→[5,7] / 10件→[5,10] / 15件→[5,10,15]。
export function quizSizeOptions(total, steps = [5, 10]) {
  if (!(total > 0)) return [];
  return [...steps.filter((n) => n < total), total];
}

// ---- 学習の進みぐあい(未挑戦の把握) ----

// 一度でも出題された問題の id 集合。presented を持たない旧形式の記録は無視する。
export function attemptedIds(store) {
  const all = store && Array.isArray(store.attempts) ? store.attempts : [];
  const seen = new Set();
  for (const a of all) {
    if (!Array.isArray(a.presented)) continue;
    for (const id of a.presented) seen.add(id);
  }
  return seen;
}

// まだ一度も出題されていない問題を、元の並び順のまま返す。
export function unattemptedQuestions(questions, store) {
  const done = attemptedIds(store);
  return questions.filter((q) => !done.has(q.id));
}

// 全体と科目別の「何問中何問に手をつけたか」。bySubject は questions に現れた順。
export function progressSummary(questions, store) {
  const done = attemptedIds(store);
  const bySubject = new Map();
  let attempted = 0;
  for (const q of questions) {
    const hit = done.has(q.id);
    if (hit) attempted += 1;
    if (!bySubject.has(q.subject)) bySubject.set(q.subject, { subject: q.subject, total: 0, attempted: 0 });
    const s = bySubject.get(q.subject);
    s.total += 1;
    if (hit) s.attempted += 1;
  }
  for (const s of bySubject.values()) s.unattempted = s.total - s.attempted;
  return {
    total: questions.length,
    attempted,
    unattempted: questions.length - attempted,
    bySubject: [...bySubject.values()],
  };
}

// 通算誤答回数の多い順に並べる(min回以上のみ)。同数なら questions の元の並びを保つ。
export function mistakeRanking(questions, store, min = 1) {
  const counts = mistakeCounts(store);
  const rows = [];
  questions.forEach((question, i) => {
    const count = counts[question.id] || 0;
    if (count >= min) rows.push({ question, count, i });
  });
  rows.sort((a, b) => b.count - a.count || a.i - b.i);
  return rows.map(({ question, count }) => ({ question, count }));
}

// ---- 配点と合格判定(公式の「合格基準及び正答」PDFに準拠) ----
//  法規    : 満点100点・合格70点。A問題1問5点、B問題1問5点(小設問各1点)。
//  無線工学: 満点 70点・合格49点。A問題1問5点、B問題1問5点(小設問各1点)。
//  英語    : 筆記70点(A-1〜A-5各4点/A-6〜A-9各5点/B問題1問10点(小設問各2点))。
//  英会話  : 35点(1問5点)。
//  英語と英会話は合わせて105点満点・合格60点。ただし英会話が15点未満なら不合格。
// B問題は小設問ごとに点が入る(全問一致を要求する gradeQuestion とは別物なので分けてある)。
export const PASS_CRITERIA = {
  '法規': { total: 100, pass: 70 },
  '無線工学': { total: 70, pass: 49 },
  '英語': { total: 70, partner: '英会話', combinedTotal: 105, combinedPass: 60 },
  '英会話': { total: 35, partner: '英語', combinedTotal: 105, combinedPass: 60, min: 15 },
};

// 英会話の足切り(この点数に満たないと合計点に関わらず不合格)。
const EIKAIWA_MIN = 15;

// その問題の満点。
export function questionPoints(q) {
  const isB = String(q.no || '').startsWith('B');
  const blanks = Array.isArray(q.blanks) ? q.blanks.length : 0;
  const num = parseInt(String(q.no || '').replace(/[^0-9]/g, ''), 10);
  switch (q.subject) {
    case '法規':
    case '無線工学':
      return isB ? blanks * 1 : 5;
    case '英語':
      if (isB) return blanks * 2;
      return num <= 5 ? 4 : 5; // 問1(A-1〜A-5)は各4点、問2(A-6〜A-9)は各5点
    case '英会話':
      return 5;
    default:
      return 0;
  }
}

// その問題で実際に取れた点。B問題は正解した小設問の分だけ部分点が入る。
export function earnedPoints(q, response) {
  const max = questionPoints(q);
  if (isComposite(q)) {
    const n = Array.isArray(q.blanks) ? q.blanks.length : 0;
    if (n === 0) return 0;
    const per = max / n;
    const r = (response && typeof response === 'object') ? response : {};
    const hit = q.blanks.filter((b) => r[b.label] === b.answer).length;
    return hit * per;
  }
  return response === q.answer ? max : 0;
}

// 出題分の得点合計(問題数ではなく配点ベース)。
export function scoreExam(questions, responses) {
  const src = responses || {};
  let earned = 0;
  let total = 0;
  for (const q of questions) {
    earned += earnedPoints(q, src[q.id]);
    total += questionPoints(q);
  }
  return { earned, total };
}

// 科目の合格判定。法規・無線工学は単独で判定でき、英語と英会話は
// 相方の点が要るため「あと何点必要か」を返す(needFromPartner)。
export function passJudgement(subject, earned) {
  const c = PASS_CRITERIA[subject];
  if (!c) return null;
  if (c.pass != null) {
    return { kind: 'standalone', subject, total: c.total, pass: c.pass, earned, passed: earned >= c.pass };
  }
  const partnerMax = c.combinedTotal - c.total;
  // 英会話が足切りに届いていない場合は、筆記が満点でも不合格が確定する。
  if (c.min != null && earned < c.min) {
    return { kind: 'combined', subject, total: c.total, earned, partner: c.partner, partnerMax, disqualified: true, min: c.min };
  }
  // 英語(筆記)を採点したときは、相方の英会話に足切り15点があるぶん必要点が下がりきらない。
  const raw = c.combinedPass - earned;
  const need = Math.max(raw, c.partner === '英会話' ? EIKAIWA_MIN : 0, 0);
  return {
    kind: 'combined', subject, total: c.total, earned, partner: c.partner, partnerMax,
    combinedPass: c.combinedPass, combinedTotal: c.combinedTotal,
    needFromPartner: need, impossible: need > partnerMax,
  };
}

// gradeExam の結果(examResult)を questions の並びに沿ってキーごとに束ね直し、
// キー1つにつき Attempt を1件作る(= grade() が保存すべきレコード列)。
// 全期間横断の復習セッションは科目・期をまたぎ得るため、1回の採点でも
// statsForKey を汚さないよう、キーごとに別々のAttemptとしてappendする必要がある。
// keyOf(q) が全問題で同じ値を返すとき(=通常回)は要素数1になり、
// makeAttempt(key, date, examResult, questions.map(q=>q.id)) を直接呼んだ場合と
// 完全に同じ Attempt になる(退化ケース)。examResult はここでは採点し直さない(純関数)。
export function splitAttemptsByKey(questions, examResult, date, keyOf) {
  const wrongSet = new Set(examResult.wrong);
  const groups = new Map(); // key -> { presented: string[], wrong: string[] }
  for (const q of questions) {
    const k = keyOf(q);
    if (!groups.has(k)) groups.set(k, { presented: [], wrong: [] });
    const g = groups.get(k);
    g.presented.push(q.id);
    if (wrongSet.has(q.id)) g.wrong.push(q.id);
  }
  const attempts = [];
  for (const [key, g] of groups) {
    const total = g.presented.length;
    const score = total - g.wrong.length;
    attempts.push(makeAttempt(key, date, { score, total, wrong: g.wrong }, g.presented));
  }
  return attempts;
}

// ---- 検索(全問題を対象にした文言検索) ----

// 全角英数字を半角に、大文字を小文字に正規化する(IME入力ゆれの吸収)。
// 1文字→1文字の変換のみ行う(snippetForがnormalize後のindexをrawへそのまま流用するため、
// 文字数がずれる変換は入れてはいけない)。
export function normalizeSearchText(s) {
  return String(s)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

// 検索対象フィールド(優先順)。本文(text)を最優先にする: instructionは定型的な前置き、
// passageは英語長文でヒットしても検索意図(条文番号などの本文検索)からは外れやすいため。
const SEARCH_FIELDS = ['text', 'instruction', 'passage', 'options', 'blanks', 'explanation'];

function fieldSearchableText(q, field) {
  if (field === 'options') return (q.options || []).join(' ');
  if (field === 'blanks') return (q.blanks || []).map((b) => b.text || '').join(' ');
  return q[field] || '';
}

// 1問が正規化済みクエリを含むか判定する。含めば最初にヒットしたフィールドの情報を返す。
// 正規表現としては扱わない(indexOfのみ)ため、クエリ中の括弧などの特殊文字もリテラル一致になる。
export function matchQuestion(q, normalizedQuery) {
  if (!normalizedQuery) return null;
  for (const field of SEARCH_FIELDS) {
    const raw = fieldSearchableText(q, field);
    if (!raw) continue;
    const index = normalizeSearchText(raw).indexOf(normalizedQuery);
    if (index !== -1) return { field, index, matchLength: normalizedQuery.length, raw };
  }
  return null;
}

// マッチ位置の前後 contextChars 文字を切り出す(日本語は分かち書きされないため単純な文字数窓でよい)。
export function snippetFor(raw, index, matchLength, contextChars = 40) {
  const start = Math.max(0, index - contextChars);
  const end = Math.min(raw.length, index + matchLength + contextChars);
  return {
    before: raw.slice(start, index),
    match: raw.slice(index, index + matchLength),
    after: raw.slice(index + matchLength, end),
    truncatedStart: start > 0,
    truncatedEnd: end < raw.length,
  };
}

// questions 全体から検索語を含む問題を抽出する(出題順を保持)。空/空白のみのqueryは空配列。
// 表示件数の上限はここでは持たせない(描画側の責務)。
export function searchQuestions(questions, query, contextChars = 40) {
  const nq = normalizeSearchText(String(query).trim());
  if (!nq) return [];
  const hits = [];
  for (const question of questions) {
    const m = matchQuestion(question, nq);
    if (m) hits.push({ question, field: m.field, snippet: snippetFor(m.raw, m.index, m.matchLength, contextChars) });
  }
  return hits;
}
