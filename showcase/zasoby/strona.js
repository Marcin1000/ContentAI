/* Content AI - strona produktowa: zachowanie strony. Własny kod, bez bibliotek i bez obcych serwerów.
   Wszystko jest ulepszeniem: treść i linki działają bez tego pliku (patrz motyw.js i klasy html.js).
   Teksty komunikatów pochodzą z atrybutów data-* w HTML (jeden słownik PL/EN w zrodlo/teksty.json). */
(function () {
  'use strict';
  var d = document.documentElement;
  d.classList.add('js-ok');
  var mqSpokoj = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  var spokoj = !!(mqSpokoj && mqSpokoj.matches);
  var maIO = 'IntersectionObserver' in window;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function zapisz(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* tryb prywatny: wybór tylko do końca wizyty */ } }

  /* ---------- motyw ---------- */
  var mqJasny = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  var btnMotyw = $('.motyw');
  function motywTeraz() {
    var t = d.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return mqJasny && mqJasny.matches ? 'light' : 'dark';
  }
  function etykietaMotywu() {
    if (!btnMotyw) return;
    btnMotyw.setAttribute('aria-label', btnMotyw.getAttribute(motywTeraz() === 'light' ? 'data-na-ciemny' : 'data-na-jasny'));
  }
  if (btnMotyw) {
    btnMotyw.addEventListener('click', function () {
      var nowy = motywTeraz() === 'light' ? 'dark' : 'light';
      // bez przejść na czas zmiany: setki elementów zmieniają kolor naraz, przejścia tylko spowalniają odpowiedź
      d.classList.add('motyw-zmiana');
      d.setAttribute('data-theme', nowy);
      requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.remove('motyw-zmiana'); }); });
      zapisz('cai-motyw', nowy);
      etykietaMotywu();
      rysujLinie();
    });
    if (mqJasny && mqJasny.addEventListener) mqJasny.addEventListener('change', function () { etykietaMotywu(); });
    etykietaMotywu();
  }

  /* ---------- nawigacja: tło po przewinięciu, menu na telefonie i tablecie, aktywna sekcja ---------- */
  var nav = $('#nav');
  var czekaPrzew = false;
  function naPrzewiniecie() {
    czekaPrzew = false;
    if (nav) nav.classList.toggle('przewinieta', window.scrollY > 24);
  }
  window.addEventListener('scroll', function () {
    if (!czekaPrzew) { czekaPrzew = true; requestAnimationFrame(naPrzewiniecie); }
  }, { passive: true });
  naPrzewiniecie();

  var menuBtn = $('.menu-btn'), menuPanel = $('#menu-panel');
  if (menuBtn && menuPanel && nav) {
    menuBtn.setAttribute('role', 'button');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-controls', 'menu-panel');
    var ustawMenu = function (otw, fokusWroc) {
      menuPanel.hidden = !otw;
      nav.classList.toggle('menu-otwarte', otw);
      menuBtn.setAttribute('aria-expanded', otw ? 'true' : 'false');
      menuBtn.setAttribute('aria-label', menuBtn.getAttribute(otw ? 'data-zamknij' : 'data-otworz'));
      if (!otw && fokusWroc) menuBtn.focus();
    };
    menuBtn.addEventListener('click', function (e) { e.preventDefault(); ustawMenu(menuPanel.hidden); });
    menuBtn.addEventListener('keydown', function (e) { if (e.key === ' ') { e.preventDefault(); ustawMenu(menuPanel.hidden); } });
    $$('a', menuPanel).forEach(function (a) { a.addEventListener('click', function () { ustawMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menuPanel.hidden) ustawMenu(false, true); });
    window.addEventListener('resize', function () { if (window.innerWidth > 1180 && !menuPanel.hidden) ustawMenu(false); });
  }

  if (maIO) {
    var linki = {};
    $$('.nav-linki a').forEach(function (a) { var h = a.getAttribute('href'); linki[h.slice(h.indexOf('#') + 1)] = a; });
    var obsSekcji = new IntersectionObserver(function (wpisy) {
      wpisy.forEach(function (w) {
        if (!w.isIntersecting) return;
        Object.keys(linki).forEach(function (k) { linki[k].removeAttribute('aria-current'); });
        if (linki[w.target.id]) linki[w.target.id].setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('main section[id]').forEach(function (s) { obsSekcji.observe(s); });
  }

  /* ---------- kotwice: sekcje z content-visibility mają szacowaną wysokość, więc po przewinięciu
     do kotwicy cel bywa przesunięty (sekcje po drodze dostają prawdziwą wysokość). Po zakończeniu
     przewijania poprawiamy pozycję bez animacji, najwyżej kilka razy. ---------- */
  function popraw(cel, prob) {
    var gora = cel.getBoundingClientRect().top, odstep = parseFloat(getComputedStyle(d).scrollPaddingTop) || 0;
    if (Math.abs(gora - odstep) > 6 && prob > 0) {
      window.scrollBy({ top: gora - odstep, left: 0, behavior: 'instant' });
      setTimeout(function () { popraw(cel, prob - 1); }, 120);
    }
  }
  function poPrzewinieciu(cel) {
    var zrobione = false;
    var raz = function () { if (zrobione) return; zrobione = true; window.removeEventListener('scrollend', raz); popraw(cel, 4); };
    if ('onscrollend' in window) window.addEventListener('scrollend', raz);
    setTimeout(raz, spokoj ? 80 : 1400);
  }
  document.addEventListener('click', function (e) {
    // kliknięcie obsłużone przez skrypt (np. przycisk menu to link do spisu w stopce) - nie przewijamy do jego celu
    if (e.defaultPrevented) return;
    var a = e.target.closest ? e.target.closest('a[href*="#"]') : null;
    if (!a || a.origin !== location.origin || a.pathname !== location.pathname || !a.hash || a.hash.length < 2) return;
    var cel = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    if (cel) poPrzewinieciu(cel);
  });
  if (location.hash.length > 1) {
    var celStart = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (celStart) window.addEventListener('load', function () { setTimeout(function () { popraw(celStart, 4); }, 60); });
  }

  /* ---------- wejścia (raz) ---------- */
  var poWejsciu = [];
  if (maIO) {
    var obsWej = new IntersectionObserver(function (wpisy) {
      wpisy.forEach(function (w) {
        if (!w.isIntersecting) return;
        w.target.classList.add('is-in');
        obsWej.unobserve(w.target);
        poWejsciu.forEach(function (f) { f(w.target); });
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.wej').forEach(function (el) { obsWej.observe(el); });
  } else {
    $$('.wej').forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- liczniki: wartość końcowa jest w DOM od początku (czytnik nie czyta liczenia) ---------- */
  function licz(el, ms) {
    var cel = parseInt(el.getAttribute('data-cel'), 10);
    if (spokoj || !cel) { el.textContent = String(cel); return; }
    var t0 = null;
    function krok(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / ms);
      el.textContent = String(Math.round(cel * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(krok);
    }
    requestAnimationFrame(krok);
  }
  var licznik = $('.dowody .licz');
  if (licznik && maIO && !spokoj) {
    var obsL = new IntersectionObserver(function (w) { if (w[0].isIntersecting) { licz(licznik, 800); obsL.disconnect(); } });
    obsL.observe(licznik);
  }

  /* ---------- żywa ramka: 5 kroków w pętli, pauza (WCAG 2.2.2), stop poza ekranem i w ukrytej karcie ---------- */
  var ramka = $('#ramka');
  if (ramka) {
    var pauzaBtn = $('.ramka-pauza', ramka);
    var kroki = $$('.ramka-kroki button', ramka);
    var CZAS = [1500, 1400, 2200, 1700, 3400];   // ile trwa każdy krok (ms)
    var krok = 0, zegar = null, wPauzie = false, widoczna = true, wstrzymana = false;
    // Telefon: makieta statyczna w stanie końcowym (decyzja agencja-strona-projekt D3) - bez pętli, jak przy ograniczonym ruchu.
    var mqTelefon = window.matchMedia ? matchMedia('(max-width: 720px)') : null;
    var bezPetli = function () { return spokoj || !!(mqTelefon && mqTelefon.matches); };
    var ustawKlasy = function (n, bezPrzejsc) {
      var k = 'ramka';
      for (var i = 1; i <= n; i++) k += ' k' + i;
      if (wPauzie) k += ' pauza';
      if (bezPetli()) k += ' bez-petli';
      if (bezPrzejsc) k += ' bez-przejsc';
      if (wPauzie || !widoczna || document.hidden) k += ' zatrzymana';
      ramka.className = k;
      kroki.forEach(function (b, i) {
        if (i === n - 1) {
          b.setAttribute('aria-current', 'step');
          b.style.setProperty('--trwa', CZAS[i] + 'ms');
        } else b.removeAttribute('aria-current');
      });
    };
    var zatrzymaj = function () { if (zegar) { clearTimeout(zegar); zegar = null; } ramka.classList.add('zatrzymana'); };
    var planuj = function () {
      if (zegar || wPauzie || wstrzymana || !widoczna || document.hidden || bezPetli()) return;
      ramka.classList.remove('zatrzymana');
      zegar = setTimeout(nastepny, krok === 0 ? 400 : CZAS[krok - 1]);
    };
    var nastepny = function () {
      zegar = null;
      if (krok < 5) {
        krok++;
        ustawKlasy(krok);
        if (krok === 4) $$('.w-liczba', ramka).forEach(function (el) { licz(el, 700); });
        planuj();
      } else {
        ramka.classList.add('zanik');
        zegar = setTimeout(function () { zegar = null; krok = 0; ustawKlasy(0, true); void ramka.offsetWidth; ustawKlasy(0); planuj(); }, 420);
      }
    };
    var ustawPauze = function (p) {
      wPauzie = p;
      ramka.classList.toggle('pauza', p);
      pauzaBtn.setAttribute('aria-pressed', p ? 'true' : 'false');
      pauzaBtn.setAttribute('aria-label', pauzaBtn.getAttribute(p ? 'data-wznow' : 'data-pauza'));
      if (p) zatrzymaj(); else planuj();
    };
    if (spokoj) {
      krok = 5; ustawKlasy(5, true);
      pauzaBtn.hidden = true;
    } else {
      if (bezPetli()) { krok = 5; ustawKlasy(5, true); } else ustawKlasy(0, true);
      if (mqTelefon && mqTelefon.addEventListener) mqTelefon.addEventListener('change', function () {
        zatrzymaj();
        if (bezPetli()) { krok = 5; ustawKlasy(5, true); }
        else if (!wPauzie) { krok = 0; ustawKlasy(0, true); planuj(); }
      });
      pauzaBtn.addEventListener('click', function () {
        if (!wPauzie && krok < 5) { krok = 5; ustawKlasy(5); }
        ustawPauze(!wPauzie);
      });
      document.addEventListener('visibilitychange', function () { if (document.hidden) zatrzymaj(); else planuj(); });
      var tresc = $('.ramka-tresc', ramka);
      tresc.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { wstrzymana = true; zatrzymaj(); } });
      tresc.addEventListener('pointerleave', function () { if (wstrzymana) { wstrzymana = false; planuj(); } });
      if (maIO) {
        new IntersectionObserver(function (w) {
          widoczna = w[0].isIntersecting;
          if (widoczna) planuj(); else zatrzymaj();
        }, { threshold: 0.2 }).observe(ramka);
      }
      planuj();
    }
    kroki.forEach(function (b) {
      b.addEventListener('click', function () {
        var n = parseInt(b.getAttribute('data-krok'), 10);
        zatrzymaj();
        krok = n;
        if (!spokoj) ustawPauze(true);
        ustawKlasy(n);
        if (n >= 4) $$('.w-liczba', ramka).forEach(function (el) { el.textContent = el.getAttribute('data-cel'); });
      });
    });
  }

  /* ---------- „Jak to działa": aktywny krok; na szerokim ekranie jedna przyklejona scena ---------- */
  var listaKrokow = $('.kroki'), uklad = $('.kroki-uklad');
  if (listaKrokow && uklad && maIO) {
    var krokiLi = $$('.krok', listaKrokow);
    var ekrany = krokiLi.map(function (k) { return $('.krok-ekran', k); });
    var scena = document.createElement('div');
    scena.className = 'kroki-scena';
    scena.setAttribute('aria-hidden', 'true');
    var mqSzeroki = matchMedia('(min-width: 981px)');
    var aktywny = 0;
    var pokazEkran = function () { ekrany.forEach(function (e, i) { e.classList.toggle('widoczny', i === aktywny); }); };
    // Na komputerze scena ma wysokość najwyższego ekranu, więc żaden ekran nie jest ucinany przy zmianie tekstów.
    var wyrownaj = function () {
      if (!scena.parentNode) { scena.style.height = ''; return; }   // lista do 980 px: każdy ekran w swojej wysokości
      var max = 0;
      ekrany.forEach(function (e) { max = Math.max(max, e.offsetHeight); });
      if (max) scena.style.height = max + 'px';
    };
    var rozloz = function () {
      if (mqSzeroki.matches) {
        if (!scena.parentNode) { uklad.insertBefore(scena, listaKrokow); ekrany.forEach(function (e) { scena.appendChild(e); }); uklad.classList.add('scena'); }
      } else if (scena.parentNode) {
        ekrany.forEach(function (e, i) { e.classList.remove('widoczny'); krokiLi[i].insertBefore(e, krokiLi[i].firstChild); });
        uklad.removeChild(scena); uklad.classList.remove('scena');
      }
      pokazEkran();
      wyrownaj();
    };
    if (mqSzeroki.addEventListener) mqSzeroki.addEventListener('change', rozloz);
    rozloz();
    var czekaWyrownanie = null;
    window.addEventListener('resize', function () { clearTimeout(czekaWyrownanie); czekaWyrownanie = setTimeout(wyrownaj, 150); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(wyrownaj);
    var obsKrok = new IntersectionObserver(function (wpisy) {
      wpisy.forEach(function (w) {
        if (!w.isIntersecting) return;
        aktywny = krokiLi.indexOf(w.target);
        krokiLi.forEach(function (k) { k.classList.toggle('aktywny', k === w.target); });
        listaKrokow.classList.add('ma-aktywny');
        pokazEkran();
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    krokiLi.forEach(function (k) { obsKrok.observe(k); });
  }

  /* ---------- cztery powierzchnie: zakładki (klik, strzałki, Home/End) ---------- */
  var pow = $('.pow');
  if (pow) {
    var zakladki = $$('[role="tab"]', pow);
    var panel = $('#p-pow');
    var wybierz = function (btn, fokus) {
      var zmien = function () {
        zakladki.forEach(function (z) {
          var on = z === btn;
          z.setAttribute('aria-selected', on ? 'true' : 'false');
          z.tabIndex = on ? 0 : -1;
        });
        pow.setAttribute('data-pow', btn.getAttribute('data-pow'));
        panel.setAttribute('aria-labelledby', btn.id);
      };
      if (document.startViewTransition && !spokoj) document.startViewTransition(zmien); else zmien();
      if (fokus) btn.focus();
    };
    zakladki.forEach(function (z, i) {
      z.addEventListener('click', function () { wybierz(z); });
      z.addEventListener('keydown', function (e) {
        var n = null, ile = zakladki.length;
        if (e.key === 'ArrowRight') n = zakladki[(i + 1) % ile];
        else if (e.key === 'ArrowLeft') n = zakladki[(i - 1 + ile) % ile];
        else if (e.key === 'Home') n = zakladki[0];
        else if (e.key === 'End') n = zakladki[ile - 1];
        if (n) { e.preventDefault(); wybierz(n, true); }
      });
    });
  }

  /* ---------- kontrola faktów: podświetlenie noty, linie na marginesie, dymek w ekranie ---------- */
  var fk = $('#fk'), svgLinie = fk ? $('.fk-linie', fk) : null;
  function rysujLinie() {
    if (!fk || !svgLinie) return;
    if (window.innerWidth <= 980) { svgLinie.innerHTML = ''; return; }
    var k = fk.getBoundingClientRect(), h = '';
    $$('.tw[data-nota]', fk).forEach(function (tw) {
      var nota = document.getElementById(tw.getAttribute('data-nota'));
      var rs = tw.getClientRects();
      if (!nota || !rs.length) return;
      var r = rs[rs.length - 1], n = nota.getBoundingClientRect();
      var x1 = r.right - k.left + 4, y1 = r.top - k.top + r.height * 0.62, x2 = n.left - k.left - 6, y2 = n.top - k.top + 21;
      var kolor = tw.getAttribute('data-stan') === 'bl' ? 'var(--c-blad)' : 'var(--c-uwaga)';
      var cx = x1 + (x2 - x1) * 0.55;
      h += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' C ' + cx.toFixed(1) + ' ' + y1.toFixed(1) + ', ' + cx.toFixed(1) + ' ' + y2.toFixed(1) + ', ' + x2.toFixed(1) + ' ' + y2.toFixed(1) +
        '" fill="none" stroke="' + kolor + '" stroke-width="1.25" stroke-dasharray="3 4" opacity=".75"/>' +
        '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="2.5" fill="' + kolor + '"/>';
    });
    svgLinie.setAttribute('width', Math.round(k.width));
    svgLinie.setAttribute('height', Math.round(k.height));
    svgLinie.innerHTML = h;
  }
  if (fk) {
    $$('.tw', fk).forEach(function (tw) {
      var nota = tw.getAttribute('data-nota') ? document.getElementById(tw.getAttribute('data-nota')) : null;
      var dymek = tw.nextElementSibling && tw.nextElementSibling.classList.contains('dymek') ? tw.nextElementSibling : null;
      var wlacz = function () {
        tw.classList.add('aktywne');
        if (nota) nota.classList.add('aktywna');
        if (dymek) {
          dymek.style.left = '0px';
          var r = dymek.getBoundingClientRect(), wyjscie = r.right - (document.documentElement.clientWidth - 16);
          if (wyjscie > 0) dymek.style.left = (-wyjscie) + 'px';
        }
      };
      var wylacz = function () { tw.classList.remove('aktywne'); if (nota) nota.classList.remove('aktywna'); };
      tw.addEventListener('mouseenter', wlacz);
      tw.addEventListener('mouseleave', wylacz);
      tw.addEventListener('focus', wlacz);
      tw.addEventListener('blur', wylacz);
      tw.addEventListener('click', function () {
        wlacz();
        if (nota && window.innerWidth <= 980) nota.scrollIntoView({ behavior: spokoj ? 'auto' : 'smooth', block: 'center' });
      });
    });
    var czekaLinie = null;
    var odswiezLinie = function () { clearTimeout(czekaLinie); czekaLinie = setTimeout(rysujLinie, 120); };
    window.addEventListener('resize', odswiezLinie);
    if (window.ResizeObserver) new ResizeObserver(odswiezLinie).observe(fk);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(rysujLinie);
    poWejsciu.push(function (el) { if (el === fk) setTimeout(rysujLinie, 700); });
    rysujLinie();
  }

  /* ---------- cennik: tabela porównania jest otwarta w HTML (bez JS widać ją wszędzie);
     na telefonie zwijamy ją, bo karty pakietów mówią to samo krócej ---------- */
  var porownanie = $('.porownanie');
  if (porownanie && window.matchMedia && matchMedia('(max-width: 720px)').matches) porownanie.open = false;

  /* ---------- pasek akcji na telefonie (decyzja agencja-strona-projekt D2): jedna pigułka „Załóż konto" przy prawej
     krawędzi. Widać ją po minięciu hero, przy przewijaniu w dół; chowa się przy przewijaniu w górę (wtedy przeglądarki,
     np. Samsung Internet, pokazują na środku dołu swój przycisk „do góry", a nagłówek z „Zaloguj się" i tak wraca),
     przy zakończeniu strony (#start ma własny przycisk) i przy stopce. ---------- */
  var pasek = $('#pasek-cta');
  if (pasek && maIO) {
    pasek.hidden = false;
    var poHero = false, przyKoncu = false, przyStopce = false, wDol = true, ostatniY = window.scrollY, suma = 0, stan = null;
    var odswiezPasek = function () {
      var w = poHero && !przyKoncu && !przyStopce && wDol;
      if (w === stan) return;
      stan = w;
      pasek.classList.toggle('widoczny', w);
    };
    // kierunek przewijania z progiem 24 px, żeby drobne drgnięcia palca nie migały pigułką
    window.addEventListener('scroll', function () {
      var y = window.scrollY, ruch = y - ostatniY;
      ostatniY = y;
      if (!ruch) return;
      if ((ruch > 0) !== (suma > 0)) suma = 0;
      suma += ruch;
      if (suma >= 24 && !wDol) { wDol = true; odswiezPasek(); }
      else if (suma <= -24 && wDol) { wDol = false; odswiezPasek(); }
    }, { passive: true });
    var celHero = $('.hero .cta'), celKoniec = $('#start'), celStopka = $('.stopka');
    if (celHero) new IntersectionObserver(function (w) { poHero = !w[0].isIntersecting && w[0].boundingClientRect.top < 0; odswiezPasek(); }).observe(celHero);
    if (celKoniec) new IntersectionObserver(function (w) { przyKoncu = w[0].isIntersecting; odswiezPasek(); }).observe(celKoniec);
    if (celStopka) new IntersectionObserver(function (w) { przyStopce = w[0].isIntersecting; odswiezPasek(); }).observe(celStopka);
  }

  if (mqSpokoj && mqSpokoj.addEventListener) mqSpokoj.addEventListener('change', function () { spokoj = mqSpokoj.matches; });
})();
