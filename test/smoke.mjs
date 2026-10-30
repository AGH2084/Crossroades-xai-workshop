import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHAT_URL,
  IMAGE_URL,
  LISTEN_HOST,
  buildChatBody,
  buildImageBody,
  extractMessageText,
  listenPort,
  parseRoastText,
  resolveGlowUp,
  start,
} from '../server.js';

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let child;
let base;

test('request builders use the current OpenRouter models', () => {
  assert.equal(CHAT_URL, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(IMAGE_URL, 'https://openrouter.ai/api/v1/images');
  assert.equal(LISTEN_HOST, '0.0.0.0');
  const chat = buildChatBody({ dataUrl: TINY_PNG, intensity: 'savage' });
  assert.equal(chat.model, 'x-ai/grok-4.7');
  assert.equal(chat.reasoning_effort, 'low');
  assert.equal(chat.messages[1].content[0].type, 'image_url');
  assert.match(chat.messages[1].content[1].text, /savage/);
  const image = buildImageBody({ prompt: 'A brighter room', aspectRatio: '4:3', dataUrl: TINY_PNG, quality: 'low' });
  assert.equal(image.model, 'x-ai/grok-imagine-image-2.0');
  assert.equal(image.input_references[0].type, 'image_url');
  assert.equal(image.resolution, '1K');
  const text = extractMessageText({
    choices: [{ message: { content: '{"roast":"The desk is a landfill with ambition and a lamp.","suggestions":["Move the pile."],"glowUpPrompt":"A clean desk."}' } }],
  });
  const roast = parseRoastText(text);
  assert.match(roast.roast, /landfill/);
  assert.equal(roast.suggestions.length, 1);
});

test('glow-up falls back when image generation throws', async () => {
  const result = await resolveGlowUp(async () => {
    throw new Error('nope');
  });
  assert.equal(result.imageFallback, true);
  assert.match(result.imageDataUrl, /^data:image\//);
  assert.match(result.imageNote, /sample glow-up/);
});

test('server binds 0.0.0.0 and reads PORT', async () => {
  const port = listenPort(0);
  assert.equal(port, 0);
  const previous = process.env.PORT;
  process.env.PORT = '0';
  const server = await start();
  process.env.PORT = previous;
  assert.equal(server.address().address, '0.0.0.0');
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

test('mock server roasts without a key', async () => {
  const env = { ...process.env, MOCK: '1', MOCK_DELAY_MS: '0', PORT: '0' };
  delete env.OPENROUTER_API_KEY;
  child = spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await waitForPort(child);
  const health = await fetch(`${base}/api/health`, {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'demo.example' },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('permissions-policy'), 'camera=(self)');
  const body = await health.json();
  assert.equal(body.mock, true);
  assert.equal(body.hasKey, false);
  assert.equal(body.roastModel, 'x-ai/grok-4.7');

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Roast My Room/);
  const app = await (await fetch(`${base}/app.js`)).text();
  assert.match(app, /capture: 'environment'/);
  assert.match(app, /Use webcam/);
  assert.match(app, /getUserMedia/);
  assert.match(app, /Upload a photo/);

  const gentle = await roast({ intensity: 'gentle', sample: true });
  assert.equal(gentle.mock, true);
  assert.match(gentle.roast, /moonlighting/);
  assert.equal(gentle.suggestions.length, 4);
  assert.match(gentle.imageDataUrl, /^data:image\//);

  const savage = await roast({ intensity: 'savage', sample: true });
  assert.match(savage.roast, /load-bearing/);

  const missing = await fetch(`${base}/api/roast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(missing.status, 400);

  const bad = await fetch(`${base}/api/roast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,aGVsbG8=' }),
  });
  assert.equal(bad.status, 400);
});

test('missing key is a clear error and does not redirect behind a proxy', async () => {
  const env = { ...process.env, MOCK: '0', PORT: '0' };
  delete env.OPENROUTER_API_KEY;
  const server = spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await waitForPort(server);
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(new URL('/api/roast', url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'demo.example',
          Host: 'demo.example',
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ imageDataUrl: TINY_PNG, intensity: 'gentle' }));
    });
    assert.equal(status.status, 503);
    assert.equal(status.location, undefined);
    assert.match(status.body, /OPENROUTER_API_KEY/);
    assert.match(status.body, /MOCK=1/);
  } finally {
    server.kill();
  }
});

after(() => {
  child?.kill();
});

function roast(extra) {
  return fetch(`${base}/api/roast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl: TINY_PNG, ...extra }),
  }).then(async (response) => {
    const json = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(json));
    return json;
  });
}

function waitForPort(proc) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`server did not start\n${buf}`)), 8000);
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${buf}`));
    };
    const onData = (chunk) => {
      buf += chunk.toString();
      const match = buf.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      proc.off('exit', onExit);
      resolve(`http://127.0.0.1:${match[1]}`);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', onExit);
  });
}
