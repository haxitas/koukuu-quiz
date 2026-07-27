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
