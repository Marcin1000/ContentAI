// Content AI - Przeglad bezpieczenstwa. Generuje wersje PL i EN.
// Paleta wzieta z samej aplikacji (Deep Space): bursztyn na czerni, cyan techniczny.
const pptxgen = require('pptxgenjs');

const C = {
  tlo:      '07080D',
  karta:    '141824',
  karta2:   '1C2131',
  linia:    '2A3145',
  tekst:    'E9EDF6',
  szary:    '9DA6BC',
  slaby:    '6B7488',
  bursztyn: 'FFB000',
  cyan:     '46D5F2',
  zielony:  '34D399',
  czerwony: 'FF5566',
};
const NAGL = 'Cambria';
const TRESC = 'Arial';

const T = {
  pl: {
    plik: 'ContentAI_Security.pptx',
    tytul: 'Przegląd bezpieczeństwa',
    podtytul: 'Wdrożenie serwerowe: konta, role i klucze po stronie serwera',
    stopka: 'Content AI · Marcin Przybylski',
    s: {},
  },
  en: {
    plik: 'ContentAI_Security_EN.pptx',
    tytul: 'Security overview',
    podtytul: 'Server deployment: accounts, roles and keys held server-side',
    stopka: 'Content AI · Marcin Przybylski',
    s: {},
  },
};

// ─── Tresc slajdow ────────────────────────────────────────────────────────────

