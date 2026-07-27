// app.js — 表示と画面遷移のみ。採点ロジックは quiz-core.mjs に委譲(外部API呼び出しなし)。
import {
  gradeExam, appendResult, statsForKey, isComposite,
  currentMistakes, pickReviewQuestions, splitAttemptsByKey,
  searchQuestions, mistakeCounts, pickRandomQuestions, quizSizeOptions,
  unattemptedQuestions, progressSummary, mistakeRanking, scoreExam, passJudgement,
  resolvedPassage,
} from './quiz-core.mjs';

const STORE_KEY = 'aviation_quiz_results';
const REVIEW_MAX = 10; // 復習モードの1回あたりの最大出題数
const SEARCH_RESULT_CAP = 50; // 検索結果の表示上限
const SUBJECT_ORDER = ['無線工学', '法規', '英語', '英会話']; // ボタンの並び順の好み(未知の科目は末尾にアルファベット順で追加)

const state = {
  exams: [],
  exam: null,      // 選択中の試験(index.jsonのentry)
  subject: null,   // 選択中の科目名
  mode: 'normal',  // 'normal'(全問) | 'review'(誤答バンクからの復習) | 'search'(検索結果からの出題) | 'fresh'(未挑戦から出題)
  reviewSubject: null, // 復習回の科目フィルタ。null=全分野横断、文字列=その科目のみ
  searchQuery: '', // 検索出題回の検索語(出題画面の見出し表示用)
  freshSubject: null, // 未挑戦回の科目フィルタ。null=全分野横断
  questions: [],   // 出題(科目でフィルタ済み、復習モードは誤答のみ)
  responses: {},   // { questionId: response }
  qi: 0,           // 現在の問番号(0始まり)
  prevWrong: null, // Set<questionId> 出題時点で誤答バンクに入っていたid(バッジ表示用)
  mistakeCounts: {}, // { questionId: 通算誤答回数 } 出題時点のスナップショット(バッジ表示用)
  allQuestionsCache: [], // 全期間・全科目の問題(出典タグ付き)。initSelect で作り、復習開始時に使い回す
};

// ---- localStorage(append-only) ----
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : { attempts: [] };
  } catch (_) {
    return { attempts: [] };
  }
}
function saveAttempt(attempt) {
  const next = appendResult(loadStore(), attempt); // 既存を書き換えず新配列を作る
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
}

// ---- 画面切替 ----
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = (s.id !== id);
  document.getElementById('home-btn').hidden = (id === 'screen-select');
  window.scrollTo(0, 0);
}
const pct = (r) => (r === null ? '—' : Math.round(r * 100) + '%');

// 出題データに現れる科目を、好みの並び順(SUBJECT_ORDER)→未知はアルファベット順で返す。
function sortedSubjects(questions) {
  const present = new Set(questions.map((q) => q.subject));
  const known = SUBJECT_ORDER.filter((s) => present.has(s));
  const unknown = [...present].filter((s) => !SUBJECT_ORDER.includes(s)).sort();
  return [...known, ...unknown];
}

// 学習の進みぐあいカード。全体の消化率と、科目ごとの未挑戦数を出す。
// 科目の行はそのままボタンで、押すとその科目の未挑戦からランダム出題する。
function makeProgressCard(questions, store) {
  const p = progressSummary(questions, store);
  const card = document.createElement('div');
  card.className = 'progress-card';

  const h = document.createElement('h2');
  h.textContent = '学習の進みぐあい';
  card.appendChild(h);

  const line = document.createElement('div');
  line.className = 'progress-line';
  const rate = p.total > 0 ? Math.round((p.attempted / p.total) * 100) : 0;
  line.textContent = `全${p.total}問中 ${p.attempted}問に挑戦済み（${rate}%）／ 未挑戦 ${p.unattempted}問`;
  card.appendChild(line);

  const bar = document.createElement('div');
  bar.className = 'progress-bar';
  const fill = document.createElement('span');
  fill.style.width = `${rate}%`;
  bar.appendChild(fill);
  card.appendChild(bar);

  // 科目行(未挑戦が残っている科目のみボタンにする)
  const order = sortedSubjects(questions);
  const bySubject = new Map(p.bySubject.map((s) => [s.subject, s]));
  for (const subject of order) {
    const s = bySubject.get(subject);
    if (!s) continue;
    const row = document.createElement('button');
    row.className = 'progress-row';
    row.disabled = (s.unattempted === 0);
    const label = s.unattempted === 0 ? '全部やった' : `未挑戦 ${s.unattempted}問`;
    row.innerHTML = `<span class="ps-name">${escapeHtml(subject)}</span>` +
      `<span class="ps-count">${s.attempted}/${s.total}</span>` +
      `<span class="ps-rest">${label}</span>`;
    if (s.unattempted > 0) row.addEventListener('click', () => startFreshQuiz(subject));
    card.appendChild(row);
  }

  if (p.unattempted > 0) {
    const gbtn = document.createElement('button');
    gbtn.className = 'fresh-quiz-btn';
    gbtn.textContent = p.unattempted > REVIEW_MAX
      ? `まだ解いていない問題（全分野・${p.unattempted}問中${REVIEW_MAX}問）`
      : `まだ解いていない問題（全分野・${p.unattempted}問）`;
    gbtn.addEventListener('click', () => startFreshQuiz(null));
    card.appendChild(gbtn);
  }
  return card;
}

