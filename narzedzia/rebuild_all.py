#!/usr/bin/env python3
# Naprawia i18n i regeneruje warianty keys/proxy/owner dla obu zestawow (DHL i odbrandowany).
import sys

# zrodla czytelne (DEV + owner)
KITS = {
    'dhl': {
        'dev':   '/home/claude/contentai/app/DHL_ContentAI.html',
        'owner': '/home/claude/contentai/app/DHL_ContentAI_owner.html',
        'out':   '/home/claude/out/DHL_ContentAI_pakowanie/zrodlo',
        'btn':   'var(--red)',
    },
    'debrand': {
        'dev':   '/home/claude/cai_debrand/komplet/app/ContentAI.html',
        'owner': '/home/claude/cai_debrand/komplet/app/ContentAI_owner.html',
        'out':   '/home/claude/out/ContentAI_pakowanie/zrodlo',
        'btn':   'var(--accent,#d97706)',
    },
}

def rep(s, old, new, n=1):
    c = s.count(old)
    if c != n:
        sys.exit(f'BLAD: oczekiwano {n}, jest {c} dla:\n{old[:90]}')
    return s.replace(old, new)

# ---- F1: render historii przez _t() ----
def fix_history_render(h):
    return rep(h,
        "${history.length ? 'Brak wyników dla wybranego filtra.' : 'Brak historii - wygeneruj pierwszą treść.'}",
        "${history.length ? _t('history-no-filter') : _t('history-empty')}")

# ---- F3: wykrywanie jezyka przy pierwszym starcie ----
def fix_lang_detect(h):
    for key in ('cai_lang', 'dhl_ai_lang'):
        old = "var currentLang = localStorage.getItem('%s') || 'pl';" % key
        if old in h:
            new = "var currentLang = localStorage.getItem('%s') || ((navigator.language||'pl').toLowerCase().indexOf('pl')===0 ? 'pl' : 'en');" % key
            return h.replace(old, new, 1)
    sys.exit('BLAD: nie znaleziono deklaracji currentLang')

# ---- F2 (+F4): dopisanie kluczy do slownikow PL i EN ----
PL_ANCHOR = "    'history-empty':'Brak historii - wygeneruj pierwszą treść.',"
EN_ANCHOR = "    'history-empty':'No history - generate your first content.',"

BASE_PL = "    'history-no-filter':'Brak wyników dla wybranego filtra.',\n"
BASE_EN = "    'history-no-filter':'No results for the selected filter.',\n"

KEYS_PL = (
    "    'keys-menu-title':'Klucze API',\n"
    "    'keys-modal-title':'Klucze API',\n"
    "    'keys-modal-desc':'Klucze zapisują się tylko lokalnie na tym urządzeniu (localStorage tej aplikacji). Nie są nigdzie wysyłane poza wywołania do API danego dostawcy.',\n"
    "    'keys-anthropic-label':'Anthropic <span style=\"color:var(--text3);font-weight:400\">(treść, wymagany)</span>',\n"
    "    'keys-openai-label':'OpenAI <span style=\"color:var(--text3);font-weight:400\">(grafiki, audio, transkrypcja)</span>',\n"
    "    'keys-eleven-label':'ElevenLabs <span style=\"color:var(--text3);font-weight:400\">(głos premium, opcjonalny)</span>',\n"
    "    'keys-save':'Zapisz',\n"
    "    'keys-cancel':'Anuluj',\n"
    "    'keys-clear':'Wyczyść',\n"
)
KEYS_EN = (
    "    'keys-menu-title':'API keys',\n"
    "    'keys-modal-title':'API keys',\n"
    "    'keys-modal-desc':'Keys are stored only locally on this device (this app localStorage). They are never sent anywhere except calls to the selected provider API.',\n"
    "    'keys-anthropic-label':'Anthropic <span style=\"color:var(--text3);font-weight:400\">(content, required)</span>',\n"
    "    'keys-openai-label':'OpenAI <span style=\"color:var(--text3);font-weight:400\">(images, audio, transcription)</span>',\n"
    "    'keys-eleven-label':'ElevenLabs <span style=\"color:var(--text3);font-weight:400\">(premium voice, optional)</span>',\n"
    "    'keys-save':'Save',\n"
    "    'keys-cancel':'Cancel',\n"
    "    'keys-clear':'Clear',\n"
)

