import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const IMAGE_URL = 'https://openrouter.ai/api/v1/images';
export const XAI_CHAT_URL = 'https://api.x.ai/v1/responses';
export const XAI_IMAGE_URL = 'https://api.x.ai/v1/images/generations';
export const LISTEN_HOST = '0.0.0.0';

// Prices checked against the OpenRouter models API on 2026-10-30.
// gemini-2.5-flash-lite: $0.10 / 1M input, $0.40 / 1M output, image in, text out.
// flux.2-klein-4b: $0.014 per output megapixel, accepts a reference photo.
export const DEFAULT_OPENROUTER_ROAST_MODEL = 'google/gemini-2.5-flash-lite';
export const DEFAULT_OPENROUTER_IMAGE_MODEL = 'black-forest-labs/flux.2-klein-4b';
export const DEFAULT_XAI_ROAST_MODEL = 'grok-4.7';
export const DEFAULT_XAI_IMAGE_MODEL = 'grok-imagine-image-2.0';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Allow the page itself to call getUserMedia. The public demo is HTTPS at the tunnel;
  // this process stays plain HTTP behind that proxy and must not redirect or upgrade.
  'Permissions-Policy': 'camera=(self)',
};

const ASPECTS = new Set(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']);
const QUALITIES = new Set(['low', 'medium', 'high', 'auto']);

const SYSTEM_PROMPT = `You are the host of Roast My Room, a live demo. You look at one photo and return JSON only.
Joke about the room, the furniture, and the mess. Never joke about a person's body, identity, income, culture, disability, family, or who might live there. Do not guess gender, age, job, or relationships.
Stage-safe: no slurs, no profanity, no cruelty, no threats.
Be specific to what is actually visible. If the photo is not a room, say so in the roast and still offer a welcoming glow-up.
Return a JSON object with:
- roast: 2 to 4 sentences
- suggestions: an array of exactly 4 short, concrete redesign moves
- glowUpPrompt: one paragraph for an image model describing this same room after those changes. Same architecture, windows, and camera angle when visible. Photorealistic, no people, no pets, no text.`;

loadEnv(path.join(ROOT, '.env'));

let inflight = 0;

export function provider() {
  return String(process.env.PROVIDER || 'openrouter').trim().toLowerCase() === 'xai' ? 'xai' : 'openrouter';
}

export function roastModelFor(which = provider()) {
  if (which === provider() && process.env.ROAST_MODEL) return process.env.ROAST_MODEL;
  return which === 'xai' ? DEFAULT_XAI_ROAST_MODEL : DEFAULT_OPENROUTER_ROAST_MODEL;
}

export function imageModelFor(which = provider()) {
  if (which === provider() && process.env.IMAGE_MODEL) return process.env.IMAGE_MODEL;
  return which === 'xai' ? DEFAULT_XAI_IMAGE_MODEL : DEFAULT_OPENROUTER_IMAGE_MODEL;
}

export function roastModel() {
  return roastModelFor(provider());
}

export function imageModel() {
  return imageModelFor(provider());
}

export function isMock() {
  return ['1', 'true', 'yes'].includes(String(process.env.MOCK || '').toLowerCase());
}

function usableKey(name) {
  const key = String(process.env[name] || '').trim();
  if (!key || key === 'your-key-here') return '';
  return key;
}

function openRouterKey() {
  return usableKey('OPENROUTER_API_KEY');
}

function xaiKey() {
  return usableKey('XAI_API_KEY');
}

export function hasKey() {
  return provider() === 'xai' ? Boolean(xaiKey()) : Boolean(openRouterKey());
}

export function missingKeyMessage() {
  if (provider() === 'xai') {
    return 'No xAI API key. Add XAI_API_KEY to .env, or restart with MOCK=1 to rehearse the demo.';
  }
  return 'No OpenRouter API key. Add OPENROUTER_API_KEY to .env, or restart with MOCK=1 to rehearse the demo.';
}

function imageQuality() {
  const value = String(process.env.IMAGE_QUALITY || 'low').toLowerCase();
  return QUALITIES.has(value) ? value : 'low';
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[name] == null) process.env[name] = value;
  }
}