// 誤答バンク入口ボタンを1個作る(全分野 or 特定科目)。
function makeMistakeReviewButton(label, count) {
  const btn = document.createElement('button');
  btn.className = 'mistake-review-btn';
  btn.textContent = count > REVIEW_MAX
    ? `過去に間違えた問題集（${label}・誤答${count}問中${REVIEW_MAX}問）`
    : `過去に間違えた問題集（${label}・誤答${count}問）`;
  return btn;
}

// ---- 選択画面 ----
async function initSelect() {
  const res = await fetch('data/index.json');
  const idx = await res.json();
  state.exams = idx.exams;
  const store = loadStore();
  const list = document.getElementById('exam-list');
  list.innerHTML = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').hidden = true;
  list.hidden = false;

  // 全期間・全科目の問題を結合してキャッシュ(誤答バンクの内訳表示・復習開始の両方で使う)。
  const combined = [];
  for (const exam of idx.exams) {
    const data = await (await fetch(`data/${exam.file}`)).json();
    for (const q of data.questions) combined.push(tagQuestion(q, exam));
  }
  state.allQuestionsCache = combined;

  // ---- 学習の進みぐあい(最上部): 全体の消化率と、科目ごとの未挑戦から出題する入口 ----
  list.appendChild(makeProgressCard(combined, store));

  // ---- よく間違える問題ランキングの入口 ----
  const ranked = mistakeRanking(combined, store);
  if (ranked.length > 0) {
    const rbtn = document.createElement('button');
    rbtn.className = 'ranking-entry-btn';
    rbtn.textContent = `よく間違える問題（${ranked.length}問）`;
    rbtn.addEventListener('click', showRanking);
    list.appendChild(rbtn);
  }

  // ---- 誤答バンク入口(最上部にまとめる): 全分野1つ + 科目ごとに1つずつ ----
  const globalMistakes = currentMistakes(store);
  const mistakeSet = new Set(globalMistakes);
  if (globalMistakes.length > 0) {
    const gbtn = makeMistakeReviewButton('全分野', globalMistakes.length);
    gbtn.addEventListener('click', () => startMistakeReview(null));
    list.appendChild(gbtn);

    for (const subject of sortedSubjects(combined)) {
      const count = combined.filter((q) => q.subject === subject && mistakeSet.has(q.id)).length;
      if (count === 0) continue;
      const sbtn = makeMistakeReviewButton(subject, count);
      sbtn.addEventListener('click', () => startMistakeReview(subject));
      list.appendChild(sbtn);
    }
  }

  for (const exam of idx.exams) {
    const card = document.createElement('div');
    card.className = 'exam-card';
    const h = document.createElement('h2');
    h.textContent = `${exam.era}(${exam.code})`;
    card.appendChild(h);
    for (const s of exam.subjects) {
      const key = `${exam.code}-${s.subject}`;
      const st = statsForKey(store, key);

      const btn = document.createElement('button');
      btn.className = 'subject-btn';
      const statsText = st.count === 0
        ? '未挑戦'
        : `前回 ${pct(st.last)} / 最高 ${pct(st.best)} / 挑戦 ${st.count}回`;
      btn.innerHTML = `<span class="name">${s.subject}</span>（全${s.count}問）` +
        `<span class="stats">${statsText}</span>`;
      btn.addEventListener('click', () => startQuiz(exam, s.subject));
      card.appendChild(btn);
    }
    list.appendChild(card);
  }
  show('screen-select');
}