def patch_dicts(h, with_keys):
    pl_add = BASE_PL + (KEYS_PL if with_keys else "")
    en_add = BASE_EN + (KEYS_EN if with_keys else "")
    h = rep(h, PL_ANCHOR, PL_ANCHOR + "\n" + pl_add.rstrip("\n"))
    h = rep(h, EN_ANCHOR, EN_ANCHOR + "\n" + en_add.rstrip("\n"))
    return h

# ---- wspolne poprawki dla kazdego wariantu ----
def common(h, with_keys):
    h = fix_history_render(h)
    h = fix_lang_detect(h)
    h = patch_dicts(h, with_keys)
    h = fix_kw_section(h)
    h = fix_serp_lang(h)
    h = fix_spinner_stale(h)
    h = fix_repurpose_lang(h)
    h = fix_autoimprove(h)
    h = fix_panel_css(h)
    h = fix_gap_indicator(h)
    h = fix_repurpose_dropdown(h)   # F12
    h = fix_gap_scroll(h)           # F13
    h = fix_section_spinner(h)      # F14
    h = fix_pdf_meta(h)             # F16 (docx bez zmian - meta-box ma juz wymuszone jasne tlo w stylu eksportu)
    h = fix_placeholder_star(h)     # F17
    return h

# ---- F11: uzupelnianie luk - status tylko na gorze (przycisk), bez skoku na dol artykulu ----
def fix_gap_indicator(h):
    old = ("  art.appendChild(_genInd);\n"
           "  _genInd.scrollIntoView({ behavior: 'smooth', block: 'center' });\n")
    new = "  // status generowania sekcji tylko na gorze (przycisk); bez dolnego wskaznika i skoku na dol\n"
    return rep(h, old, new)

# ---- F10: Problem A - usuniecie reguly position:relative psujacej panele SEO/AIO ----
def fix_panel_css(h):
    rule = '\n.seo-panel, .aio-panel { position: relative; }'
    if rule in h:
        h = h.replace(rule, '', 1)
    return h

# ---- F9: auto-poprawka SEO/AIO - jezyk + usuniecie mylacego prefiksu "Premium:" ----
def fix_autoimprove(h):
    # jezyk w improvePrompt (analogicznie do doPremiumCorrection, ktory juz trzyma jezyk)
    h = rep(h,
        "${allIssues}\n\nCRITICAL: The improved article MUST be approximately",
        "${allIssues}\n\nLANGUAGE: Write the improved article in ${langMap[lang] || 'Polish'} - keep the same language as the original, do not translate.\n\nCRITICAL: The improved article MUST be approximately")
    # ten blok to standardowa auto-poprawka, nie Premium - usun mylacy prefiks
    h = rep(h,
        "document.getElementById('spin-label').textContent = 'Premium: ' + (currentLang==='en'?'improving (was ':'Poprawiam (było ') + scores + ')...';",
        "document.getElementById('spin-label').textContent = (currentLang==='en'?'Improving (was ':'Poprawiam (było ') + scores + ')...';")
    return h