function userPrompt(intensity) {
  const tone = intensity === 'savage'
    ? 'Intensity: savage. Sharper wit, shorter patience, still playful. Punch at the clutter, never at the person.'
    : 'Intensity: gentle. Affectionate teasing, like a stylish friend. Warm, specific, and encouraging.';
  return `${tone}\nLook at the photo and return the JSON object.`;
}

export function buildChatBody({ dataUrl, intensity, which = provider() }) {
  const text = userPrompt(intensity);
  if (which === 'xai') {
    return {
      model: roastModelFor('xai'),
      store: false,
      reasoning: { effort: 'low' },
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: dataUrl, detail: 'high' },
            { type: 'input_text', text },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'room_roast',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['roast', 'suggestions', 'glowUpPrompt'],
            properties: {
              roast: { type: 'string' },
              suggestions: { type: 'array', items: { type: 'string' } },
              glowUpPrompt: { type: 'string' },
            },
          },
        },
      },
    };
  }
  return {
    model: roastModelFor('openrouter'),
    response_format: { type: 'json_object' },
    max_tokens: 800,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text },
        ],
      },
    ],
  };
}

export function buildImageBody({ prompt, aspectRatio, dataUrl, which = provider(), quality }) {
  const model = imageModelFor(which);
  if (which === 'xai') {
    return {
      model,
      prompt,
      aspect_ratio: aspectRatio,
      resolution: '1k',
      quality: quality || imageQuality(),
      response_format: 'b64_json',
      n: 1,
    };
  }
  const body = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    n: 1,
  };
  if (model.includes('grok-imagine')) {
    body.quality = quality || imageQuality();
    body.resolution = '1K';
  }
  if (dataUrl) {
    body.input_references = [{ type: 'image_url', image_url: { url: dataUrl } }];
  }
  return body;
}

export function extractMessageText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content.map((part) => part?.text || part?.content || '').join('');
    if (joined.trim()) return joined;
  }
  const chunks = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  if (chunks.length) return chunks.join('');
  if (typeof payload?.output_text === 'string') return payload.output_text;
  return '';
}

export function parseRoastText(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('The model did not return a roast. Try the photo again.');
    }
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  }
  const roast = String(parsed.roast || '').trim();
  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((item) => item.slice(0, 180));
  let glowUpPrompt = String(parsed.glowUpPrompt || parsed.glow_up_prompt || '').trim();
  if (!glowUpPrompt && suggestions.length) {
    glowUpPrompt = `Photorealistic redesign of the same room. ${suggestions.join('. ')}`;
  }
  if (roast.length < 8 || suggestions.length < 1) {
    throw new Error('The model returned an incomplete roast. Try the photo again.');
  }
  return {
    roast: roast.slice(0, 800),
    suggestions,
    glowUpPrompt: glowUpPrompt.slice(0, 1800),
  };
}

export function extractImageDataUrl(payload) {
  const item = payload?.data?.[0];
  if (!item) return '';
  if (item.b64_json) {
    const mime = item.media_type || 'image/png';
    return `data:${mime};base64,${item.b64_json}`;
  }
  return '';
}

export function parseImageDataUrl(input) {
  if (typeof input !== 'string') return { error: 'Choose a photo first.', status: 400 };
  const compact = input.replace(/\s/g, '');
  if (compact.length > 12_000_000) return { error: 'That photo is too big. Try a smaller one.', status: 413 };
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(compact);
  if (!match) return { error: 'Use a JPEG or PNG photo.', status: 400 };
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length < 24) return { error: 'That file does not look like a JPEG or PNG.', status: 400 };
  if (buffer.length > 8 * 1024 * 1024) return { error: 'That photo is too big. Try a smaller one.', status: 413 };
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isPng && !isJpeg) return { error: 'That file does not look like a JPEG or PNG.', status: 400 };
  const mime = isPng ? 'image/png' : 'image/jpeg';
  return { mime, dataUrl: `data:${mime};base64,${match[2]}` };
}