// 問題オブジェクトに出典(期コード・期名)を付与する。
// grade() のキー分割(splitAttemptsByKey)と、復習回の出典タグ表示の両方で使う。
function tagQuestion(q, exam) {
  return { ...q, examCode: exam.code, era: exam.era };
}

// ---- 検索(選択画面内。参照用のカード一覧で、採点は行わない) ----

// 検索欄の入力に応じて #search-results を組み立てる(空queryなら通常の一覧に戻す)。
function renderSearchResults(rawQuery) {
  const query = rawQuery.trim();
  const resultsEl = document.getElementById('search-results');
  const listEl = document.getElementById('exam-list');
  if (!query) {
    resultsEl.hidden = true;
    listEl.hidden = false;
    return;
  }
  listEl.hidden = true;
  resultsEl.hidden = false;
  resultsEl.innerHTML = '';

  const hits = searchQuestions(state.allQuestionsCache, query);
  if (hits.length === 0) {
    resultsEl.innerHTML = '<p class="search-no-results">一致する問題は見つかりませんでした。</p>';
    return;
  }

  const shown = hits.slice(0, SEARCH_RESULT_CAP);
  const count = document.createElement('div');
  count.className = 'search-result-count';
  count.textContent = hits.length > SEARCH_RESULT_CAP
    ? `${hits.length}件中${SEARCH_RESULT_CAP}件を表示`
    : `${hits.length}件`;
  resultsEl.appendChild(count);

  // 出題ボタンはヒット全件を母集団にする(カードの表示上限とは別)。
  resultsEl.appendChild(makeQuizBar(hits.map((h) => h.question), (questions, n) =>
    startSearchQuiz(questions, n, query)));

  const counts = mistakeCounts(loadStore());
  for (const hit of shown) resultsEl.appendChild(makeSearchResultCard(hit, counts));
}

// 「この一覧から出題」ボタン群。件数に応じて 5問 / 10問 / 全件 を出し分ける。
// 検索結果とランキングの両方から使う(onStart で開始処理だけ差し替える)。
function makeQuizBar(questions, onStart) {
  const bar = document.createElement('div');
  bar.className = 'search-quiz-bar';
  for (const n of quizSizeOptions(questions.length)) {
    const btn = document.createElement('button');
    btn.className = 'search-quiz-btn';
    btn.textContent = n === questions.length
      ? `この一覧から出題（全${n}問）`
      : `この一覧から出題（ランダム${n}問）`;
    btn.addEventListener('click', () => onStart(questions, n));
    bar.appendChild(btn);
  }
  return bar;
}

// ---- 出題開始(検索結果からの出題: ヒットした問題からランダムに n 問) ----
function startSearchQuiz(questions, n, query) {
  const picked = pickRandomQuestions(questions, n);
  if (picked.length === 0) return;
  const store = loadStore();
  state.exam = null;
  state.subject = null;
  state.mode = 'search';
  state.searchQuery = query;
  state.questions = picked;
  state.responses = {};
  state.qi = 0;
  state.prevWrong = new Set(currentMistakes(store));
  state.mistakeCounts = mistakeCounts(store);
  renderQuestion();
  show('screen-quiz');
}

// 検索結果1件のカード(要約行 + クリックで開閉する詳細)を作る。
function makeSearchResultCard(hit, counts) {
  const q = hit.question;
  const card = document.createElement('div');
  card.className = 'search-result';

  const summary = document.createElement('div');
  summary.className = 'search-result-summary';
  const tag = document.createElement('span');
  tag.className = 'source-tag';
  tag.textContent = `${q.era} ／ ${q.subject} ／ ${q.no}`;
  summary.appendChild(tag);
  const wrongCount = (counts && counts[q.id]) || 0;
  if (wrongCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'past-wrong-badge';
    badge.textContent = `過去${wrongCount}回まちがえた`;
    summary.appendChild(badge);
  }
  const snip = document.createElement('div');
  snip.className = 'snippet';
  const { before, match, after, truncatedStart, truncatedEnd } = hit.snippet;
  snip.innerHTML =
    (truncatedStart ? '…' : '') + escapeHtml(before) +
    '<mark>' + escapeHtml(match) + '</mark>' +
    escapeHtml(after) + (truncatedEnd ? '…' : '');
  summary.appendChild(snip);
  card.appendChild(summary);

  const detail = document.createElement('div');
  detail.className = 'search-result-detail';
  detail.hidden = true;
  renderSearchDetail(detail, q);
  card.appendChild(detail);

  summary.addEventListener('click', () => { detail.hidden = !detail.hidden; });
  return card;
}

