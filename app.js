/* 単語帳アプリ
 * - data/words.json から単語を読み込む
 * - 学習状態（習熟度・正答数など）は localStorage に保存
 * - シャッフル / 登録順 / 習熟度優先 の出題、カテゴリ絞り込み、苦手のみ出題に対応
 */

const STORAGE_KEY = "flashcard.progress.v1";
const SETTINGS_KEY = "flashcard.settings.v1";

const state = {
  cards: [],          // 全カード
  queue: [],          // 現在の出題キュー（カードidの配列）
  index: 0,           // queue 内の現在位置
  flipped: false,
  progress: {},       // id -> { level, correct, wrong, lastSeen }
  settings: { category: "all", mode: "shuffle", onlyWeak: false },
};

// DOM
const el = {
  title: document.getElementById("deck-title"),
  desc: document.getElementById("deck-desc"),
  categorySelect: document.getElementById("category-select"),
  modeSelect: document.getElementById("mode-select"),
  onlyWeak: document.getElementById("only-weak"),
  restartBtn: document.getElementById("restart-btn"),
  progressFill: document.getElementById("progress-fill"),
  progressCount: document.getElementById("progress-count"),
  accuracyText: document.getElementById("accuracy-text"),
  card: document.getElementById("card"),
  cardCategory: document.getElementById("card-category"),
  frontText: document.getElementById("card-front-text"),
  hint: document.getElementById("card-hint"),
  backText: document.getElementById("card-back-text"),
  knownBtn: document.getElementById("known-btn"),
  unknownBtn: document.getElementById("unknown-btn"),
  emptyMessage: document.getElementById("empty-message"),
  resetBtn: document.getElementById("reset-progress-btn"),
  statsSummary: document.getElementById("stats-summary"),
};

// 習熟度レベルの最大値（これ以上は「習得済み」扱い）
const MAX_LEVEL = 5;
const WEAK_THRESHOLD = 2; // level < この値 を苦手とみなす

/* ---------- localStorage ---------- */
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.progress = raw ? JSON.parse(raw) : {};
  } catch {
    state.progress = {};
  }
}
function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
  } catch { /* 容量超過などは無視 */ }
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(state.settings, JSON.parse(raw));
  } catch { /* noop */ }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  } catch { /* noop */ }
}

function getCardProgress(id) {
  if (!state.progress[id]) {
    state.progress[id] = { level: 0, correct: 0, wrong: 0, lastSeen: 0 };
  }
  return state.progress[id];
}

/* ---------- データ読み込み ---------- */
async function loadCards() {
  const res = await fetch("data/words.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`words.json の取得に失敗しました (${res.status})`);
  const json = await res.json();
  state.cards = Array.isArray(json.cards) ? json.cards : [];
  if (json.meta) {
    if (json.meta.title) el.title.textContent = json.meta.title;
    if (json.meta.description) el.desc.textContent = json.meta.description;
  }
}

/* ---------- 出題キューの構築 ---------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQueue() {
  const { category, mode, onlyWeak } = state.settings;

  let pool = state.cards.filter((c) => category === "all" || c.category === category);

  if (onlyWeak) {
    pool = pool.filter((c) => getCardProgress(c.id).level < WEAK_THRESHOLD);
  }

  if (mode === "order") {
    // 登録順そのまま
  } else if (mode === "srs") {
    // 習熟度が低い順 -> 同レベルはランダム
    pool = shuffle(pool).sort(
      (a, b) => getCardProgress(a.id).level - getCardProgress(b.id).level
    );
  } else {
    // shuffle
    pool = shuffle(pool);
  }

  state.queue = pool.map((c) => c.id);
  state.index = 0;
  state.flipped = false;
}

/* ---------- カテゴリ選択肢の生成 ---------- */
function populateCategories() {
  const categories = [...new Set(state.cards.map((c) => c.category).filter(Boolean))];
  el.categorySelect.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "すべて";
  el.categorySelect.appendChild(allOpt);
  for (const cat of categories) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    el.categorySelect.appendChild(opt);
  }
  el.categorySelect.value = state.settings.category;
  el.modeSelect.value = state.settings.mode;
  el.onlyWeak.checked = state.settings.onlyWeak;
}

/* ---------- 描画 ---------- */
function currentCard() {
  const id = state.queue[state.index];
  return state.cards.find((c) => c.id === id) || null;
}

