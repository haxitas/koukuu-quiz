// app.js — 表示と画面遷移のみ。採点ロジックは quiz-core.mjs に委譲(外部API呼び出しなし)。
import { gradeQuestion, gradeExam, makeAttempt, appendResult, statsForKey, isComposite } from './quiz-core.mjs';

const STORE_KEY = 'aviation_quiz_results';

const state = {
  exams: [],
  exam: null,      // 選択中の試験(index.jsonのentry)
  subject: null,   // 選択中の科目名
  questions: [],   // 出題(科目でフィルタ済み)
  responses: {},   // { questionId: response }
  qi: 0,           // 現在の問番号(0始まり)
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

// ---- 出題開始 ----
async function startQuiz(exam, subject) {
  const res = await fetch(`data/${exam.file}`);
  const data = await res.json();
  state.exam = exam;
  state.subject = subject;
  state.questions = data.questions.filter((q) => q.subject === subject);
  state.responses = {};
  state.qi = 0;
  renderQuestion();
  show('screen-quiz');
}

// ---- 1問描画 ----
function renderQuestion() {
  const q = state.questions[state.qi];
  document.getElementById('quiz-meta').textContent = `${state.exam.era} ／ ${state.subject}`;
  document.getElementById('progress').textContent = `第 ${state.qi + 1} / ${state.questions.length} 問`;

  const art = document.getElementById('question');
  art.innerHTML = '';

  const no = document.createElement('div');
  no.className = 'q-no';
  no.textContent = q.no;
  art.appendChild(no);

  if (q.instruction) {
    const ins = document.createElement('div');
    ins.className = 'q-instruction';
    ins.textContent = q.instruction;
    art.appendChild(ins);
  }

  const text = document.createElement('div');
  text.className = 'q-text';
  text.textContent = q.text;
  art.appendChild(text);

  if (q.figure) {
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

  if (isComposite(q)) renderComposite(art, q);
  else renderSingle(art, q);

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

    if (q.type === 'truefalse_list') {
      // 2択をラジオで
      q.options.forEach((opt, i) => {
        const idx = i + 1;
        const wrap = document.createElement('label');
        wrap.className = 'tf-row';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `tf-${b.label}`;
        input.checked = (cur[b.label] === idx);
        input.addEventListener('change', () => {
          const r = { ...(state.responses[q.id] || {}) };
          r[b.label] = idx;
          state.responses[q.id] = r;
        });
        wrap.append(input, document.createTextNode(opt));
        group.appendChild(wrap);
      });
    } else {
      // fill_blanks: 選択肢プールから select
      const sel = document.createElement('select');
      const none = document.createElement('option');
      none.value = ''; none.textContent = '— 選択 —';
      sel.appendChild(none);
      q.options.forEach((opt, i) => {
        const idx = i + 1;
        const o = document.createElement('option');
        o.value = String(idx);
        o.textContent = `${idx}. ${opt}`;
        if (cur[b.label] === idx) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        const r = { ...(state.responses[q.id] || {}) };
        if (sel.value === '') delete r[b.label];
        else r[b.label] = Number(sel.value);
        state.responses[q.id] = r;
      });
      group.appendChild(sel);
    }
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
function grade() {
  const result = gradeExam(state.questions, state.responses);
  const key = `${state.exam.code}-${state.subject}`;
  const date = new Date().toISOString().slice(0, 10);
  saveAttempt(makeAttempt(key, date, result));
  renderResult(result);
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

function renderResult(result) {
  const rate = result.total > 0 ? result.score / result.total : 0;
  document.getElementById('result-summary').innerHTML =
    `<div>${state.exam.era} ／ ${state.subject}</div>` +
    `<div class="score-big">${result.score} / ${result.total}</div>` +
    `<div class="rate">正答率 ${Math.round(rate * 100)}%</div>`;

  const wl = document.getElementById('wrong-list');
  wl.innerHTML = '';
  if (result.wrong.length === 0) {
    wl.innerHTML = '<p class="all-correct">全問正解。誤答はありません。</p>';
    return;
  }
  for (const i of result.wrong) {
    const q = state.questions[i];
    const item = document.createElement('div');
    item.className = 'wrong-item';
    const parts = [
      `<div class="q-no">${q.no}</div>`,
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