// 検索結果の展開詳細: 参照用に全文+正解のみを表示する(採点はしないので「あなたの解答」欄は無い)。
function renderSearchDetail(container, q) {
  const parts = [`<div class="q-no">${escapeHtml(q.no)}</div>`];
  const passage = resolvedPassage(q, state.allQuestionsCache);
  if (passage) parts.push(`<div class="q-passage">${escapeHtml(passage)}</div>`);
  if (q.instruction) parts.push(`<div class="q-instruction">${escapeHtml(q.instruction)}</div>`);
  parts.push(`<div class="q-text">${escapeHtml(q.text)}</div>`);
  parts.push(`<div class="correct">正解: ${escapeHtml(correctText(q))}</div>`);
  if (q.explanation) parts.push(`<div class="explanation">${escapeHtml(q.explanation)}</div>`);
  container.innerHTML = parts.join('');
}

// ---- よく間違える問題ランキング(見るだけの画面。出題は下のボタンから) ----
function showRanking() {
  const store = loadStore();
  const ranked = mistakeRanking(state.allQuestionsCache, store);
  const listEl = document.getElementById('ranking-list');
  listEl.innerHTML = '';
  if (ranked.length === 0) {
    listEl.innerHTML = '<p class="search-no-results">まだ誤答の記録がありません。</p>';
    show('screen-ranking');
    return;
  }

  listEl.appendChild(makeQuizBar(ranked.map((r) => r.question), (questions, n) =>
    startRankingQuiz(questions, n)));

  for (const { question, count } of ranked) {
    const card = document.createElement('div');
    card.className = 'search-result';

    const summary = document.createElement('div');
    summary.className = 'search-result-summary';
    const tag = document.createElement('span');
    tag.className = 'source-tag';
    tag.textContent = `${question.era} ／ ${question.subject} ／ ${question.no}`;
    const badge = document.createElement('span');
    badge.className = 'past-wrong-badge';
    badge.textContent = `${count}回`;
    const snip = document.createElement('div');
    snip.className = 'snippet';
    snip.textContent = question.text;
    summary.append(tag, badge, snip);
    card.appendChild(summary);

    const detail = document.createElement('div');
    detail.className = 'search-result-detail';
    detail.hidden = true;
    renderSearchDetail(detail, question);
    card.appendChild(detail);

    summary.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    listEl.appendChild(card);
  }
  show('screen-ranking');
}

// ---- 出題開始(未挑戦回: まだ一度も出題されていない問題からランダム) ----
function startFreshQuiz(subjectFilter) {
  const store = loadStore();
  const pool = subjectFilter
    ? state.allQuestionsCache.filter((q) => q.subject === subjectFilter)
    : state.allQuestionsCache;
  const fresh = unattemptedQuestions(pool, store);
  const picked = pickRandomQuestions(fresh, REVIEW_MAX);
  if (picked.length === 0) return;

  state.exam = null;
  state.subject = null;
  state.mode = 'fresh';
  state.freshSubject = subjectFilter;
  state.questions = picked;
  state.responses = {};
  state.qi = 0;
  // 未挑戦の問題なので誤答バンクには入っていないが、判定は共通処理に任せる。
  state.prevWrong = new Set(currentMistakes(store));
  state.mistakeCounts = mistakeCounts(store);
  renderQuestion();
  show('screen-quiz');
}

// ---- 出題開始(ランキングからの出題) ----
function startRankingQuiz(questions, n) {
  const picked = pickRandomQuestions(questions, n);
  if (picked.length === 0) return;
  const store = loadStore();
  state.exam = null;
  state.subject = null;
  state.mode = 'ranking';
  state.questions = picked;
  state.responses = {};
  state.qi = 0;
  state.prevWrong = new Set(currentMistakes(store));
  state.mistakeCounts = mistakeCounts(store);
  renderQuestion();
  show('screen-quiz');
}

