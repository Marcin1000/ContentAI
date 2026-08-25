/**
 * Content AI - Cloudflare Worker Proxy
 *
 * Wdrożenie:
 * 1. Zaloguj się na dash.cloudflare.com
 * 2. Workers & Pages → Create Worker
 * 3. Wklej ten kod
 * 4. Settings → Variables → dodaj zmienne środowiskowe:
 *      ANTHROPIC_KEY = sk-ant-...       (klucz Anthropic)
 *      OPENAI_KEY    = sk-proj-...      (klucz OpenAI, dla grafik)
 * 5. Zapisz i wdróż
 * 6. Skopiuj URL workera (np. https://contentai.twojlogin.workers.dev)
 * 7. Wklej URL do build.py jako PROXY_URL i uruchom build
 *
 * Endpointy:
 *   POST /api        → proxy do Anthropic API (generowanie tresci)
 *   POST /api/images → proxy do OpenAI API   (generowanie grafik)
 */

// Dozwolone originy - dodaj domeny z których korzystają Twoi klienci.
//
// Uwaga: nagłówek Origin jest wiarygodny tylko w przeglądarce - klient inny niż
// przeglądarka może wpisać dowolną wartość. To filtr odsiewający obce strony WWW,
// a nie mechanizm uwierzytelniania. Klucze i tak chroni to, że nigdy nie opuszczają workera.

// Dopasowanie po dokładnej wartości (bez prefiksu, żeby https://localhost.cokolwiek.pl nie przeszło)
const ALLOWED_ORIGINS = [
  'null',                    // niektore przegladarki dla file://
  'https://localhost',       // Capacitor Android (androidScheme: "https")
  'http://localhost',        // lokalny podglad (python3 -m http.server)
];

// Dopasowanie po prefiksie - schematy aplikacji natywnych, gdzie host bywa pusty lub zmienny
const ALLOWED_ORIGIN_PREFIXES = [
  'file://',                 // lokalne pliki HTML
  'app://',                  // Electron (Windows/macOS) - payload serwowany jako app://./index.html
  'capacitor://',            // Capacitor iOS (domyslnie capacitor://localhost)
  'ionic://',                // starsze wersje Capacitora/Ionica na iOS
  'http://localhost:',       // lokalny podglad na dowolnym porcie
  'https://localhost:',      // Capacitor Android z jawnym portem
];

export default {
  async fetch(request, env) {

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse('', 204, request);
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // ── Sprawdz origin ──────────────────────────────────────────────────────
    const origin = request.headers.get('Origin') || 'null';
    const allowed = ALLOWED_ORIGINS.includes(origin)
      || ALLOWED_ORIGIN_PREFIXES.some(o => origin.startsWith(o));
    if (!allowed) {
      console.warn(`Blocked origin: ${origin}`);
      return new Response('Unauthorized', { status: 403 });
    }

    // ── Routing na podstawie sciezki ────────────────────────────────────────
    const url = new URL(request.url);

    if (url.pathname === '/api') {
      return handleAnthropic(request, env);
    }

    if (url.pathname === '/api/images') {
      return handleOpenAI(request, env);
    }

    if (url.pathname === '/api/tts') {
      return handleTTS(request, env);
    }

    if (url.pathname === '/api/eleven-tts') {
      return handleElevenTTS(request, env);
    }

    if (url.pathname === '/api/transcribe') {
      return handleTranscribe(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ── Proxy → Anthropic API ───────────────────────────────────────────────────
async function handleAnthropic(request, env) {
  if (!env.ANTHROPIC_KEY) {
    return new Response('Server misconfigured: missing ANTHROPIC_KEY', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return corsResponse(text, res.status, request, { 'Content-Type': 'application/json' });
}

// ── Proxy → OpenAI Images API ───────────────────────────────────────────────
async function handleOpenAI(request, env) {
  if (!env.OPENAI_KEY) {
    return new Response('Server misconfigured: missing OPENAI_KEY', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.OPENAI_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return corsResponse(text, res.status, request, { 'Content-Type': 'application/json' });
}

// ── Proxy → OpenAI TTS (audio/speech) ───────────────────────────────────────
async function handleTTS(request, env) {
  if (!env.OPENAI_KEY) {
    return new Response('Server misconfigured: missing OPENAI_KEY', { status: 500 });
  }
  let body;
  try { body = await request.text(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.OPENAI_KEY },
    body,
  });
  const buf = await res.arrayBuffer();
  const origin = request.headers.get('Origin') || '*';
  return new Response(buf, {
    status: res.status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
    },
  });
}

// ── Proxy → OpenAI transkrypcja (audio/transcriptions, multipart) ────────────
async function handleTranscribe(request, env) {
  if (!env.OPENAI_KEY) {
    return new Response('Server misconfigured: missing OPENAI_KEY', { status: 500 });
  }
  const ct = request.headers.get('Content-Type') || 'multipart/form-data';
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.OPENAI_KEY, 'Content-Type': ct },
    body: request.body,
  });
  const text = await res.text();
  return corsResponse(text, res.status, request, { 'Content-Type': 'application/json' });
}

// ── Proxy → ElevenLabs TTS ───────────────────────────────────────────────────
async function handleElevenTTS(request, env) {
  if (!env.ELEVEN_KEY) {
    return new Response('Server misconfigured: missing ELEVEN_KEY', { status: 500 });
  }
  let payload;
  try { payload = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }
  const vid = payload.voice_id || '21m00Tcm4TlvDq8ikWAM';
  const fmt = payload.output_format || 'mp3_44100_128';
  const body = JSON.stringify({ text: payload.text || '', model_id: payload.model_id || 'eleven_multilingual_v2' });
  const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(vid) + '?output_format=' + fmt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': env.ELEVEN_KEY },
    body,
  });
  const buf = await res.arrayBuffer();
  const origin = request.headers.get('Origin') || '*';
  return new Response(buf, {
    status: res.status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
    },
  });
}

// ── Helper: response z CORS headerami ──────────────────────────────────────
function corsResponse(body, status, request, extraHeaders = {}) {
  const origin = request.headers.get('Origin') || '*';
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders,
    },
  });
}