# ---- F7: Problem 2 - usuniecie nieaktualnego (premium) komunikatu spinnera ----
def fix_spinner_stale(h):
    old = ("  let step = 0;\n"
           "  const activeSteps = buildSteps(ctype, premiumMode);\n"
           "  const iv = setInterval(() => {\n"
           "    if (step < activeSteps.length) {\n"
           "      document.getElementById('spin-label').textContent = activeSteps[step][0];\n"
           "      document.getElementById('spin-sub').textContent = activeSteps[step][1];\n"
           "      step++;\n"
           "    }\n"
           "  }, 900);")
    new = ("  let step = 0;\n"
           "  const activeSteps = buildSteps(ctype, premiumMode);\n"
           "  const _tickStep = () => {\n"
           "    if (step < activeSteps.length) {\n"
           "      document.getElementById('spin-label').textContent = activeSteps[step][0];\n"
           "      document.getElementById('spin-sub').textContent = activeSteps[step][1];\n"
           "      step++;\n"
           "    }\n"
           "  };\n"
           "  _tickStep();\n"
           "  const iv = setInterval(_tickStep, 900);")
    h = rep(h, old, new)
    # zaszyty PL komunikat premium -> i18n
    h = rep(h,
        "document.getElementById('spin-label').textContent = 'Premium: oceniam i poprawiam...';",
        "document.getElementById('spin-label').textContent = _t('msg-spin-premium-eval');")
    return h

# ---- F8: Problem 1 - przerobki (repurpose) w jezyku tresci, nie na sztywno po polsku ----
def fix_repurpose_lang(h):
    h = rep(h,
        "  const prompts = {",
        "  const _rpLang = ({ 'Polski':'Polish','English':'English','Deutsch':'German','Čeština':'Czech' })[document.getElementById('lang')?.value] || 'Polish';\n  const prompts = {")
    h = rep(h, "Napisz po polsku ", "Napisz ", n=5)
    h = rep(h,
        "system: `You are a professional content repurposing specialist. Follow the instructions exactly. Never truncate your response - always write the complete content as instructed.`,",
        "system: `You are a professional content repurposing specialist. Follow the instructions exactly. Write the ENTIRE output strictly in ${_rpLang}, regardless of the language of these instructions or the source article. Never truncate your response - always write the complete content as instructed.`,")
    return h

# ---- F5: nazwa sekcji "Kluczowe wnioski" w jezyku artykulu ----
def fix_kw_section(h):
    h = rep(h,
        "    const langMap = { 'Polski':'Polish','English':'English','Deutsch':'German','Čeština':'Czech' };",
        "    const langMap = { 'Polski':'Polish','English':'English','Deutsch':'German','Čeština':'Czech' };\n"
        "    const kwName = ({ 'Polish':'Kluczowe wnioski','English':'Key takeaways','German':'Wichtigste Erkenntnisse','Czech':'Klíčové poznatky' })[langMap[lang]] || 'Kluczowe wnioski';")
    h = rep(h,
        '"Kluczowe wnioski" (or its equivalent in the article language)',
        '"${kwName}"', n=2)
    return h

# ---- F6: frazy/tematy/context SERP w jezyku artykulu ----
def fix_serp_lang(h):
    h = rep(h,
        "document.getElementById('spin-sub').textContent = _t('msg-spin-serp-sub');",
        "document.getElementById('spin-sub').textContent = _t('msg-spin-serp-sub');\n"
        "    const _serpLang = ({ 'Polski':'Polish','English':'English','Deutsch':'German','Čeština':'Czech' })[document.getElementById('lang')?.value] || 'Polish';")
    h = rep(h,
        'system: \'Search for top Google results for the given keyword. Analyze top 5-10 results and return ONLY a valid JSON object (no markdown, no preamble): {"context":"2-3 sentence summary of main topics covered by top results in the same language as keyword","topics":["topic1","topic2",...up to 8 topics],"phrases":["phrase1",...up to 10 key phrases],"avgWords":estimated_average_word_count_as_integer,"avgH2":estimated_average_h2_sections_as_integer}\',',
        'system: \'Write the context, topics and phrases in \' + _serpLang + \'. Search for top Google results for the given keyword. Analyze top 5-10 results and return ONLY a valid JSON object (no markdown, no preamble): {"context":"2-3 sentence summary of main topics covered by top results","topics":["topic1","topic2",...up to 8 topics],"phrases":["phrase1",...up to 10 key phrases],"avgWords":estimated_average_word_count_as_integer,"avgH2":estimated_average_h2_sections_as_integer}\',')
    return h

