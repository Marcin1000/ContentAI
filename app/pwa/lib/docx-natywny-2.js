/*
 * docx-natywny-2.js - prawdziwy DOCX (WordprocessingML) z drzewa HTML artykulu. Bez zaleznosci.
 *
 * Wersja 2 (runda 9, R9-D): oznaczenie tresci AI (art. 50 AI Act, PR8-17) we wlasciwosciach
 * dokumentu. Z opcje.wlasciwosciAI = { zrodlo, system, wersja, slowa, edytowany } plik dostaje
 * docProps/custom.xml (AIGenerated, AISystem, DigitalSourceType = kod IPTC, AIMarkingVersion,
 * AIEditedByHuman), cp:keywords w core.xml, wpis w [Content_Types].xml i relacje w _rels/.rels.
 * Widac je w Wordzie (Plik, Informacje, Wlasciwosci zaawansowane, Niestandardowe), w LibreOffice
 * i w exiftool. Akapit p.oznaczenie-ai (widoczna etykieta z aplikacji) dostaje styl drobnego druku.
 * Wersja 1 (docx-natywny.js) zostaje w repozytorium dla kart otwartych przed aktualizacja.
 *
 * Zastepuje html-docx-js. Tamta biblioteka wkladala HTML do DOCX jako "altChunk" (plik MHT
 * w srodku). Taki dokument otwieral tylko Word: Google Docs, LibreOffice, Pages i czesc
 * aplikacji na telefonie pokazywaly pusta strone albo plik odrzucaly, a strona byla w formacie
 * Letter zamiast A4.
 *
 * Tu kazdy element HTML staje sie elementem Worda:
 *   h1 -> styl "Title", h2 -> "heading 2", h3/h4 -> "heading 3" (poziomy 1:1 z artykulem,
 *   bo od nich zalezy struktura SEO po dalszych konwersjach), listy -> numbering.xml,
 *   linki -> hiperlacza z relacjami (wylacznie http, https, mailto), tabele -> w:tbl
 *   z wierszem naglowka, ramka meta description i sekcja zrodel.
 * Strona A4 (11906 x 16838), marginesy 2,5 cm. Kroje: Georgia (tekst) i Arial (tabele,
 * etykiety, naglowek i stopka strony) - odbiorca nie ma Literaty ani Schibsted Grotesk.
 * Wartosci: AG/agencja-marka/spec-eksportow.md (runda 3).
 *
 * Uzycie w przegladarce:
 *   const blob = await DocxNatywny.zbuduj(element, {
 *     tytul: 'H1', autor: 'Marka', opis: 'meta description', jezyk: 'pl-PL',
 *     naglowek: 'Marka' (pusty = bez naglowka strony), stopka: 'H1 skrocony',
 *     etykietaMeta: 'Meta description', znaki: function (n) { return n + ' znakow'; } });
 *
 * Nazwa pliku jest NOWA (nie html-docx.js): pliki z pwa/lib serwer podaje jako
 * niezmienne przez rok, wiec nowa tresc pod stara nazwa nie dotarlaby do przegladarek.
 */
