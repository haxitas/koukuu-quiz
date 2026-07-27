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
  mistakeCounts,
  pickRandomQuestions,
  quizSizeOptions,
  attemptedIds,
  unattemptedQuestions,
  progressSummary,
  mistakeRanking,
  questionPoints,
  earnedPoints,
  scoreExam,
  passJudgement,
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

// --- mistakeCounts: 通算の誤答回数を attempts から数える ---
check('mistakeCounts 記録なしは空', () => {
  eq(mistakeCounts({ attempts: [] }), {});
  eq(mistakeCounts(null), {});
});
check('mistakeCounts 同じ問題を複数回間違えたら加算される', () => {
  const store = { attempts: [
    { key: 'K', date: '2026-07-20', score: 0, total: 2, wrong: ['q1', 'q2'], presented: ['q1', 'q2'] },
    { key: 'K', date: '2026-07-21', score: 1, total: 2, wrong: ['q1'], presented: ['q1', 'q2'] },
  ] };
  eq(mistakeCounts(store), { q1: 2, q2: 1 });
});
check('mistakeCounts 正解しても過去の回数は減らない(累計なので)', () => {
  const store = { attempts: [
    { key: 'K', date: '2026-07-20', score: 0, total: 1, wrong: ['q1'], presented: ['q1'] },
    { key: 'K', date: '2026-07-21', score: 1, total: 1, wrong: [], presented: ['q1'] },
  ] };
  eq(mistakeCounts(store), { q1: 1 }, '誤答バンクからは消えても通算回数は残る');
});

// --- pickRandomQuestions: ランダムに選ぶが並びは元のまま ---
check('pickRandomQuestions 件数がmax以下ならそのまま全部返す', () => {
  const qs = [{ id: 'a' }, { id: 'b' }];
  eq(pickRandomQuestions(qs, 5).map((q) => q.id), ['a', 'b']);
});
check('pickRandomQuestions max件だけ返し、元の並び順を保つ', () => {
  const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const rng = () => 0.99; // 決定的にするための差し替え
  const picked = pickRandomQuestions(qs, 3, rng);
  eq(picked.length, 3);
  const order = picked.map((q) => qs.findIndex((x) => x.id === q.id));
  eq(order, [...order].sort((a, b) => a - b), '選ばれた問題は元の順序で並ぶ');
});
check('pickRandomQuestions rngを変えると選ばれる組が変わりうる', () => {
  const qs = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));
  const a = pickRandomQuestions(qs, 3, () => 0).map((q) => q.id);
  const b = pickRandomQuestions(qs, 3, () => 0.99).map((q) => q.id);
  assert(JSON.stringify(a) !== JSON.stringify(b), 'rng次第で別の組が選ばれる');
});
check('pickRandomQuestions 空配列やmax=0は空', () => {
  eq(pickRandomQuestions([], 5), []);
  eq(pickRandomQuestions([{ id: 'a' }], 0), []);
});

// --- quizSizeOptions: 検索結果から出題するときの選択肢 ---
check('quizSizeOptions 5問未満はあるだけ', () => eq(quizSizeOptions(3), [3]));
check('quizSizeOptions ちょうど5問は全件のみ(5問=あるだけ)', () => eq(quizSizeOptions(5), [5]));
check('quizSizeOptions 5問超10問未満は5問と全件', () => eq(quizSizeOptions(7), [5, 7]));
check('quizSizeOptions ちょうど10問は5問と全件(10問=あるだけ)', () => eq(quizSizeOptions(10), [5, 10]));
check('quizSizeOptions 10問超は5問・10問・全件', () => eq(quizSizeOptions(15), [5, 10, 15]));
check('quizSizeOptions 0件は空', () => eq(quizSizeOptions(0), []));

// --- 未挑戦の把握 -----------------------------------------------------
const qsProgress = [
  { id: 'k1', subject: '無線工学' }, { id: 'k2', subject: '無線工学' },
  { id: 'h1', subject: '法規' }, { id: 'h2', subject: '法規' }, { id: 'h3', subject: '法規' },
];
const storeProgress = { attempts: [
  { key: 'X-無線工学', date: '2026-07-20', score: 1, total: 2, wrong: ['k2'], presented: ['k1', 'k2'] },
  { key: 'X-法規', date: '2026-07-21', score: 1, total: 1, wrong: [], presented: ['h1'] },
] };

