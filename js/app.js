const DEFAULT_SETTINGS = {
  alphabet: 'ru',
  range: { ru: ['А', 'Я'], en: ['A', 'Z'] },
  excluded: { ru: [], en: [] },
  delay: 6,
  repeatTwice: true,
  checkDelay: 3,
  rate: 0.8,
  voice: { ru: '', en: '' },
  font: { ru: 'marck', en: 'print-caps' },
  caseMode: 'none',
  voiceSource: 'recorded',
  limitEnabled: false,
  limitCount: 10,
};

const REPEAT_GAP_MS = 1500;
const INTRO_MS = 3000;
const RING_LENGTH = 2 * Math.PI * 54;

const $ = (id) => document.getElementById(id);

let settings = Storage.loadSettings(DEFAULT_SETTINGS);

// ---------- Последовательное озвучивание с паузами ----------

// Проходит по элементам: произносит каждый (возможно, несколько раз), затем ждёт паузу.
// Поддерживает паузу, перезапуск с любого элемента и остановку.
class Sequencer {
  constructor({ count, say, repeats = 1, delayMs, intro, onStep, onSpeaking, onTick, onDone }) {
    Object.assign(this, { count, say, repeats, delayMs, intro, onStep, onSpeaking, onTick, onDone });
    this.index = 0;
    this.paused = false;
    this.speaking = false;
    this.interrupted = false;
    this.runId = 0;
    this.finished = false;
  }

  start(from = 0) {
    const run = ++this.runId;
    this.paused = false;
    this.finished = false;
    this.loop(from, run);
  }

  alive(run) {
    return run === this.runId;
  }

  async loop(from, run) {
    if (this.intro) {
      const intro = this.intro;
      this.intro = null;
      if (!(await intro(run))) return;
    }
    for (let i = from; i < this.count; i++) {
      this.index = i;
      this.onStep?.(i);
      do {
        this.interrupted = false;
        for (let r = 0; r < this.repeats; r++) {
          if (r > 0 && !(await this.sleep(REPEAT_GAP_MS, run))) return;
          this.speaking = true;
          this.onSpeaking?.(i);
          await this.say(i);
          this.speaking = false;
          if (!this.alive(run)) return;
          if (this.interrupted) break;
        }
        // Если поставили на паузу посреди слова — после паузы произнесём букву заново.
        if (!(await this.waitWhilePaused(run))) return;
      } while (this.interrupted);
      if (!(await this.sleep(this.delayMs(), run, true))) return;
    }
    if (this.alive(run)) {
      this.finished = true;
      this.onDone?.();
    }
  }

  // Ждёт ms миллисекунд, не считая время на паузе. false — запуск отменён.
  async sleep(ms, run, ticking = false) {
    let left = ms;
    if (ticking) this.onTick?.(left, ms);
    while (left > 0) {
      await new Promise((r) => setTimeout(r, 100));
      if (!this.alive(run)) return false;
      if (!this.paused) left -= 100;
      if (ticking) this.onTick?.(Math.max(left, 0), ms);
    }
    return true;
  }

  async waitWhilePaused(run) {
    while (this.paused) {
      await new Promise((r) => setTimeout(r, 100));
      if (!this.alive(run)) return false;
    }
    return true;
  }

  pause() {
    this.paused = true;
    if (this.speaking) {
      this.interrupted = true;
      stopSpeaking();
    }
  }

  resume() {
    this.paused = false;
  }

  stop() {
    this.runId++;
    this.paused = false;
    stopSpeaking();
  }
}

// ---------- Вспомогательные функции ----------

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

