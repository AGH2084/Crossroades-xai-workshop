const state = {
  intensity: 'gentle',
  phase: 'pick',
  photo: null,
  sample: false,
  roast: '',
  suggestions: [],
  afterUrl: '',
  imageNote: '',
  error: '',
  status: 'Grok is looking at the room…',
  health: null,
  stream: null,
};

let requestSeq = 0;
let roastAbort = null;
let revealFrame = 0;

const view = document.querySelector('#view');
const banner = document.querySelector('#banner');
const foot = document.querySelector('#foot');

document.body.dataset.intensity = state.intensity;
document.querySelector('#intensity').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || state.phase === 'loading') return;
  setIntensity(button.dataset.value);
});

window.addEventListener('pagehide', stopStream);
loadHealth();
render();

async function loadHealth() {
  try {
    const response = await fetch('/api/health');
    state.health = await response.json();
    if (state.health.mock) {
      banner.hidden = false;
      banner.textContent = 'Demo mode is on (MOCK=1). Roasts and the glow-up are samples, so you can present without an API key.';
    } else if (!state.health.hasKey) {
      banner.hidden = false;
      const keyName = state.health.provider === 'xai' ? 'XAI_API_KEY' : 'OPENROUTER_API_KEY';
      banner.textContent = `No API key yet. Add ${keyName} to .env, or restart with MOCK=1.`;
    }
    foot.textContent = `${state.health.provider} · ${state.health.roastModel} · ${state.health.imageModel}`;
  } catch {
    banner.hidden = false;
    banner.textContent = 'The app server is not responding.';
  }
}

function setIntensity(value) {
  state.intensity = value === 'savage' ? 'savage' : 'gentle';
  document.body.dataset.intensity = state.intensity;
  const group = document.querySelector('#intensity');
  group.dataset.value = state.intensity;
  for (const button of group.querySelectorAll('button')) {
    button.setAttribute('aria-checked', String(button.dataset.value === state.intensity));
  }
}

function render() {
  stopReveal();
  view.replaceChildren();
  if (state.phase === 'webcam') view.append(webcamView());
  else if (state.phase === 'preview') view.append(previewView());
  else if (state.phase === 'loading') view.append(loadingView());
  else if (state.phase === 'result') view.append(resultView());
  else view.append(pickView());
}

function pickView() {
  return el('section', { class: 'hero' }, [
    el('p', { class: 'eyebrow' }, 'Live from the clutter'),
    el('h1', {}, 'Roast my room'),
    el('p', { class: 'lede' }, 'One photo. Grok tells the truth, then paints the glow-up. Drag to compare.'),
    state.error ? el('p', { class: 'error', role: 'alert' }, state.error) : null,
    el('div', { class: 'stack' }, [
      el('button', { class: 'button button-primary webcam-action', type: 'button', onclick: openWebcam }, 'Use webcam'),
      el('label', { class: 'button button-secondary' }, [
        'Take a photo',
        el('input', {
          class: 'visually-hidden-file',
          type: 'file',
          accept: 'image/*',
          capture: 'environment',
          onchange: onFile,
        }),
      ]),
      el('label', { class: 'button button-secondary' }, [
        'Upload a photo',
        el('input', {
          class: 'visually-hidden-file',
          type: 'file',
          accept: 'image/*',
          onchange: onFile,
        }),
      ]),
      el('button', { class: 'button button-ghost', type: 'button', onclick: useSample }, 'Use the sample room'),
    ]),
    el('p', { class: 'quiet' }, 'Your photo is sent to OpenRouter and is not saved on this server.'),
  ]);
}

function webcamView() {
  return el('section', { class: 'panel' }, [
    el('p', { class: 'eyebrow' }, 'Laptop camera'),
    el('h1', {}, 'Point it at the room'),
    state.error ? el('p', { class: 'error', role: 'alert' }, state.error) : null,
    el('div', { class: 'cam-frame' }, [
      el('video', { id: 'cam', autoplay: 'true', playsinline: 'true', muted: 'true' }),
    ]),
    el('div', { class: 'stack' }, [
      el('button', { class: 'button button-primary', id: 'capture', type: 'button', disabled: 'true', onclick: captureWebcam }, 'Capture'),
      el('button', { class: 'button button-ghost', type: 'button', onclick: closeWebcam }, 'Close camera'),
    ]),
  ]);
}