check('attemptedIds 出題された問題だけ集める', () => {
  eq([...attemptedIds(storeProgress)].sort(), ['h1', 'k1', 'k2']);
});
check('attemptedIds 記録なしは空', () => eq([...attemptedIds(null)], []));
check('attemptedIds presented欠落の旧レコードは無視する', () => {
  eq([...attemptedIds({ attempts: [{ key: 'X', wrong: ['q1'] }] })], []);
});
check('unattemptedQuestions 未出題だけを元の順で返す', () => {
  eq(unattemptedQuestions(qsProgress, storeProgress).map((q) => q.id), ['h2', 'h3']);
});
check('unattemptedQuestions 記録なしなら全部が未挑戦', () => {
  eq(unattemptedQuestions(qsProgress, { attempts: [] }).length, 5);
});
check('progressSummary 全体と科目別を数える', () => {
  const p = progressSummary(qsProgress, storeProgress);
  eq({ total: p.total, attempted: p.attempted, unattempted: p.unattempted }, { total: 5, attempted: 3, unattempted: 2 });
  eq(p.bySubject, [
    { subject: '無線工学', total: 2, attempted: 2, unattempted: 0 },
    { subject: '法規', total: 3, attempted: 1, unattempted: 2 },
  ]);
});

// --- 誤答ランキング ---------------------------------------------------
check('mistakeRanking 回数の多い順、同数は元の並びを保つ', () => {
  const qs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const store = { attempts: [
    { key: 'K', date: '1', score: 0, total: 3, wrong: ['a', 'b', 'c'], presented: ['a', 'b', 'c'] },
    { key: 'K', date: '2', score: 0, total: 2, wrong: ['b', 'c'], presented: ['b', 'c'] },
    { key: 'K', date: '3', score: 0, total: 1, wrong: ['c'], presented: ['c'] },
  ] };
  eq(mistakeRanking(qs, store).map((r) => [r.question.id, r.count]),
    [['c', 3], ['b', 2], ['a', 1]], 'dは誤答0なので出ない');
});
check('mistakeRanking min指定で少ない回数を除外できる', () => {
  const qs = [{ id: 'a' }, { id: 'b' }];
  const store = { attempts: [
    { key: 'K', date: '1', score: 0, total: 2, wrong: ['a', 'b'], presented: ['a', 'b'] },
    { key: 'K', date: '2', score: 0, total: 1, wrong: ['b'], presented: ['b'] },
  ] };
  eq(mistakeRanking(qs, store, 2).map((r) => r.question.id), ['b']);
});
check('mistakeRanking 誤答なしは空', () => eq(mistakeRanking([{ id: 'a' }], { attempts: [] }), []));

// --- 配点(公式PDFの配点内訳どおりか) ---------------------------------
const b5 = [{ label: 'ア' }, { label: 'イ' }, { label: 'ウ' }, { label: 'エ' }, { label: 'オ' }];
check('questionPoints 法規A問題は5点', () =>
  eq(questionPoints({ subject: '法規', no: 'A-1' }), 5));
check('questionPoints 法規B問題は小設問各1点で5点', () =>
  eq(questionPoints({ subject: '法規', no: 'B-1', blanks: b5 }), 5));
check('questionPoints 無線工学A問題は5点・B問題は5点', () => {
  eq(questionPoints({ subject: '無線工学', no: 'A-1' }), 5);
  eq(questionPoints({ subject: '無線工学', no: 'B-4', blanks: b5 }), 5);
});
check('questionPoints 英語は問1が4点・問2が5点・B問題が10点', () => {
  eq(questionPoints({ subject: '英語', no: 'A-1' }), 4);
  eq(questionPoints({ subject: '英語', no: 'A-5' }), 4);
  eq(questionPoints({ subject: '英語', no: 'A-6' }), 5);
  eq(questionPoints({ subject: '英語', no: 'A-9' }), 5);
  eq(questionPoints({ subject: '英語', no: 'B-1', blanks: b5 }), 10);
});
check('questionPoints 英会話は1問5点', () =>
  eq(questionPoints({ subject: '英会話', no: 'Q-1' }), 5));
check('配点の合計が公式の満点と一致する(法規100/工学70/英語70/英会話35)', () => {
  const sum = (qs) => qs.reduce((a, q) => a + questionPoints(q), 0);
  const houki = [...Array(14)].map((_, i) => ({ subject: '法規', no: `A-${i + 1}` }))
    .concat([...Array(6)].map((_, i) => ({ subject: '法規', no: `B-${i + 1}`, blanks: b5 })));
  const kougaku = [...Array(10)].map((_, i) => ({ subject: '無線工学', no: `A-${i + 1}` }))
    .concat([...Array(4)].map((_, i) => ({ subject: '無線工学', no: `B-${i + 1}`, blanks: b5 })));
  const eigo = [...Array(9)].map((_, i) => ({ subject: '英語', no: `A-${i + 1}` }))
    .concat([...Array(3)].map((_, i) => ({ subject: '英語', no: `B-${i + 1}`, blanks: b5 })));
  const eikaiwa = [...Array(7)].map((_, i) => ({ subject: '英会話', no: `Q-${i + 1}` }));
  eq([sum(houki), sum(kougaku), sum(eigo), sum(eikaiwa)], [100, 70, 70, 35]);
});