// ---- 出題開始(通常回: 科目の全問) ----
async function startQuiz(exam, subject) {
  const data = await (await fetch(`data/${exam.file}`)).json();
  state.exam = exam;
  state.subject = subject;
  state.mode = 'normal';
  state.questions = data.questions
    .filter((q) => q.subject === subject)
    .map((q) => tagQuestion(q, exam));
  state.responses = {};
  state.qi = 0;
  // 誤答バンクに入っている問題は出題画面で「前回まちがえた」バッジを出す
  // (グローバル判定だが、他科目のidはこの科目の問題リストに現れないので結果は従来と同じ)。
  const store = loadStore();
  state.prevWrong = new Set(currentMistakes(store));
  state.mistakeCounts = mistakeCounts(store);
  renderQuestion();
  show('screen-quiz');
}

// ---- 出題開始(誤答バンクからの復習回: 全期間横断、最大 REVIEW_MAX 問) ----
// subjectFilter が null なら全分野横断、科目名を渡せばその科目だけに絞って復習する。
async function startMistakeReview(subjectFilter) {
  const mistakes = currentMistakes(loadStore());
  if (mistakes.length === 0) return; // 選択画面のボタン自体が非表示のはずだが念のため

  // 選択画面表示時に作った全期間・全科目のキャッシュを使い回す(無ければ念のため再取得)。
  const combined = state.allQuestionsCache.length > 0
    ? state.allQuestionsCache
    : await (async () => {
        const idx = await (await fetch('data/index.json')).json();
        const all = [];
        for (const exam of idx.exams) {
          const data = await (await fetch(`data/${exam.file}`)).json();
          for (const q of data.questions) all.push(tagQuestion(q, exam));
        }
        return all;
      })();
  const pool = subjectFilter ? combined.filter((q) => q.subject === subjectFilter) : combined;
  const picked = pickReviewQuestions(pool, mistakes, REVIEW_MAX);
  if (picked.length === 0) return;

  state.exam = null;
  state.subject = null;
  state.mode = 'review';
  state.reviewSubject = subjectFilter;
  state.questions = picked;
  state.responses = {};
  state.qi = 0;
  // 復習回は出題されている問題が全て「バンク入り」で自明なため、個別バッジは出さない
  // (通算回数だけは問題ごとに違うので mistakeCounts 側で表示する)。
  state.prevWrong = new Set();
  state.mistakeCounts = mistakeCounts(loadStore());
  renderQuestion();
  show('screen-quiz');
}

// 復習の対象範囲(全分野=null or 特定科目)における、現時点の誤答バンク件数。
function remainingMistakeCount(subjectFilter) {
  const mistakes = currentMistakes(loadStore());
  if (!subjectFilter) return mistakes.length;
  const idSubject = new Map(state.allQuestionsCache.map((q) => [q.id, q.subject]));
  return mistakes.filter((id) => idSubject.get(id) === subjectFilter).length;
}

// 出題回の見出し(出題画面・結果画面で共用)。通常回だけ state.exam を持つ。
function sessionLabel() {
  if (state.mode === 'review') return `過去に間違えた問題集（${state.reviewSubject || '全分野'}・復習）`;
  if (state.mode === 'search') return `検索「${state.searchQuery}」から${state.questions.length}問`;
  if (state.mode === 'fresh') return `まだ解いていない問題（${state.freshSubject || '全分野'}・${state.questions.length}問）`;
  if (state.mode === 'ranking') return `よく間違える問題から${state.questions.length}問`;
  return `${state.exam.era} ／ ${state.subject}`;
}

// 期・科目をまたぐ回は問題ごとに出典が異なり得るので明示する(通常回だけが単一の期・科目)。
function isCrossExamMode() {
  return state.mode !== 'normal';
}