function previewView() {
  return el('section', { class: 'panel' }, [
    el('p', { class: 'eyebrow' }, state.sample ? 'Sample room' : 'Ready'),
    el('h1', {}, 'Roast this?'),
    state.error ? el('p', { class: 'error', role: 'alert' }, state.error) : null,
    el('div', { class: 'frame' }, [
      el('img', { src: state.photo.dataUrl, alt: 'Room photo waiting to be roasted' }),
    ]),
    el('div', { class: 'stack' }, [
      el('button', { class: 'button button-primary', type: 'button', onclick: roast }, 'Roast this room'),
      el('button', { class: 'button button-ghost', type: 'button', onclick: resetPick }, 'Choose another photo'),
    ]),
  ]);
}

function loadingView() {
  return el('section', { class: 'panel' }, [
    el('div', { class: 'frame scan' }, [
      el('img', { src: state.photo.dataUrl, alt: '' }),
    ]),
    el('p', { class: 'status', id: 'status', role: 'status' }, state.status),
  ]);
}

function resultView() {
  const copy = el('section', { class: 'copy rise' }, [
    el('p', { class: 'eyebrow' }, state.intensity === 'savage' ? 'Savage roast' : 'Gentle roast'),
    el('div', { class: 'roast' }, [el('p', {}, state.roast)]),
    el('ol', { class: 'suggestions' }, state.suggestions.map((item, index) => el('li', {}, [
      el('span', {}, String(index + 1)),
      item,
    ]))),
  ]);
  const stage = el('section', { class: 'stage' }, [
    compareNode(),
    el('p', { class: 'hint', id: 'hint' }, 'Drag to reveal the glow-up'),
    state.imageNote ? el('p', { class: 'note' }, state.imageNote) : null,
  ]);
  const actions = el('div', { class: 'actions' }, [
    el('button', { class: 'button button-primary', type: 'button', onclick: shareResult }, 'Share result'),
    el('button', { class: 'button button-secondary', type: 'button', onclick: saveResult }, 'Save image'),
    el('button', { class: 'button button-ghost', type: 'button', onclick: resetPick }, 'Roast another'),
  ]);
  return el('div', { class: 'result-grid' }, [copy, stage, actions]);
}

function compareNode() {
  const root = el('div', {
    class: 'compare',
    role: 'slider',
    tabindex: '0',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '100',
    'aria-label': 'Reveal the glow-up. Left is your photo, right is the redesign.',
  }, [
    el('img', { class: 'compare-after', src: state.afterUrl, alt: 'Glow-up of the room' }),
    el('img', { class: 'compare-before', src: state.photo.dataUrl, alt: 'Original room photo' }),
    el('div', { class: 'handle', 'aria-hidden': 'true' }, [el('span', { class: 'knob' }, '↔')]),
    el('span', { class: 'tag before' }, 'Before'),
    el('span', { class: 'tag after' }, 'After'),
  ]);
  if (state.photo?.aspect) root.style.aspectRatio = state.photo.aspect.replace(':', ' / ');
  const setValue = (value) => {
    const next = Math.min(100, Math.max(0, value));
    root.dataset.value = String(next);
    root.setAttribute('aria-valuenow', String(Math.round(next)));
    root.querySelector('.compare-before').style.clipPath = `inset(0 ${100 - next}% 0 0)`;
    root.querySelector('.handle').style.left = `${next}%`;
    root.querySelector('.tag.before').style.opacity = next < 8 ? '0' : '1';
    root.querySelector('.tag.after').style.opacity = next > 92 ? '0' : '1';
  };
  const point = (event) => {
    const rect = root.getBoundingClientRect();
    setValue(((event.clientX - rect.left) / rect.width) * 100);
  };
  root.addEventListener('pointerdown', (event) => {
    stopReveal();
    root.setPointerCapture(event.pointerId);
    point(event);
  });
  root.addEventListener('pointermove', (event) => {
    if (root.hasPointerCapture?.(event.pointerId)) point(event);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    stopReveal();
    const current = Number(root.dataset.value || 100);
    setValue(current + (event.key === 'ArrowLeft' ? -5 : 5));
  });
  setValue(100);
  requestAnimationFrame(() => playReveal(setValue));
  return root;
}