# ---- menu + modal panelu Klucze API (z data-i18n) ----
def keys_menu(h):
    old = ('      <div class="settings-menu" id="settings-menu">\n'
           '        <div class="settings-item" onclick="openWpModal();closeSettingsMenu()">')
    new = ('      <div class="settings-menu" id="settings-menu">\n'
           '        <div class="settings-item" onclick="openKeysModal();closeSettingsMenu()">\n'
           '          <span>🔑</span>\n'
           '          <div><div style="font-weight:600;font-size:13px" data-i18n="keys-menu-title">Klucze API</div><div style="font-size:11px;color:var(--text3)">Anthropic, OpenAI, ElevenLabs</div></div>\n'
           '        </div>\n'
           '        <div style="height:1px;background:var(--border);margin:4px 0"></div>\n'
           '        <div class="settings-item" onclick="openWpModal();closeSettingsMenu()">')
    return rep(h, old, new)

def keys_decls(h):
    h = rep(h,
        "const API_KEY = 'WSTAW_TUTAJ_NOWY_KLUCZ_API'; // ← wklej nowy klucz z console.anthropic.com po unieważnieniu starego",
        "let API_KEY = localStorage.getItem('cai_key_anthropic') || 'WSTAW_TUTAJ_NOWY_KLUCZ_API'; // klucz z panelu Klucze API (localStorage)")
    h = rep(h,
        "const OPENAI_API_KEY = 'WSTAW_TUTAJ_KLUCZ_OPENAI'; // ← klucz z platform.openai.com",
        "let OPENAI_API_KEY = localStorage.getItem('cai_key_openai') || 'WSTAW_TUTAJ_KLUCZ_OPENAI'; // klucz z panelu Klucze API (localStorage)")
    h = rep(h,
        "const ELEVEN_API_KEY = 'WSTAW_TUTAJ_KLUCZ_ELEVENLABS'; // ← klucz z elevenlabs.io (opcjonalnie, dla silnika ElevenLabs)",
        "let ELEVEN_API_KEY = localStorage.getItem('cai_key_eleven') || 'WSTAW_TUTAJ_KLUCZ_ELEVENLABS'; // klucz z panelu Klucze API (localStorage)")
    return h

def nokey_i18n(h):
    h = rep(h,
        "'nokey-title':'Brak klucza API','nokey-line1':'Otwórz plik w edytorze tekstowym i znajdź linię:','nokey-line2':'Zastąp WSTAW_TUTAJ_NOWY_KLUCZ_API swoim kluczem z console.anthropic.com',",
        "'nokey-title':'Brak klucza API','nokey-line1':'Kliknij ikonę ustawień i wybierz Klucze API.','nokey-line2':'Wpisz klucz Anthropic z console.anthropic.com i zapisz.',")
    h = rep(h,
        "'nokey-title':'Missing API key','nokey-line1':'Open the file in a text editor and find the line:','nokey-line2':'Replace WSTAW_TUTAJ_NOWY_KLUCZ_API with your key from console.anthropic.com',",
        "'nokey-title':'Missing API key','nokey-line1':'Click the settings icon and choose API keys.','nokey-line2':'Enter your Anthropic key from console.anthropic.com and save.',")
    return h

