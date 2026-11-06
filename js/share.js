// Код диктанта для «Поделиться»: буквы в их порядке, регистр, название и настройки диктанта.
// Данные — короткий JSON в base64url, чтобы код целиком помещался в ссылку (#d=…).
const Share = {
  VERSION: 1,
  // Номер буквы в алфавите кодируется одним символом.
  DIGITS: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  CASES: { upper: 'U', lower: 'L' },

  encode(entry, settings) {
    const order = ALPHABETS[entry.alphabet].letters.map((l) => l[0]);
    const data = {
      v: this.VERSION,
      a: entry.alphabet,
      l: entry.letters.map((upper) => this.DIGITS[order.indexOf(upper)]).join(''),
      d: settings.delay,
      r: settings.repeatTwice ? 1 : 0,
      k: settings.checkDelay,
    };
    if (entry.cases?.some(Boolean)) {
      data.m = entry.caseMode;
      data.c = entry.cases.map((c) => this.CASES[c] || '-').join('');
    }
    if (entry.name) data.n = entry.name;
    if (entry.mode === 'training') data.t = 1;
    return this.toBase64Url(JSON.stringify(data));
  },

  // Принимает код или ссылку целиком. Возвращает { alphabet, letters, cases, caseMode, name, mode, settings }
  // или бросает Error с понятным пользователю текстом.
  decode(input) {
    let code = String(input || '').trim();
    const hashAt = code.indexOf('#d=');
    if (hashAt >= 0) code = code.slice(hashAt + 3);
    code = code.replace(/\s+/g, '');
    if (!code) throw new Error('Вставьте код или ссылку.');

    let data;
    try {
      data = JSON.parse(this.fromBase64Url(code));
    } catch {
      throw new Error('Код не распознан — проверьте, что он скопирован полностью.');
    }
    if (!data || data.v !== this.VERSION) throw new Error('Код создан другой версией сайта.');

    const alphabet = ALPHABETS[data.a];
    if (!alphabet || typeof data.l !== 'string' || !data.l.length || data.l.length > 200) {
      throw new Error('В коде нет букв диктанта.');
    }
    const letters = [...data.l].map((ch) => alphabet.letters[this.DIGITS.indexOf(ch)]?.[0]);
    if (letters.some((u) => !u)) throw new Error('Код повреждён: неизвестная буква.');

    let cases = letters.map(() => null);
    let caseMode = 'none';
    if (typeof data.c === 'string') {
      const decoded = { U: 'upper', L: 'lower', '-': null };
      if (data.c.length !== letters.length || [...data.c].some((ch) => !(ch in decoded))) {
        throw new Error('Код повреждён: не совпадает регистр букв.');
      }
      cases = [...data.c].map((ch) => decoded[ch]);
      caseMode = ['upper', 'lower', 'mixed'].includes(data.m) ? data.m : 'mixed';
    }

    const clamp = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(Math.max(Math.round(v), min), max) : fallback);
    return {
      alphabet: data.a,
      letters,
      cases,
      caseMode,
      name: typeof data.n === 'string' ? data.n.slice(0, 60) : '',
      mode: data.t === 1 ? 'training' : 'dictation',
      settings: {
        delay: clamp(data.d, 3, 30, 6),
        repeatTwice: data.r === 1,
        checkDelay: clamp(data.k, 1, 15, 3),
      },
    };
  },

  link(code) {
    return `${location.origin}${location.pathname}#d=${code}`;
  },

  toBase64Url(text) {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  fromBase64Url(code) {
    let b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  },
};
