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

  /* ---------- nawigacja: tło po przewinięciu, menu na telefonie, aktywna sekcja ---------- */
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
    window.addEventListener('resize', function () { if (window.innerWidth > 720 && !menuPanel.hidden) ustawMenu(false); });
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
    var ustawKlasy = function (n, bezPrzejsc) {
      var k = 'ramka';
      for (var i = 1; i <= n; i++) k += ' k' + i;
      if (wPauzie) k += ' pauza';
      if (spokoj) k += ' bez-petli';
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
      if (zegar || wPauzie || wstrzymana || !widoczna || document.hidden || spokoj) return;
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
      ustawKlasy(0, true);
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
    var rozloz = function () {
      if (mqSzeroki.matches) {
        if (!scena.parentNode) { uklad.insertBefore(scena, listaKrokow); ekrany.forEach(function (e) { scena.appendChild(e); }); uklad.classList.add('scena'); }
      } else if (scena.parentNode) {
        ekrany.forEach(function (e, i) { e.classList.remove('widoczny'); krokiLi[i].insertBefore(e, krokiLi[i].firstChild); });
        uklad.removeChild(scena); uklad.classList.remove('scena');
      }
      pokazEkran();
    };
    if (mqSzeroki.addEventListener) mqSzeroki.addEventListener('change', rozloz);
    rozloz();
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

  /* ---------- pakiety: przycisk w karcie ustawia pakiet w formularzu ---------- */
  var form = $('#formularz');
  var poleP = form ? $('[name="pakiet"]', form) : null;
  $$('[data-pakiet]').forEach(function (a) {
    a.addEventListener('click', function () { if (poleP) poleP.value = a.getAttribute('data-pakiet'); });
  });

  /* ---------- formularz „Poproś o dostęp" ---------- */
  if (form) {
    var pola = $('#form-pola', form);
    var wyslij = $('.form-wyslij', form), wyslijTekst = $('.fw-tekst', form);
    var komunikat = $('#form-komunikat', form);
    var wyslano = $('#wyslano', form);
    var tekstPrzycisku = wyslijTekst.textContent;
    var POLA = ['imie', 'email', 'firma', 'pakiet', 'wiadomosc', 'zgoda'];
    var KODY = { 'brak-imienia': 'data-b-imie', 'zly-email': 'data-b-email', 'za-dlugie': 'data-b-dlugie', 'zly-pakiet': 'data-b-pakiet', 'brak-zgody': 'data-b-zgoda' };
    var pole = function (n) { return form.elements[n]; };
    var tekst = function (atr) { return form.getAttribute(atr) || ''; };
    pola.disabled = false;

    var pokazBlad = function (nazwa, msg) {
      var el = pole(nazwa), b = $('#b-' + nazwa, form);
      if (!el || !b) return false;
      if (msg) { b.textContent = msg; b.hidden = false; el.setAttribute('aria-invalid', 'true'); }
      else { b.textContent = ''; b.hidden = true; el.removeAttribute('aria-invalid'); }
      return true;
    };
    var pokazKomunikat = function (msg) { komunikat.textContent = msg || ''; komunikat.hidden = !msg; };
    var EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
    var sprawdzPole = function (n) {
      var el = pole(n), v = el.type === 'checkbox' ? el.checked : el.value.trim(), msg = '';
      if (n === 'imie' && !v) msg = tekst('data-b-imie');
      else if (n === 'email' && !EMAIL.test(v)) msg = tekst('data-b-email');
      else if (n === 'zgoda' && !v) msg = tekst('data-b-zgoda');
      else if (el.maxLength > 0 && typeof v === 'string' && v.length > el.maxLength) msg = tekst('data-b-dlugie');
      pokazBlad(n, msg);
      return !msg;
    };
    ['imie', 'email'].forEach(function (n) {
      pole(n).addEventListener('blur', function () { if (pole(n).value.trim()) sprawdzPole(n); });
      pole(n).addEventListener('input', function () { if (pole(n).getAttribute('aria-invalid')) sprawdzPole(n); });
    });
    pole('zgoda').addEventListener('change', function () { if (pole('zgoda').getAttribute('aria-invalid')) sprawdzPole('zgoda'); });

    var stanWysylania = function (trwa) {
      wyslij.disabled = trwa;
      wyslij.setAttribute('aria-busy', trwa ? 'true' : 'false');
      wyslijTekst.textContent = trwa ? tekst('data-wysylanie') : tekstPrzycisku;
    };
    var sukces = function (email) {
      $('.wyslano-email', form).textContent = email;
      form.classList.add('wyslana');
      wyslano.hidden = false;
      wyslano.focus();
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      pokazKomunikat('');
      var pierwszyZly = null;
      POLA.forEach(function (n) { if (!sprawdzPole(n) && !pierwszyZly) pierwszyZly = pole(n); });
      if (pierwszyZly) { pierwszyZly.focus(); return; }
      var dane = {
        imie: pole('imie').value.trim(),
        email: pole('email').value.trim(),
        firma: pole('firma').value.trim(),
        pakiet: pole('pakiet').value,
        wiadomosc: pole('wiadomosc').value.trim(),
        jezyk: form.getAttribute('data-jezyk') || d.lang,
        zgoda: pole('zgoda').checked === true,
        strona: pole('strona').value
      };
      stanWysylania(true);
      var ctrl = window.AbortController ? new AbortController() : null;
      var limit = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
      fetch(form.getAttribute('data-api'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dane),
        credentials: 'omit',
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (odp) {
        return odp.json().catch(function () { return {}; }).then(function (cialo) { return { status: odp.status, cialo: cialo || {} }; });
      }).then(function (w) {
        clearTimeout(limit);
        stanWysylania(false);
        if (w.status === 200 && w.cialo.ok === true) { sukces(dane.email); return; }
        if (w.status === 429) { pokazKomunikat(tekst('data-b-429')); return; }
        if (w.status === 413) { pokazKomunikat(tekst('data-b-dlugie')); return; }
        if (w.status === 400) {
          var c = w.cialo, msg = (c.blad && KODY[c.blad]) ? tekst(KODY[c.blad]) : (typeof c.komunikat === 'string' && c.komunikat) || tekst('data-b-ogolny');
          var nazwaPola = c.pole || (c.blad === 'brak-zgody' ? 'zgoda' : '');
          if (nazwaPola && POLA.indexOf(nazwaPola) >= 0 && pokazBlad(nazwaPola, msg)) pole(nazwaPola).focus();
          else pokazKomunikat(msg);
          return;
        }
        pokazKomunikat(tekst('data-b-siec'));
      }).catch(function () {
        clearTimeout(limit);
        stanWysylania(false);
        pokazKomunikat(tekst('data-b-siec'));
      });
    });
  }

  /* ---------- pasek akcji na telefonie: po hero, schowany przy formularzu i stopce ---------- */
  var pasek = $('#pasek-cta');
  if (pasek && maIO) {
    pasek.hidden = false;
    var poHero = false, przyKoncu = false, przyStopce = false;
    var odswiezPasek = function () {
      var w = poHero && !przyKoncu && !przyStopce;
      pasek.classList.toggle('widoczny', w);
    };
    var celHero = $('.hero .cta'), celKoniec = $('#dostep'), celStopka = $('.stopka');
    if (celHero) new IntersectionObserver(function (w) { poHero = !w[0].isIntersecting && w[0].boundingClientRect.top < 0; odswiezPasek(); }).observe(celHero);
    if (celKoniec) new IntersectionObserver(function (w) { przyKoncu = w[0].isIntersecting; odswiezPasek(); }).observe(celKoniec);
    if (celStopka) new IntersectionObserver(function (w) { przyStopce = w[0].isIntersecting; odswiezPasek(); }).observe(celStopka);
  }

  if (mqSpokoj && mqSpokoj.addEventListener) mqSpokoj.addEventListener('change', function () { spokoj = mqSpokoj.matches; });
})();