def modal_html(btn_bg):
    return ('\n<!-- PANEL KLUCZY API (i18n PL/EN) -->\n'
'<div id="keys-modal" style="display:none;position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.45);align-items:center;justify-content:center;padding:16px">\n'
'  <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow);max-width:480px;width:100%;max-height:90vh;overflow:auto;padding:20px">\n'
'    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">\n'
'      <span style="font-size:18px">🔑</span>\n'
'      <div style="font-weight:700;font-size:16px;color:var(--text)" data-i18n="keys-modal-title">Klucze API</div>\n'
'    </div>\n'
'    <div style="font-size:12px;color:var(--text2);margin-bottom:16px;line-height:1.5" data-i18n="keys-modal-desc">Klucze zapisują się tylko lokalnie na tym urządzeniu (localStorage tej aplikacji). Nie są nigdzie wysyłane poza wywołania do API danego dostawcy.</div>\n'
'    <label style="display:block;font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px" data-i18n="keys-anthropic-label">Anthropic <span style="color:var(--text3);font-weight:400">(treść, wymagany)</span></label>\n'
'    <input id="key-in-anthropic" type="password" autocomplete="off" placeholder="sk-ant-..." style="width:100%;padding:9px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:13px;margin-bottom:14px">\n'
'    <label style="display:block;font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px" data-i18n="keys-openai-label">OpenAI <span style="color:var(--text3);font-weight:400">(grafiki, audio, transkrypcja)</span></label>\n'
'    <input id="key-in-openai" type="password" autocomplete="off" placeholder="sk-proj-..." style="width:100%;padding:9px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:13px;margin-bottom:14px">\n'
'    <label style="display:block;font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px" data-i18n="keys-eleven-label">ElevenLabs <span style="color:var(--text3);font-weight:400">(głos premium, opcjonalny)</span></label>\n'
'    <input id="key-in-eleven" type="password" autocomplete="off" placeholder="..." style="width:100%;padding:9px 10px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--bg);color:var(--text);font-size:13px;margin-bottom:18px">\n'
'    <div style="display:flex;gap:8px;flex-wrap:wrap">\n'
'      <button onclick="saveKeys()" style="flex:1;min-width:120px;padding:10px;border:none;border-radius:var(--radius);background:' + btn_bg + ';color:#fff;font-weight:600;font-size:13px;cursor:pointer" data-i18n="keys-save">Zapisz</button>\n'
'      <button onclick="closeKeysModal()" style="padding:10px 16px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--surface);color:var(--text);font-size:13px;cursor:pointer" data-i18n="keys-cancel">Anuluj</button>\n'
'      <button onclick="clearKeys()" style="padding:10px 16px;border:1px solid var(--border2);border-radius:var(--radius);background:var(--surface);color:var(--text2);font-size:13px;cursor:pointer" data-i18n="keys-clear">Wyczyść</button>\n'
'    </div>\n'
'  </div>\n'
'</div>\n'
'<script>\n'
'(function(){\n'
"  var PH = { a:'WSTAW_TUTAJ_NOWY_KLUCZ_API', o:'WSTAW_TUTAJ_KLUCZ_OPENAI', e:'WSTAW_TUTAJ_KLUCZ_ELEVENLABS' };\n"
'  window.openKeysModal = function(){\n'
'    try {\n'
"      document.getElementById('key-in-anthropic').value = localStorage.getItem('cai_key_anthropic') || '';\n"
"      document.getElementById('key-in-openai').value    = localStorage.getItem('cai_key_openai')    || '';\n"
"      document.getElementById('key-in-eleven').value    = localStorage.getItem('cai_key_eleven')    || '';\n"
'    } catch(e){}\n'
"    document.getElementById('keys-modal').style.display = 'flex';\n"
'  };\n'
"  window.closeKeysModal = function(){ document.getElementById('keys-modal').style.display = 'none'; };\n"
'  window.saveKeys = function(){\n'
"    var a = (document.getElementById('key-in-anthropic').value || '').trim();\n"
"    var o = (document.getElementById('key-in-openai').value    || '').trim();\n"
"    var e = (document.getElementById('key-in-eleven').value    || '').trim();\n"
'    try {\n'
"      a ? localStorage.setItem('cai_key_anthropic', a) : localStorage.removeItem('cai_key_anthropic');\n"
"      o ? localStorage.setItem('cai_key_openai', o)    : localStorage.removeItem('cai_key_openai');\n"
"      e ? localStorage.setItem('cai_key_eleven', e)    : localStorage.removeItem('cai_key_eleven');\n"
'    } catch(err){}\n'
'    API_KEY        = a || PH.a;\n'
'    OPENAI_API_KEY = o || PH.o;\n'
'    ELEVEN_API_KEY = e || PH.e;\n'
'    closeKeysModal();\n'
'  };\n'
'  window.clearKeys = function(){\n'
'    try {\n'
"      localStorage.removeItem('cai_key_anthropic');\n"
"      localStorage.removeItem('cai_key_openai');\n"
"      localStorage.removeItem('cai_key_eleven');\n"
'    } catch(err){}\n'
"    document.getElementById('key-in-anthropic').value = '';\n"
"    document.getElementById('key-in-openai').value = '';\n"
"    document.getElementById('key-in-eleven').value = '';\n"
'    API_KEY = PH.a; OPENAI_API_KEY = PH.o; ELEVEN_API_KEY = PH.e;\n'
'  };\n'
"  window.addEventListener('load', function(){\n"
"    try { if(!localStorage.getItem('cai_key_anthropic')) window.openKeysModal(); } catch(e){}\n"
'  });\n'
'})();\n'
'</script>\n')