export function fallbackImageDataUrl() {
  const png = path.join(PUBLIC_DIR, 'samples', 'after.png');
  if (fs.existsSync(png)) {
    return `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`;
  }
  const svg = fs.readFileSync(path.join(PUBLIC_DIR, 'samples', 'after.svg'));
  return `data:image/svg+xml;base64,${svg.toString('base64')}`;
}

export async function resolveGlowUp(requestFn) {
  try {
    const imageDataUrl = await requestFn();
    if (!imageDataUrl) throw new Error('empty image');
    return { imageDataUrl, imageFallback: false, imageNote: null };
  } catch (err) {
    console.error(`[glow-up] ${scrub(err.message)}`);
    return {
      imageDataUrl: fallbackImageDataUrl(),
      imageFallback: true,
      imageNote: 'Image generation did not come back, so this is a sample glow-up. The roast is still about your photo.',
    };
  }
}

function mockCopy(intensity, sample) {
  if (sample && intensity === 'savage') {
    return {
      roast: 'The mattress did not lose the bed frame. There was not one. The pizza box is load-bearing, the blinds quit mid-shift, and the overhead bulb is interrogating a laundry pile that has already won.',
      suggestions: [
        'Put the mattress on a frame. The floor is not a mattress brand.',
        'Evict the pizza box and put a real table in that corner.',
        'Fix the blinds or commit to a curtain.',
        'Turn off the overhead light and add one warm lamp.',
      ],
    };
  }
  if (sample) {
    return {
      roast: 'The mattress is moonlighting as furniture, the pizza box has signed a lease, and that overhead light would make a mugshot feel welcome. The laundry pile is the only thing in here with real commitment.',
      suggestions: [
        'Get the mattress onto a frame, even a low one.',
        'Walk the pizza box out and give that corner a real table.',
        'Turn off the overhead light and bounce a warm lamp off the wall.',
        'Hang one print level, then stop. A rug will do the rest.',
      ],
    };
  }
  if (intensity === 'savage') {
    return {
      roast: 'Demo mode is on, so this is a stand-in, not a verdict. I will not invent a mess I cannot see. Add an OpenRouter key and the roast will name what is actually in the frame.',
      suggestions: [
        'Clear one surface completely so the room has a rest note.',
        'Swap the overhead glare for a warm lamp in a corner.',
        'Pick two colors and let everything else sit quietly.',
        'Put a rug down so the furniture has somewhere to belong.',
      ],
    };
  }
  return {
    roast: 'Demo mode is on, so this is a rehearsal roast, not a read of your actual photo. The glow-up shows how the reveal works. Add an OpenRouter key and Grok will get specific.',
    suggestions: [
      'Clear one surface completely so the room can breathe.',
      'Swap harsh overhead light for a warm lamp.',
      'Choose two colors and repeat them on purpose.',
      'Add a rug to give the furniture a boundary.',
    ],
  };
}

function glowPromptFrom(suggestions) {
  return `Photorealistic interior photo of this same room after a redesign: ${suggestions.join(' ')} Keep the same windows, walls, and camera angle. Natural light, realistic materials, livable styling. No people, no pets, no text, no watermark.`;
}

function sleep(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    }, { once: true });
  });
}

function mockDelay() {
  const raw = process.env.MOCK_DELAY_MS;
  if (raw == null || raw === '') return 900;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, value) : 900;
}

export function listenPort(value = process.env.PORT || 3000) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer from 0 to 65535.');
  }
  return port;
}

export function start(port = listenPort()) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on the server.' });
      else res.end();
    });
  });
  server.requestTimeout = 180000;
  server.headersTimeout = 60000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort(port), LISTEN_HOST, () => resolve(server));
  });
}

async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      mock: isMock(),
      provider: provider(),
      hasKey: hasKey(),
      roastModel: roastModel(),
      imageModel: imageModel(),
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/roast') return handleRoast(req, res);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
  sendJson(res, 405, { error: 'Method not allowed.' });
}