function lettersWord(n) {
  return `${n} ${plural(n, 'буква', 'буквы', 'букв')}`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

function saveSettings() {
  Storage.saveSettings(settings);
}

function voiceName(alphabetId) {
  return settings.voice[alphabetId];
}

// Что произнести: запись (file) и текст для синтезатора браузера на случай,
// если запись недоступна или в настройках выбран голос браузера.
function letterClip(alphabetId, upper) {
  return {
    file: letterAudioFile(alphabetId, upper),
    text: findLetter(alphabetId, upper)[2],
    alphabetId,
  };
}

// Служебные фразы всегда по‑русски.
function phraseClip(key, text) {
  return { file: `audio/ru/${key}.mp3`, text, alphabetId: 'ru' };
}

const PHRASES = {
  start: phraseClip('start', 'Начинаем диктант'),
  end: phraseClip('end', 'Диктант окончен'),
  upper: phraseClip('upper', 'заглавная'),
  lower: phraseClip('lower', 'строчная'),
};

// Произносит фрагмент; true — договорил, false — прервали.
async function say(clip) {
  if (settings.voiceSource === 'recorded') {
    const result = await Recorded.play(clip.file);
    if (result !== 'failed') return result === 'ended';
  }
  return Speech.speak(clip.text, ALPHABETS[clip.alphabetId].lang, voiceName(clip.alphabetId));
}

async function sayAll(clips) {
  for (const clip of clips) {
    if (!(await say(clip))) return false;
  }
  return true;
}

function stopSpeaking() {
  Recorded.stop();
  Speech.cancel();
}

const CASE_MODES = {
  none: '',
  upper: 'заглавные',
  lower: 'строчные',
  mixed: 'заглавные и строчные вперемешку',
};

// Регистр каждой буквы диктанта: 'upper' / 'lower', или null — не называть.
function makeCases(mode, count) {
  if (mode === 'upper' || mode === 'lower') return Array(count).fill(mode);
  if (mode === 'mixed') {
    // Поровну заглавных и строчных, нечётную букву — случайно.
    const half = Array.from({ length: count }, (_, i) => (i < Math.floor(count / 2) ? 'upper' : 'lower'));
    if (count % 2 && Math.random() < 0.5) half[count - 1] = 'upper';
    return shuffle(half);
  }
  return Array(count).fill(null);
}

// Фрагменты для i‑й буквы диктанта: при необходимости «заглавная»/«строчная» перед буквой.
function itemClips(entry, i) {
  const letter = letterClip(entry.alphabet, entry.letters[i]);
  const letterCase = entry.cases?.[i];
  return letterCase ? [PHRASES[letterCase], letter] : [letter];
}

function speakItem(entry, i) {
  return sayAll(itemClips(entry, i));
}

// Подгружает записи заранее, чтобы между буквами не было задержек на скачивание.
function preloadEntry(entry) {
  const files = entry.letters.map((upper) => letterAudioFile(entry.alphabet, upper));
  Recorded.preload([...files, ...Object.values(PHRASES).map((p) => p.file)]);
}

function cursiveFont(alphabetId) {
  const fonts = CURSIVE_FONTS[alphabetId];
  return fonts.find((f) => f.id === settings.font[alphabetId]) || fonts[0];
}

// Не даём экрану погаснуть во время диктанта (где поддерживается).
const WakeLock = {
  lock: null,
  async acquire() {
    try {
      if ('wakeLock' in navigator && !this.lock) {
        this.lock = await navigator.wakeLock.request('screen');
        this.lock.addEventListener('release', () => { this.lock = null; });
      }
    } catch {
      this.lock = null;
    }
  },
  release() {
    this.lock?.release();
    this.lock = null;
  },
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && activeSequencer && !activeSequencer.finished) {
    WakeLock.acquire();
  }
});

// ---------- Навигация между экранами ----------

let activeSequencer = null;
let currentEntry = null;

function showScreen(name) {
  for (const id of ['setup', 'dictation', 'check']) {
    $(`screen-${id}`).hidden = id !== name;
  }
  window.scrollTo(0, 0);
}

function openScreen(name) {
  if (history.state) history.replaceState({ screen: name }, '');
  else history.pushState({ screen: name }, '');
  showScreen(name);
}

function stopActive() {
  activeSequencer?.stop();
  activeSequencer = null;
  stopPreview();
  WakeLock.release();
}

function showSetup() {
  stopActive();
  // Приостанавливаем звук только на главной: пара suspend()+resume() подряд
  // при переходе «диктант → проверка» в Firefox оставляет контекст приостановленным.
  Recorded.suspend();
  showScreen('setup');
  renderHistory();
}

function goHome() {
  if (history.state) history.back();
  else showSetup();
}

window.addEventListener('popstate', () => {
  if (!history.state) showSetup();
});

// ---------- Экран настройки ----------