# ---- F12: dropdown Przerobek - z-index nad sidebar + otwieranie w prawo ----
def fix_repurpose_dropdown(h):
    return rep(h,
        "repurpose-menu { position:absolute;top:calc(100% + 4px);right:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);z-index:200",
        "repurpose-menu { position:absolute;top:calc(100% + 4px);left:0;right:auto;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);z-index:9000")

# ---- F13: panel Luk semantycznych - scroll przy dlugiej liscie (max-height + overflow) ----
def fix_gap_scroll(h):
    return rep(h,
        'id="gap-panel" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:12px;margin:0 0 0"',
        'id="gap-panel" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:12px;margin:0 0 0;max-height:65vh;overflow-y:auto"')

# ---- F14: przycisk generacji sekcji - krecace sie kolko zamiast klepsydry ----
# kolko + tekst w wewnetrznym wrapperze inline-flex (align-items:center + gap) -> pionowe
# wyrownanie i rowny odstep, niezaleznie od renderu samego <button>
def fix_section_spinner(h):
    return rep(h,
        "if (btn) { btn.disabled = true; btn.textContent = _t('msg-spin-sections'); }",
        "if (btn) { btn.disabled = true; btn.innerHTML = '<span style=\"display:inline-flex;align-items:center;gap:8px\"><span class=\"progress-spinner\" style=\"display:inline-block\"></span><span>' + _t('msg-spin-sections').replace('\u23f3','').trim() + '</span></span>'; }")

# ---- F16: eksport PDF - jawne wyciagniecie meta-box i doklejenie na samym koncu ----
# (parseEl renderowal meta-box wg kolejnosci w DOM; append gwarantuje pozycje na koncu)
def fix_pdf_meta(h):
    old = ("  function _runPdf() {\n"
           "    const articleContent = buildContent(art.innerHTML);")
    new = ("  function _runPdf() {\n"
           "    const _mbEl = art.querySelector('.meta-box');\n"
           "    const _artClone = art.cloneNode(true);\n"
           "    const _mbClone = _artClone.querySelector('.meta-box'); if (_mbClone) _mbClone.remove();\n"
           "    const articleContent = buildContent(_artClone.innerHTML);\n"
           "    if (_mbEl) {\n"
           "      const _lblEl = _mbEl.querySelector('.meta-label');\n"
           "      const _lbl = (_lblEl ? _lblEl.textContent.trim() : 'Meta description (SEO)').toUpperCase();\n"
           "      const _pEl = _mbEl.querySelector('p');\n"
           "      const _body = _pEl ? _pEl.textContent.trim() : '';\n"
           "      if (_body) {\n"
           "        articleContent.push({ table: { widths: ['*'], body: [[{ stack: [\n"
           "          { text: _lbl, bold: true, color: '#9A6A00', fontSize: 9, margin: [0,0,0,4] },\n"
           "          { text: _body, fontSize: 10.5, lineHeight: 1.5 }\n"
           "        ], fillColor: '#fff9e6', margin: [10, 8, 10, 8] }]] },\n"
           "          layout: { hLineColor: () => '#FFB000', vLineColor: () => '#FFB000', hLineWidth: () => 1.5, vLineWidth: () => 1.5 },\n"
           "          margin: [0, 16, 0, 0] });\n"
           "      }\n"
           "    }")
    return rep(h, old, new)