T.pl.s = {
  agenda: ['Co się zmieniło', 'Architektura', 'Kontrola dostępu', 'Hasła i sesje',
           'Klucze API', 'Przepływ danych', 'Ryzyka i ograniczenia', 'Rekomendacje'],
  zmianaTytul: 'Co się zmieniło',
  zmianaNota: 'Poprzedni model opierał się na zabezpieczeniach, które nie zabezpieczały.',
  przed: {
    naglowek: 'Poprzednio',
    pozycje: [
      ['Plik HTML z wbudowanym kluczem', 'każdy, kto dostał plik, dostał też klucz'],
      ['„Blokada urządzenia"', 'odcisk przeglądarki — znikał po wyczyszczeniu pamięci'],
      ['Obfuskacja JavaScriptu', 'wydłuża czas wyciągnięcia klucza, nie chroni go'],
      ['Odebranie dostępu', 'wymagało wymiany klucza u wszystkich'],
    ],
  },
  po: {
    naglowek: 'Obecnie',
    pozycje: [
      ['Konto z hasłem', 'każdy loguje się swoim; plik nie niesie sekretu'],
      ['Klucze wyłącznie na serwerze', 'nigdy nie docierają do przeglądarki'],
      ['Hasła haszowane scryptem', 'losowa sól, porównanie odporne na pomiar czasu'],
      ['Odebranie dostępu', 'jedno polecenie, klucz zostaje nietknięty'],
    ],
  },
  archTytul: 'Architektura',
  archNota: 'Przeglądarka nigdy nie rozmawia z dostawcami API bezpośrednio.',
  archWarstwy: [
    ['Przeglądarka', 'aplikacja bez kluczy\nhistoria w localStorage'],
    ['Caddy', 'HTTPS, certyfikat\nautomatyczny'],
    ['Serwer Node', 'logowanie, role\nproxy API, baza wiedzy'],
    ['Dostawcy API', 'Anthropic / NVIDIA\nOpenAI / ElevenLabs'],
  ],
  archPunkty: [
    'Serwer stoi na Twojej maszynie — usługa systemd z ograniczonymi uprawnieniami, zapis tylko do katalogu z kontami',
    'Zero zależności npm: wyłącznie moduły wbudowane Node, więc nie ma czego aktualizować pod kątem podatności paczek',
    'Ruch z zewnątrz wchodzi tylko przez Caddy; serwer nasłuchuje na 127.0.0.1',
  ],
  dostepTytul: 'Kontrola dostępu',
  dostepNota: 'Konta z rolami zamiast rozdawania plików.',
  role: [
    ['admin', 'Zarządza kontami, widzi stan serwera, dodaje do bazy wspólnej'],
    ['użytkownik', 'Korzysta z aplikacji i swojej bazy prywatnej'],
  ],
  dostepPunkty: [
    ['Zakładanie konta', 'polecenie pyta o hasło dwa razy, bez wyświetlania; minimum 10 znaków'],
    ['Odebranie dostępu', 'jedno polecenie plus restart usługi, żeby uciąć bieżącą sesję'],
    ['Ochrona przed pomyłką', 'ostatniego admina nie da się usunąć ani zdegradować'],
  ],
  haslaTytul: 'Hasła, sesje i próby logowania',
  haslaKarty: [
    ['scrypt', 'Hasła haszowane z losową solą. W pliku kont nie ma hasła jawnego, a porównanie jest odporne na pomiar czasu.'],
    ['8 prób / 15 minut', 'Po ośmiu nieudanych próbach z jednego adresu IP logowanie jest blokowane na kwadrans.'],
    ['Podpisane ciasteczko', 'HMAC-SHA256 z sekretu serwera. HttpOnly, SameSite=Lax, Secure przy HTTPS. Podmiana psuje podpis.'],
  ],
  haslaNota: 'Sesja siedzi w podpisanym ciasteczku, nie w pamięci procesu, więc restart usługi nie wylogowuje zespołu. Cztery drogi unieważnienia działają bez restartu: usunięcie konta, zmiana hasła, zmiana roli i wylogowanie.',
  kluczeTytul: 'Klucze API',
  kluczeNota: 'Klucz nigdy nie trafia do przeglądarki użytkownika.',
  kluczePunkty: [
    ['Gdzie leżą', 'plik /etc/contentai/srodowisko z uprawnieniami 600, czytany tylko przez usługę'],
    ['Co widzi użytkownik', 'nic — aplikacja wysyła żądania do Twojego serwera, ten dokłada klucz'],
    ['Klucz własny użytkownika', 'jeśli ktoś poda swój, generowania obciążają jego konto, nie Twoje'],
    ['Kontrola stanu', 'endpoint dla admina pokazuje, czy klucz jest ustawiony — nigdy jego treść'],
  ],
  danePrzeplyw: 'Przepływ danych',
  daneNota: 'Co wychodzi na zewnątrz, a co zostaje u Ciebie.',
  wychodzi: ['Temat i wytyczne generowania', 'Fragmenty bazy wiedzy dobrane do tematu',
             'Ustawienia: typ treści, długość, ton, język', 'Opis stylu marki (Brand Voice)'],
  zostaje: ['Historia artykułów (przeglądarka użytkownika)', 'Konta i hasła (serwer, plik 600)',
            'Dokumenty bazy wiedzy (serwer)', 'Dane logowania do CMS'],
  daneUwaga: 'Do promptu trafiają tylko fragmenty pasujące do tematu, nie cała baza — mniej danych opuszcza organizację niż przy wklejaniu całych dokumentów.',
  bazaTytul: 'Baza wiedzy',
  bazaNota: 'Dwa zakresy, rozdzielone po stronie serwera.',
  bazaZakresy: [
    ['Prywatna', 'Widoczna wyłącznie dla właściciela. Administrator nie widzi cudzych dokumentów prywatnych.'],
    ['Wspólna', 'Widoczna dla wszystkich zalogowanych. Dodaje wyłącznie administrator, więc wiedza firmowa jest jedna.'],
  ],
  bazaPunkty: [
    'Dokumenty leżą na serwerze, więc chodzą za użytkownikiem na każde urządzenie',
    'Nazwa pliku powstaje z loginu przepuszczonego przez filtr znaków — nie da się wyjść poza katalog',
    'Pliki zapisywane z uprawnieniami 600',
  ],
  seoTytul: 'OpenSEO za wspólnym logowaniem',
  seoNota: 'Analityka SEO to osobna aplikacja. Nie wystawiamy jej wprost.',
  seoPunkty: [
    ['Problem', 'wersja kontenerowa OpenSEO startuje bez żadnego logowania — wystawiona wprost daje pełny dostęp każdemu, kto zna adres'],
    ['Rozwiązanie', 'Content AI stoi przed nią jako brama: przepuszcza wyłącznie zalogowanych, tym samym kontem'],
    ['Higiena', 'token sesji Content AI jest wycinany z żądania, zanim trafi do obcej aplikacji'],
    ['Skutek', 'odebranie komuś konta odcina go od obu aplikacji naraz'],
  ],
  zeroTytul: 'Zero obcych serwerów',
  zeroNota: 'Poza wywołaniami API przeglądarka nie wysyła nic na zewnątrz.',
  zeroKarty: [
    ['Biblioteki', 'Siedem bibliotek do wczytywania i eksportu plików leży w repozytorium i idzie z Twojego hosta, nie z publicznego CDN.'],
    ['Krój pisma', 'IBM Plex hostowany razem z aplikacją zamiast pobierania z Google Fonts.'],
    ['Co to daje', 'Aplikacja działa w zamkniętej sieci firmowej, a nikt spoza organizacji nie może podmienić kodu, który się w niej wykonuje.'],
  ],
  ryzykaTytul: 'Ryzyka i ograniczenia',
  ryzykaNota: 'Czego ten model nie obejmuje — świadomie.',
  ryzyka: [
    ['2FA tylko z bramą', 'Własne logowanie to samo hasło. Drugi składnik daje brama uwierzytelniająca postawiona przed całością.'],
    ['Brak resetu przez e-mail', 'Hasło zmienia administrator poleceniem — nie ma samoobsługi.'],
    ['Licznik prób per IP', 'Za wspólnym NAT-em blokada dotknie całe biuro naraz.'],
    ['Zaufanie do X-Forwarded-For', 'Serwer ufa temu nagłówkowi, więc ma sens wyłącznie za własnym Caddy.'],
    ['Port tylko lokalnie', 'Przy bramie port 3100 nie może być wystawiony — nagłówek tożsamości byłby wtedy do podrobienia.'],
    ['Treści u dostawcy', 'Temat i dobrane fragmenty bazy trafiają do modelu. Zasady ODO obowiązują.'],
  ],
  rekTytul: 'Rekomendacje wdrożenia',
  rekomendacje: [
    ['1', 'Konto firmowe u dostawcy', 'WYMAGANE', 'Klucz na koncie organizacji, nie prywatnym. Limit miesięczny plus alert przy 80% wykorzystania.'],
    ['2', 'HTTPS i własna domena', 'WYMAGANE', 'Caddy pobiera certyfikat sam. Serwer nasłuchuje wyłącznie lokalnie.'],
    ['3', 'Loginy zanonimizowane', 'ZALECANE', 'Format u-2207 zamiast imienia i nazwiska ogranicza dane osobowe w logach serwera.'],
    ['4', 'Kopia katalogu z kontami', 'ZALECANE', 'serwer/dane/ zawiera konta i bazę wiedzy — jedyne dane, których nie odtworzy git.'],
    ['5', 'Rotacja kluczy', 'ZALECANE', 'Po zmianie klucza wystarczy restart usługi; użytkownicy nie robią nic.'],
  ],
  koniecTytul: 'Dziękuję',
  koniecPodtytul: 'Pytania i dalsze informacje',
  koniecOsoba: 'Marcin Przybylski',
  koniecRola: 'Web and Digital Marketing Expert',
};