async function handleRoast(req, res) {
  if (inflight >= 3) {
    return sendJson(res, 429, { error: 'Too many roasts at once. Give it a second.' });
  }
  let body;
  try {
    body = JSON.parse((await readBody(req, 9 * 1024 * 1024)).toString('utf8') || '{}');
  } catch (err) {
    const status = err.status || 400;
    return sendJson(res, status, { error: err.status ? err.message : 'The upload was garbled. Try the photo again.' });
  }
  const image = parseImageDataUrl(body.imageDataUrl);
  if (image.error) return sendJson(res, image.status, { error: image.error });
  const intensity = body.intensity === 'savage' ? 'savage' : 'gentle';
  const aspectRatio = ASPECTS.has(body.aspectRatio) ? body.aspectRatio : '4:3';
  const sample = Boolean(body.sample);

  if (!isMock() && !hasKey()) {
    return sendJson(res, 503, { error: missingKeyMessage() });
  }

  inflight += 1;
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  try {
    const result = isMock()
      ? await runMock({ intensity, sample, signal: ac.signal })
      : await runLive({ dataUrl: image.dataUrl, intensity, aspectRatio, signal: ac.signal });
    if (!res.writableEnded) sendJson(res, 200, result);
  } catch (err) {
    if (err.name === 'AbortError' || res.writableEnded) return;
    const status = err.status || 502;
    sendJson(res, status, { error: publicError(err) });
  } finally {
    inflight -= 1;
  }
}

async function runMock({ intensity, sample, signal }) {
  await sleep(mockDelay(), signal);
  const copy = mockCopy(intensity, sample);
  return {
    roast: copy.roast,
    suggestions: copy.suggestions,
    intensity,
    mock: true,
    imageDataUrl: fallbackImageDataUrl(),
    imageFallback: false,
    imageNote: sample ? null : 'Demo mode is showing a sample glow-up, not a redesign of this photo.',
  };
}

async function runLive({ dataUrl, intensity, aspectRatio, signal }) {
  const roast = await requestRoast({ dataUrl, intensity, signal });
  const prompt = `${roast.glowUpPrompt} Photorealistic interior photograph. Preserve the architecture and camera angle of the reference photo. No people, no pets, no text, no watermark.`;
  const glow = await resolveGlowUp(async () => {
    const attempts = imageAttempts();
    let lastError;
    for (const which of attempts) {
      try {
        return await requestImageWithRetry(which, { prompt, aspectRatio, dataUrl, signal });
      } catch (err) {
        lastError = err;
        console.error(`[glow-up] ${which} failed: ${scrub(err.message)}`);
      }
    }
    throw lastError || new Error('No image provider is configured.');
  });
  return {
    roast: roast.roast,
    suggestions: roast.suggestions,
    intensity,
    mock: false,
    ...glow,
  };
}

function imageAttempts() {
  const order = provider() === 'xai' ? ['xai', 'openrouter'] : ['openrouter', 'xai'];
  return order.filter((which) => (which === 'xai' ? xaiKey() : openRouterKey()));
}

async function requestRoast({ dataUrl, intensity, signal }) {
  const which = provider();
  const payload = await postJson(
    which === 'xai' ? XAI_CHAT_URL : CHAT_URL,
    buildChatBody({ dataUrl, intensity, which }),
    which === 'xai' ? xaiKey() : openRouterKey(),
    signal,
    75000,
    which,
  );
  const roast = parseRoastText(extractMessageText(payload));
  if (!roast.glowUpPrompt) roast.glowUpPrompt = glowPromptFrom(roast.suggestions);
  return roast;
}

async function requestImageWithRetry(which, args) {
  try {
    return await requestImage(which, args);
  } catch (err) {
    if (!args.dataUrl || which === 'xai') throw err;
    console.error(`[glow-up] ${which} reference failed, retrying text-only: ${scrub(err.message)}`);
    return requestImage(which, { ...args, dataUrl: undefined });
  }
}