// ---- 1問描画 ----
function renderQuestion() {
  const q = state.questions[state.qi];
  document.getElementById('quiz-meta').textContent = sessionLabel();
  document.getElementById('progress').textContent = `第 ${state.qi + 1} / ${state.questions.length} 問`;

  const art = document.getElementById('question');
  art.innerHTML = '';

  const no = document.createElement('div');
  no.className = 'q-no';
  no.textContent = q.no;
  if (isCrossExamMode()) {
    const src = document.createElement('span');
    src.className = 'source-tag';
    src.textContent = `${q.era} ／ ${q.subject}`;
    no.appendChild(src);
  }
  // 直近で誤答なら「前回まちがえた」、直近は正解でも過去に誤答があれば通算回数だけ出す。
  const wrongCount = state.mistakeCounts[q.id] || 0;
  if (state.prevWrong && state.prevWrong.has(q.id)) {
    const badge = document.createElement('span');
    badge.className = 'prev-wrong-badge';
    badge.textContent = wrongCount > 0 ? `前回まちがえた（通算${wrongCount}回）` : '前回まちがえた';
    no.appendChild(badge);
  } else if (wrongCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'past-wrong-badge';
    badge.textContent = `過去${wrongCount}回まちがえた`;
    no.appendChild(badge);
  }
  art.appendChild(no);

  const passage = resolvedPassage(q, state.allQuestionsCache);
  if (passage) {
    const psg = document.createElement('div');
    psg.className = 'q-passage';
    psg.textContent = passage;
    art.appendChild(psg);
  }

  if (q.instruction) {
    const ins = document.createElement('div');
    ins.className = 'q-instruction';
    ins.textContent = q.instruction;
    art.appendChild(ins);
  }

  if (q.type === 'fill_blanks') {
    // 穴埋めは本文の（ア）位置にセレクトをインライン表示する
    if (q.figure) renderFigure(art, q);
    renderFillBlanks(art, q);
  } else {
    const text = document.createElement('div');
    text.className = 'q-text';
    text.textContent = q.text;
    art.appendChild(text);
    if (q.figure) renderFigure(art, q);
    if (q.type === 'truefalse_list') renderComposite(art, q);
    else renderSingle(art, q);
  }

  // ナビ状態
  document.getElementById('prev-btn').disabled = (state.qi === 0);
  const isLast = (state.qi === state.questions.length - 1);
  document.getElementById('next-btn').hidden = isLast;
  document.getElementById('grade-btn').hidden = !isLast;
}

function renderSingle(art, q) {
  const cur = state.responses[q.id]; // 1始まり index or undefined
  q.options.forEach((opt, i) => {
    const idx = i + 1;
    const label = document.createElement('label');
    label.className = 'choice' + (cur === idx ? ' picked' : '');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'single';
    input.value = String(idx);
    input.checked = (cur === idx);
    input.addEventListener('change', () => {
      state.responses[q.id] = idx;
      renderQuestion();
    });
    const span = document.createElement('span');
    span.textContent = opt;
    label.append(input, span);
    art.appendChild(label);
  });
}

function renderFigure(art, q) {
  const img = document.createElement('img');
  img.className = 'q-figure';
  img.alt = '問題図';
  img.src = q.figure;
  img.onerror = () => {
    const ph = document.createElement('div');
    ph.className = 'figure-missing';
    ph.textContent = '（図は準備中）';
    img.replaceWith(ph);
  };
  art.appendChild(img);
}

// 空欄用のインラインセレクト。未選択時は「(ラベル)」を表示し、本文中で穴として読める。
function makeBlankSelect(q, label) {
  const cur = state.responses[q.id] || {};
  const sel = document.createElement('select');
  sel.className = 'blank-inline';
  sel.dataset.label = label;
  const none = document.createElement('option');
  none.value = ''; none.textContent = `(${label})`;
  sel.appendChild(none);
  q.options.forEach((opt, i) => {
    const idx = i + 1;
    const o = document.createElement('option');
    o.value = String(idx);
    o.textContent = `${idx}. ${opt}`;
    if (cur[label] === idx) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    const r = { ...(state.responses[q.id] || {}) };
    if (sel.value === '') delete r[label];
    else r[label] = Number(sel.value);
    state.responses[q.id] = r;
    renderQuestion(); // 同じ記号(例:ウ)が複数あるとき表示を同期する
  });
  return sel;
}

