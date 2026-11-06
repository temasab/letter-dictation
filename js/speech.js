// Обёртка над встроенным синтезатором речи браузера (Web Speech API).
const Speech = {
  supported: 'speechSynthesis' in window,
  voices: [],
  rate: 0.8,
  // Ссылка на текущую фразу: без неё Chrome может собрать её сборщиком мусора
  // до окончания, и событие onend не придёт.
  current: null,

  init(onChange) {
    if (!this.supported) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices();
      if (onChange) onChange();
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
  },

  voicesFor(lang) {
    const base = lang.slice(0, 2);
    return this.voices
      .filter((v) => v.lang.replace('_', '-').slice(0, 2) === base)
      .sort((a, b) => this.score(b, lang) - this.score(a, lang));
  },

  // Чем выше, тем предпочтительнее голос по умолчанию.
  score(voice, lang) {
    let s = 0;
    if (voice.lang.replace('_', '-') === lang) s += 4;
    if (voice.localService) s += 2;
    if (/google|milena|daniel|serena|kate|premium|enhanced/i.test(voice.name)) s += 1;
    return s;
  },

  pickVoice(lang, preferredName) {
    const list = this.voicesFor(lang);
    return list.find((v) => v.name === preferredName) || list[0] || null;
  },

  // Произносит текст; промис завершается по окончании речи, ошибке или отмене.
  // Результат: true — фраза договорена, false — прервана.
  speak(text, lang, voiceName) {
    return new Promise((resolve) => {
      if (!this.supported) return resolve(true);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = this.rate;
      const voice = this.pickVoice(lang, voiceName);
      if (voice) u.voice = voice;
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (this.current === u) this.current = null;
        resolve(ok);
      };
      // Страховка: некоторые браузеры иногда не присылают onend.
      const timer = setTimeout(() => finish(true), 6000);
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      // Сбрасываем синтезатор, только если прерываем ещё звучащую фразу:
      // лишний cancel() после естественного окончания даёт щелчок.
      if (this.current) speechSynthesis.cancel();
      this.current = u;
      speechSynthesis.speak(u);
    });
  },

  cancel() {
    if (this.supported && this.current) speechSynthesis.cancel();
  },
};

// Воспроизведение заранее записанных файлов через Web Audio.
// Плавное нарастание и затухание убирают щелчки, громкость файлов выравнивается.
const Recorded = {
  ctx: null,
  buffers: new Map(),
  current: null,
  playId: 0,
  TARGET_RMS: 0.12,
  FADE_IN: 0.01,
  FADE_OUT: 0.04,

  // Вызывать из обработчика нажатия: браузеры запускают звук только по действию пользователя.
  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) this.ctx = new AudioCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  suspend() {
    this.stop();
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  },

  // Загружает и декодирует файл один раз; результат — буфер и множитель громкости.
  load(file) {
    if (!this.buffers.has(file)) {
      const promise = fetch(file)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((data) => this.ctx.decodeAudioData(data))
        .then((buffer) => ({ buffer, gain: this.normalGain(buffer) }));
      promise.catch(() => this.buffers.delete(file));
      this.buffers.set(file, promise);
    }
    return this.buffers.get(file);
  },

  preload(files) {
    if (!this.ctx) return;
    for (const f of files) this.load(f).catch(() => {});
  },

  // Множитель, приводящий громкость речи к общему уровню без перегрузки.
  normalGain(buffer) {
    const data = buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (!peak) return 1;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > peak * 0.05) {
        sum += data[i] * data[i];
        count++;
      }
    }
    const rms = Math.sqrt(sum / count);
    return Math.min(this.TARGET_RMS / rms, 0.95 / peak);
  },

  // Результат: 'ended' — доиграл, 'stopped' — прервали, 'failed' — файл недоступен.
  async play(file) {
    if (!this.ctx) return 'failed';
    this.stop();
    const id = ++this.playId;
    let clip;
    try {
      clip = await this.load(file);
    } catch {
      return 'failed';
    }
    if (id !== this.playId) return 'stopped';
    // Firefox может оставить контекст приостановленным — тогда звук не пошёл бы, а таймер
    // посчитал бы файл доигранным. Пытаемся возобновить, иначе отдаём букву голосу браузера.
    if (this.ctx.state !== 'running') {
      await Promise.race([this.ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
      if (id !== this.playId) return 'stopped';
      if (this.ctx.state !== 'running') return 'failed';
    }

    return new Promise((resolve) => {
      const ctx = this.ctx;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = clip.buffer;
      const t = ctx.currentTime;
      const end = t + clip.buffer.duration;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(clip.gain, t + this.FADE_IN);
      gain.gain.setValueAtTime(clip.gain, end - this.FADE_OUT);
      gain.gain.linearRampToValueAtTime(0, end);
      source.connect(gain).connect(ctx.destination);

      const playing = { source, gain, finish: null };
      // Страховка: если контекст приостановлен, onended может не прийти.
      const timer = setTimeout(() => playing.finish('ended'), (clip.buffer.duration + 1.5) * 1000);
      playing.finish = (result) => {
        if (this.current !== playing) return;
        this.current = null;
        clearTimeout(timer);
        resolve(result);
      };
      source.onended = () => playing.finish('ended');
      this.current = playing;
      source.start(t);
    });
  },

  // Прерывает текущий файл с коротким затуханием, чтобы не было щелчка.
  stop() {
    const playing = this.current;
    if (!playing) return;
    const t = this.ctx.currentTime;
    playing.gain.gain.cancelScheduledValues(t);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, t);
    playing.gain.gain.linearRampToValueAtTime(0, t + 0.015);
    playing.source.stop(t + 0.02);
    playing.finish('stopped');
  },
};