T.en.s = {
  agenda: ['What changed', 'Architecture', 'Access control', 'Passwords and sessions',
           'API keys', 'Data flow', 'Risks and limits', 'Recommendations'],
  zmianaTytul: 'What changed',
  zmianaNota: 'The previous model relied on protections that did not protect.',
  przed: {
    naglowek: 'Previously',
    pozycje: [
      ['HTML file with an embedded key', 'anyone given the file was also given the key'],
      ['"Device lock"', 'a browser fingerprint — gone once site data is cleared'],
      ['JavaScript obfuscation', 'delays extracting the key, does not protect it'],
      ['Revoking access', 'required rotating the key for everyone'],
    ],
  },
  po: {
    naglowek: 'Now',
    pozycje: [
      ['An account with a password', 'everyone signs in as themselves, file holds no secret'],
      ['Keys held server-side only', 'they never reach the browser'],
      ['Passwords hashed with scrypt', 'random salt, timing-safe comparison'],
      ['Revoking access', 'one command, the key stays untouched'],
    ],
  },
  archTytul: 'Architecture',
  archNota: 'The browser never talks to API providers directly.',
  archWarstwy: [
    ['Browser', 'app without keys\nhistory in localStorage'],
    ['Caddy', 'HTTPS, certificate\nhandled automatically'],
    ['Node server', 'login, roles\nAPI proxy, knowledge base'],
    ['API providers', 'Anthropic / NVIDIA\nOpenAI / ElevenLabs'],
  ],
  archPunkty: [
    'The server runs on your machine — a systemd unit with restricted privileges, writing only to the accounts directory',
    'Zero npm dependencies: built-in Node modules only, so there is no package supply chain to patch',
    'External traffic enters through Caddy alone; the server listens on 127.0.0.1',
  ],
  dostepTytul: 'Access control',
  dostepNota: 'Accounts with roles instead of handing out files.',
  role: [
    ['admin', 'Manages accounts, sees server status, adds to the shared knowledge base'],
    ['user', 'Uses the app and their own private knowledge base'],
  ],
  dostepPunkty: [
    ['Creating an account', 'the command asks for the password twice, without echo; minimum 10 characters'],
    ['Revoking access', 'one command plus a service restart to cut the active session'],
    ['Guard against mistakes', 'the last admin cannot be removed or demoted'],
  ],
  haslaTytul: 'Passwords, sessions and login attempts',
  haslaKarty: [
    ['scrypt', 'Passwords hashed with a random salt. The accounts file holds no plaintext, and the comparison is timing-safe.'],
    ['8 attempts / 15 minutes', 'After eight failed attempts from one IP address, login is blocked for fifteen minutes.'],
    ['Signed cookie', 'HMAC-SHA256 from the server secret. HttpOnly, SameSite=Lax, Secure over HTTPS. Tampering breaks the signature.'],
  ],
  haslaNota: 'The session lives in a signed cookie rather than process memory, so restarting the service does not sign the team out. Four revocation paths work without a restart: deleting the account, changing the password, changing the role, and signing out.',
  kluczeTytul: 'API keys',
  kluczeNota: 'The key never reaches a user’s browser.',
  kluczePunkty: [
    ['Where they live', 'the file /etc/contentai/srodowisko with mode 600, read only by the service'],
    ['What the user sees', 'nothing — the app calls your server, which attaches the key'],
    ['A user’s own key', 'if someone supplies theirs, the generations bill their account, not yours'],
    ['Status check', 'an admin endpoint reports whether a key is set — never its value'],
  ],
  danePrzeplyw: 'Data flow',
  daneNota: 'What leaves the organisation and what stays.',
  wychodzi: ['The topic and generation guidelines', 'Knowledge-base passages matching the topic',
             'Settings: content type, length, tone, language', 'Brand voice description'],
  zostaje: ['Article history (user’s browser)', 'Accounts and passwords (server, mode 600)',
            'Knowledge-base documents (server)', 'CMS credentials'],
  daneUwaga: 'Only passages matching the topic reach the prompt, not the whole base — less data leaves the organisation than when whole documents were pasted in.',
  bazaTytul: 'Knowledge base',
  bazaNota: 'Two scopes, separated on the server.',
  bazaZakresy: [
    ['Private', 'Visible only to its owner. An administrator cannot see anyone else’s private documents.'],
    ['Shared', 'Visible to everyone signed in. Only an administrator can add to it, so company knowledge stays singular.'],
  ],
  bazaPunkty: [
    'Documents live on the server, so they follow the user to every device',
    'The filename derives from the login passed through a character filter — directory traversal is not possible',
    'Files are written with mode 600',
  ],
  seoTytul: 'OpenSEO behind the same login',
  seoNota: 'SEO analytics is a separate app. We do not expose it directly.',
  seoPunkty: [
    ['The problem', 'the containerised OpenSEO starts with no login at all — exposed directly it grants full access to anyone who knows the address'],
    ['The solution', 'Content AI sits in front of it as a gateway, admitting only signed-in users, on the same account'],
    ['Hygiene', 'the Content AI session token is stripped from the request before it reaches the third-party app'],
    ['The effect', 'revoking an account cuts access to both applications at once'],
  ],
  zeroTytul: 'No third-party servers',
  zeroNota: 'Beyond API calls, the browser sends nothing outward.',
  zeroKarty: [
    ['Libraries', 'The seven libraries for reading and exporting files live in the repository and are served from your host, not a public CDN.'],
    ['Typeface', 'IBM Plex is hosted alongside the app instead of being fetched from Google Fonts.'],
    ['Why it matters', 'The app works on a closed corporate network, and nobody outside the organisation can swap the code running inside it.'],
  ],
  ryzykaTytul: 'Risks and limits',
  ryzykaNota: 'What this model deliberately does not cover.',
  ryzyka: [
    ['2FA needs the gateway', 'Our own login is a password alone. The second factor comes from an authentication gateway placed in front.'],
    ['No email reset', 'An administrator changes passwords by command — there is no self-service.'],
    ['Attempt counter per IP', 'Behind shared NAT, a block affects the whole office at once.'],
    ['Trusts X-Forwarded-For', 'The server trusts this header, so it belongs behind your own Caddy only.'],
    ['Port stays local', 'With the gateway, port 3100 must not be exposed — the identity header would be forgeable.'],
    ['Content reaches the provider', 'The topic and selected passages go to the model. Data-protection rules still apply.'],
  ],
  rekTytul: 'Deployment recommendations',
  rekomendacje: [
    ['1', 'Company account with the provider', 'REQUIRED', 'The key on the organisation account, not a personal one. Monthly limit plus an alert at 80% usage.'],
    ['2', 'HTTPS and your own domain', 'REQUIRED', 'Caddy obtains the certificate itself. The server listens locally only.'],
    ['3', 'Anonymised logins', 'ADVISED', 'A u-2207 format instead of a full name limits personal data in server logs.'],
    ['4', 'Back up the accounts directory', 'ADVISED', 'serwer/dane/ holds accounts and the knowledge base — the only data git cannot restore.'],
    ['5', 'Key rotation', 'ADVISED', 'After changing a key, a service restart is enough; users do nothing.'],
  ],
  koniecTytul: 'Thank you',
  koniecPodtytul: 'Questions and further information',
  koniecOsoba: 'Marcin Przybylski',
  koniecRola: 'Web and Digital Marketing Expert',
};