function render() {
  const card = currentCard();
  const total = state.queue.length;

  if (!card) {
    // 出題対象なし、または完了
    el.emptyMessage.hidden = total !== 0;
    el.card.style.visibility = total === 0 ? "hidden" : "hidden";
    if (total === 0) {
      el.emptyMessage.textContent = "出題できるカードがありません。設定を変えてください。";
    } else {
      el.emptyMessage.hidden = false;
      el.emptyMessage.textContent = "このセットは完了しました。「やり直す」で再挑戦できます。";
    }
    el.progressCount.textContent = `${Math.min(state.index, total)} / ${total}`;
    el.progressFill.style.width = total ? "100%" : "0%";
    updateStats();
    return;
  }

  el.emptyMessage.hidden = true;
  el.card.style.visibility = "visible";

  // めくり状態をリセット
  state.flipped = false;
  el.card.classList.remove("flipped");

  el.cardCategory.textContent = card.category || "";
  el.cardCategory.style.display = card.category ? "inline-block" : "none";
  el.frontText.textContent = card.front;
  el.hint.textContent = card.hint || "";
  el.hint.style.display = card.hint ? "block" : "none";
  el.backText.textContent = card.back;

  el.progressCount.textContent = `${state.index + 1} / ${total}`;
  el.progressFill.style.width = `${(state.index / total) * 100}%`;

  updateStats();
}

function updateStats() {
  // 全体の正答率と習得状況
  let correct = 0, wrong = 0, mastered = 0;
  const ids = Object.keys(state.progress);
  for (const id of ids) {
    const p = state.progress[id];
    correct += p.correct;
    wrong += p.wrong;
    if (p.level >= MAX_LEVEL) mastered++;
  }
  const totalAnswers = correct + wrong;
  el.accuracyText.textContent =
    totalAnswers > 0 ? `正答率 ${Math.round((correct / totalAnswers) * 100)}%` : "正答率 -";
  el.statsSummary.textContent =
    `習得 ${mastered} / ${state.cards.length} 語 ・ 累計回答 ${totalAnswers} 回`;
}

/* ---------- 操作 ---------- */
function flip() {
  if (!currentCard()) return;
  state.flipped = !state.flipped;
  el.card.classList.toggle("flipped", state.flipped);
}

function answer(known) {
  const card = currentCard();
  if (!card) return;
  const p = getCardProgress(card.id);
  if (known) {
    p.correct++;
    p.level = Math.min(MAX_LEVEL, p.level + 1);
  } else {
    p.wrong++;
    p.level = Math.max(0, p.level - 1);
  }
  p.lastSeen = Date.now();
  saveProgress();

  state.index++;
  render();
}

function restart() {
  buildQueue();
  render();
}

function resetProgress() {
  if (!confirm("学習記録（習熟度・正答数）をすべて消去します。よろしいですか？")) return;
  state.progress = {};
  saveProgress();
  restart();
}

/* ---------- イベント ---------- */
function bindEvents() {
  el.card.addEventListener("click", flip);
  el.card.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      flip();
    }
  });

  el.knownBtn.addEventListener("click", () => answer(true));
  el.unknownBtn.addEventListener("click", () => answer(false));

  el.categorySelect.addEventListener("change", () => {
    state.settings.category = el.categorySelect.value;
    saveSettings();
    restart();
  });
  el.modeSelect.addEventListener("change", () => {
    state.settings.mode = el.modeSelect.value;
    saveSettings();
    restart();
  });
  el.onlyWeak.addEventListener("change", () => {
    state.settings.onlyWeak = el.onlyWeak.checked;
    saveSettings();
    restart();
  });

  el.restartBtn.addEventListener("click", restart);
  el.resetBtn.addEventListener("click", resetProgress);

  // キーボードショートカット: ←まだ / →覚えた
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") answer(true);
    else if (e.key === "ArrowLeft") answer(false);
  });
}

/* ---------- 起動 ---------- */
async function init() {
  loadProgress();
  loadSettings();
  try {
    await loadCards();
  } catch (err) {
    el.emptyMessage.hidden = false;
    el.emptyMessage.textContent = `データ読み込みエラー: ${err.message}`;
    el.card.style.visibility = "hidden";
    return;
  }
  populateCategories();
  buildQueue();
  bindEvents();
  render();
}

init();