function rangeIndexes(alphabetId = settings.alphabet) {
  const letters = ALPHABETS[alphabetId].letters.map((l) => l[0]);
  let from = letters.indexOf(settings.range[alphabetId][0]);
  let to = letters.indexOf(settings.range[alphabetId][1]);
  if (from < 0) from = 0;
  if (to < 0) to = letters.length - 1;
  return [Math.min(from, to), Math.max(from, to)];
}

function selectedLetters() {
  const id = settings.alphabet;
  const [from, to] = rangeIndexes();
  const excluded = settings.excluded[id];
  return ALPHABETS[id].letters
    .slice(from, to + 1)
    .map((l) => l[0])
    .filter((u) => !excluded.includes(u));
}

function renderAlphabetSwitch() {
  for (const btn of $('alphabet-switch').querySelectorAll('button')) {
    const active = btn.dataset.alphabet === settings.alphabet;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  }
}

// Нажатие на букву: в режиме «диапазон» — первая, затем последняя буква;
// в режиме «исключить» — убрать букву из диктанта или вернуть её.
let pickMode = 'range';
let pendingStart = null;

function renderPickMode() {
  for (const btn of $('pick-mode').querySelectorAll('button')) {
    const active = btn.dataset.mode === pickMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  }
  $('pick-hint').textContent = pickMode === 'exclude'
    ? 'Нажмите на буквы, которые не нужно диктовать.'
    : pendingStart === null
      ? 'Нажмите первую букву диапазона, затем последнюю.'
      : 'Теперь нажмите последнюю букву диапазона.';
}

function onChipClick(i) {
  const id = settings.alphabet;
  const letters = ALPHABETS[id].letters.map((l) => l[0]);
  if (pickMode === 'exclude') {
    const upper = letters[i];
    const list = settings.excluded[id];
    settings.excluded[id] = list.includes(upper) ? list.filter((u) => u !== upper) : [...list, upper];
  } else if (pendingStart === null) {
    pendingStart = i;
    settings.range[id] = [letters[i], letters[i]];
  } else {
    const [from, to] = [Math.min(pendingStart, i), Math.max(pendingStart, i)];
    settings.range[id] = [letters[from], letters[to]];
    pendingStart = null;
  }
  saveSettings();
  renderPickMode();
  renderChips();
}

function renderChips() {
  const id = settings.alphabet;
  const [from, to] = rangeIndexes();
  const excluded = settings.excluded[id];
  const box = $('letter-chips');
  box.innerHTML = '';
  box.classList.toggle('exclude-mode', pickMode === 'exclude');
  ALPHABETS[id].letters.forEach(([upper, lower], i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = upper + lower;
    const inRange = i >= from && i <= to;
    const isExcluded = inRange && excluded.includes(upper);
    btn.classList.toggle('in-range', inRange && !isExcluded);
    btn.classList.toggle('excluded', isExcluded);
    btn.classList.toggle('pending', i === pendingStart);
    if (pickMode === 'exclude') {
      btn.disabled = !inRange;
      btn.setAttribute('aria-pressed', String(inRange && !isExcluded));
    }
    btn.addEventListener('click', () => onChipClick(i));
    box.appendChild(btn);
  });

  const available = selectedLetters().length;
  const count = dictationSize(available);
  $('letters-count').textContent = !count
    ? 'Не выбрано ни одной буквы'
    : count < available
      ? `В диктанте ${lettersWord(count)} из ${available} выбранных`
      : `В диктанте ${lettersWord(count)}`;
  $('reset-excluded').hidden = !excluded.some((u) => rangeIncludes(id, u));
  $('select-all').hidden = from === 0 && to === ALPHABETS[id].letters.length - 1;
  $('start-button').disabled = count === 0;
}

// Сколько букв войдёт в диктант: все выбранные или не больше заданного в настройках.
function dictationSize(available) {
  return settings.limitEnabled ? Math.min(settings.limitCount, available) : available;
}

function renderSetup() {
  renderAlphabetSwitch();
  renderPickMode();
  renderChips();
}

// ---------- Настройки ----------

