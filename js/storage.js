// Хранение настроек и истории диктантов в localStorage браузера.
const Storage = {
  SETTINGS_KEY: 'letterDictation.settings.v1',
  HISTORY_KEY: 'letterDictation.history.v1',
  HISTORY_LIMIT: 100,

  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },

  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Приватный режим или переполнение — работаем без сохранения.
    }
  },

  loadSettings(defaults) {
    return { ...defaults, ...this.read(this.SETTINGS_KEY, {}) };
  },

  saveSettings(settings) {
    this.write(this.SETTINGS_KEY, settings);
  },

  loadHistory() {
    const list = this.read(this.HISTORY_KEY, []);
    return Array.isArray(list) ? list : [];
  },

  saveHistory(list) {
    this.write(this.HISTORY_KEY, list.slice(0, this.HISTORY_LIMIT));
  },

  // Добавляет диктант или поднимает существующий наверх списка.
  upsert(entry) {
    const list = this.loadHistory().filter((e) => e.id !== entry.id);
    list.unshift(entry);
    this.saveHistory(list);
  },

  remove(id) {
    this.saveHistory(this.loadHistory().filter((e) => e.id !== id));
  },

  get(id) {
    return this.loadHistory().find((e) => e.id === id) || null;
  },
};