// ─── Pomocnicze ───────────────────────────────────────────────────────────────

function tloSlajdu(s) {
  s.background = { color: C.tlo };
}

function naglowekSlajdu(s, kicker, tytul, nota) {
  s.addText(kicker.toUpperCase(), {
    x: 0.6, y: 0.38, w: 8, h: 0.24, fontFace: TRESC, fontSize: 10.5,
    color: C.cyan, charSpacing: 2.2, bold: true, margin: 0,
  });
  s.addText(tytul, {
    x: 0.6, y: 0.66, w: 9.2, h: 0.62, fontFace: NAGL, fontSize: 30,
    color: C.tekst, bold: true, margin: 0,
  });
  if (nota) {
    s.addText(nota, {
      x: 0.6, y: 1.3, w: 8.8, h: 0.3, fontFace: TRESC, fontSize: 12.5,
      color: C.szary, margin: 0,
    });
  }
}

function karta(s, opt) {
  s.addShape('roundRect', {
    x: opt.x, y: opt.y, w: opt.w, h: opt.h,
    fill: { color: opt.fill || C.karta },
    line: { color: opt.line || C.linia, width: 1 },
    rectRadius: 0.06,
  });
}

function stopka(s, tekst, nr) {
  s.addText(tekst, {
    x: 0.6, y: 5.24, w: 6, h: 0.22, fontFace: TRESC, fontSize: 8.5,
    color: C.slaby, margin: 0,
  });
  if (nr) {
    s.addText(String(nr), {
      x: 9, y: 5.24, w: 0.4, h: 0.22, fontFace: TRESC, fontSize: 8.5,
      color: C.slaby, align: 'right', margin: 0,
    });
  }
}