function renderVoiceSelect(alphabetId) {
  const select = $(`voice-${alphabetId}`);
  const voices = Speech.voicesFor(ALPHABETS[alphabetId].lang);
  select.innerHTML = '';
  if (!voices.length) {
    select.add(new Option('Голос по умолчанию', ''));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const chosen = Speech.pickVoice(ALPHABETS[alphabetId].lang, settings.voice[alphabetId]);
  for (const v of voices) {
    select.add(new Option(`${v.name} (${v.lang})`, v.name, false, v === chosen));
  }
}

function renderSettings() {
  $('delay').value = settings.delay;
  $('delay-out').textContent = `${settings.delay} с`;
  $('repeat-twice').checked = settings.repeatTwice;
  $('limit-enabled').checked = settings.limitEnabled;
  $('limit-count').value = settings.limitCount;
  $('limit-count').disabled = !settings.limitEnabled;
  $('case-mode').value = settings.caseMode;
  $('voice-source').value = settings.voiceSource;
  $('browser-voice-settings').hidden = settings.voiceSource !== 'browser';
  $('check-delay').value = settings.checkDelay;
  $('check-delay-out').textContent = `${settings.checkDelay} с`;
  $('rate').value = settings.rate;
  $('rate-out').textContent = settings.rate.toFixed(1);
  Speech.rate = settings.rate;
  for (const id of ['ru', 'en']) {
    renderVoiceSelect(id);
    const select = $(`font-${id}`);
    select.innerHTML = '';
    for (const f of CURSIVE_FONTS[id]) {
      const option = new Option(f.title, f.id, false, f.id === settings.font[id]);
      option.style.fontFamily = f.family;
      select.add(option);
    }
  }
}

// Прослушивание всего алфавита выбранным голосом.
let previewRun = 0;
let previewButton = null;

function stopPreview() {
  previewRun++;
  if (previewButton) {
    previewButton.textContent = previewButton.dataset.label;
    previewButton = null;
    stopSpeaking();
    if (!activeSequencer) Recorded.suspend();
  }
}

async function togglePreview(button, alphabetId) {
  const wasThis = previewButton === button;
  stopPreview();
  if (wasThis) return;
  const run = previewRun;
  previewButton = button;
  Recorded.unlock();
  button.dataset.label = button.textContent;
  button.textContent = '■ Стоп';
  const letters = ALPHABETS[alphabetId].letters.map((l) => l[0]);
  Recorded.preload(letters.map((upper) => letterAudioFile(alphabetId, upper)));
  for (const upper of letters) {
    await say(letterClip(alphabetId, upper));
    if (run !== previewRun) return;
    await new Promise((r) => setTimeout(r, 300));
    if (run !== previewRun) return;
  }
  stopPreview();
}

// ---------- История ----------

function entryTitle(entry) {
  if (entry.name) return entry.name;
  const [from, to] = entry.range;
  return `${ALPHABETS[entry.alphabet].title}: ${from}–${to}`;
}

function renderHistory() {
  const list = Storage.loadHistory();
  const ul = $('history-list');
  ul.innerHTML = '';
  $('history-empty').hidden = list.length > 0;

  for (const entry of list) {
    const li = document.createElement('li');
    li.className = 'history-item';

    const info = document.createElement('div');
    info.className = 'history-info';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = entryTitle(entry);
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const parts = [lettersWord(entry.letters.length), formatDate(entry.lastRunAt)];
    if (CASE_MODES[entry.caseMode]) parts.push(CASE_MODES[entry.caseMode]);
    if (entry.runs > 1) parts.push(`запусков: ${entry.runs}`);
    if (entry.excluded.length) parts.push(`без ${entry.excluded.join(', ')}`);
    meta.textContent = parts.join(' · ');
    const letters = document.createElement('div');
    letters.className = 'history-letters';
    letters.textContent = entry.letters.join(' ');
    info.append(title, meta, letters);

    const actions = document.createElement('div');
    actions.className = 'history-actions';
    const addAction = (label, hint, cls, handler) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.title = hint;
      b.addEventListener('click', handler);
      actions.appendChild(b);
    };
    addAction('▶ Повторить', 'Тот же порядок букв', 'secondary', () => startDictation(entry));
    addAction('🔀 Перемешать', 'Те же буквы в новом порядке', 'secondary', () => startDictation(reshuffled(entry)));
    addAction('✓ Проверка', 'Сразу открыть проверку', 'secondary', () => openCheck(entry));
    addAction('↗ Поделиться', 'Ссылка или код этого диктанта', 'secondary', () => openShare(entry));
    addAction('🗑', 'Удалить', 'ghost icon', async () => {
      const ok = await confirmDialog({
        title: 'Удалить диктант?',
        text: `«${entryTitle(entry)}» исчезнет из списка сохранённых.`,
        ok: 'Удалить',
        danger: true,
      });
      if (ok) {
        Storage.remove(entry.id);
        renderHistory();
      }
    });

    li.append(info, actions);
    ul.appendChild(li);
  }
}

