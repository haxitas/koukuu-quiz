// app.js — 表示と画面遷移のみ。採点ロジックは quiz-core.mjs に委譲(外部API呼び出しなし)。
import {
  gradeExam, appendResult, statsForKey, isComposite,
  currentMistakes, pickReviewQuestions, splitAttemptsByKey,
} from './quiz-core.mjs';

const STORE_KEY = 'aviation_quiz_results';
const REVIEW_MAX = 10; // 復習モードの1回あたりの最大出題数

const state = {
  exams: [],
  exam: null,      // 選択中の試験(index.jsonのentry)
  subject: null,   // 選択中の科目名
  mode: 'normal',  // 'normal'(全問) | 'review'(誤答バンクからの復習)
  questions: [],   // 出題(科目でフィルタ済み、復習モードは誤答のみ)
  responses: {},   // { questionId: response }
  qi: 0,           // 現在の問番号(0始まり)
  prevWrong: null, // Set<questionId> 出題時点で誤答バンクに入っていたid(バッジ表示用)
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

// ---- 選択画面 ----
async function initSelect() {
  const res = await fetch('data/index.json');
  const idx = await res.json();
  state.exams = idx.exams;
  const store = loadStore();
  const list = document.getElementById('exam-list');
  list.innerHTML = '';

  // ---- グローバル復習エントリ(全期間・全科目の誤答バンク。最上部に1つだけ) ----
  const globalMistakes = currentMistakes(store);
  if (globalMistakes.length > 0) {
    const gbtn = document.createElement('button');
    gbtn.className = 'global-review-btn';
    gbtn.textContent = globalMistakes.length > REVIEW_MAX
      ? `過去に間違えた問題集（誤答${globalMistakes.length}問中${REVIEW_MAX}問）`
      : `過去に間違えた問題集（誤答${globalMistakes.length}問）`;
    gbtn.addEventListener('click', startGlobalReview);
    list.appendChild(gbtn);
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
  state.prevWrong = new Set(currentMistakes(loadStore()));
  renderQuestion();
  show('screen-quiz');
}

// ---- 出題開始(グローバル復習回: 全期間・全科目の誤答バンクから最大 REVIEW_MAX 問) ----
async function startGlobalReview() {
  const mistakes = currentMistakes(loadStore());
  if (mistakes.length === 0) return; // 選択画面のボタン自体が非表示のはずだが念のため

  // data/index.json 記載の全期を取得して結合する(state.exams、build_index.py が
  // code降順=新しい期が先に並ぶ)。期の数は少数な前提なので全期取得のコストは無視できる。
  const combined = [];
  for (const exam of state.exams) {
    const data = await (await fetch(`data/${exam.file}`)).json();
    for (const q of data.questions) combined.push(tagQuestion(q, exam));
  }
  const picked = pickReviewQuestions(combined, mistakes, REVIEW_MAX);
  if (picked.length === 0) return;

  state.exam = null;
  state.subject = null;
  state.mode = 'review';
  state.questions = picked;
  state.responses = {};
  state.qi = 0;
  // 復習回は出題されている問題が全て「バンク入り」で自明なため、個別バッジは出さない。
  state.prevWrong = new Set();
  renderQuestion();
  show('screen-quiz');
}

// ---- 1問描画 ----
function renderQuestion() {
  const q = state.questions[state.qi];
  document.getElementById('quiz-meta').textContent = state.mode === 'review'
    ? '過去に間違えた問題集（復習）'
    : `${state.exam.era} ／ ${state.subject}`;
  document.getElementById('progress').textContent = `第 ${state.qi + 1} / ${state.questions.length} 問`;

  const art = document.getElementById('question');
  art.innerHTML = '';

  const no = document.createElement('div');
  no.className = 'q-no';
  no.textContent = q.no;
  if (state.mode === 'review') {
    // 全期間横断の復習は問題ごとに出典(期・科目)が異なり得るので明示する。
    const src = document.createElement('span');
    src.className = 'source-tag';
    src.textContent = `${q.era} ／ ${q.subject}`;
    no.appendChild(src);
  }
  if (state.prevWrong && state.prevWrong.has(q.id)) {
    const badge = document.createElement('span');
    badge.className = 'prev-wrong-badge';
    badge.textContent = '前回まちがえた';
    no.appendChild(badge);
  }
  art.appendChild(no);

  if (q.passage) {
    const psg = document.createElement('div');
    psg.className = 'q-passage';
    psg.textContent = q.passage;
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
  // 採点直後のグローバル誤答バンク残数(正解した問題はここで自動的に消えている)。
  const remaining = currentMistakes(loadStore()).length;
  renderResult(result, remaining);
  show('screen-result');
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

function renderResult(result, remainingMistakes) {
  const rate = result.total > 0 ? result.score / result.total : 0;
  const headerLine = state.mode === 'review'
    ? '過去に間違えた問題集（復習）'
    : `${state.exam.era} ／ ${state.subject}`;
  const resolved = remainingMistakes === 0;
  const bankLine = resolved
    ? '誤答バンク: 0問(すべて解消)'
    : `誤答バンク: ${remainingMistakes}問` +
      (remainingMistakes > REVIEW_MAX ? `(次の復習は${REVIEW_MAX}問まで)` : '');
  document.getElementById('result-summary').innerHTML =
    `<div>${headerLine}</div>` +
    `<div class="score-big">${result.score} / ${result.total}</div>` +
    `<div class="rate">正答率 ${Math.round(rate * 100)}%</div>` +
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
    const sourceTag = state.mode === 'review'
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

initSelect();