// --- 得点(B問題は小設問ごとの部分点が入る) ---------------------------
const qHoukiA = { id: 'ha', subject: '法規', no: 'A-1', type: 'single', options: ['a', 'b'], answer: 2, blanks: null };
const qHoukiB = {
  id: 'hb', subject: '法規', no: 'B-1', type: 'truefalse_list', options: ['正', '誤'], answer: null,
  blanks: [{ label: 'ア', answer: 1 }, { label: 'イ', answer: 2 }, { label: 'ウ', answer: 1 },
    { label: 'エ', answer: 2 }, { label: 'オ', answer: 1 }],
};
check('earnedPoints single 正解で満点・不正解で0', () => {
  eq(earnedPoints(qHoukiA, 2), 5);
  eq(earnedPoints(qHoukiA, 1), 0);
  eq(earnedPoints(qHoukiA, null), 0);
});
check('earnedPoints B問題は当たった小設問の数だけ部分点が入る', () => {
  eq(earnedPoints(qHoukiB, { ア: 1, イ: 2, ウ: 1, エ: 2, オ: 1 }), 5, '全問一致で5点');
  eq(earnedPoints(qHoukiB, { ア: 1, イ: 2, ウ: 1 }), 3, '3つ当たりで3点');
  eq(earnedPoints(qHoukiB, {}), 0);
  eq(earnedPoints(qHoukiB, null), 0);
});
check('earnedPoints 英語B問題は小設問各2点', () => {
  const q = { subject: '英語', no: 'B-1', type: 'fill_blanks', answer: null,
    blanks: [{ label: 'ア', answer: 1 }, { label: 'イ', answer: 2 }, { label: 'ウ', answer: 3 },
      { label: 'エ', answer: 4 }, { label: 'オ', answer: 5 }] };
  eq(earnedPoints(q, { ア: 1, イ: 2 }), 4, '2つ当たりで4点');
});
check('scoreExam 配点ベースで合計する(問題数ではない)', () => {
  const r = scoreExam([qHoukiA, qHoukiB], { ha: 2, hb: { ア: 1, イ: 2, ウ: 1 } });
  eq(r, { earned: 8, total: 10 });
});

// --- 合格判定 ---------------------------------------------------------
check('passJudgement 法規は100点満点・合格70点', () => {
  const j = passJudgement('法規', 70);
  eq({ kind: j.kind, total: j.total, pass: j.pass, passed: j.passed },
    { kind: 'standalone', total: 100, pass: 70, passed: true });
  assert(passJudgement('法規', 69).passed === false);
});
check('passJudgement 無線工学は70点満点・合格49点', () => {
  assert(passJudgement('無線工学', 49).passed === true);
  assert(passJudgement('無線工学', 48).passed === false);
  eq(passJudgement('無線工学', 49).total, 70);
});
check('passJudgement 英語は英会話との合計判定になる', () => {
  const j = passJudgement('英語', 50);
  eq(j.kind, 'combined');
  eq(j.partner, '英会話');
  eq(j.needFromPartner, 15, '合計60点まであと10点だが、英会話の足切り15点が優先される');
});
check('passJudgement 英語の点が低いと英会話に多く必要になる', () => {
  eq(passJudgement('英語', 30).needFromPartner, 30);
});
check('passJudgement 英会話が満点でも届かないなら impossible', () => {
  const j = passJudgement('英語', 20); // 合計60まであと40点だが英会話は35点満点
  eq(j.needFromPartner, 40);
  assert(j.impossible === true);
});
check('passJudgement 英会話は15点未満だと合計に関わらず不合格', () => {
  const j = passJudgement('英会話', 10);
  assert(j.disqualified === true);
  eq(j.min, 15);
});
check('passJudgement 英会話15点以上なら筆記に必要な点を返す', () => {
  const j = passJudgement('英会話', 25);
  assert(!j.disqualified);
  eq(j.needFromPartner, 35, '合計60点まであと35点');
  eq(j.partnerMax, 70);
});
check('passJudgement 未知の科目はnull', () => eq(passJudgement('電気通信術', 10), null));

export function runTests() {
  return results;
}
