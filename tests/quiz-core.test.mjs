// quiz-core のユニットテスト(フレームワーク非依存)。
// node が無い環境のため、同じ ESモジュールをブラウザのテストランナー(run-tests.html)で実行する。
// 出荷する実物(quiz-core.mjs)をそのまま検証するため、ロジックの二重化を避けられる。
import {
  gradeQuestion,
  gradeExam,
  makeAttempt,
  appendResult,
  statsForKey,
} from '../quiz-core.mjs';

// --- 最小アサートハーネス -------------------------------------------------
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, msg: e.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || 'not equal') + ` — got ${sa}, want ${sb}`);
}

// --- フィクスチャ(実物 R8-02 の型を踏襲。answer は 1始まり) ------------
const qSingle = {
  id: 'R8-02-kougaku-A7', subject: '無線工学', type: 'single',
  options: ['a', 'b', 'c', 'd', 'e'], answer: 5, blanks: null,
};
const qTF = {
  id: 'R8-02-houki-B1', subject: '法規', type: 'truefalse_list',
  options: ['該当する', '該当しない'], answer: null,
  blanks: [
    { label: 'ア', answer: 2 }, { label: 'イ', answer: 1 },
    { label: 'ウ', answer: 2 }, { label: 'エ', answer: 2 }, { label: 'オ', answer: 1 },
  ],
};
const qFill = {
  id: 'R8-02-houki-B2', subject: '法規', type: 'fill_blanks',
  options: ['o1','o2','o3','o4','o5','o6','o7','o8','o9','o10'], answer: null,
  blanks: [
    { label: 'ア', answer: 1 }, { label: 'イ', answer: 4 },
    { label: 'ウ', answer: 6 }, { label: 'エ', answer: 8 }, { label: 'オ', answer: 9 },
  ],
};

// --- gradeQuestion: single ------------------------------------------------
check('single 正解', () => assert(gradeQuestion(qSingle, 5) === true));
check('single 不正解', () => assert(gradeQuestion(qSingle, 1) === false));
check('single 未回答(null)は不正解', () => assert(gradeQuestion(qSingle, null) === false));

// --- gradeQuestion: truefalse_list ---------------------------------------
check('truefalse 全一致で正解', () =>
  assert(gradeQuestion(qTF, { ア: 2, イ: 1, ウ: 2, エ: 2, オ: 1 }) === true));
check('truefalse 1つ違いで不正解', () =>
  assert(gradeQuestion(qTF, { ア: 1, イ: 1, ウ: 2, エ: 2, オ: 1 }) === false));
check('truefalse ブランク欠落で不正解', () =>
  assert(gradeQuestion(qTF, { ア: 2, イ: 1 }) === false));
check('truefalse 応答なし(null)で不正解', () =>
  assert(gradeQuestion(qTF, null) === false));

// --- gradeQuestion: fill_blanks ------------------------------------------
check('fill 全一致で正解', () =>
  assert(gradeQuestion(qFill, { ア: 1, イ: 4, ウ: 6, エ: 8, オ: 9 }) === true));
check('fill 一部違いで不正解', () =>
  assert(gradeQuestion(qFill, { ア: 1, イ: 4, ウ: 6, エ: 8, オ: 10 }) === false));

// --- gradeExam ------------------------------------------------------------
check('gradeExam 集計(score/total/wrong=0始まりindex)', () => {
  const questions = [qSingle, qTF, qFill];
  const responses = {
    'R8-02-kougaku-A7': 5,                              // 正
    'R8-02-houki-B1': { ア: 1, イ: 1, ウ: 2, エ: 2, オ: 1 }, // 誤(index 1)
    'R8-02-houki-B2': { ア: 1, イ: 4, ウ: 6, エ: 8, オ: 9 }, // 正
  };
  const r = gradeExam(questions, responses);
  eq(r.score, 2, 'score');
  eq(r.total, 3, 'total');
  eq(r.wrong, [1], 'wrong');
});
check('gradeExam 全問未回答なら全誤', () => {
  const r = gradeExam([qSingle, qTF], {});
  eq(r, { score: 0, total: 2, wrong: [0, 1] });
});

// --- appendResult: append-only(既存を破壊しない) ------------------------
check('appendResult 空(null)から1件', () => {
  const out = appendResult(null, { key: 'k', date: 'd', score: 1, total: 2, wrong: [1] });
  eq(out.attempts.length, 1);
});
check('appendResult 既存配列を変更しない(参照・長さ保持)', () => {
  const a1 = { key: 'R8-02-無線工学', date: '2026-07-22', score: 1, total: 2, wrong: [0] };
  const store = Object.freeze({ attempts: Object.freeze([a1]) }); // 破壊したら例外になる
  const a2 = { key: 'R8-02-法規', date: '2026-07-22', score: 3, total: 3, wrong: [] };
  const out = appendResult(store, a2);
  eq(store.attempts.length, 1, '元配列の長さが変わってはいけない');
  assert(out.attempts[0] === a1, '既存要素は同一参照で保持');
  eq(out.attempts.length, 2);
  eq(out.attempts[1], a2);
});

// --- statsForKey ----------------------------------------------------------
check('statsForKey 記録なしは count=0', () => {
  eq(statsForKey({ attempts: [] }, 'R8-02-無線工学'), { count: 0, last: null, best: null });
});
check('statsForKey last/best/count', () => {
  const store = { attempts: [
    { key: 'R8-02-無線工学', date: '2026-07-20', score: 10, total: 20, wrong: [] }, // 0.5
    { key: 'R8-02-無線工学', date: '2026-07-21', score: 18, total: 20, wrong: [] }, // 0.9 (best)
    { key: 'R8-02-無線工学', date: '2026-07-22', score: 14, total: 20, wrong: [] }, // 0.7 (last)
    { key: 'R8-02-法規',   date: '2026-07-22', score: 1,  total: 3,  wrong: [] }, // 別キーは無視
  ] };
  const s = statsForKey(store, 'R8-02-無線工学');
  eq(s.count, 3, 'count');
  eq(s.last, 0.7, 'last');
  eq(s.best, 0.9, 'best');
});

// makeAttempt はUIの結線用。examResult を素直に写す。
check('makeAttempt 形', () => {
  const at = makeAttempt('R8-02-法規', '2026-07-22', { score: 2, total: 3, wrong: [1] });
  eq(at, { key: 'R8-02-法規', date: '2026-07-22', score: 2, total: 3, wrong: [1] });
});

export function runTests() {
  return results;
}
