/* Content AI - strona produktowa: motyw przed pierwszym malowaniem.
   Ładowany synchronicznie w <head> (mały plik), więc wybrany motyw jest ustawiony, zanim cokolwiek się narysuje:
   bez migotania jasny/ciemny. Domyślnie motyw systemowy (CSS: prefers-color-scheme); zapamiętany wybór gościa
   z localStorage ma pierwszeństwo. Klasa „js" włącza ukrywanie elementów do animacji wejścia; bezpiecznik po 2,5 s
   odsłania wszystko, gdyby strona.js się nie wykonał - treść nigdy nie zależy od powodzenia skryptu. */
(function () {
  'use strict';
  var d = document.documentElement;
  d.classList.add('js');
  var m = null;
  try { m = localStorage.getItem('cai-motyw'); } catch (e) { m = null; }
  if (m === 'light' || m === 'dark') d.setAttribute('data-theme', m);
  setTimeout(function () {
    if (!d.classList.contains('js-ok')) d.classList.add('wej-wszystko');
  }, 2500);
})();
