// Content AI - kontrola JavaScriptu aplikacji.
//
// Aplikacja to jeden plik HTML z kilkoma blokami <script>, wiec zadne standardowe
// narzedzie nie zajrzy do niej samo. narzedzia/wytnij_skrypty.py wyciaga same
// skrypty do pliku .js z zachowana numeracja linii, a ESLint sprawdza je tutaj.
//
// Dobor regul jest waski i celowy. Nie chodzi o styl - chodzi o klasy bledow,
// ktore w jednym pliku z 460 funkcjami w zasiegu globalnym nie daja o sobie znac
// az do momentu, gdy cos przestaje dzialac u uzytkownika.
//
// Tak wyszedl na jaw blad, ktorego nie zlapala zadna z wczesniejszych kontroli:
// klucz i18n 'history-no-filter' byl w slowniku EN zadeklarowany dwa razy, z dwoma
// roznymi tlumaczeniami. Wygrywala druga deklaracja, wiec poprawka F2 istniala
// w zrodle i przechodzila kontrole, a mimo to nie dzialala.
//
// Uruchomienie:
//   python3 narzedzia/wytnij_skrypty.py app/web-proxy.html /tmp/app.js
//   npx eslint /tmp/app.js

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
    },
    rules: {
      // ── Ciche nadpisania ─────────────────────────────────────────────────
      // Ten sam klucz dwa razy w obiekcie: druga wartosc wygrywa, pierwsza
      // znika bez sladu. Na slownikach i18n to znaczy tlumaczenie, ktore jest
      // w kodzie, ale nigdy sie nie pokazuje.
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-func-assign': 'error',
      'no-const-assign': 'error',
      'no-import-assign': 'error',

      // ── Kod, ktory nie robi tego, co wyglada, ze robi ────────────────────
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-finally': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-sparse-arrays': 'error',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-async-promise-executor': 'error',

      // ── Ostrzezenia, nie bledy ───────────────────────────────────────────
      // builtinGlobals wylaczone swiadomie: aplikacja ma wlasna zmienna
      // `history` (lista artykulow), ktora przyslania wbudowana. To dziala
      // i jest zamierzone, ale warto o tym wiedziec przy nowym kodzie.
      // Powtorzone `var` w jednej funkcji to duplikat bloku, nie blad -
      // do posprzatania przy okazji, nie do blokowania budowania.
      'no-redeclare': ['warn', { builtinGlobals: false }],
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // ── Celowo wylaczone ─────────────────────────────────────────────────
      // no-undef: aplikacja wystawia funkcje przez window.nazwa i wola je
      // po nazwie. ESLint tego nie widzi, wiec regula daje same falszywe
      // alarmy. Kolizje nazw lapie no-redeclare.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // require-atomic-updates: w kodzie interfejsu praktycznie kazde
      // `przycisk.disabled = false` po `await` wyglada dla niej jak wyscig.
      // 39 zgloszen, zero prawdziwych - w przegladarce nie ma tu rownoleglosci.
      'require-atomic-updates': 'off',
    },
  },
];