(function (globalny) {
  'use strict';

  var TYP_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

  // Strona A4 i marginesy 2,5 cm (twipy). Szerokosc tekstu: 11906 - 2 * 1418 = 9070.
  var STRONA = { w: 11906, h: 16838, margines: 1418, tekst: 9070 };

  // Paleta druku (spec marki, pkt 1): wszystkie pary tekst/tlo >= AA, bez bursztynu.
  var KOLOR = {
    tekst: '1B1A17', tekst2: '4F4C45', tekst3: '67635B', link: '0B7268',
    liniaStrony: 'E3E1DB', linia: 'D6D3CB', tloTabeli: 'EFEEE9', tloMeta: 'F7F6F2',
  };
  var KROJ = { tresc: 'Georgia', dane: 'Arial', mono: 'Courier New' };

  // ─── Tekst i XML ─────────────────────────────────────────────────────────────

  // Znaki, ktorych XML 1.0 nie dopuszcza: sterujace (poza tab i nowa linia), U+FFFE/FFFF
  // i samotne polowki par zastepczych. Jeden taki znak w odpowiedzi modelu robil z
  // calego dokumentu plik, ktorego Word nie otworzy.
  function czystyTekst(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { out += s.charAt(i) + s.charAt(i + 1); i++; }
        continue;
      }
      if (c >= 0xDC00 && c <= 0xDFFF) continue;
      out += s.charAt(i);
    }
    return out;
  }

  function xml(s) {
    return czystyTekst(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // Odnosnik przechodzi tylko jako http, https albo mailto i tylko w postaci
  // znormalizowanej przez URL (spacje i znaki spoza ASCII zakodowane). Reszta
  // (javascript:, data:, kotwice, sciezki wzgledne) zostaje zwyklym tekstem.
  function bezpiecznyAdres(href) {
    var s = String(href == null ? '' : href).trim();
    if (!/^(https?:|mailto:)/i.test(s)) return '';
    try {
      var u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return '';
      // Login i haslo w adresie (https://user:haslo@host) nie wychodza do dokumentu klienta.
      if (u.username || u.password) { u.username = ''; u.password = ''; }
      if (u.href.length > 2000) return '';
      return u.href;
    } catch (e) {
      return '';
    }
  }

  function domena(href) {
    try { return new URL(href).hostname.replace(/^www\./i, ''); } catch (e) { return ''; }
  }

  // ─── Wlasciwosci akapitu i przebiegu ────────────────────────────────────────
  // Kolejnosc elementow w w:pPr i w:rPr jest ustalona przez schemat. Word odrzuca
  // plik z elementami w innej kolejnosci, wiec skladamy je w jednym miejscu.

  function pPr(o) {
    o = o || {};
    var s = '';
    if (o.styl) s += '<w:pStyle w:val="' + o.styl + '"/>';
    if (o.keepNext) s += '<w:keepNext/>';
    if (o.numId) s += '<w:numPr><w:ilvl w:val="' + (o.ilvl || 0) + '"/><w:numId w:val="' + o.numId + '"/></w:numPr>';
    if (o.ramkaGora) s += '<w:pBdr><w:top w:val="single" w:sz="4" w:space="12" w:color="' + KOLOR.linia + '"/></w:pBdr>';
    if (o.tab) s += '<w:tabs><w:tab w:val="right" w:pos="' + o.tab + '"/></w:tabs>';
    if (o.odstep) s += o.odstep;
    if (o.wciecie) s += '<w:ind w:left="' + o.wciecie + '"/>';
    if (o.jc) s += '<w:jc w:val="' + o.jc + '"/>';
    return s ? '<w:pPr>' + s + '</w:pPr>' : '';
  }

  function kluczFormatu(f) {
    return [f.b ? 1 : 0, f.i ? 1 : 0, f.u ? 1 : 0, f.s ? 1 : 0, f.sup ? 1 : 0, f.sub ? 1 : 0,
      f.mono ? 1 : 0, f.znak ? 1 : 0, f.kolor || '', f.kroj || '', f.sz || '', f.caps ? 1 : 0].join('|');
  }

  function rPr(f, styl) {
    var s = '';
    if (styl) s += '<w:rStyle w:val="' + styl + '"/>';
    var kroj = f.mono ? KROJ.mono : f.kroj;
    if (kroj) s += '<w:rFonts w:ascii="' + kroj + '" w:hAnsi="' + kroj + '" w:eastAsia="' + kroj + '" w:cs="' + kroj + '"/>';
    if (f.b) s += '<w:b/><w:bCs/>';
    if (f.i) s += '<w:i/><w:iCs/>';
    if (f.caps) s += '<w:caps/>';
    if (f.s) s += '<w:strike/>';
    if (f.kolor) s += '<w:color w:val="' + f.kolor + '"/>';
    if (f.sz) s += '<w:sz w:val="' + f.sz + '"/><w:szCs w:val="' + f.sz + '"/>';
    if (f.znak) s += '<w:highlight w:val="yellow"/>';
    if (f.u) s += '<w:u w:val="single"/>';
    if (f.sup) s += '<w:vertAlign w:val="superscript"/>';
    else if (f.sub) s += '<w:vertAlign w:val="subscript"/>';
    return s ? '<w:rPr>' + s + '</w:rPr>' : '';
  }

  function przebieg(tekst, f, styl) {
    return '<w:r>' + rPr(f || {}, styl) + '<w:t xml:space="preserve">' + xml(tekst) + '</w:t></w:r>';
  }

  // ─── HTML na odcinki tekstu ──────────────────────────────────────────────────

  var POMIJANE = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, SVG: 1, MATH: 1, IMG: 1, PICTURE: 1, VIDEO: 1,
    AUDIO: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, FORM: 1,
    LINK: 1, META: 1, BASE: 1, DIALOG: 1 };
  var INLINE = { A: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, INS: 1, S: 1, STRIKE: 1, DEL: 1, SPAN: 1, TIME: 1,
    ABBR: 1, CITE: 1, Q: 1, SMALL: 1, MARK: 1, SUP: 1, SUB: 1, CODE: 1, KBD: 1, SAMP: 1, TT: 1, VAR: 1, DFN: 1,
    BR: 1, LABEL: 1, FONT: 1, BIG: 1, WBR: 1 };

  function pominiety(el) {
    if (POMIJANE[el.tagName]) return true;
    if (el.hasAttribute && el.hasAttribute('data-tylko-ekran')) return true;
    return false;
  }

  // Formatowanie z atrybutu style (raport widocznosci ma pogrubione liczby w stylu).
  // Tylko pogrubienie, kursywa i kolor z szesciu cyfr - zadnych zmiennych motywu.
  function zeStylu(el, f) {
    var st = el.getAttribute && el.getAttribute('style');
    if (!st) return f;
    var nowy = null;
    var kopiuj = function () { if (!nowy) nowy = Object.assign({}, f); return nowy; };
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(st)) kopiuj().b = true;
    if (/font-style\s*:\s*italic/i.test(st)) kopiuj().i = true;
    var kol = /(?:^|;)\s*color\s*:\s*#([0-9a-f]{6})\b/i.exec(st);
    if (kol) kopiuj().kolor = kol[1].toUpperCase();
    return nowy || f;
  }

  // Cudzyslowy dla <q> wg jezyka dokumentu (ustawiane w czesci() przed budowa):
  // pl „…”, de i cs „…“, pozostale “…”.
  var CUDZYSLOWY = { pl: ['\u201E', '\u201D'], de: ['\u201E', '\u201C'], cs: ['\u201E', '\u201C'] };
  var cudzyslow = CUDZYSLOWY.pl;

  function zbierzInline(wezly, f, link, out) {
    for (var i = 0; i < wezly.length; i++) {
      var n = wezly[i];
      if (n.nodeType === 3) { out.push({ t: n.nodeValue, f: f, link: link }); continue; }
      if (n.nodeType !== 1 || pominiety(n)) continue;
      var tag = n.tagName;
      if (tag === 'BR') { out.push({ br: true }); continue; }
      var g = f;
      var kopia = function () { if (g === f) g = Object.assign({}, f); return g; };
      if (tag === 'STRONG' || tag === 'B') kopia().b = true;
      else if (tag === 'EM' || tag === 'I' || tag === 'CITE' || tag === 'DFN' || tag === 'VAR') kopia().i = true;
      else if (tag === 'U' || tag === 'INS') kopia().u = true;
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') kopia().s = true;
      else if (tag === 'SUP') kopia().sup = true;
      else if (tag === 'SUB') kopia().sub = true;
      else if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') kopia().mono = true;
      else if (tag === 'MARK') kopia().znak = true;
      g = zeStylu(n, g);
      var l = link;
      if (tag === 'A' && !link) l = bezpiecznyAdres(n.getAttribute('href'));
      if (tag === 'Q') out.push({ t: cudzyslow[0], f: g, link: l });
      zbierzInline(n.childNodes, g, l, out);
      if (tag === 'Q') out.push({ t: cudzyslow[1], f: g, link: l });
    }
    return out;
  }

  // Bialy znak jak w HTML: ciagi spacji i nowych linii to jedna spacja, bez spacji na
  // poczatku i koncu akapitu oraz wokol twardego przelamania. Spacja nierozdzielajaca zostaje.
  function normalizuj(odcinki) {
    var out = [];
    var poSpacji = true;
    var obetnij = function () {
      for (var k = out.length - 1; k >= 0; k--) {
        if (out[k].br) break;
        out[k].t = out[k].t.replace(/ +$/, '');
        if (out[k].t) break;
        out.splice(k, 1);
      }
    };
    odcinki.forEach(function (o) {
      if (o.br) { obetnij(); out.push({ br: true }); poSpacji = true; return; }
      var t = String(o.t).replace(/[ \t\n\r\f]+/g, ' ');
      if (poSpacji) t = t.replace(/^ /, '');
      if (!t) return;
      out.push({ t: t, f: o.f, link: o.link });
      poSpacji = / $/.test(t);
    });
    obetnij();
    while (out.length && out[0].br) out.shift();
    while (out.length && out[out.length - 1].br) out.pop();
    return out;
  }

  // ─── Budowa dokumentu ────────────────────────────────────────────────────────

  function Budowniczy(opcje) {
    this.opcje = opcje || {};
    this.relacje = [];          // hiperlacza: { id, adres }
    this.mapaRelacji = {};
    this.numeracje = [];        // numId list numerowanych (kazda lista od 1)
    this.nastepnyNum = 2;       // 1 = wypunktowanie
    this.bylTytul = false;
  }

  Budowniczy.prototype.relacja = function (adres) {
    if (this.mapaRelacji[adres]) return this.mapaRelacji[adres];
    var id = 'rIdL' + (this.relacje.length + 1);
    this.relacje.push({ id: id, adres: adres });
    this.mapaRelacji[adres] = id;
    return id;
  };

  Budowniczy.prototype.nowaNumeracja = function () {
    var id = this.nastepnyNum++;
    this.numeracje.push(id);
    return id;
  };

  // Odcinki -> przebiegi; sasiednie z tym samym formatem i linkiem sklejone w jeden.
  Budowniczy.prototype.przebiegi = function (odcinki, bazowy) {
    var self = this;
    var grupy = [];
    odcinki.forEach(function (o) {
      if (o.br) { grupy.push({ br: true }); return; }
      var f = Object.assign({}, bazowy || {}, o.f || {});
      var ost = grupy[grupy.length - 1];
      if (ost && !ost.br && ost.link === o.link && kluczFormatu(ost.f) === kluczFormatu(f)) ost.t += o.t;
      else grupy.push({ t: o.t, f: f, link: o.link || '' });
    });
    var s = '';
    for (var i = 0; i < grupy.length; i++) {
      var g = grupy[i];
      if (g.br) { s += '<w:r><w:br/></w:r>'; continue; }
      if (g.link) {
        // Kolejne odcinki tego samego linku (np. czesc pogrubiona) ida pod jedna relacje.
        var wnetrze = '';
        var j = i;
        while (j < grupy.length && !grupy[j].br && grupy[j].link === g.link) {
          wnetrze += przebieg(grupy[j].t, grupy[j].f, 'Hyperlink');
          j++;
        }
        s += '<w:hyperlink r:id="' + self.relacja(g.link) + '" w:history="1">' + wnetrze + '</w:hyperlink>';
        i = j - 1;
        continue;
      }
      s += przebieg(g.t, g.f);
    }
    return s;
  };

  // Akapit z wezlow inline. Zwraca '' gdy nie ma w nim tekstu (chyba ze wymuszony).
  Budowniczy.prototype.akapit = function (wezly, wlasciwosci, bazowy, wymus) {
    var odcinki = normalizuj(zbierzInline(wezly, {}, '', []));
    if (!odcinki.length && !wymus) return '';
    return '<w:p>' + pPr(wlasciwosci) + this.przebiegi(odcinki, bazowy) + '</w:p>';
  };

  Budowniczy.prototype.akapitTekstu = function (tekst, wlasciwosci, f) {
    return '<w:p>' + pPr(wlasciwosci) + (tekst ? przebieg(tekst, f || {}) : '') + '</w:p>';
  };

  // Dzieci elementu blokowego: wezly inline miedzy blokami tworza akapity "anonimowe".
  Budowniczy.prototype.dzieci = function (rodzic, out, ctx) {
    var bufor = [];
    var self = this;
    var splucz = function () {
      if (!bufor.length) return;
      var p = self.akapit(bufor, self.wlasciwosciAkapitu(ctx), ctx.bazowy);
      if (p) out.push(p);
      bufor = [];
    };
    var wezly = rodzic.childNodes;
    for (var i = 0; i < wezly.length; i++) {
      var n = wezly[i];
      if (n.nodeType === 3) { bufor.push(n); continue; }
      if (n.nodeType !== 1 || pominiety(n)) continue;
      if (INLINE[n.tagName]) { bufor.push(n); continue; }
      splucz();
      this.blok(n, out, ctx);
    }
    splucz();
  };

  Budowniczy.prototype.wlasciwosciAkapitu = function (ctx) {
    if (ctx.styl) return { styl: ctx.styl, jc: ctx.jc };
    return ctx.jc ? { jc: ctx.jc } : null;
  };

  Budowniczy.prototype.blok = function (el, out, ctx) {
    var tag = el.tagName;
    var klasy = el.classList || { contains: function () { return false; } };
    var poTytule = this.poTytule;
    this.poTytule = false;

    if (tag === 'H1') {
      var tytul = this.akapit(el.childNodes, { styl: this.bylTytul ? 'Heading2' : 'Title' });
      if (tytul) { out.push(tytul); this.poTytule = !this.bylTytul; this.bylTytul = true; }
      return;
    }
    if (tag === 'H2') { out.push(this.akapit(el.childNodes, { styl: 'Heading2' })); return; }
    if (tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      out.push(this.akapit(el.childNodes, { styl: 'Heading3' }));
      return;
    }
    if (tag === 'P' && klasy.contains('oznaczenie-ai')) {
      var etykietaAI = this.akapit(el.childNodes, { styl: 'OznaczenieAI' });
      if (etykietaAI) out.push(etykietaAI);
      return;
    }
    if (tag === 'P') {
      var styl = ctx.styl || (poTytule && !ctx.wTabeli ? 'Lead' : '');
      var p = this.akapit(el.childNodes, styl || ctx.jc ? { styl: styl, jc: ctx.jc } : null, ctx.bazowy);
      if (p) out.push(p);
      return;
    }
    if (tag === 'UL' || tag === 'OL') { this.lista(el, out, ctx, 0); return; }
    if (tag === 'TABLE') { this.tabela(el, out, ctx); return; }
    if (tag === 'BLOCKQUOTE') { this.dzieci(el, out, Object.assign({}, ctx, { styl: 'Quote' })); return; }
    if (tag === 'PRE') {
      var self = this;
      String(el.textContent || '').replace(/\r/g, '').split('\n').forEach(function (linia) {
        out.push(self.akapitTekstu(linia, { styl: 'Kod' }));
      });
      return;
    }
    if (tag === 'HR') {
      out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="' + KOLOR.linia + '"/></w:pBdr></w:pPr></w:p>');
      return;
    }
    if (tag === 'DL') {
      for (var d = 0; d < el.children.length; d++) {
        var dz = el.children[d];
        if (dz.tagName === 'DT') out.push(this.akapit(dz.childNodes, { keepNext: true }, { b: true }));
        else if (dz.tagName === 'DD') out.push(this.akapit(dz.childNodes, { wciecie: 360 }));
      }
      return;
    }
    if (tag === 'DIV' && klasy.contains('meta-box')) { this.ramkaMeta(el, out); return; }
    if (tag === 'DIV' && klasy.contains('zrodla-box')) { this.zrodla(el, out); return; }
    if (tag === 'LI') { var li = this.akapit(el.childNodes, null, ctx.bazowy); if (li) out.push(li); return; }
    if (tag === 'FIGCAPTION' || tag === 'CAPTION') {
      var podpis = this.akapit(el.childNodes, { jc: 'left' }, { i: true, kolor: KOLOR.tekst2 });
      if (podpis) out.push(podpis);
      return;
    }
    // Kontenery (div, section, article, figure, details, header, footer...): tylko dzieci.
    this.dzieci(el, out, ctx);
  };

  // Listy: kazdy element to akapit z numeracja; listy zagniezdzone schodza poziom nizej.
  // Akapit w <li> (model czasem tak pisze) laczy sie z numerem, kolejne ida z wcieciem.
  Budowniczy.prototype.lista = function (el, out, ctx, poziom) {
    var numId = el.tagName === 'OL' ? this.nowaNumeracja() : 1;
    var ilvl = Math.min(poziom, 8);
    for (var i = 0; i < el.children.length; i++) {
      var li = el.children[i];
      if (li.tagName !== 'LI' || pominiety(li)) continue;
      var bufor = [];
      var numer = true;
      var self = this;
      var splucz = function () {
        var wciecie = numId === 1 ? 360 * (ilvl + 1) : 397 + 360 * ilvl;
        var props = numer ? { styl: 'ListParagraph', numId: numId, ilvl: ilvl } : { styl: 'ListParagraph', wciecie: wciecie };
        var p = self.akapit(bufor, props, ctx.bazowy, false);
        if (p) { out.push(p); numer = false; }
        bufor = [];
      };
      for (var j = 0; j < li.childNodes.length; j++) {
        var n = li.childNodes[j];
        if (n.nodeType === 3) { bufor.push(n); continue; }
        if (n.nodeType !== 1 || pominiety(n)) continue;
        if (INLINE[n.tagName]) { bufor.push(n); continue; }
        if (n.tagName === 'UL' || n.tagName === 'OL') {
          splucz();
          // Punkt z sama lista zagniezdzona: bez tego akapitu punkt nadrzedny znikal.
          if (numer) { out.push('<w:p>' + pPr({ styl: 'ListParagraph', numId: numId, ilvl: ilvl }) + '</w:p>'); numer = false; }
          this.lista(n, out, ctx, poziom + 1);
          continue;
        }
        if (n.tagName === 'P' || n.tagName === 'DIV' || n.tagName === 'SPAN') {
          splucz();
          for (var k = 0; k < n.childNodes.length; k++) bufor.push(n.childNodes[k]);
          splucz();
          continue;
        }
        splucz();
        this.blok(n, out, ctx);
      }
      splucz();
    }
  };

  // Tabela: obramowanie tylko poziome, wiersz naglowka powtarzany na kolejnych stronach,
  // kolumny liczbowe wyrownane do prawej. Po tabeli akapit-odstep: dwie tabele obok siebie
  // Word skleja w jedna.
  Budowniczy.prototype.tabela = function (el, out, ctx) {
    var wiersze = [];
    var zbierz = function (rodzic) {
      for (var i = 0; i < rodzic.children.length; i++) {
        var c = rodzic.children[i];
        if (c.tagName === 'TR') wiersze.push({ tr: c, naglowek: rodzic.tagName === 'THEAD' });
        else if (c.tagName === 'THEAD' || c.tagName === 'TBODY' || c.tagName === 'TFOOT') zbierz(c);
      }
    };
    zbierz(el);
    if (!wiersze.length) return;
    var podpis = null;
    for (var p = 0; p < el.children.length; p++) if (el.children[p].tagName === 'CAPTION') podpis = el.children[p];
    if (podpis) this.blok(podpis, out, ctx);

    var komorki = function (tr) {
      var k = [];
      for (var i = 0; i < tr.children.length; i++) {
        var c = tr.children[i];
        if (c.tagName === 'TD' || c.tagName === 'TH') k.push(c);
      }
      return k;
    };
    var rozpietosc = function (c) { var n = parseInt(c.getAttribute('colspan'), 10); return n > 0 && n < 64 ? n : 1; };
    var wysokosc = function (c) { var n = parseInt(c.getAttribute('rowspan'), 10); return n > 1 && n < 1000 ? n : 1; };
    // Ulozenie w siatce: komorka zaczyna sie w pierwszym wolnym polu wiersza; rowspan
    // zajmuje te same kolumny w kolejnych wierszach (tam komorka-kontynuacja vMerge).
    // Bez tego komorki pod scalona przesuwaly sie w lewo.
    var kolumn = 0;
    var ciag = {};   // 'wiersz:kolumna' -> szerokosc kontynuacji
    wiersze.forEach(function (w, r) {
      w.start = {};
      var x = 0;
      komorki(w.tr).forEach(function (c) {
        while (ciag[r + ':' + x]) x += ciag[r + ':' + x];
        var span = rozpietosc(c);
        var rs = Math.min(wysokosc(c), wiersze.length - r);
        w.start[x] = { c: c, span: span, rs: rs };
        for (var k = 1; k < rs; k++) ciag[(r + k) + ':' + x] = span;
        x += span;
      });
      kolumn = Math.max(kolumn, x);
      if (!w.naglowek && r === 0) {
        var pierwsze = komorki(w.tr);
        if (pierwsze.length && pierwsze.every(function (c) { return c.tagName === 'TH'; })) w.naglowek = true;
      }
    });
    Object.keys(ciag).forEach(function (k) { var x = +k.split(':')[1]; kolumn = Math.max(kolumn, x + ciag[k]); });
    if (!kolumn) return;

    // Kolumna liczbowa: co najmniej 80% niepustych komorek tresci to liczby.
    var liczbowe = [];
    for (var kol = 0; kol < kolumn; kol++) {
      var wsz = 0;
      var licz = 0;
      wiersze.forEach(function (w) {
        if (w.naglowek || !w.start[kol]) return;
        var t = (w.start[kol].c.textContent || '').trim();
        if (t) { wsz++; if (/^[\d\s.,%+\-−]+$/.test(t)) licz++; }
      });
      liczbowe.push(wsz > 0 && licz / wsz >= 0.8);
    }

    var szer = Math.floor(STRONA.tekst / kolumn);
    var s = '<w:tbl><w:tblPr><w:tblStyle w:val="TabelaTresc"/><w:tblW w:w="5000" w:type="pct"/>'
      + '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:left w:val="nil"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:right w:val="nil"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="autofit"/>'
      + '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>'
      + '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>'
      + '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>'
      + '</w:tblPr><w:tblGrid>';
    for (var g = 0; g < kolumn; g++) s += '<w:gridCol w:w="' + szer + '"/>';
    s += '</w:tblGrid>';

    var self = this;
    // tcPr w kolejnosci schematu: tcW, gridSpan, vMerge, shd.
    var tcPr = function (span, scalenie, naglowek) {
      return '<w:tcPr><w:tcW w:w="' + (szer * span) + '" w:type="dxa"/>'
        + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '')
        + (scalenie === 'start' ? '<w:vMerge w:val="restart"/>' : scalenie === 'dalej' ? '<w:vMerge/>' : '')
        + (naglowek ? '<w:shd w:val="clear" w:color="auto" w:fill="' + KOLOR.tloTabeli + '"/>' : '')
        + '</w:tcPr>';
    };
    wiersze.forEach(function (w, r) {
      s += '<w:tr>' + (w.naglowek ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>');
      var stylPusty = w.naglowek ? 'TabelaNaglowek' : 'TabelaTekst';
      var x = 0;
      while (x < kolumn) {
        var start = w.start[x];
        if (start) {
          var span = Math.min(start.span, kolumn - x);
          var wewnatrz = [];
          var cctx = { styl: stylPusty, wTabeli: true, jc: !w.naglowek && liczbowe[x] ? 'right' : '' };
          self.dzieci(start.c, wewnatrz, cctx);
          if (!wewnatrz.length || /<w:tbl>/.test(wewnatrz[wewnatrz.length - 1].slice(0, 7))) {
            wewnatrz.push('<w:p>' + pPr({ styl: cctx.styl }) + '</w:p>');
          }
          s += '<w:tc>' + tcPr(span, start.rs > 1 ? 'start' : '', w.naglowek) + wewnatrz.join('') + '</w:tc>';
          x += span;
        } else if (ciag[r + ':' + x]) {
          // Kontynuacja komorki z rowspan z wiersza wyzej.
          var szerC = Math.min(ciag[r + ':' + x], kolumn - x);
          s += '<w:tc>' + tcPr(szerC, 'dalej', w.naglowek) + '<w:p>' + pPr({ styl: stylPusty }) + '</w:p></w:tc>';
          x += szerC;
        } else {
          // Wiersz krotszy od siatki dopelniamy pustymi komorkami - inaczej czesc
          // programow przesuwa kolumny.
          s += '<w:tc>' + tcPr(1, '', w.naglowek) + '<w:p>' + pPr({ styl: stylPusty }) + '</w:p></w:tc>';
          x += 1;
        }
      }
      s += '</w:tr>';
    });
    s += '</w:tbl>';
    out.push(s);
    out.push('<w:p>' + pPr({ styl: 'Odstep' }) + '</w:p>');
  };

  // Ramka meta description: tabela 1x1, bo obramowanie i tlo akapitu Google Docs
  // i Pages oddaja gorzej niz tabele.
  Budowniczy.prototype.ramkaMeta = function (el, out) {
    var tresc = [];
    var etykieta = this.opcje.etykietaMeta || 'Meta description';
    tresc.push('<w:p>' + pPr({ styl: 'MetaEtykieta' }) + przebieg(etykieta, {}) + '</w:p>');
    var tekstMeta = '';
    var self = this;
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (pominiety(c) || (c.classList && c.classList.contains('meta-label'))) continue;
      // Starsze artykuly mialy etykiete w <strong> zamiast w div.meta-label.
      if (c.tagName === 'STRONG' && i === 0) continue;
      var p = self.akapit(c.childNodes, { styl: 'MetaTekst' });
      if (p) { tresc.push(p); tekstMeta += (c.textContent || '').trim(); }
    }
    if (tekstMeta && typeof this.opcje.znaki === 'function') {
      tresc.push('<w:p>' + pPr({ styl: 'MetaZnaki' }) + przebieg(this.opcje.znaki(tekstMeta.length), {}) + '</w:p>');
    }
    var ramka = '<w:top w:val="single" w:sz="6" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:left w:val="single" w:sz="6" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:right w:val="single" w:sz="6" w:space="0" w:color="' + KOLOR.linia + '"/>';
    out.push('<w:p>' + pPr({ styl: 'Odstep' }) + '</w:p>');
    out.push('<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>' + ramka + '</w:tblBorders>'
      + '<w:tblCellMar><w:top w:w="160" w:type="dxa"/><w:left w:w="200" w:type="dxa"/>'
      + '<w:bottom w:w="160" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tblCellMar>'
      + '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>'
      + '</w:tblPr><w:tblGrid><w:gridCol w:w="' + STRONA.tekst + '"/></w:tblGrid>'
      + '<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="' + STRONA.tekst + '" w:type="dxa"/>'
      + '<w:shd w:val="clear" w:color="auto" w:fill="' + KOLOR.tloMeta + '"/></w:tcPr>'
      + tresc.join('') + '</w:tc></w:tr></w:tbl>');
    out.push('<w:p>' + pPr({ styl: 'Odstep' }) + '</w:p>');
  };

  // Zrodla: naglowek poziomu H2 z linia nad soba i lista numerowana. Pozycja: tytul
  // jako hiperlacze, za nim "domena · data" malym szarym krojem danych.
  Budowniczy.prototype.zrodla = function (el, out) {
    var etykietaEl = el.querySelector('.zrodla-label');
    var etykieta = (this.opcje.etykietaZrodel || (etykietaEl && etykietaEl.textContent) || '').trim();
    if (etykieta) out.push('<w:p>' + pPr({ styl: 'Heading2', ramkaGora: true }) + przebieg(etykieta, {}) + '</w:p>');
    var numId = this.nowaNumeracja();
    var self = this;
    var pozycje = el.querySelectorAll('li');
    for (var i = 0; i < pozycje.length; i++) {
      var li = pozycje[i];
      if (pominiety(li)) continue;
      var a = li.querySelector('a[href]');
      var adres = a ? bezpiecznyAdres(a.getAttribute('href')) : '';
      var tytul = ((a ? a.textContent : li.textContent) || '').replace(/\s+/g, ' ').trim();
      var dataEl = li.querySelector('time') || li.querySelector('.zrodlo-data');
      var data = dataEl ? String(dataEl.textContent || '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim() : '';
      var opis = [domena(adres), data].filter(Boolean).join(' · ');
      var s = '<w:p>' + pPr({ styl: 'ZrodloPozycja', numId: numId, ilvl: 0 });
      if (tytul && adres) s += '<w:hyperlink r:id="' + self.relacja(adres) + '" w:history="1">' + przebieg(tytul, {}, 'Hyperlink') + '</w:hyperlink>';
      else if (tytul) s += przebieg(tytul, {});
      if (opis) s += przebieg('  ' + opis, { kroj: KROJ.dane, sz: 16, kolor: KOLOR.tekst3 });
      s += '</w:p>';
      if (tytul || opis) out.push(s);
    }
  };

  // ─── Czesci pakietu ──────────────────────────────────────────────────────────

  function stylAkapitu(id, nazwa, opcje) {
    opcje = opcje || {};
    return '<w:style w:type="paragraph" w:styleId="' + id + '"' + (opcje.domyslny ? ' w:default="1"' : '') + '>'
      + '<w:name w:val="' + nazwa + '"/>'
      + (opcje.basedOn ? '<w:basedOn w:val="' + opcje.basedOn + '"/>' : '')
      + (opcje.next ? '<w:next w:val="' + opcje.next + '"/>' : '')
      + (opcje.ui != null ? '<w:uiPriority w:val="' + opcje.ui + '"/>' : '')
      + (opcje.qFormat ? '<w:qFormat/>' : '')
      + (opcje.pPr ? '<w:pPr>' + opcje.pPr + '</w:pPr>' : '')
      + (opcje.rPr ? '<w:rPr>' + opcje.rPr + '</w:rPr>' : '')
      + '</w:style>';
  }

  function kroj(nazwa) {
    return '<w:rFonts w:ascii="' + nazwa + '" w:hAnsi="' + nazwa + '" w:eastAsia="' + nazwa + '" w:cs="' + nazwa + '"/>';
  }
  function rozmiar(polpunkty) { return '<w:sz w:val="' + polpunkty + '"/><w:szCs w:val="' + polpunkty + '"/>'; }
  function kolor(k) { return '<w:color w:val="' + k + '"/>'; }

  function stylesXml(jezyk) {
    var pogrubienie = '<w:b/><w:bCs/>';
    var naglowek = '<w:keepNext/><w:keepLines/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:styles xmlns:w="' + NS_W + '">'
      + '<w:docDefaults><w:rPrDefault><w:rPr>' + kroj(KROJ.tresc) + kolor(KOLOR.tekst) + rozmiar(22)
      + '<w:lang w:val="' + jezyk + '" w:eastAsia="' + jezyk + '" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
      + '<w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>'
      + '</w:docDefaults>'
      + stylAkapitu('Normal', 'Normal', { domyslny: true, qFormat: true })
      + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/>'
      + '<w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
      + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/>'
      + '<w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar>'
      + '<w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>'
      + '<w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
      + '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/>'
      + '<w:semiHidden/><w:unhideWhenUsed/></w:style>'
      + stylAkapitu('Title', 'Title', { basedOn: 'Normal', next: 'Lead', ui: 10, qFormat: true,
        pPr: '<w:keepNext/><w:spacing w:before="0" w:after="200" w:line="240" w:lineRule="auto"/><w:outlineLvl w:val="0"/>',
        rPr: pogrubienie + kolor(KOLOR.tekst) + rozmiar(44) })
      + stylAkapitu('Lead', 'Lead', { basedOn: 'Normal', next: 'Normal', qFormat: true,
        pPr: '<w:spacing w:after="280" w:line="300" w:lineRule="auto"/>', rPr: kolor(KOLOR.tekst2) + rozmiar(25) })
      + stylAkapitu('Heading1', 'heading 1', { basedOn: 'Normal', next: 'Normal', ui: 9, qFormat: true,
        pPr: naglowek + '<w:spacing w:before="480" w:after="160" w:line="264" w:lineRule="auto"/><w:outlineLvl w:val="0"/>',
        rPr: pogrubienie + kolor(KOLOR.tekst) + rozmiar(36) })
      + stylAkapitu('Heading2', 'heading 2', { basedOn: 'Normal', next: 'Normal', ui: 9, qFormat: true,
        pPr: naglowek + '<w:spacing w:before="360" w:after="120" w:line="264" w:lineRule="auto"/><w:outlineLvl w:val="1"/>',
        rPr: pogrubienie + kolor(KOLOR.tekst) + rozmiar(30) })
      + stylAkapitu('Heading3', 'heading 3', { basedOn: 'Normal', next: 'Normal', ui: 9, qFormat: true,
        pPr: naglowek + '<w:spacing w:before="240" w:after="80" w:line="264" w:lineRule="auto"/><w:outlineLvl w:val="2"/>',
        rPr: pogrubienie + kolor(KOLOR.tekst) + rozmiar(24) })
      + stylAkapitu('ListParagraph', 'List Paragraph', { basedOn: 'Normal', ui: 34, qFormat: true,
        pPr: '<w:spacing w:after="60"/><w:contextualSpacing/>' })
      + stylAkapitu('Quote', 'Quote', { basedOn: 'Normal', next: 'Normal', ui: 29, qFormat: true,
        pPr: '<w:pBdr><w:left w:val="single" w:sz="12" w:space="10" w:color="' + KOLOR.linia + '"/></w:pBdr>'
          + '<w:spacing w:after="160"/><w:ind w:left="340"/>',
        rPr: '<w:i/><w:iCs/>' + kolor(KOLOR.tekst2) })
      + '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/>'
      + '<w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr>' + kolor(KOLOR.link) + '<w:u w:val="single"/></w:rPr></w:style>'
      + '<w:style w:type="table" w:styleId="TabelaTresc"><w:name w:val="Tabela treści"/><w:basedOn w:val="TableNormal"/>'
      + '<w:uiPriority w:val="59"/><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr>'
      + '<w:rPr>' + kroj(KROJ.dane) + kolor(KOLOR.tekst) + rozmiar(19) + '</w:rPr>'
      + '<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="' + KOLOR.linia + '"/>'
      + '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="' + KOLOR.linia + '"/></w:tblBorders>'
      + '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/>'
      + '<w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
      // Akapity w komorkach maja wlasny styl z krojem danych: styl tabeli nie kazdy
      // program stosuje do tekstu (LibreOffice i Pages bywaja wybiorcze).
      + stylAkapitu('TabelaTekst', 'Tabela tekst', { basedOn: 'Normal', ui: 60,
        pPr: '<w:spacing w:after="0" w:line="252" w:lineRule="auto"/>', rPr: kroj(KROJ.dane) + kolor(KOLOR.tekst) + rozmiar(19) })
      + stylAkapitu('TabelaNaglowek', 'Tabela nagłówek', { basedOn: 'TabelaTekst', ui: 60,
        pPr: '<w:keepNext/>', rPr: pogrubienie + rozmiar(17) })
      + stylAkapitu('MetaEtykieta', 'Meta etykieta', { basedOn: 'Normal', ui: 60,
        pPr: '<w:keepNext/><w:spacing w:after="60"/>',
        rPr: kroj(KROJ.dane) + pogrubienie + '<w:caps/>' + kolor(KOLOR.tekst2) + '<w:spacing w:val="12"/>' + rozmiar(16) })
      + stylAkapitu('MetaTekst', 'Meta tekst', { basedOn: 'Normal', ui: 60,
        pPr: '<w:spacing w:after="0" w:line="288" w:lineRule="auto"/>', rPr: rozmiar(21) })
      + stylAkapitu('MetaZnaki', 'Meta liczba znaków', { basedOn: 'Normal', ui: 60,
        pPr: '<w:spacing w:before="80" w:after="0"/>', rPr: kroj(KROJ.dane) + kolor(KOLOR.tekst3) + rozmiar(16) })
      + stylAkapitu('OznaczenieAI', 'Oznaczenie AI', { basedOn: 'Normal', ui: 60,
        pPr: '<w:spacing w:before="240" w:after="120"/>', rPr: kroj(KROJ.dane) + kolor(KOLOR.tekst2) + rozmiar(17) })
      + stylAkapitu('ZrodloPozycja', 'Źródło', { basedOn: 'Normal', ui: 60,
        pPr: '<w:spacing w:after="80" w:line="276" w:lineRule="auto"/>', rPr: rozmiar(19) })
      + stylAkapitu('Kod', 'Kod', { basedOn: 'Normal', ui: 60,
        pPr: '<w:spacing w:after="0" w:line="252" w:lineRule="auto"/>', rPr: kroj(KROJ.mono) + rozmiar(19) })
      + stylAkapitu('Odstep', 'Odstęp', { basedOn: 'Normal', ui: 99,
        pPr: '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>', rPr: rozmiar(12) })
      + stylAkapitu('Header', 'header', { basedOn: 'Normal', ui: 99,
        pPr: '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="' + KOLOR.liniaStrony + '"/></w:pBdr>'
          + '<w:tabs><w:tab w:val="right" w:pos="' + STRONA.tekst + '"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
        rPr: kroj(KROJ.dane) + kolor(KOLOR.tekst2) + rozmiar(17) })
      + stylAkapitu('Footer', 'footer', { basedOn: 'Normal', ui: 99,
        pPr: '<w:tabs><w:tab w:val="right" w:pos="' + STRONA.tekst + '"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>',
        rPr: kroj(KROJ.dane) + kolor(KOLOR.tekst3) + rozmiar(16) })
      + '</w:styles>';
  }

  // Wypunktowanie: wciecie 360/284, drugi poziom 720, kazdy kolejny +360 (spec marki).
  // Numerowanie ma szersze wysuniecie (397): numer "10." nie miesci sie w 284 i LibreOffice
  // odsuwa wtedy tekst do nastepnego tabulatora, a zrodel bywa 12.
  function numberingXml(numeracje) {
    var poziomy = function (numerowana) {
      var s = '';
      for (var i = 0; i < 9; i++) {
        var wysuniecie = numerowana ? 397 : 284;
        var lewo = numerowana ? 397 + 360 * i : 360 * (i + 1);
        s += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/>'
          + '<w:numFmt w:val="' + (numerowana ? 'decimal' : 'bullet') + '"/>'
          + '<w:lvlText w:val="' + (numerowana ? '%' + (i + 1) + '.' : '•') + '"/><w:lvlJc w:val="left"/>'
          + '<w:pPr><w:ind w:left="' + lewo + '" w:hanging="' + wysuniecie + '"/></w:pPr>'
          + (numerowana ? '<w:rPr>' + kolor(KOLOR.tekst3) + '</w:rPr>'
            : '<w:rPr>' + kroj(KROJ.dane) + kolor(KOLOR.tekst3) + '</w:rPr>')
          + '</w:lvl>';
      }
      return s;
    };
    var s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="' + NS_W + '">'
      + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + poziomy(false) + '</w:abstractNum>'
      + '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + poziomy(true) + '</w:abstractNum>'
      + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    // Kazda lista numerowana zaczyna od 1 - inaczej druga lista w artykule liczylaby dalej.
    numeracje.forEach(function (id) {
      s += '<w:num w:numId="' + id + '"><w:abstractNumId w:val="1"/>';
      for (var i = 0; i < 9; i++) s += '<w:lvlOverride w:ilvl="' + i + '"><w:startOverride w:val="1"/></w:lvlOverride>';
      s += '</w:num>';
    });
    return s + '</w:numbering>';
  }

  function settingsXml(jezyk) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="' + NS_W + '">'
      + '<w:zoom w:percent="100"/><w:defaultTabStop w:val="709"/><w:characterSpacingControl w:val="doNotCompress"/>'
      + '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>'
      + '<w:themeFontLang w:val="' + jezyk + '"/></w:settings>';
  }

  function headerXml(tekst) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '">'
      + '<w:p>' + pPr({ styl: 'Header' }) + przebieg(tekst, {}) + '</w:p></w:hdr>';
  }

  function pole(instrukcja, zapas) {
    return '<w:fldSimple w:instr=" ' + instrukcja + ' "><w:r><w:t>' + zapas + '</w:t></w:r></w:fldSimple>';
  }

  function footerXml(tekst) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '">'
      + '<w:p>' + pPr({ styl: 'Footer' }) + (tekst ? przebieg(tekst, {}) : '') + '<w:r><w:tab/></w:r>'
      + pole('PAGE', '1') + przebieg(' / ', {}) + pole('NUMPAGES', '1') + '</w:p></w:ftr>';
  }

  function teraz() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  function coreXml(o) {
    var t = teraz();
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
      + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
      + ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + '<dc:title>' + xml(o.tytul || '') + '</dc:title>'
      + '<dc:creator>' + xml(o.autor || '') + '</dc:creator>'
      + '<cp:lastModifiedBy>' + xml(o.autor || '') + '</cp:lastModifiedBy>'
      + (o.opis ? '<dc:description>' + xml(o.opis) + '</dc:description>' : '')
      + (o.slowa ? '<cp:keywords>' + xml(o.slowa) + '</cp:keywords>' : '')
      + '<dc:language>' + xml(o.jezyk) + '</dc:language>'
      + '<dcterms:created xsi:type="dcterms:W3CDTF">' + t + '</dcterms:created>'
      + '<dcterms:modified xsi:type="dcterms:W3CDTF">' + t + '</dcterms:modified>'
      + '</cp:coreProperties>';
  }

  // Wlasne wlasciwosci pliku (ECMA-376 cz. 1, Custom File Properties): nazwy sa nasze, bo standard nie
  // przewiduje pola dla AI; wartosc DigitalSourceType to kod ze slownika IPTC Digital Source Type.
  var FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}';
  function customXml(ai) {
    var pid = 2;
    var wlasciwosc = function (nazwa, typ, wartosc) {
      return '<property fmtid="' + FMTID + '" pid="' + (pid++) + '" name="' + nazwa + '"><vt:' + typ + '>' + xml(wartosc) + '</vt:' + typ + '></property>';
    };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"'
      + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
      + wlasciwosc('AIGenerated', 'bool', 'true')
      + wlasciwosc('AISystem', 'lpwstr', ai.system || 'Content AI')
      + wlasciwosc('DigitalSourceType', 'lpwstr', ai.zrodlo || '')
      + wlasciwosc('AIMarkingVersion', 'lpwstr', ai.wersja || '1')
      + (typeof ai.edytowany === 'boolean' ? wlasciwosc('AIEditedByHuman', 'bool', ai.edytowany ? 'true' : 'false') : '')
      + '</Properties>';
  }

  function appXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
      + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
      + '<Application>Content AI</Application><DocSecurity>0</DocSecurity></Properties>';
  }

  function contentTypesXml(zNaglowkiem, zWlasciwosciamiAI) {
    var o = function (czesc, typ) { return '<Override PartName="' + czesc + '" ContentType="' + typ + '"/>'; };
    var wml = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + o('/word/document.xml', wml + 'document.main+xml')
      + o('/word/styles.xml', wml + 'styles+xml')
      + o('/word/numbering.xml', wml + 'numbering+xml')
      + o('/word/settings.xml', wml + 'settings+xml')
      + (zNaglowkiem ? o('/word/header1.xml', wml + 'header+xml') : '')
      + o('/word/footer1.xml', wml + 'footer+xml')
      + o('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')
      + o('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml')
      + (zWlasciwosciamiAI ? o('/docProps/custom.xml', 'application/vnd.openxmlformats-officedocument.custom-properties+xml') : '')
      + '</Types>';
  }

  function relsGlowne(zWlasciwosciamiAI) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS_REL + '">'
      + '<Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="' + REL + 'extended-properties" Target="docProps/app.xml"/>'
      + (zWlasciwosciamiAI ? '<Relationship Id="rId4" Type="' + REL + 'custom-properties" Target="docProps/custom.xml"/>' : '')
      + '</Relationships>';
  }

  function relsDokumentu(relacje, zNaglowkiem) {
    var s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS_REL + '">'
      + '<Relationship Id="rIdS" Type="' + REL + 'styles" Target="styles.xml"/>'
      + '<Relationship Id="rIdN" Type="' + REL + 'numbering" Target="numbering.xml"/>'
      + '<Relationship Id="rIdU" Type="' + REL + 'settings" Target="settings.xml"/>'
      + (zNaglowkiem ? '<Relationship Id="rIdH" Type="' + REL + 'header" Target="header1.xml"/>' : '')
      + '<Relationship Id="rIdF" Type="' + REL + 'footer" Target="footer1.xml"/>';
    relacje.forEach(function (r) {
      s += '<Relationship Id="' + r.id + '" Type="' + REL + 'hyperlink" Target="' + xml(r.adres) + '" TargetMode="External"/>';
    });
    return s + '</Relationships>';
  }

  function documentXml(cialo, zNaglowkiem) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="' + NS_W + '" xmlns:r="' + NS_R + '"><w:body>' + cialo
      + '<w:sectPr>' + (zNaglowkiem ? '<w:headerReference w:type="default" r:id="rIdH"/>' : '')
      + '<w:footerReference w:type="default" r:id="rIdF"/>'
      + '<w:pgSz w:w="' + STRONA.w + '" w:h="' + STRONA.h + '"/>'
      + '<w:pgMar w:top="' + STRONA.margines + '" w:right="' + STRONA.margines + '" w:bottom="' + STRONA.margines
      + '" w:left="' + STRONA.margines + '" w:header="709" w:footer="709" w:gutter="0"/>'
      + '<w:cols w:space="708"/></w:sectPr></w:body></w:document>';
  }

  // ─── ZIP (bez zaleznosci) ────────────────────────────────────────────────────

  var TABLICA_CRC = null;
  function crc32(bajty) {
    if (!TABLICA_CRC) {
      TABLICA_CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        TABLICA_CRC[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bajty.length; i++) crc = TABLICA_CRC[(crc ^ bajty[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Kompresja wbudowana w przegladarke, gdy jest (CompressionStream 'deflate-raw').
  // Bez niej pliki ida bez kompresji (metoda STORE) - DOCX jest wtedy wiekszy, ale poprawny.
  function deflateRaw(bajty) {
    if (typeof CompressionStream !== 'function' || typeof Response !== 'function' || typeof Blob !== 'function') {
      return Promise.resolve(null);
    }
    try {
      var strumien = new Blob([bajty]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Response(strumien).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function dosCzas(d) {
    return {
      czas: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      data: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  function spakuj(pliki, kompresja) {
    var kod = new TextEncoder();
    var dc = dosCzas(new Date());
    return Promise.all(pliki.map(function (p) {
      var surowe = typeof p.dane === 'string' ? kod.encode(p.dane) : p.dane;
      return (kompresja === false ? Promise.resolve(null) : deflateRaw(surowe)).then(function (sk) {
        var metoda = sk && sk.length < surowe.length ? 8 : 0;
        return { nazwa: kod.encode(p.nazwa), surowe: surowe, dane: metoda ? sk : surowe, metoda: metoda, crc: crc32(surowe) };
      });
    })).then(function (wpisy) {
      var czesci = [];
      var katalog = [];
      var przesuniecie = 0;
      wpisy.forEach(function (w) {
        var lok = new Uint8Array(30 + w.nazwa.length);
        var v = new DataView(lok.buffer);
        v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0, true);
        v.setUint16(8, w.metoda, true); v.setUint16(10, dc.czas, true); v.setUint16(12, dc.data, true);
        v.setUint32(14, w.crc, true); v.setUint32(18, w.dane.length, true); v.setUint32(22, w.surowe.length, true);
        v.setUint16(26, w.nazwa.length, true); v.setUint16(28, 0, true);
        lok.set(w.nazwa, 30);
        czesci.push(lok, w.dane);

        var cen = new Uint8Array(46 + w.nazwa.length);
        var c = new DataView(cen.buffer);
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0, true);
        c.setUint16(10, w.metoda, true); c.setUint16(12, dc.czas, true); c.setUint16(14, dc.data, true);
        c.setUint32(16, w.crc, true); c.setUint32(20, w.dane.length, true); c.setUint32(24, w.surowe.length, true);
        c.setUint16(28, w.nazwa.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true);
        c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, przesuniecie, true);
        cen.set(w.nazwa, 46);
        katalog.push(cen);
        przesuniecie += lok.length + w.dane.length;
      });
      var rozmiarKatalogu = katalog.reduce(function (s, k) { return s + k.length; }, 0);
      var koniec = new Uint8Array(22);
      var e = new DataView(koniec.buffer);
      e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
      e.setUint16(8, wpisy.length, true); e.setUint16(10, wpisy.length, true);
      e.setUint32(12, rozmiarKatalogu, true); e.setUint32(16, przesuniecie, true); e.setUint16(20, 0, true);
      return czesci.concat(katalog, [koniec]);
    });
  }

  // ─── API ─────────────────────────────────────────────────────────────────────

  /** Czesci pakietu jako { sciezka: tekst XML } - do testow i do spakowania. */
  function czesci(element, opcje) {
    opcje = opcje || {};
    var jezyk = /^[a-z]{2}-[A-Z]{2}$/.test(opcje.jezyk || '') ? opcje.jezyk : 'pl-PL';
    cudzyslow = CUDZYSLOWY[jezyk.slice(0, 2)] || ['\u201C', '\u201D'];
    var b = new Budowniczy(opcje);
    var out = [];
    b.dzieci(element, out, {});
    if (!out.length) out.push('<w:p/>');
    var naglowek = String(opcje.naglowek || '').trim();
    var ai = opcje.wlasciwosciAI && typeof opcje.wlasciwosciAI === 'object' ? opcje.wlasciwosciAI : null;
    var mapa = {
      '[Content_Types].xml': contentTypesXml(!!naglowek, !!ai),
      '_rels/.rels': relsGlowne(!!ai),
      'word/document.xml': documentXml(out.join(''), !!naglowek),
      'word/styles.xml': stylesXml(jezyk),
      'word/numbering.xml': numberingXml(b.numeracje),
      'word/settings.xml': settingsXml(jezyk),
      'word/footer1.xml': footerXml(String(opcje.stopka || '').trim()),
      'word/_rels/document.xml.rels': relsDokumentu(b.relacje, !!naglowek),
      'docProps/core.xml': coreXml({ tytul: opcje.tytul, autor: opcje.autor, opis: opcje.opis, jezyk: jezyk, slowa: ai ? ai.slowa : '' }),
      'docProps/app.xml': appXml(),
    };
    if (naglowek) mapa['word/header1.xml'] = headerXml(naglowek);
    if (ai) mapa['docProps/custom.xml'] = customXml(ai);
    return mapa;
  }

  /** Gotowy plik DOCX (Blob). [Content_Types].xml idzie pierwszy - czesc czytnikow tego oczekuje. */
  function zbuduj(element, opcje) {
    var mapa = czesci(element, opcje);
    var kolejnosc = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels',
      'word/styles.xml', 'word/numbering.xml', 'word/settings.xml', 'word/header1.xml', 'word/footer1.xml',
      'docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml'];
    var pliki = kolejnosc.filter(function (n) { return mapa[n] != null; })
      .map(function (n) { return { nazwa: n, dane: mapa[n] }; });
    return spakuj(pliki, opcje && opcje.kompresja).then(function (kawalki) {
      return new Blob(kawalki, { type: TYP_DOCX });
    });
  }

  globalny.DocxNatywny = {
    zbuduj: zbuduj,
    czesci: czesci,
    xml: xml,
    bezpiecznyAdres: bezpiecznyAdres,
    crc32: crc32,
    TYP: TYP_DOCX,
    wersja: '2',
  };
})(typeof window !== 'undefined' ? window : globalThis);