// fill_blanks: 本文の [ア]…[オ] マーカー位置にセレクトを差し込み、下に選択肢一覧を表示。
function renderFillBlanks(art, q) {
  const labels = q.blanks.map((b) => b.label);
  const wrap = document.createElement('div');
  wrap.className = 'q-text fill-text';
  const re = new RegExp('[\\[［]\\s*(' + labels.join('|') + ')\\s*[\\]］]');
  let rest = q.text;
  let guard = 0;
  const placed = new Set();
  while (guard++ < 500) {
    const m = rest.match(re);
    if (!m) break;
    if (m.index > 0) wrap.appendChild(document.createTextNode(rest.slice(0, m.index)));
    wrap.appendChild(makeBlankSelect(q, m[1]));
    placed.add(m[1]);
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) wrap.appendChild(document.createTextNode(rest));
  art.appendChild(wrap);

  // 選択肢プール(紙の問題と同じく番号付きで一覧表示)
  const pool = document.createElement('div');
  pool.className = 'option-pool';
  const head = document.createElement('div');
  head.className = 'pool-head';
  head.textContent = '選択肢';
  pool.appendChild(head);
  q.options.forEach((opt, i) => {
    const item = document.createElement('span');
    item.className = 'pool-item';
    const b = document.createElement('b');
    b.textContent = i + 1;
    item.append(b, document.createTextNode(' ' + opt));
    pool.appendChild(item);
  });
  art.appendChild(pool);

  // マーカーが本文に無かった空欄はラベル付きセレクトで下に補う(フォールバック)
  for (const b of q.blanks) {
    if (placed.has(b.label)) continue;
    const group = document.createElement('div');
    group.className = 'blank-group';
    const lab = document.createElement('div');
    lab.className = 'blank-label';
    lab.textContent = `［${b.label}］`;
    group.append(lab, makeBlankSelect(q, b.label));
    art.appendChild(group);
  }
}

// truefalse_list 専用: 各設問文(ア〜オ)に2択ラジオ。
function renderComposite(art, q) {
  const cur = state.responses[q.id] || {}; // { label: 1始まり index }
  for (const b of q.blanks) {
    const group = document.createElement('div');
    group.className = 'blank-group';
    const lab = document.createElement('div');
    lab.className = 'blank-label';
    lab.textContent = `［${b.label}］`;
    group.appendChild(lab);
    if (b.text) {
      const t = document.createElement('div');
      t.className = 'blank-text';
      t.textContent = b.text;
      group.appendChild(t);
    }
    q.options.forEach((opt, i) => {
      const idx = i + 1;
      const w = document.createElement('label');
      w.className = 'tf-row';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `tf-${q.id}-${b.label}`;
      input.checked = (cur[b.label] === idx);
      input.addEventListener('change', () => {
        const r = { ...(state.responses[q.id] || {}) };
        r[b.label] = idx;
        state.responses[q.id] = r;
      });
      w.append(input, document.createTextNode(opt));
      group.appendChild(w);
    });
    art.appendChild(group);
  }
}

// ---- ナビ ----
function go(delta) {
  const n = state.qi + delta;
  if (n < 0 || n >= state.questions.length) return;
  state.qi = n;
  renderQuestion();
}

// ---- 採点 ----
// 全期間横断の復習は科目・期をまたぎ得るため、採点結果をキーごとに分割して
// それぞれ別のAttemptとして追記する(通常回はキーが1種類なので1件に退化する)。
function grade() {
  const result = gradeExam(state.questions, state.responses);
  const date = new Date().toISOString().slice(0, 10);
  const attempts = splitAttemptsByKey(
    state.questions,
    result,
    date,
    (q) => `${q.examCode}-${q.subject}`,
  );
  for (const attempt of attempts) saveAttempt(attempt);
  // 採点直後の誤答バンク残数(正解した問題はここで自動的に消えている)。
  // 通常回はその科目のスコープ、復習回は復習時に選んだスコープ(全分野 or 特定科目)で数える。
  const scopeSubject = state.mode === 'review' ? state.reviewSubject
    : state.mode === 'fresh' ? state.freshSubject
    : state.subject;
  const remaining = remainingMistakeCount(scopeSubject);
  renderResult(result, remaining, scopeSubject);
  show('screen-result');
}