function reshuffled(entry) {
  return {
    ...entry,
    id: newId(),
    letters: shuffle(entry.letters),
    cases: makeCases(entry.caseMode, entry.letters.length),
    createdAt: Date.now(),
    runs: 0,
  };
}

// ---------- Диктант ----------

function setRing(fraction) {
  $('ring-fg').style.strokeDashoffset = String(RING_LENGTH * (1 - fraction));
}

function setPauseButton(button, paused) {
  button.textContent = paused ? '▶ Продолжить' : '⏸ Пауза';
}

function startNewDictation() {
  // Перемешиваем все выбранные и берём первые N — случайные буквы без повторов.
  const letters = shuffle(selectedLetters()).slice(0, dictationSize(selectedLetters().length));
  if (!letters.length) return;
  const id = settings.alphabet;
  const name = $('dictation-name').value.trim();
  $('dictation-name').value = '';
  startDictation({
    id: newId(),
    name,
    alphabet: id,
    range: settings.range[id].slice(),
    excluded: settings.excluded[id].filter((u) => rangeIncludes(id, u)),
    letters,
    caseMode: settings.caseMode,
    cases: makeCases(settings.caseMode, letters.length),
    createdAt: Date.now(),
    runs: 0,
  });
}

function rangeIncludes(alphabetId, upper) {
  const [from, to] = rangeIndexes(alphabetId);
  const i = ALPHABETS[alphabetId].letters.findIndex((l) => l[0] === upper);
  return i >= from && i <= to;
}

function startDictation(entry) {
  stopActive();
  entry.runs = (entry.runs || 0) + 1;
  entry.lastRunAt = Date.now();
  Storage.upsert(entry);
  currentEntry = entry;

  const total = entry.letters.length;
  $('dictation-title').textContent = entryTitle(entry);
  $('dictation-controls').hidden = false;
  $('dictation-finished').hidden = true;
  $('dictation-progress').style.width = '0%';
  $('dictation-counter').innerHTML = '';
  setPauseButton($('dict-pause'), false);
  setRing(1);
  openScreen('dictation');
  WakeLock.acquire();
  Recorded.unlock();
  preloadEntry(entry);

  const status = (text) => { $('dictation-status').textContent = text; };
  status('Приготовься');
  // Первая фраза звучит прямо из обработчика нажатия — иначе iOS не разрешит озвучку.
  const greeting = say(PHRASES.start);
  let inIntro = true;

  const seq = new Sequencer({
    count: total,
    repeats: settings.repeatTwice ? 2 : 1,
    delayMs: () => settings.delay * 1000,
    say: (i) => speakItem(entry, i),
    intro: async (run) => {
      await greeting;
      if (!seq.alive(run)) return false;
      return seq.sleep(INTRO_MS, run, true);
    },
    onStep: (i) => {
      inIntro = false;
      $('dictation-counter').innerHTML = `<span class="counter-num">${i + 1}</span><span class="counter-total">из ${total}</span>`;
      $('dictation-progress').style.width = `${(i / total) * 100}%`;
    },
    onSpeaking: () => {
      setRing(1);
      status('Слушай');
    },
    onTick: (left, all) => {
      setRing(left / all);
      if (seq.paused) status('Пауза');
      else if (inIntro) status(`Приготовься… ${Math.ceil(left / 1000)}`);
      else status('Пиши');
    },
    onDone: () => {
      $('dictation-progress').style.width = '100%';
      $('dictation-controls').hidden = true;
      $('dictation-finished').hidden = false;
      status('Готово');
      setRing(0);
      WakeLock.release();
      say(PHRASES.end);
    },
  });
  activeSequencer = seq;
  seq.start(0);
}

function togglePause(button) {
  const seq = activeSequencer;
  if (!seq) return;
  if (seq.finished) {
    seq.start(0);
    setPauseButton(button, false);
    return;
  }
  if (seq.paused) seq.resume();
  else seq.pause();
  setPauseButton(button, seq.paused);
  if (button === $('dict-pause') && seq.paused) $('dictation-status').textContent = 'Пауза';
}