function playReveal(setValue) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setValue(42);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 1400);
    const eased = 1 - (1 - t) ** 3;
    setValue(100 + (42 - 100) * eased);
    if (t < 1) revealFrame = requestAnimationFrame(step);
  };
  revealFrame = requestAnimationFrame(step);
}

function stopReveal() {
  if (revealFrame) cancelAnimationFrame(revealFrame);
  revealFrame = 0;
}

async function onFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const photo = await fileToPhoto(file);
    stopStream();
    state.photo = photo;
    state.sample = false;
    state.error = '';
    state.phase = 'preview';
    render();
  } catch (err) {
    state.error = err.message;
    state.phase = 'pick';
    render();
  }
}

async function useSample() {
  try {
    const response = await fetch('/samples/before.svg');
    if (!response.ok) throw new Error('The sample room is missing.');
    const blob = await response.blob();
    state.photo = await fileToPhoto(new File([blob], 'sample.svg', { type: 'image/svg+xml' }));
    state.sample = true;
    state.error = '';
    state.phase = 'preview';
    render();
  } catch (err) {
    state.error = err.message || 'Could not load the sample room.';
    render();
  }
}

async function openWebcam() {
  stopStream();
  state.error = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    state.error = 'This browser has no camera API. Upload a photo instead.';
    state.phase = 'pick';
    render();
    return;
  }
  if (!window.isSecureContext) {
    state.error = 'The webcam needs the HTTPS demo link. Upload a photo, or open the tunnel URL.';
    state.phase = 'pick';
    render();
    return;
  }
  state.phase = 'webcam';
  render();
  try {
    state.stream = await getCamera();
  } catch (err) {
    state.error = cameraMessage(err);
    state.phase = 'pick';
    render();
    return;
  }
  const video = document.querySelector('#cam');
  const capture = document.querySelector('#capture');
  if (!video || state.phase !== 'webcam') {
    stopStream();
    return;
  }
  video.muted = true;
  video.playsInline = true;
  video.srcObject = state.stream;
  await video.play();
  if (capture) capture.disabled = false;
}

async function getCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1600 },
        height: { ideal: 1200 },
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') throw err;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
}

function cameraMessage(err) {
  if (err?.name === 'NotAllowedError') return 'Camera permission was blocked. Allow it in the browser, or upload a photo.';
  if (err?.name === 'NotFoundError') return 'No camera was found. Upload a photo instead.';
  return 'Could not open the webcam. Upload a photo instead.';
}

function captureWebcam() {
  const video = document.querySelector('#cam');
  if (!video?.videoWidth) return;
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(video, 0, 0, width, height);
  stopStream();
  state.photo = {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    width,
    height,
    aspect: aspectFor(width, height),
  };
  state.sample = false;
  state.error = '';
  state.phase = 'preview';
  render();
}

function closeWebcam() {
  stopStream();
  state.phase = 'pick';
  render();
}

function stopStream() {
  for (const track of state.stream?.getTracks?.() || []) track.stop();
  state.stream = null;
}