// ─── Budowa ───────────────────────────────────────────────────────────────────

function zbuduj(jezyk) {
  const t = T[jezyk];
  const s = t.s;
  const p = new pptxgen();
  p.layout = 'LAYOUT_16x9';   // 10 x 5.625 cala
  p.author = 'Marcin Przybylski';
  p.title = 'Content AI - ' + t.tytul;
  let nr = 0;
  const nowy = () => { const sl = p.addSlide(); tloSlajdu(sl); nr += 1; return sl; };

  // 1. Tytul
  {
    const sl = p.addSlide();
    sl.background = { color: C.tlo };
    sl.addShape('ellipse', { x: 6.9, y: -1.2, w: 5.2, h: 5.2, fill: { color: C.bursztyn, transparency: 93 }, line: { color: C.tlo, width: 0 } });
    sl.addText('CONTENT AI', {
      x: 0.75, y: 1.75, w: 6, h: 0.3, fontFace: TRESC, fontSize: 12,
      color: C.bursztyn, charSpacing: 4, bold: true, margin: 0,
    });
    sl.addText(t.tytul, {
      x: 0.75, y: 2.15, w: 7.6, h: 0.95, fontFace: NAGL, fontSize: 42,
      color: C.tekst, bold: true, margin: 0,
    });
    sl.addText(t.podtytul, {
      x: 0.75, y: 3.15, w: 7.2, h: 0.5, fontFace: TRESC, fontSize: 14,
      color: C.szary, margin: 0,
    });
    sl.addText(s.agenda.join('   ·   '), {
      x: 0.75, y: 4.55, w: 8.5, h: 0.4, fontFace: TRESC, fontSize: 9.5,
      color: C.slaby, margin: 0,
    });
    sl.addNotes(t.podtytul);
  }

  // 2. Co sie zmienilo - dwie kolumny
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[0], s.zmianaTytul, s.zmianaNota);
    const kolY = 1.78, kolH = 3.16;
    [[s.przed, 0.6, C.czerwony], [s.po, 5.15, C.zielony]].forEach(([blok, x, kolor]) => {
      karta(sl, { x, y: kolY, w: 4.25, h: kolH });
      sl.addText(blok.naglowek.toUpperCase(), {
        x: x + 0.28, y: kolY + 0.22, w: 3.7, h: 0.26, fontFace: TRESC, fontSize: 10.5,
        color: kolor, bold: true, charSpacing: 1.8, margin: 0,
      });
      blok.pozycje.forEach((poz, i) => {
        const y = kolY + 0.66 + i * 0.63;
        sl.addText(poz[0], {
          x: x + 0.28, y, w: 3.7, h: 0.24, fontFace: TRESC, fontSize: 11.5,
          color: C.tekst, bold: true, margin: 0,
        });
        sl.addText(poz[1], {
          x: x + 0.28, y: y + 0.23, w: 3.7, h: 0.36, fontFace: TRESC, fontSize: 9.5,
          color: C.szary, margin: 0,
        });
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 3. Architektura - lancuch warstw
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[1], s.archTytul, s.archNota);
    const szer = 2.06, odstep = 0.24, startX = 0.6, y = 1.82, h = 1.16;
    s.archWarstwy.forEach((w, i) => {
      const x = startX + i * (szer + odstep);
      const wyroznione = i === 2;
      karta(sl, { x, y, w: szer, h, fill: wyroznione ? C.karta2 : C.karta, line: wyroznione ? C.bursztyn : C.linia });
      sl.addText(w[0], {
        x: x + 0.16, y: y + 0.18, w: szer - 0.32, h: 0.26, fontFace: TRESC, fontSize: 12,
        color: wyroznione ? C.bursztyn : C.tekst, bold: true, margin: 0,
      });
      sl.addText(w[1], {
        x: x + 0.16, y: y + 0.5, w: szer - 0.32, h: 0.56, fontFace: TRESC, fontSize: 9,
        color: C.szary, margin: 0,
      });
      if (i < s.archWarstwy.length - 1) {
        sl.addText('→', {
          x: x + szer, y: y + 0.42, w: odstep, h: 0.3, fontFace: TRESC, fontSize: 13,
          color: C.slaby, align: 'center', margin: 0,
        });
      }
    });
    s.archPunkty.forEach((punkt, i) => {
      sl.addText(punkt, {
        x: 0.6, y: 3.28 + i * 0.55, w: 8.8, h: 0.48, fontFace: TRESC, fontSize: 11,
        color: C.szary, bullet: { code: '2022' }, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 4. Kontrola dostepu
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[2], s.dostepTytul, s.dostepNota);
    s.role.forEach((r, i) => {
      const x = 0.6 + i * 4.55;
      karta(sl, { x, y: 1.8, w: 4.25, h: 0.92 });
      sl.addText(r[0], {
        x: x + 0.28, y: 1.98, w: 3.7, h: 0.26, fontFace: TRESC, fontSize: 13,
        color: C.bursztyn, bold: true, margin: 0,
      });
      sl.addText(r[1], {
        x: x + 0.28, y: 2.28, w: 3.7, h: 0.36, fontFace: TRESC, fontSize: 10,
        color: C.szary, margin: 0,
      });
    });
    s.dostepPunkty.forEach((punkt, i) => {
      const y = 3.05 + i * 0.66;
      sl.addText(punkt[0], {
        x: 0.6, y, w: 2.7, h: 0.26, fontFace: TRESC, fontSize: 11.5,
        color: C.tekst, bold: true, margin: 0,
      });
      sl.addText(punkt[1], {
        x: 3.35, y, w: 6.05, h: 0.5, fontFace: TRESC, fontSize: 10.5,
        color: C.szary, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 5. Hasla i sesje - trzy karty
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[3], s.haslaTytul, null);
    s.haslaKarty.forEach((k, i) => {
      const x = 0.6 + i * 3.03;
      karta(sl, { x, y: 1.62, w: 2.79, h: 1.92 });
      sl.addText(k[0], {
        x: x + 0.22, y: 1.84, w: 2.35, h: 0.34, fontFace: NAGL, fontSize: 15,
        color: C.bursztyn, bold: true, margin: 0,
      });
      sl.addText(k[1], {
        x: x + 0.22, y: 2.26, w: 2.35, h: 1.1, fontFace: TRESC, fontSize: 10,
        color: C.szary, margin: 0,
      });
    });
    karta(sl, { x: 0.6, y: 3.74, w: 8.8, h: 0.86, fill: C.karta2 });
    sl.addText(s.haslaNota, {
      x: 0.85, y: 3.92, w: 8.3, h: 0.55, fontFace: TRESC, fontSize: 10.5,
      color: C.szary, margin: 0,
    });
    stopka(sl, t.stopka, nr);
  }

  // 6. Klucze API
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[4], s.kluczeTytul, s.kluczeNota);
    s.kluczePunkty.forEach((punkt, i) => {
      const y = 1.86 + i * 0.82;
      karta(sl, { x: 0.6, y, w: 8.8, h: 0.68 });
      sl.addText(punkt[0], {
        x: 0.85, y: y + 0.2, w: 2.5, h: 0.28, fontFace: TRESC, fontSize: 11.5,
        color: C.cyan, bold: true, margin: 0,
      });
      sl.addText(punkt[1], {
        x: 3.4, y: y + 0.2, w: 5.75, h: 0.32, fontFace: TRESC, fontSize: 10.5,
        color: C.szary, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 7. Przeplyw danych
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[5], s.danePrzeplyw, s.daneNota);
    const y = 1.8, h = 2.16;
    [[jezyk === 'pl' ? 'WYCHODZI DO MODELU' : 'LEAVES FOR THE MODEL', s.wychodzi, 0.6, C.bursztyn],
     [jezyk === 'pl' ? 'ZOSTAJE U CIEBIE' : 'STAYS WITH YOU', s.zostaje, 5.15, C.zielony]].forEach(([tyt, poz, x, kolor]) => {
      karta(sl, { x, y, w: 4.25, h });
      sl.addText(tyt, {
        x: x + 0.28, y: y + 0.22, w: 3.7, h: 0.26, fontFace: TRESC, fontSize: 10,
        color: kolor, bold: true, charSpacing: 1.6, margin: 0,
      });
      poz.forEach((linia, i) => {
        sl.addText(linia, {
          x: x + 0.28, y: y + 0.64 + i * 0.36, w: 3.7, h: 0.32, fontFace: TRESC, fontSize: 10,
          color: C.szary, margin: 0,
        });
      });
    });
    karta(sl, { x: 0.6, y: 4.16, w: 8.8, h: 0.8, fill: C.karta2 });
    sl.addText(s.daneUwaga, {
      x: 0.85, y: 4.33, w: 8.3, h: 0.5, fontFace: TRESC, fontSize: 10.5,
      color: C.szary, margin: 0,
    });
    stopka(sl, t.stopka, nr);
  }

  // 8. Baza wiedzy
  {
    const sl = nowy();
    naglowekSlajdu(sl, jezyk === 'pl' ? 'Dane' : 'Data', s.bazaTytul, s.bazaNota);
    s.bazaZakresy.forEach((z, i) => {
      const x = 0.6 + i * 4.55;
      karta(sl, { x, y: 1.8, w: 4.25, h: 1.32 });
      sl.addText(z[0], {
        x: x + 0.28, y: 2.0, w: 3.7, h: 0.3, fontFace: NAGL, fontSize: 15,
        color: i === 0 ? C.cyan : C.bursztyn, bold: true, margin: 0,
      });
      sl.addText(z[1], {
        x: x + 0.28, y: 2.36, w: 3.7, h: 0.64, fontFace: TRESC, fontSize: 10,
        color: C.szary, margin: 0,
      });
    });
    s.bazaPunkty.forEach((punkt, i) => {
      sl.addText(punkt, {
        x: 0.6, y: 3.38 + i * 0.52, w: 8.8, h: 0.44, fontFace: TRESC, fontSize: 11,
        color: C.szary, bullet: { code: '2022' }, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 9. OpenSEO
  {
    const sl = nowy();
    naglowekSlajdu(sl, jezyk === 'pl' ? 'Integracja' : 'Integration', s.seoTytul, s.seoNota);
    s.seoPunkty.forEach((punkt, i) => {
      const y = 1.86 + i * 0.82;
      karta(sl, { x: 0.6, y, w: 8.8, h: 0.68, line: i === 0 ? C.czerwony : C.linia });
      sl.addText(punkt[0], {
        x: 0.85, y: y + 0.2, w: 1.9, h: 0.28, fontFace: TRESC, fontSize: 11.5,
        color: i === 0 ? C.czerwony : C.cyan, bold: true, margin: 0,
      });
      sl.addText(punkt[1], {
        x: 2.8, y: y + 0.16, w: 6.35, h: 0.42, fontFace: TRESC, fontSize: 10.5,
        color: C.szary, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 10. Zero obcych serwerow
  {
    const sl = nowy();
    naglowekSlajdu(sl, jezyk === 'pl' ? 'Zależności' : 'Dependencies', s.zeroTytul, s.zeroNota);
    s.zeroKarty.forEach((k, i) => {
      const x = 0.6 + i * 3.03;
      karta(sl, { x, y: 1.9, w: 2.79, h: 2.2, fill: i === 2 ? C.karta2 : C.karta });
      sl.addText(k[0], {
        x: x + 0.22, y: 2.14, w: 2.35, h: 0.32, fontFace: NAGL, fontSize: 15,
        color: i === 2 ? C.zielony : C.bursztyn, bold: true, margin: 0,
      });
      sl.addText(k[1], {
        x: x + 0.22, y: 2.56, w: 2.35, h: 1.3, fontFace: TRESC, fontSize: 10,
        color: C.szary, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 11. Ryzyka - siatka 2x3
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[6], s.ryzykaTytul, s.ryzykaNota);
    s.ryzyka.forEach((r, i) => {
      const kol = i % 2, wiersz = Math.floor(i / 2);
      const x = 0.6 + kol * 4.55, y = 1.82 + wiersz * 1.12;
      karta(sl, { x, y, w: 4.25, h: 0.98 });
      sl.addText(r[0], {
        x: x + 0.24, y: y + 0.15, w: 3.8, h: 0.26, fontFace: TRESC, fontSize: 11.5,
        color: C.bursztyn, bold: true, margin: 0,
      });
      sl.addText(r[1], {
        x: x + 0.24, y: y + 0.42, w: 3.8, h: 0.48, fontFace: TRESC, fontSize: 9.5,
        color: C.szary, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 12. Rekomendacje
  {
    const sl = nowy();
    naglowekSlajdu(sl, s.agenda[7], s.rekTytul, null);
    s.rekomendacje.forEach((r, i) => {
      const y = 1.62 + i * 0.7;
      karta(sl, { x: 0.6, y, w: 8.8, h: 0.58 });
      sl.addText(r[0], {
        x: 0.78, y: y + 0.16, w: 0.3, h: 0.26, fontFace: TRESC, fontSize: 12,
        color: C.slaby, bold: true, margin: 0,
      });
      sl.addText(r[1], {
        x: 1.15, y: y + 0.16, w: 2.55, h: 0.26, fontFace: TRESC, fontSize: 11,
        color: C.tekst, bold: true, margin: 0,
      });
      sl.addText(r[2], {
        x: 3.75, y: y + 0.17, w: 0.95, h: 0.24, fontFace: TRESC, fontSize: 8.5,
        color: r[2] === 'WYMAGANE' || r[2] === 'REQUIRED' ? C.bursztyn : C.cyan,
        bold: true, charSpacing: 1, margin: 0,
      });
      sl.addText(r[3], {
        x: 4.8, y: y + 0.13, w: 4.4, h: 0.36, fontFace: TRESC, fontSize: 9.5,
        color: C.szary, margin: 0,
      });
    });
    stopka(sl, t.stopka, nr);
  }

  // 13. Koniec
  {
    const sl = p.addSlide();
    sl.background = { color: C.tlo };
    sl.addShape('ellipse', { x: -1.6, y: 2.4, w: 4.6, h: 4.6, fill: { color: C.cyan, transparency: 94 }, line: { color: C.tlo, width: 0 } });
    sl.addText(s.koniecTytul, {
      x: 0.75, y: 2.0, w: 7, h: 0.8, fontFace: NAGL, fontSize: 38,
      color: C.tekst, bold: true, margin: 0,
    });
    sl.addText(s.koniecPodtytul, {
      x: 0.75, y: 2.85, w: 7, h: 0.32, fontFace: TRESC, fontSize: 13,
      color: C.szary, margin: 0,
    });
    sl.addText(s.koniecOsoba, {
      x: 0.75, y: 3.42, w: 7, h: 0.3, fontFace: TRESC, fontSize: 14,
      color: C.bursztyn, bold: true, margin: 0,
    });
    sl.addText(s.koniecRola, {
      x: 0.75, y: 3.72, w: 7, h: 0.3, fontFace: TRESC, fontSize: 11,
      color: C.slaby, margin: 0,
    });
  }

  return p.writeFile({ fileName: t.plik });
}

(async () => {
  for (const jezyk of ['pl', 'en']) {
    await zbuduj(jezyk);
    console.log('zbudowano', T[jezyk].plik);
  }
})();