// 合格判定の1行。本番と同じ配点で採点し直して出す。
// 科目の全問をそのまま解いた通常回でしか意味がないので、他のモードでは呼ばない。
function passLine() {
  const { earned } = scoreExam(state.questions, state.responses);
  const j = passJudgement(state.subject, earned);
  if (!j) return '';
  const pts = Number.isInteger(earned) ? earned : earned.toFixed(1);
  if (j.kind === 'standalone') {
    const diff = j.pass - earned;
    const verdict = j.passed
      ? `合格ライン${j.pass}点に対して <b>${pts}点</b>（+${(earned - j.pass).toFixed(0)}点）`
      : `合格ライン${j.pass}点に対して <b>${pts}点</b>（あと${diff.toFixed(0)}点）`;
    return `<div class="pass-line${j.passed ? ' ok' : ' ng'}">` +
      `${j.passed ? '合格ライン到達' : '合格ラインに届いていません'}<br>${verdict} ／ 満点${j.total}点</div>`;
  }
  // 英語・英会話は相方と合計105点中60点で判定するため、単独では確定しない。
  if (j.disqualified) {
    return `<div class="pass-line ng">${pts}点 ／ 満点${j.total}点<br>` +
      `英会話は${j.min}点未満だと合計点に関わらず不合格です。</div>`;
  }
  const reach = j.needFromPartner <= 0;
  return `<div class="pass-line${reach ? ' ok' : ''}">` +
    `${pts}点 ／ 満点${j.total}点<br>` +
    `合格は${j.partner}との合計${j.combinedPass}点以上（満点${j.combinedTotal}点）。` +
    (j.impossible
      ? `${j.partner}が満点でも届きません。`
      : `${j.partner}で<b>${j.needFromPartner}点以上</b>必要です。`) +
    `</div>`;
}

function answerText(q, resp) {
  if (isComposite(q)) {
    return q.blanks.map((b) => {
      const v = resp && resp[b.label];
      const val = v ? q.options[v - 1] : '未回答';
      return `${b.label}: ${val}`;
    }).join(' ／ ');
  }
  return resp ? q.options[resp - 1] : '未回答';
}
function correctText(q) {
  if (isComposite(q)) {
    return q.blanks.map((b) => `${b.label}: ${q.options[b.answer - 1]}`).join(' ／ ');
  }
  return q.options[q.answer - 1];
}

function renderResult(result, remainingMistakes, scopeSubject) {
  const rate = result.total > 0 ? result.score / result.total : 0;
  const headerLine = sessionLabel();
  const scopeLabel = scopeSubject || '全分野';
  const resolved = remainingMistakes === 0;
  const bankLine = resolved
    ? `${scopeLabel}の誤答バンク: 0問(すべて解消)`
    : `${scopeLabel}の誤答バンク: ${remainingMistakes}問` +
      (remainingMistakes > REVIEW_MAX ? `(次の復習は${REVIEW_MAX}問まで)` : '');
  // 合格判定は「その期・科目の全問を通しで解いた」通常回だけに出す
  // (抜粋の復習・検索・未挑戦回では本番の点数として意味を持たないため)。
  const passHtml = state.mode === 'normal' ? passLine() : '';
  document.getElementById('result-summary').innerHTML =
    `<div>${headerLine}</div>` +
    `<div class="score-big">${result.score} / ${result.total}</div>` +
    `<div class="rate">正答率 ${Math.round(rate * 100)}%</div>` +
    passHtml +
    `<div class="bank-status${resolved ? ' resolved' : ''}">${bankLine}</div>`;

  const wl = document.getElementById('wrong-list');
  wl.innerHTML = '';
  if (result.wrong.length === 0) {
    wl.innerHTML = '<p class="all-correct">全問正解。誤答はありません。</p>';
    return;
  }
  for (const id of result.wrong) {
    const q = state.questions.find((x) => x.id === id);
    if (!q) continue;
    const item = document.createElement('div');
    item.className = 'wrong-item';
    const sourceTag = isCrossExamMode()
      ? ` <span class="source-tag">${escapeHtml(q.era)}／${escapeHtml(q.subject)}</span>`
      : '';
    const parts = [
      `<div class="q-no">${q.no}${sourceTag}</div>`,
      `<div class="q-text">${escapeHtml(q.text)}</div>`,
      `<div class="yours">あなたの解答: ${escapeHtml(answerText(q, state.responses[q.id]))}</div>`,
      `<div class="correct">正解: ${escapeHtml(correctText(q))}</div>`,
    ];
    if (q.explanation) parts.push(`<div class="explanation">${escapeHtml(q.explanation)}</div>`);
    item.innerHTML = parts.join('');
    wl.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- 結線 ----
document.getElementById('prev-btn').addEventListener('click', () => go(-1));
document.getElementById('next-btn').addEventListener('click', () => go(1));
document.getElementById('grade-btn').addEventListener('click', grade);
document.getElementById('home-btn').addEventListener('click', initSelect);
document.getElementById('result-home-btn').addEventListener('click', initSelect);
document.getElementById('search-input').addEventListener('input', (e) => renderSearchResults(e.target.value));

initSelect();