# ---- F17: empty state - gwiazdka jako wysrodkowany SVG zamiast znaku Unicode ----
# znak U+2726 nie jest optycznie wysrodkowany w glyphie na wielu fontach mobilnych (Android);
# flex centruje box znaku, ale glyph siedzi krzywo -> SVG centruje sie idealnie
def fix_placeholder_star(h):
    return rep(h,
        '<div class="placeholder-box">\u2726</div>',
        '<div class="placeholder-box"><svg viewBox="0 0 32 32" width="24" height="24" style="display:block">'
        '<path d="M16 1.5 L18.4 13.6 L30.5 16 L18.4 18.4 L16 30.5 L13.6 18.4 L1.5 16 L13.6 13.6 Z" fill="currentColor"/></svg></div>')

def inject_modal(h, btn_bg):
    idx = h.rfind('</body>')
    if idx < 0:
        sys.exit('BLAD: brak </body>')
    return h[:idx] + modal_html(btn_bg) + h[idx:]

# ---- override proxy ----
def proxy_transform(h):
    ov = ("window.API_ENDPOINT_OVERRIDE        = 'https://twoj-worker.workers.dev/api';\n"
          "window.OPENAI_IMG_ENDPOINT_OVERRIDE = 'https://twoj-worker.workers.dev/api/images';\n"
          "window.OPENAI_TTS_ENDPOINT_OVERRIDE = 'https://twoj-worker.workers.dev/api/tts';\n"
          "window.OPENAI_STT_ENDPOINT_OVERRIDE = 'https://twoj-worker.workers.dev/api/transcribe';\n"
          "window.ELEVEN_TTS_ENDPOINT_OVERRIDE = 'https://twoj-worker.workers.dev/api/eleven-tts';\n")
    h = rep(h,
        "const API_KEY = 'WSTAW_TUTAJ_NOWY_KLUCZ_API'; // ← wklej nowy klucz z console.anthropic.com po unieważnieniu starego",
        ov + "const API_KEY = ''; // wersja proxy - klucz po stronie workera")
    h = rep(h,
        "const OPENAI_API_KEY = 'WSTAW_TUTAJ_KLUCZ_OPENAI'; // ← klucz z platform.openai.com",
        "const OPENAI_API_KEY = ''; // wersja proxy - klucz po stronie workera")
    h = rep(h,
        "const ELEVEN_API_KEY = 'WSTAW_TUTAJ_KLUCZ_ELEVENLABS'; // ← klucz z elevenlabs.io (opcjonalnie, dla silnika ElevenLabs)",
        "const ELEVEN_API_KEY = ''; // wersja proxy - klucz po stronie workera")
    return h

for name, cfg in KITS.items():
    dev = open(cfg['dev'], encoding='utf-8').read()
    owner = open(cfg['owner'], encoding='utf-8').read()

    # KEYS
    k = common(dev, with_keys=True)
    k = keys_decls(k)
    k = keys_menu(k)
    k = nokey_i18n(k)
    k = inject_modal(k, cfg['btn'])
    open(cfg['out'] + '/web-keys.html', 'w', encoding='utf-8').write(k)

    # PROXY
    p = common(dev, with_keys=False)
    p = proxy_transform(p)
    open(cfg['out'] + '/web-proxy.html', 'w', encoding='utf-8').write(p)

    # OWNER (tylko wspolne poprawki i18n)
    o = common(owner, with_keys=False)
    open(cfg['out'] + '/web-owner.html', 'w', encoding='utf-8').write(o)

    print(f'[{name}] keys/proxy/owner zregenerowane z poprawkami i18n')
