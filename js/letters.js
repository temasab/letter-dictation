// Алфавиты: [заглавная, строчная, что произносит голос].
// Для русских букв голосу передаётся название буквы словами («бэ», «эль»),
// иначе синтезатор может прочитать одиночную согласную как звук.
const ALPHABETS = {
  ru: {
    id: 'ru',
    title: 'Русский',
    lang: 'ru-RU',
    letters: [
      ['А', 'а', 'а'], ['Б', 'б', 'бэ'], ['В', 'в', 'вэ'], ['Г', 'г', 'гэ'],
      ['Д', 'д', 'дэ'], ['Е', 'е', 'е'], ['Ё', 'ё', 'ё'], ['Ж', 'ж', 'жэ'],
      ['З', 'з', 'зэ'], ['И', 'и', 'и'], ['Й', 'й', 'и краткое'], ['К', 'к', 'ка'],
      ['Л', 'л', 'эль'], ['М', 'м', 'эм'], ['Н', 'н', 'эн'], ['О', 'о', 'о'],
      ['П', 'п', 'пэ'], ['Р', 'р', 'эр'], ['С', 'с', 'эс'], ['Т', 'т', 'тэ'],
      ['У', 'у', 'у'], ['Ф', 'ф', 'эф'], ['Х', 'х', 'ха'], ['Ц', 'ц', 'цэ'],
      ['Ч', 'ч', 'чэ'], ['Ш', 'ш', 'ша'], ['Щ', 'щ', 'ща'], ['Ъ', 'ъ', 'твёрдый знак'],
      ['Ы', 'ы', 'ы'], ['Ь', 'ь', 'мягкий знак'], ['Э', 'э', 'э'], ['Ю', 'ю', 'ю'],
      ['Я', 'я', 'я'],
    ],
  },
  en: {
    id: 'en',
    title: 'Английский',
    lang: 'en-GB',
    // Голосу браузера передаётся английское название буквы словом: одиночную букву синтезатор
    // читает как «capital D», а русский голос — как русскую букву («а», «бэ»).
    letters: [
      ['A', 'ey'], ['B', 'bee'], ['C', 'see'], ['D', 'dee'], ['E', 'ee'], ['F', 'eff'],
      ['G', 'gee'], ['H', 'aitch'], ['I', 'eye'], ['J', 'jay'], ['K', 'kay'], ['L', 'ell'],
      ['M', 'em'], ['N', 'en'], ['O', 'oh'], ['P', 'pee'], ['Q', 'cue'], ['R', 'ar'],
      ['S', 'ess'], ['T', 'tee'], ['U', 'you'], ['V', 'vee'], ['W', 'double you'], ['X', 'ex'],
      ['Y', 'why'], ['Z', 'zed'],
    ].map(([upper, name]) => [upper, upper.toLowerCase(), name]),
  },
};

// Шрифты-прописи для экрана проверки; первый в списке — по умолчанию.
// size подобран так, чтобы строчная буква занимала рабочую строку прописи (50 единиц SVG).
// upperFamily — отдельный шрифт для заглавных (в английском заглавные пишут печатными).
const CURSIVE_FONTS = {
  ru: [
    { id: 'marck', title: 'Marck Script (пропись)', family: "'Propis Marck'", size: 135 },
    { id: 'bad', title: 'Bad Script (почерк)', family: "'Propis Bad'", size: 98 },
  ],
  en: [
    {
      id: 'print-caps',
      title: 'Заглавные печатные, строчные прописью',
      family: "'Propis Trad'",
      upperFamily: "'Propis GBS'",
      size: 96,
    },
    { id: 'trad-all', title: 'Всё прописью (Playwrite US Trad)', family: "'Propis Trad'", size: 96 },
    { id: 'gbs', title: 'Всё полупечатное (Playwrite GB S)', family: "'Propis GBS'", size: 96 },
  ],
};

function findLetter(alphabetId, upper) {
  return ALPHABETS[alphabetId].letters.find((l) => l[0] === upper);
}

// Файл с записью названия буквы.
function letterAudioFile(alphabetId, upper) {
  if (alphabetId === 'en') return `audio/en/${upper.toLowerCase()}.mp3`;
  const index = ALPHABETS.ru.letters.findIndex((l) => l[0] === upper);
  return `audio/ru/${String(index).padStart(2, '0')}.mp3`;
}