// ---------- Проверка ----------

function openCheck(entry) {
  stopActive();
  currentEntry = entry;
  const font = cursiveFont(entry.alphabet);
  $('screen-check').style.setProperty('--propis-font', font.family);
  $('screen-check').style.setProperty('--propis-font-upper', font.upperFamily || font.family);
  $('screen-check').style.setProperty('--propis-size', `${font.size}px`);
  $('check-title').textContent = `Проверка: ${entryTitle(entry)}`;

  const grid = $('check-grid');
  grid.innerHTML = '';
  entry.letters.forEach((upper, i) => {
    const [, lower] = findLetter(entry.alphabet, upper);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'check-cell';
    btn.innerHTML = `<span class="cell-number">${i + 1}</span><span class="cell-letters"></span>`;
    const box = btn.querySelector('.cell-letters');
    for (const [char, letterCase] of [[upper, 'upper'], [lower, 'lower']]) {
      const span = document.createElement('span');
      span.textContent = char;
      span.className = letterCase;
      span.classList.toggle('dim', isDimmed(entry, i, letterCase));
      box.appendChild(span);
    }
    btn.addEventListener('click', () => {
      seq.start(i);
      setPauseButton($('check-pause'), false);
    });
    li.appendChild(btn);
    grid.appendChild(li);
  });

  openScreen('check');
  Recorded.unlock();
  preloadEntry(entry);
  setPauseButton($('check-pause'), false);

  const seq = new Sequencer({
    count: entry.letters.length,
    delayMs: () => settings.checkDelay * 1000,
    say: (i) => speakItem(entry, i),
    onStep: (i) => {
      const upper = entry.letters[i];
      const [, lower] = findLetter(entry.alphabet, upper);
      $('check-number').textContent = `${i + 1}`;
      renderCopybookLetters(entry, i, upper, lower);
      grid.querySelectorAll('.check-cell').forEach((cell, j) => {
        cell.classList.toggle('current', j === i);
        cell.classList.toggle('passed', j < i);
      });
      const cell = grid.children[i];
      if (cell) cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    onDone: () => {
      $('check-pause').textContent = '🔁 Ещё раз';
      grid.querySelectorAll('.check-cell').forEach((cell) => cell.classList.add('passed'));
    },
  });
  activeSequencer = seq;
  seq.start(0);
}

// Если регистр называли в диктанте, вторая форма буквы показывается бледно.
function isDimmed(entry, i, letterCase) {
  const dictated = entry.cases?.[i];
  return Boolean(dictated) && dictated !== letterCase;
}

// Заглавная и строчная — отдельными фрагментами с промежутком, чтобы не сливались.
function renderCopybookLetters(entry, i, upper, lower) {
  const text = $('check-letters');
  text.textContent = '';
  for (const [char, letterCase, dx] of [[upper, 'upper', 0], [lower, 'lower', 36]]) {
    const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    span.textContent = char;
    if (dx) span.setAttribute('dx', String(dx));
    span.classList.add(letterCase);
    if (isDimmed(entry, i, letterCase)) span.classList.add('dim');
    text.appendChild(span);
  }
  text.closest('svg').setAttribute('aria-label', `${upper} ${lower}`);
}

function checkJump(delta) {
  const seq = activeSequencer;
  if (!seq) return;
  const i = Math.min(Math.max(seq.index + delta, 0), seq.count - 1);
  seq.start(i);
  setPauseButton($('check-pause'), false);
}

// ---------- Окна (вместо системных confirm/alert) ----------

// Открывает <dialog> и ждёт закрытия; результат — value нажатой кнопки ('' при Esc или клике мимо).
function showDialog(dialog) {
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}

function confirmDialog({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = ok;
  $('confirm-cancel').textContent = cancel;
  $('confirm-ok').classList.toggle('danger', danger);
  return showDialog($('confirm-dialog')).then((value) => value === 'ok');
}

// «Прервать»: диктант встаёт на паузу, пока открыт вопрос.
async function stopDictationAsk() {
  const seq = activeSequencer;
  const wasRunning = seq && !seq.paused && !seq.finished;
  if (wasRunning) {
    seq.pause();
    setPauseButton($('dict-pause'), true);
  }
  const ok = await confirmDialog({
    title: 'Прервать диктант?',
    text: 'Он останется в списке сохранённых — его можно будет начать заново.',
    ok: 'Прервать',
    cancel: 'Продолжить',
    danger: true,
  });
  if (ok) goHome();
  else if (wasRunning && activeSequencer === seq) {
    seq.resume();
    setPauseButton($('dict-pause'), false);
  }
}

// ---------- Поделиться и открыть по коду ----------

function settingsSummary(s) {
  return `пауза ${s.delay} с${s.repeatTwice ? ', повтор дважды' : ''}, на проверке ${s.checkDelay} с`;
}

function openShare(entry) {
  const code = Share.encode(entry, settings);
  const link = Share.link(code);
  $('share-summary').textContent = `${entryTitle(entry)} · ${lettersWord(entry.letters.length)} · ${settingsSummary(settings)}`;
  $('share-link').value = link;
  $('share-code').value = code;
  $('share-status').textContent = '';
  const native = $('share-native');
  native.hidden = !navigator.share;
  native.onclick = () => {
    navigator.share({ title: 'Буквенный диктант', text: `Диктант «${entryTitle(entry)}»`, url: link }).catch(() => {});
  };
  showDialog($('share-dialog'));
}

async function copyField(id) {
  const field = $(id);
  try {
    await navigator.clipboard.writeText(field.value);
  } catch {
    field.select();
    document.execCommand('copy');
  }
  $('share-status').textContent = id === 'share-link' ? 'Ссылка скопирована' : 'Код скопирован';
}

let importData = null;

function onImportInput() {
  const text = $('import-code').value;
  importData = null;
  $('import-error').textContent = '';
  try {
    if (text.trim()) importData = Share.decode(text);
  } catch (error) {
    $('import-error').textContent = error.message;
  }
  const ok = Boolean(importData);
  $('import-preview').hidden = !ok;
  $('import-save').disabled = !ok;
  $('import-start').disabled = !ok;
  if (!ok) return;
  const entry = importedEntry(importData);
  $('import-title').textContent = entryTitle(entry);
  const parts = [lettersWord(entry.letters.length), entry.letters.join(' ')];
  if (CASE_MODES[entry.caseMode]) parts.splice(1, 0, CASE_MODES[entry.caseMode]);
  $('import-meta').textContent = parts.join(' · ');
  $('import-settings').textContent = settingsSummary(importData.settings);
}

function importedEntry(data) {
  const order = ALPHABETS[data.alphabet].letters.map((l) => l[0]);
  const indexes = data.letters.map((u) => order.indexOf(u));
  return {
    id: newId(),
    name: data.name,
    alphabet: data.alphabet,
    range: [order[Math.min(...indexes)], order[Math.max(...indexes)]],
    excluded: [],
    letters: data.letters,
    caseMode: data.caseMode,
    cases: data.cases,
    createdAt: Date.now(),
    lastRunAt: Date.now(),
    runs: 0,
  };
}

async function openImport(prefill = '') {
  $('import-code').value = prefill;
  onImportInput();
  const action = await showDialog($('import-dialog'));
  if (!importData || (action !== 'save' && action !== 'start')) return;
  if ($('import-apply-settings').checked) {
    Object.assign(settings, importData.settings);
    saveSettings();
    renderSettings();
  }
  const entry = importedEntry(importData);
  if (action === 'start') {
    startDictation(entry);
  } else {
    Storage.upsert(entry);
    renderHistory();
  }
}

// Ссылка вида …/#d=КОД открывает окно импорта; адрес очищаем, чтобы не открывалось повторно.
function importFromHash() {
  if (!location.hash.startsWith('#d=')) return;
  const code = location.hash.slice(3);
  history.replaceState(null, '', location.pathname + location.search);
  openImport(code);
}

// ---------- Подключение обработчиков ----------

function bindEvents() {
  for (const btn of $('alphabet-switch').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      settings.alphabet = btn.dataset.alphabet;
      pendingStart = null;
      saveSettings();
      renderSetup();
    });
  }
  for (const btn of $('pick-mode').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      pickMode = btn.dataset.mode;
      pendingStart = null;
      renderPickMode();
      renderChips();
    });
  }
  $('select-all').addEventListener('click', () => {
    const letters = ALPHABETS[settings.alphabet].letters;
    settings.range[settings.alphabet] = [letters[0][0], letters[letters.length - 1][0]];
    pendingStart = null;
    saveSettings();
    renderPickMode();
    renderChips();
  });
  $('reset-excluded').addEventListener('click', () => {
    settings.excluded[settings.alphabet] = [];
    saveSettings();
    renderChips();
  });
  $('start-button').addEventListener('click', startNewDictation);
  $('import-button').addEventListener('click', () => openImport());
  $('import-code').addEventListener('input', onImportInput);
  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', () => copyField(btn.dataset.copy));
  }
  // Клик по затемнённому фону закрывает окно.
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close('');
    });
  }

  const bindRange = (id, key, parse) => {
    $(id).addEventListener('input', () => {
      settings[key] = parse($(id).value);
      saveSettings();
      renderSettings();
    });
  };
  bindRange('delay', 'delay', Number);
  bindRange('check-delay', 'checkDelay', Number);
  bindRange('rate', 'rate', (v) => Math.round(Number(v) * 10) / 10);
  $('voice-source').addEventListener('change', () => {
    stopPreview();
    settings.voiceSource = $('voice-source').value;
    saveSettings();
    renderSettings();
    $('speech-warning').hidden = Speech.supported || settings.voiceSource === 'recorded';
  });
  $('case-mode').addEventListener('change', () => {
    settings.caseMode = $('case-mode').value;
    saveSettings();
  });
  $('limit-enabled').addEventListener('change', () => {
    settings.limitEnabled = $('limit-enabled').checked;
    saveSettings();
    renderSettings();
    renderChips();
  });
  $('limit-count').addEventListener('input', () => {
    const n = parseInt($('limit-count').value, 10);
    if (!(n >= 1)) return;
    settings.limitCount = Math.min(n, 99);
    saveSettings();
    renderChips();
  });
  $('limit-count').addEventListener('change', () => renderSettings());
  $('repeat-twice').addEventListener('change', () => {
    settings.repeatTwice = $('repeat-twice').checked;
    saveSettings();
  });
  for (const id of ['ru', 'en']) {
    $(`voice-${id}`).addEventListener('change', () => {
      settings.voice[id] = $(`voice-${id}`).value;
      saveSettings();
    });
    $(`font-${id}`).addEventListener('change', () => {
      settings.font[id] = $(`font-${id}`).value;
      saveSettings();
    });
  }
  for (const btn of document.querySelectorAll('[data-preview-voice]')) {
    btn.addEventListener('click', () => togglePreview(btn, btn.dataset.previewVoice));
  }

  $('dict-pause').addEventListener('click', () => togglePause($('dict-pause')));
  $('dict-repeat').addEventListener('click', () => {
    const seq = activeSequencer;
    if (!seq || seq.finished) return;
    seq.start(seq.index);
    setPauseButton($('dict-pause'), false);
  });
  $('dict-stop').addEventListener('click', stopDictationAsk);
  $('dict-check').addEventListener('click', () => openCheck(currentEntry));
  $('dict-home').addEventListener('click', goHome);

  $('check-home').addEventListener('click', goHome);
  $('check-pause').addEventListener('click', () => togglePause($('check-pause')));
  $('check-prev').addEventListener('click', () => checkJump(-1));
  $('check-next').addEventListener('click', () => checkJump(1));
  $('check-restart').addEventListener('click', () => {
    activeSequencer?.start(0);
    setPauseButton($('check-pause'), false);
  });

  // Пробел — пауза, стрелки — листание на проверке.
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.target.closest('input, select, textarea, button')) return;
    if (!$('screen-dictation').hidden && e.code === 'Space') {
      e.preventDefault();
      if (!$('dictation-controls').hidden) togglePause($('dict-pause'));
    }
    if (!$('screen-check').hidden) {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause($('check-pause'));
      } else if (e.code === 'ArrowLeft') checkJump(-1);
      else if (e.code === 'ArrowRight') checkJump(1);
    }
  });
}

function init() {
  $('speech-warning').hidden = Speech.supported || settings.voiceSource === 'recorded';
  Speech.init(() => renderSettings());
  bindEvents();
  renderSetup();
  renderSettings();
  renderHistory();
  // При перезагрузке посреди диктанта возвращаемся на главную.
  if (history.state) history.replaceState(null, '');
  importFromHash();
  window.addEventListener('hashchange', importFromHash);
}

init();