async function roast() {
  if (!state.photo || state.phase === 'loading') return;
  const id = ++requestSeq;
  roastAbort?.abort();
  roastAbort = new AbortController();
  state.phase = 'loading';
  state.error = '';
  state.status = 'Grok is looking at the room…';
  render();
  const timers = [
    setTimeout(() => setStatus(id, 'Writing the roast…'), 2200),
    setTimeout(() => setStatus(id, 'Painting the glow-up…'), 6000),
  ];
  try {
    const response = await fetch('/api/roast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: roastAbort.signal,
      body: JSON.stringify({
        imageDataUrl: state.photo.dataUrl,
        intensity: state.intensity,
        aspectRatio: state.photo.aspect,
        sample: state.sample,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (id !== requestSeq) return;
    if (!response.ok) throw new Error(data.error || 'The roast failed.');
    state.roast = data.roast || '';
    state.suggestions = data.suggestions || [];
    state.afterUrl = data.imageDataUrl || '';
    state.imageNote = data.imageNote || '';
    state.phase = 'result';
    render();
  } catch (err) {
    if (err.name === 'AbortError' || id !== requestSeq) return;
    state.error = err.message || 'The roast failed. Try again.';
    state.phase = state.photo ? 'preview' : 'pick';
    render();
  } finally {
    timers.forEach(clearTimeout);
  }
}

function setStatus(id, text) {
  if (id !== requestSeq || state.phase !== 'loading') return;
  state.status = text;
  const node = document.querySelector('#status');
  if (node) node.textContent = text;
}

function resetPick() {
  requestSeq += 1;
  roastAbort?.abort();
  stopStream();
  state.photo = null;
  state.sample = false;
  state.error = '';
  state.phase = 'pick';
  render();
}

async function fileToPhoto(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('That photo is over 20 MB. Try a smaller one.');
  const image = await loadImage(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    width,
    height,
    aspect: aspectFor(width, height),
  };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This browser could not read that photo. Use a JPEG or PNG.'));
    };
    image.src = url;
  });
}

function aspectFor(width, height) {
  const ratio = width / height;
  if (ratio > 1.7) return '16:9';
  if (ratio > 1.2) return '4:3';
  if (ratio > 0.9) return '1:1';
  if (ratio > 0.7) return '3:4';
  return '9:16';
}

async function shareResult() {
  try {
    const blob = await resultBlob();
    const file = new File([blob], 'roast-my-room.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Roast My Room', text: state.roast });
      return;
    }
    downloadBlob(blob, 'roast-my-room.png');
  } catch (err) {
    if (err.name === 'AbortError') return;
    downloadDataUrl(state.afterUrl, 'roast-my-room-glow-up');
  }
}

async function saveResult() {
  try {
    downloadBlob(await resultBlob(), 'roast-my-room.png');
  } catch {
    downloadDataUrl(state.afterUrl, 'roast-my-room-glow-up');
  }
}

async function resultBlob() {
  await document.fonts.ready;
  const before = await loadUrl(state.photo.dataUrl);
  const after = await loadUrl(state.afterUrl);
  const width = 1080;
  const pad = 48;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = '700 42px Fraunces, Georgia, serif';
  const lines = wrap(ctx, state.roast, width - pad * 2).slice(0, 8);
  const imageW = (width - pad * 2 - 16) / 2;
  const imageH = imageW * 0.75;
  canvas.width = width;
  canvas.height = pad + 36 + lines.length * 52 + 24 + imageH + 36 + state.suggestions.length * 36 + pad;
  ctx.fillStyle = '#140c12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffb703';
  ctx.font = '700 18px Outfit, sans-serif';
  ctx.fillText('ROAST MY ROOM', pad, pad);
  ctx.fillStyle = '#fff6ee';
  ctx.font = '700 42px Fraunces, Georgia, serif';
  lines.forEach((line, index) => ctx.fillText(line, pad, pad + 48 + index * 52));
  const y = pad + 48 + lines.length * 52 + 12;
  ctx.drawImage(before, pad, y, imageW, imageH);
  ctx.drawImage(after, pad + imageW + 16, y, imageW, imageH);
  ctx.font = '500 24px Outfit, sans-serif';
  state.suggestions.forEach((item, index) => {
    ctx.fillText(`${index + 1}. ${item}`.slice(0, 80), pad, y + imageH + 40 + index * 36);
  });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not build the image.');
  return blob;
}

function loadUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not draw the image.'));
    image.src = url;
  });
}

function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(url, name) {
  if (!url) return;
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}
