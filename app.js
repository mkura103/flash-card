/* 単語帳アプリ
 * - data/words.json から単語を読み込む
 * - 学習状態（習熟度・正答数など）は localStorage に保存
 * - シャッフル / 登録順 / 習熟度優先 の出題、カテゴリ絞り込み、苦手のみ出題に対応
 */

const SETTINGS_KEY = "flashcard.settings.v1";
// 学習記録はデッキごとに分ける（STORAGE_KEY はデッキ確定後に決まる）
const PROGRESS_KEY_PREFIX = "flashcard.progress.v1.";

const state = {
  decks: [],          // [{ id, file, name }]
  deckId: null,       // 現在のデッキid
  cards: [],          // 全カード
  queue: [],          // 現在の出題キュー（カードidの配列）
  index: 0,           // queue 内の現在位置
  flipped: false,
  answered: false,    // クイズモードで回答済みか
  progress: {},       // id -> { level, correct, wrong, lastSeen }
  settings: {
    deck: null,
    category: "all",
    difficulty: "all",
    mode: "shuffle",
    studyMode: "flip", // flip | quiz
    reverse: false,
    onlyWeak: false,
  },
};

function progressKey() {
  return PROGRESS_KEY_PREFIX + (state.deckId || "default");
}

// DOM
const el = {
  title: document.getElementById("deck-title"),
  desc: document.getElementById("deck-desc"),
  deckSelect: document.getElementById("deck-select"),
  categorySelect: document.getElementById("category-select"),
  difficultySelect: document.getElementById("difficulty-select"),
  modeSelect: document.getElementById("mode-select"),
  studyModeSelect: document.getElementById("study-mode-select"),
  reverse: document.getElementById("reverse"),
  onlyWeak: document.getElementById("only-weak"),
  restartBtn: document.getElementById("restart-btn"),
  quizArea: document.getElementById("quiz-area"),
  quizChoices: document.getElementById("quiz-choices"),
  quizNextBtn: document.getElementById("quiz-next-btn"),
  answerControls: document.getElementById("answer-controls"),
  progressFill: document.getElementById("progress-fill"),
  progressCount: document.getElementById("progress-count"),
  accuracyText: document.getElementById("accuracy-text"),
  card: document.getElementById("card"),
  cardCategory: document.getElementById("card-category"),
  cardDifficulty: document.getElementById("card-difficulty"),
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
    const raw = localStorage.getItem(progressKey());
    state.progress = raw ? JSON.parse(raw) : {};
  } catch {
    state.progress = {};
  }
}
function saveProgress() {
  try {
    localStorage.setItem(progressKey(), JSON.stringify(state.progress));
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
// デッキ一覧。decks.json が無い場合は words.json 単体にフォールバック
async function loadDecks() {
  try {
    const res = await fetch("data/decks.json", { cache: "no-store" });
    if (!res.ok) throw new Error();
    const json = await res.json();
    state.decks = Array.isArray(json.decks) ? json.decks : [];
    // 設定 > decks.json の default > 先頭 の優先で初期デッキを決める
    const ids = state.decks.map((d) => d.id);
    if (state.settings.deck && ids.includes(state.settings.deck)) {
      state.deckId = state.settings.deck;
    } else if (json.default && ids.includes(json.default)) {
      state.deckId = json.default;
    } else {
      state.deckId = ids[0] || null;
    }
  } catch {
    state.decks = [{ id: "words", file: "words.json", name: "単語帳" }];
    state.deckId = "words";
  }
}

async function loadCards() {
  const deck = state.decks.find((d) => d.id === state.deckId) || state.decks[0];
  const file = deck ? deck.file : "words.json";
  const res = await fetch(`data/${file}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${file} の取得に失敗しました (${res.status})`);
  const json = await res.json();
  state.cards = Array.isArray(json.cards) ? json.cards : [];
  if (json.meta) {
    el.title.textContent = json.meta.title || (deck && deck.name) || "単語帳";
    el.desc.textContent = json.meta.description || "";
  } else {
    el.title.textContent = (deck && deck.name) || "単語帳";
    el.desc.textContent = "";
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
  const { category, difficulty, mode, onlyWeak } = state.settings;

  let pool = state.cards.filter((c) => category === "all" || c.category === category);

  if (difficulty !== "all") {
    pool = pool.filter((c) => String(c.difficulty) === String(difficulty));
  }

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

/* ---------- 表裏の取り出し（逆引き対応） ---------- */
// 逆引き ON のときは front/back を入れ替える。hint は表面の補足なので逆引き時は出さない
function faces(card) {
  if (state.settings.reverse) {
    return { front: card.back, back: card.front, hint: "" };
  }
  return { front: card.front, back: card.back, hint: card.hint || "" };
}

/* ---------- デッキ選択肢の生成 ---------- */
function populateDecks() {
  el.deckSelect.innerHTML = "";
  for (const deck of state.decks) {
    const opt = document.createElement("option");
    opt.value = deck.id;
    opt.textContent = deck.name || deck.id;
    el.deckSelect.appendChild(opt);
  }
  el.deckSelect.value = state.deckId;
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
  // カテゴリはデッキごとに変わるため、現在のデッキに無い値は all に戻す
  const catValues = ["all", ...categories];
  if (!catValues.includes(state.settings.category)) state.settings.category = "all";
  el.categorySelect.value = state.settings.category;
  el.difficultySelect.value = state.settings.difficulty;
  el.modeSelect.value = state.settings.mode;
  el.studyModeSelect.value = state.settings.studyMode;
  el.reverse.checked = state.settings.reverse;
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
  state.answered = false;
  el.card.classList.remove("flipped");

  el.cardCategory.textContent = card.category || "";
  el.cardCategory.style.display = card.category ? "inline-block" : "none";

  const diff = Number(card.difficulty);
  if (diff >= 1 && diff <= 3) {
    el.cardDifficulty.textContent = "★".repeat(diff);
    el.cardDifficulty.title = ["", "易しい", "ふつう", "難しい"][diff];
    el.cardDifficulty.style.display = "inline-block";
  } else {
    el.cardDifficulty.style.display = "none";
  }

  const f = faces(card);
  el.frontText.textContent = f.front;
  el.hint.textContent = f.hint;
  el.hint.style.display = f.hint ? "block" : "none";
  el.backText.textContent = f.back;

  el.progressCount.textContent = `${state.index + 1} / ${total}`;
  el.progressFill.style.width = `${(state.index / total) * 100}%`;

  // 学習方式に応じて UI を切り替える
  const isQuiz = state.settings.studyMode === "quiz";
  el.quizArea.hidden = !isQuiz;
  el.answerControls.hidden = isQuiz;
  el.card.classList.toggle("card--quiz", isQuiz);
  if (isQuiz) {
    renderQuiz(card, f);
  }

  updateStats();
}

/* ---------- クイズ（4択） ---------- */
// 同デッキの他カードの「答え（裏面）」から誤答を選ぶ。
// 同カテゴリを優先し、足りなければ全体から補う。
function buildChoices(card, correctText) {
  const pool = state.cards.filter((c) => c.id !== card.id);
  const sameCat = pool.filter((c) => c.category === card.category);
  const ranked = shuffle(sameCat).concat(shuffle(pool.filter((c) => c.category !== card.category)));

  const distractors = [];
  const seen = new Set([correctText]);
  for (const c of ranked) {
    const text = faces(c).back;
    if (seen.has(text)) continue;
    seen.add(text);
    distractors.push(text);
    if (distractors.length >= 3) break;
  }
  return shuffle([correctText, ...distractors]);
}

function renderQuiz(card, f) {
  el.quizChoices.innerHTML = "";
  el.quizNextBtn.hidden = true;
  const correct = f.back;
  const choices = buildChoices(card, correct);

  for (const text of choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quiz-choice";
    btn.textContent = text;
    btn.addEventListener("click", () => onQuizChoice(btn, text === correct, correct));
    el.quizChoices.appendChild(btn);
  }
}

function onQuizChoice(btn, isCorrect, correctText) {
  if (state.answered) return;
  state.answered = true;

  // 全選択肢を無効化し、正解・誤答を色付け
  const buttons = el.quizChoices.querySelectorAll(".quiz-choice");
  for (const b of buttons) {
    b.disabled = true;
    if (b.textContent === correctText) b.classList.add("is-correct");
  }
  if (!isCorrect) btn.classList.add("is-wrong");

  // めくりモードと同じ習熟度ロジックに記録
  recordAnswer(isCorrect);
  el.quizNextBtn.hidden = false;
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
  if (state.settings.studyMode === "quiz") return; // クイズ中はめくらない
  state.flipped = !state.flipped;
  el.card.classList.toggle("flipped", state.flipped);
}

// デッキを切り替える: カードと学習記録を読み直して再構築
async function switchDeck(deckId) {
  state.deckId = deckId;
  state.settings.deck = deckId;
  saveSettings();
  loadProgress();
  try {
    await loadCards();
  } catch (err) {
    el.emptyMessage.hidden = false;
    el.emptyMessage.textContent = `データ読み込みエラー: ${err.message}`;
    el.card.style.visibility = "hidden";
    return;
  }
  populateCategories();
  restart();
}

// 習熟度・正答数を記録するだけ（画面遷移はしない）
function recordAnswer(known) {
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
  updateStats();
}

// めくりモードの「覚えた / まだ」: 記録して次へ
function answer(known) {
  if (!currentCard()) return;
  recordAnswer(known);
  next();
}

function next() {
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
  el.quizNextBtn.addEventListener("click", next);

  el.deckSelect.addEventListener("change", () => {
    switchDeck(el.deckSelect.value);
  });
  el.studyModeSelect.addEventListener("change", () => {
    state.settings.studyMode = el.studyModeSelect.value;
    saveSettings();
    restart();
  });
  el.reverse.addEventListener("change", () => {
    state.settings.reverse = el.reverse.checked;
    saveSettings();
    restart();
  });

  el.categorySelect.addEventListener("change", () => {
    state.settings.category = el.categorySelect.value;
    saveSettings();
    restart();
  });
  el.difficultySelect.addEventListener("change", () => {
    state.settings.difficulty = el.difficultySelect.value;
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

  // キーボードショートカット
  // めくり: ←まだ / →覚えた   クイズ: 回答後に → か Enter で次へ
  document.addEventListener("keydown", (e) => {
    if (state.settings.studyMode === "quiz") {
      if (state.answered && (e.key === "ArrowRight" || e.key === "Enter")) next();
      return;
    }
    if (e.key === "ArrowRight") answer(true);
    else if (e.key === "ArrowLeft") answer(false);
  });
}

/* ---------- 起動 ---------- */
async function init() {
  loadSettings();
  await loadDecks();          // デッキ一覧と初期デッキの確定
  loadProgress();             // 確定したデッキの学習記録を読む
  try {
    await loadCards();
  } catch (err) {
    el.emptyMessage.hidden = false;
    el.emptyMessage.textContent = `データ読み込みエラー: ${err.message}`;
    el.card.style.visibility = "hidden";
    return;
  }
  populateDecks();
  populateCategories();
  buildQueue();
  bindEvents();
  render();
}

init();