async function requestImage(which, { prompt, aspectRatio, dataUrl, signal }) {
  const payload = await postJson(
    which === 'xai' ? XAI_IMAGE_URL : IMAGE_URL,
    buildImageBody({ prompt, aspectRatio, dataUrl, which }),
    which === 'xai' ? xaiKey() : openRouterKey(),
    signal,
    100000,
    which,
  );
  const direct = extractImageDataUrl(payload);
  if (direct) return direct;
  const remote = payload?.data?.[0]?.url;
  if (remote) return fetchUrlAsDataUrl(remote, signal);
  throw new Error(`${which === 'xai' ? 'xAI' : 'OpenRouter'} returned no image.`);
}

async function postJson(url, body, key, signal, timeoutMs, vendor) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  const who = vendor === 'xai' ? 'xAI' : 'OpenRouter';
  let response;
  try {
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    if (vendor === 'openrouter') {
      headers['HTTP-Referer'] = 'http://localhost:3000';
      headers['X-Title'] = 'Roast My Room';
    }
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      const wrapped = new Error(err.name === 'TimeoutError' ? 'The model took too long. Try again.' : 'aborted');
      wrapped.name = err.name === 'TimeoutError' ? 'Error' : 'AbortError';
      wrapped.status = err.name === 'TimeoutError' ? 504 : undefined;
      throw wrapped;
    }
    const wrapped = new Error(`Couldn't reach ${who}. Check the network, or use MOCK=1.`);
    wrapped.status = 502;
    throw wrapped;
  }
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!response.ok) {
    const message = errorMessage(json, `${who} request failed (${response.status}).`);
    const wrapped = new Error(friendlyStatus(response.status, message, vendor));
    wrapped.status = response.status;
    throw wrapped;
  }
  return json;
}

async function fetchUrlAsDataUrl(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('The glow-up link could not be downloaded.');
  const mime = (response.headers.get('content-type') || 'image/png').split(';')[0];
  if (!mime.startsWith('image/')) throw new Error('The glow-up link was not an image.');
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function errorMessage(json, fallback) {
  if (!json) return fallback;
  if (typeof json.error === 'string') return json.error;
  if (json.error?.message) return json.error.message;
  if (json.message) return json.message;
  return fallback;
}

function friendlyStatus(status, message, vendor) {
  const who = vendor === 'xai' ? 'xAI' : 'OpenRouter';
  const keyName = vendor === 'xai' ? 'XAI_API_KEY' : 'OPENROUTER_API_KEY';
  if (status === 401 || status === 403) return `${who} rejected the API key. Check ${keyName} in .env.`;
  if (status === 402) return `${who} refused the request for billing. Check the key credit balance.`;
  if (status === 429) return `${who} rate limit hit. Wait a moment and try again.`;
  return scrub(message);
}

function publicError(err) {
  return scrub(err.message || 'The roast failed. Try again.');
}

function scrub(text) {
  return String(text || '').replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-***').replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 300);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('That photo is too big. Try a smaller one.');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (rel.includes('\0') || rel.split('/').includes('..')) {
    return sendText(res, 400, 'Bad path');
  }
  const file = path.join(PUBLIC_DIR, rel);
  const relative = path.relative(PUBLIC_DIR, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return sendText(res, 400, 'Bad path');
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.txt': 'text/plain; charset=utf-8',
    };
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': types[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  start().then((server) => {
    const port = server.address().port;
    console.log(`Roast My Room listening on http://127.0.0.1:${port}`);
    console.log(`Bound to ${LISTEN_HOST}:${port}. Point an HTTPS tunnel at this port for a public demo link.`);
    if (isMock()) console.log('MOCK=1 — sample roast and glow-up, no API calls.');
    console.log(`Provider ${provider()} · roast ${roastModel()} · image ${imageModel()}`);
    if (!isMock() && !hasKey()) console.log(missingKeyMessage());
    for (const url of lanUrls(port)) console.log(`On this network: ${url}`);
  }).catch((err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${process.env.PORT || 3000} is already in use. Set PORT to a free port.`);
    else console.error(err.message || err);
    process.exit(1);
  });
}
