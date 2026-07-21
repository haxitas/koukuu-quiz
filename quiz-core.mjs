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
export function makeAttempt(key, date, examResult) {
  return {
    key,
    date,
    score: examResult.score,
    total: examResult.total,
    wrong: examResult.wrong,
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
