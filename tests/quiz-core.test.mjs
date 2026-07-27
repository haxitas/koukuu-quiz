// quiz-core のユニットテスト(フレームワーク非依存)。
// node が無い環境のため、同じ ESモジュールをブラウザのテストランナー(run-tests.html)で実行する。
// 出荷する実物(quiz-core.mjs)をそのまま検証するため、ロジックの二重化を避けられる。
import {
  gradeQuestion,
  gradeExam,
  makeAttempt,
  appendResult,
  statsForKey,
  currentMistakes,
  pickReviewQuestions,
  splitAttemptsByKey,
  normalizeSearchText,
  matchQuestion,
  snippetFor,
  searchQuestions,
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
check('gradeExam 集計(score/total/wrong=誤答id)', () => {
  const questions = [qSingle, qTF, qFill];
  const responses = {
    'R8-02-kougaku-A7': 5,                              // 正
    'R8-02-houki-B1': { ア: 1, イ: 1, ウ: 2, エ: 2, オ: 1 }, // 誤
    'R8-02-houki-B2': { ア: 1, イ: 4, ウ: 6, エ: 8, オ: 9 }, // 正
  };
  const r = gradeExam(questions, responses);
  eq(r.score, 2, 'score');
  eq(r.total, 3, 'total');
  eq(r.wrong, ['R8-02-houki-B1'], 'wrong');
});
check('gradeExam 全問未回答なら全誤(id配列)', () => {
  const r = gradeExam([qSingle, qTF], {});
  eq(r, { score: 0, total: 2, wrong: ['R8-02-kougaku-A7', 'R8-02-houki-B1'] });
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

// makeAttempt はUIの結線用。examResult を素直に写す。presented は出題したid一覧。
check('makeAttempt 形(presentedを含む)', () => {
  const at = makeAttempt('R8-02-法規', '2026-07-22', { score: 2, total: 3, wrong: ['b1'] }, ['a1', 'b1']);
  eq(at, { key: 'R8-02-法規', date: '2026-07-22', score: 2, total: 3, wrong: ['b1'], presented: ['a1', 'b1'] });
});
check('makeAttempt presented省略時は空配列', () => {
  const at = makeAttempt('k', 'd', { score: 1, total: 1, wrong: [] });
  eq(at.presented, []);
});

// --- currentMistakes: attempts から誤答バンクを導出(可変ストアを持たない・全期間横断) ---
// 「あるidの直近の出題時に誤答だったか」で判定 → 正解すれば消え、誤答すれば残る。
// id は元々 {examCode}-{subject}-{no} でグローバルに一意なので、key での絞り込みはしない
// (科目・期をまたいで attempts 全体を横断走査する = 「過去に間違えた問題集」の実体)。
check('currentMistakes 記録なしは空', () => {
  eq(currentMistakes({ attempts: [] }), []);
});
check('currentMistakes 1回目の誤答がそのまま残る', () => {
  const store = { attempts: [
    { key: 'R8-02-無線工学', date: '2026-07-20', score: 1, total: 2, wrong: ['q1'], presented: ['q1', 'q2'] },
  ] };
  eq(currentMistakes(store), ['q1']);
});
check('currentMistakes 再挑戦で正解すると消える', () => {
  const store = { attempts: [
    { key: 'R8-02-無線工学', date: '2026-07-20', score: 1, total: 2, wrong: ['q1'], presented: ['q1', 'q2'] },
    { key: 'R8-02-無線工学', date: '2026-07-21', score: 1, total: 1, wrong: [], presented: ['q1'] }, // 復習でq1正解
  ] };
  eq(currentMistakes(store), []);
});
check('currentMistakes 再挑戦でまた誤答なら残り続ける', () => {
  const store = { attempts: [
    { key: 'R8-02-無線工学', date: '2026-07-20', score: 1, total: 2, wrong: ['q1'], presented: ['q1', 'q2'] },
    { key: 'R8-02-無線工学', date: '2026-07-21', score: 0, total: 1, wrong: ['q1'], presented: ['q1'] },
  ] };
  eq(currentMistakes(store), ['q1']);
});
check('currentMistakes 再提示されていない誤答は残る(未解決のまま)', () => {
  const store = { attempts: [
    { key: 'R8-02-無線工学', date: '2026-07-20', score: 1, total: 2, wrong: ['q1'], presented: ['q1', 'q2'] },
    { key: 'R8-02-無線工学', date: '2026-07-21', score: 1, total: 1, wrong: [], presented: ['q3'] }, // q1には触れていない
  ] };
  eq(currentMistakes(store), ['q1']);
});
check('currentMistakes 複数キー(科目・期)を横断して集約する', () => {
  const store = { attempts: [
    { key: 'R8-02-法規', date: '2026-07-20', score: 0, total: 1, wrong: ['b1'], presented: ['b1'] },
    { key: 'R8-02-無線工学', date: '2026-07-20', score: 0, total: 1, wrong: ['k1'], presented: ['k1'] },
  ] };
  eq(currentMistakes(store), ['b1', 'k1'], 'キーに関わらず両方が誤答バンクに入る');
});
check('currentMistakes presented欠落の旧レコードは無視して安全に動く', () => {
  const store = { attempts: [
    { key: 'R8-02-無線工学', date: '2026-07-20', score: 0, total: 1, wrong: ['q1'] }, // presented無し(旧形式)
  ] };
  eq(currentMistakes(store), []);
});

// --- pickReviewQuestions: 出題順を保ち、最大件数でキャップする ---
check('pickReviewQuestions 誤答idに一致する問題だけ出題順で返す', () => {
  const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  eq(pickReviewQuestions(qs, ['c', 'a']).map((q) => q.id), ['a', 'c']);
});
check('pickReviewQuestions 最大10問にキャップ', () => {
  const qs = Array.from({ length: 15 }, (_, i) => ({ id: `q${i}` }));
  const mistakes = qs.map((q) => q.id);
  const picked = pickReviewQuestions(qs, mistakes);
  eq(picked.length, 10);
  eq(picked.map((q) => q.id), ['q0','q1','q2','q3','q4','q5','q6','q7','q8','q9']);
});
check('pickReviewQuestions maxを指定できる', () => {
  const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  eq(pickReviewQuestions(qs, ['a', 'b', 'c'], 2).map((q) => q.id), ['a', 'b']);
});
check('pickReviewQuestions 誤答が無ければ空', () => {
  eq(pickReviewQuestions([{ id: 'a' }], []), []);
});

// --- splitAttemptsByKey: 採点結果をキーごとに1 Attempt へ分割する ---
// 全期間横断の復習セッションは科目・期をまたぎ得るため、1回のgrade()でも
// キー(科目×期)ごとに別々のAttemptとして保存する必要がある(statsForKeyを汚さないため)。
check('splitAttemptsByKey 混在キーをそれぞれ正しく採点したattemptに分割する', () => {
  const qs = [
    { id: 'a1', key: 'R8-02-無線工学' },
    { id: 'b1', key: 'R8-02-法規' },
    { id: 'a2', key: 'R8-02-無線工学' },
  ];
  const result = { score: 2, total: 3, wrong: ['b1'] };
  const attempts = splitAttemptsByKey(qs, result, '2026-07-22', (q) => q.key);
  eq(attempts.length, 2, '2キー分のattemptができる');
  eq(attempts[0], { key: 'R8-02-無線工学', date: '2026-07-22', score: 2, total: 2, wrong: [], presented: ['a1', 'a2'] });
  eq(attempts[1], { key: 'R8-02-法規', date: '2026-07-22', score: 0, total: 1, wrong: ['b1'], presented: ['b1'] });
});
check('splitAttemptsByKey 単一キーはmakeAttempt直呼びと同じ結果になる(通常回の退化ケース)', () => {
  const qs = [{ id: 'x1', key: 'K' }, { id: 'x2', key: 'K' }];
  const result = { score: 1, total: 2, wrong: ['x2'] };
  const viaSplit = splitAttemptsByKey(qs, result, '2026-07-22', (q) => q.key);
  const viaDirect = [makeAttempt('K', '2026-07-22', result, qs.map((q) => q.id))];
  eq(viaSplit, viaDirect);
});
check('splitAttemptsByKey 出題0件なら空配列', () => {
  eq(splitAttemptsByKey([], { score: 0, total: 0, wrong: [] }, '2026-07-22', (q) => q.key), []);
});

// --- 検索用フィクスチャ(実物 R2-02 の instruction を模したもの) -----------
const qLaw1 = {
  id: 'X-law-1', subject: '法規', type: 'single',
  instruction: '航空移動業務の無線局における免許状に記載された事項の遵守について、電波法(第52条から第55条まで)の規定に照らし、',
  text: '本文サンプル(52条とは無関係)', passage: null, options: ['a', 'b'], answer: 1, blanks: null, explanation: '',
};
const qEng1 = {
  id: 'X-eng-1', subject: '英語', type: 'single',
  instruction: '', text: 'Squawk 7700 means an emergency.', passage: null,
  options: ['a'], answer: 1, blanks: null, explanation: '',
};
const qTFsearch = {
  id: 'X-tf-1', subject: '法規', type: 'truefalse_list',
  instruction: '', text: '', passage: null, options: ['該当する', '該当しない'], answer: null,
  blanks: [{ label: 'ア', text: '第57条に定める遭難通信の内容である。', answer: 1 }],
  explanation: '',
};

// --- normalizeSearchText ---------------------------------------------------
check('normalizeSearchText 全角数字を半角に変換', () =>
  assert(normalizeSearchText('第５２条') === '第52条'));
check('normalizeSearchText 全角英字と大文字を正規化', () =>
  assert(normalizeSearchText('ＳＱＵＡＷＫ') === 'squawk'));
check('normalizeSearchText 日本語はそのまま', () =>
  assert(normalizeSearchText('第52条から第55条') === '第52条から第55条'));

// --- matchQuestion -----------------------------------------------------
check('matchQuestion instructionフィールドでヒット', () => {
  const m = matchQuestion(qLaw1, normalizeSearchText('第52条から第55条'));
  assert(m && m.field === 'instruction');
});
check('matchQuestion 全角クエリが半角データにヒット', () => {
  const m = matchQuestion(qLaw1, normalizeSearchText('第５２条から第５５条'));
  assert(m !== null, '全角→半角の正規化を経てヒットするはず');
});
check('matchQuestion 大文字小文字を無視してヒット', () => {
  const m = matchQuestion(qEng1, normalizeSearchText('squawk'));
  assert(m && m.field === 'text');
});
check('matchQuestion blanksのtextでヒット', () => {
  const m = matchQuestion(qTFsearch, normalizeSearchText('第57条'));
  assert(m && m.field === 'blanks');
});
check('matchQuestion 一致なしはnull', () => {
  assert(matchQuestion(qLaw1, normalizeSearchText('存在しない語句')) === null);
});
check('matchQuestion 特殊文字を含むクエリはリテラル一致(正規表現として解釈しない)', () => {
  const q = { ...qLaw1, text: '第52条(目的外使用の禁止等)第1号' };
  const m = matchQuestion(q, normalizeSearchText('条(目的外'));
  assert(m !== null, '括弧を含むクエリでも文字通りマッチするはず');
});

// --- snippetFor --------------------------------------------------------
check('snippetFor 前後を正しく切り出す', () => {
  const s = snippetFor('0123456789', 4, 2, 3); // index4="4", len2="45", 前後3文字ずつ
  eq(s, { before: '123', match: '45', after: '678', truncatedStart: true, truncatedEnd: true });
});
check('snippetFor 先頭付近は省略記号なし', () => {
  const s = snippetFor('0123456789', 0, 1, 3);
  eq(s.before, '');
  assert(s.truncatedStart === false);
});

// --- searchQuestions -----------------------------------------------------
check('searchQuestions 空queryは空配列', () => {
  eq(searchQuestions([qLaw1], ''), []);
});
check('searchQuestions 空白のみのqueryは空配列', () => {
  eq(searchQuestions([qLaw1], '   '), []);
});
check('searchQuestions ヒットなしは空配列', () => {
  eq(searchQuestions([qLaw1], '存在しない語句'), []);
});
check('searchQuestions 出題順を保って複数件ヒット', () => {
  const hits = searchQuestions([qEng1, qLaw1], '第52条から第55条');
  eq(hits.map((h) => h.question.id), ['X-law-1']);
});
check('searchQuestions ユーザー実例クエリが一致する', () => {
  const hits = searchQuestions([qLaw1], '第52条から第55条');
  assert(hits.length === 1 && hits[0].field === 'instruction');
});

export function runTests() {
  return results;
}
