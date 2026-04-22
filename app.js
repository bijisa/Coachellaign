// ─── Redirect URI ──────────────────────────────────────────────────────────
const REDIR = location.href.split('?')[0].split('#')[0];
document.getElementById('redir').textContent = REDIR;

// ─── State ─────────────────────────────────────────────────────────────────
let token = null, tokenExp = 0;
let isPlaying = false, shuffleOn = false, repeatMode = 'off', trackDur = 0;
let cachedDeviceId = null;

let poseMesh = null, mpCam = null, calibBase = null;
let sens = 5, graceSec = 3, scratchLvl = 6;
let graceStart = null, isBad = false, nagCount = 0;

let sessionStart = null, sessionTimer = null;
let goodSecs = 0, totalSecs = 0, rewardStreak = 0;

let audioCtx = null, analyser = null;
let scratchOsc = null, scratchLfo = null, scratchGain = null;
let vinylSrc = null, vinylBuf = null, scratchInt = null;

let histChart = null;
let rewards = JSON.parse(localStorage.getItem('ca_rewards') || '[]');

// ─── Rewards ───────────────────────────────────────────────────────────────
const REWARD_DEFS = [
  { id: 'seedling', icon: '🌱', name: 'First 10 min' },
  { id: 'sprout',   icon: '🪴', name: '2 streaks' },
  { id: 'tree',     icon: '🌳', name: '30 min streak' },
  { id: 'diamond',  icon: '💎', name: '60 min good' },
  { id: 'trophy',   icon: '🏆', name: '5 badges' },
  { id: 'crown',    icon: '👑', name: '10 badges' },
];

const NAGS = [
  ['Sit up!', 'Your music is suffering'],
  ['Slouch detected!', 'Shoulders back'],
  ['Record scratch!', 'Fix your posture'],
  ['Spine check!', 'Sit up straight'],
  ['Hey!', 'Fix. Your. Posture.'],
];

const BADGE_COLORS = {
  seedling: { fill: '#14532d', stroke: '#22c55e', glow: '#22c55e' },
  sprout:   { fill: '#1a2e05', stroke: '#84cc16', glow: '#84cc16' },
  tree:     { fill: '#052e16', stroke: '#4ade80', glow: '#4ade80' },
  diamond:  { fill: '#0c1a4d', stroke: '#60a5fa', glow: '#60a5fa' },
  trophy:   { fill: '#3b1a05', stroke: '#fb923c', glow: '#fb923c' },
  crown:    { fill: '#3b0764', stroke: '#e879f9', glow: '#e879f9' },
};

const BADGE_SHAPES = {
  seedling: 'M26,4 L48,18 L48,46 L26,60 L4,46 L4,18 Z',
  sprout:   'M26,2 L50,14 L50,46 L26,58 L2,46 L2,14 Z',
  tree:     'M26,3 L49,10 L52,34 L40,54 L12,54 L0,34 L3,10 Z',
  diamond:  'M26,2 L52,26 L26,58 L0,26 Z',
  trophy:   'M26,2 L46,8 L52,28 L44,48 L26,56 L8,48 L0,28 L6,8 Z',
  crown:    'M26,2 L50,12 L50,20 L44,48 L8,48 L2,20 L2,12 Z',
};

function badgeSVG(id, unlocked) {
  const c = BADGE_COLORS[id] || { fill: '#222', stroke: '#555', glow: '#555' };
  const path = BADGE_SHAPES[id] || BADGE_SHAPES.seedling;
  const glowId = 'glow-' + id;
  return `<svg viewBox="0 0 52 60" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="${glowId}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="${unlocked ? 3 : 0}" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="${path}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${unlocked ? 2 : 1}"
      filter="url(#${glowId})" opacity="${unlocked ? 1 : 0.4}"/>
    ${unlocked ? `<path d="${path}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1" transform="translate(1,1)"/>` : ''}
  </svg>`;
}

function renderRewards() {
  document.getElementById('reward-grid').innerHTML = REWARD_DEFS.map(r => {
    const unlocked = rewards.includes(r.id);
    return `<div class="reward ${unlocked ? '' : 'locked'}" id="rw-${r.id}" title="${r.name}">
      <div class="reward-polygon">
        ${badgeSVG(r.id, unlocked)}
        <div class="reward-icon-inner">${r.icon}</div>
      </div>
      <div class="name">${r.name}</div>
    </div>`;
  }).join('');
}
renderRewards();

function grantReward(id) {
  if (rewards.includes(id)) return;
  rewards.push(id);
  localStorage.setItem('ca_rewards', JSON.stringify(rewards));
  const el = document.getElementById('rw-' + id);
  if (el) {
    el.classList.remove('locked');
    const svgWrap = el.querySelector('.reward-polygon');
    if (svgWrap) svgWrap.innerHTML = badgeSVG(id, true) + `<div class="reward-icon-inner">${REWARD_DEFS.find(r=>r.id===id)?.icon||''}</div>`;
  }
  const def = REWARD_DEFS.find(r => r.id === id);
  if (def) showToast('Reward unlocked: ' + def.icon + ' ' + def.name);
}

function checkRewards() {
  grantReward('seedling');
  if (rewards.filter(r => r !== 'seedling').length >= 1) grantReward('sprout');
  if (rewardStreak >= 1800) grantReward('tree');
  if (goodSecs >= 3600) grantReward('diamond');
  if (rewards.length >= 5) grantReward('trophy');
  if (rewards.length >= 10) grantReward('crown');
}

// ─── Toast ─────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.style.opacity = '0', 3000);
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function fmtSec(s) {
  s = Math.round(s);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fmtMs(ms) { return fmtSec(ms / 1000); }

function addLog(msg) {
  const el = document.getElementById('log');
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.innerHTML = `<span style="color:#bbb">${ts}</span> ${msg}<br>` + el.innerHTML;
}

// ─── Spotify Auth ──────────────────────────────────────────────────────────
async function doAuth() {
  const cid = document.getElementById('cid').value.trim();
  if (!cid) { alert('Paste your Client ID first.'); return; }
  localStorage.setItem('ca_cid', cid);

  const verifier = generateVerifier(128);
  const challenge = await generateChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const scope = 'user-modify-playback-state user-read-playback-state user-library-modify';
  location.href = `https://accounts.spotify.com/authorize?client_id=${encodeURIComponent(cid)}&response_type=code&redirect_uri=${encodeURIComponent(REDIR)}&scope=${encodeURIComponent(scope)}&code_challenge_method=S256&code_challenge=${challenge}`;
}

function generateVerifier(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(arr).map(b => chars[b % chars.length]).join('');
}

async function generateChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function parseToken() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return false;

  const verifier = sessionStorage.getItem('pkce_verifier');
  const cid = localStorage.getItem('ca_cid');

  history.replaceState(null, '', location.pathname);

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIR,
      client_id: cid,
      code_verifier: verifier,
    }),
  });

  const data = await res.json();
  if (data.access_token) {
    token = data.access_token;
    tokenExp = Date.now() + (data.expires_in - 60) * 1000;
    if (data.refresh_token) {
      localStorage.setItem('ca_refresh_token', data.refresh_token);
    }
    setSpotifyUI('green', 'Connected');
    document.getElementById('sp-details').open = false;
    addLog('Spotify connected');
    pollSpotify();
    return true;
  } else {
    alert('Auth failed: ' + JSON.stringify(data));
    return false;
  }
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('ca_refresh_token');
  const cid = localStorage.getItem('ca_cid');
  if (!refreshToken || !cid) return false;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cid,
    }),
  });

  const data = await res.json();
  if (data.access_token) {
    token = data.access_token;
    tokenExp = Date.now() + (data.expires_in - 60) * 1000;
    if (data.refresh_token) {
      localStorage.setItem('ca_refresh_token', data.refresh_token);
    }
    setSpotifyUI('green', 'Connected');
    addLog('Spotify token refreshed');
    pollSpotify();
    return true;
  }
  return false;
}

function setSpotifyUI(dotClass, statusText) {
  const dot = document.getElementById('sp-dot');
  dot.className = 'dot ' + dotClass;
  document.getElementById('sp-status').textContent = statusText;
}

// ─── Spotify API ───────────────────────────────────────────────────────────
async function sp(method, path, body) {
  if (!token || Date.now() > tokenExp) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      setSpotifyUI('amber', 'Token expired — re-authorize');
      return null;
    }
  }
  try {
    const res = await fetch('https://api.spotify.com/v1' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return true;
    if (res.status === 200 || res.status === 201) return res.json();
    return null;
  } catch (e) {
    console.warn('Spotify API error', e);
    return null;
  }
}

// ─── Spotify Controls ──────────────────────────────────────────────────────
async function syncDevice() {
  const d = await sp('GET', '/me/player/devices');
  if (!d || !d.devices) return;
  // prefer desktop app over web player
  const desktop = d.devices.find(dev => dev.type === 'Computer' && dev.name !== 'Web Player');
  const active = d.devices.find(dev => dev.is_active);
  cachedDeviceId = (desktop || active || d.devices[0])?.id || null;
}

async function togglePlay() {
  const path = isPlaying ? '/me/player/pause' : '/me/player/play';
  const url = cachedDeviceId ? `${path}?device_id=${cachedDeviceId}` : path;
  // optimistically update UI immediately
  isPlaying = !isPlaying;
  document.getElementById('btn-pp').textContent = isPlaying ? '⏸' : '▶';
  await sp('PUT', url);
  setTimeout(pollSpotify, 500);
}

async function spCmd(cmd) {
  const url = cachedDeviceId
    ? `/me/player/${cmd}?device_id=${cachedDeviceId}`
    : `/me/player/${cmd}`;
  await sp('POST', url);
  setTimeout(pollSpotify, 600);
}

async function setVol(v) {
  document.getElementById('vol-v').textContent = v;
  const url = cachedDeviceId
    ? `/me/player/volume?volume_percent=${v}&device_id=${cachedDeviceId}`
    : `/me/player/volume?volume_percent=${v}`;
  await sp('PUT', url);
}

async function seekPct(pct) {
  if (!trackDur) return;
  const ms = Math.round(pct / 100 * trackDur);
  document.getElementById('seek-v').textContent = fmtMs(ms);
  const url = cachedDeviceId
    ? `/me/player/seek?position_ms=${ms}&device_id=${cachedDeviceId}`
    : `/me/player/seek?position_ms=${ms}`;
  await sp('PUT', url);
}

async function toggleShuffle() {
  shuffleOn = !shuffleOn;
  document.getElementById('btn-shuffle').classList.toggle('active', shuffleOn);
  await sp('PUT', '/me/player/shuffle?state=' + shuffleOn);
}

function cycleRepeat() {
  const modes = ['off', 'context', 'track'];
  const labels = { off: '↻ Off', context: '↻ All', track: '↻ One' };
  repeatMode = modes[(modes.indexOf(repeatMode) + 1) % 3];
  document.getElementById('btn-repeat').textContent = labels[repeatMode];
  document.getElementById('btn-repeat').classList.toggle('active', repeatMode !== 'off');
  sp('PUT', '/me/player/repeat?state=' + repeatMode);
}

async function likeTrack() {
  const d = await sp('GET', '/me/player/currently-playing');
  if (d && d.item) {
    await sp('PUT', '/me/tracks?ids=' + d.item.id);
    showToast('Saved to liked songs');
  }
}

async function pollSpotify() {
  if (!token) return;
  const d = await sp('GET', '/me/player/currently-playing');
  if (d && d.item) {
    const trackEl = document.getElementById('now-playing');
    const artistEl = document.getElementById('now-artist');
    if (trackEl) { trackEl.textContent = d.item.name; trackEl.classList.remove('placeholder'); }
    if (artistEl) artistEl.textContent = d.item.artists.map(a => a.name).join(', ');
    isPlaying = d.is_playing;
    document.getElementById('btn-pp').textContent = isPlaying ? '⏸' : '▶';
    trackDur = d.item.duration_ms;
    const pos = d.progress_ms || 0;
    const pct = Math.round(pos / trackDur * 100);
    document.getElementById('seek').value = pct;
    document.getElementById('seek-v').textContent = fmtMs(pos);
    document.getElementById('sp-prog').style.width = pct + '%';

    // Album art + CD
    const art = document.getElementById('album-art');
    const cd = document.getElementById('album-cd');
    if (art && d.item.album && d.item.album.images && d.item.album.images.length) {
      const imgUrl = d.item.album.images[0].url;
      art.style.backgroundImage = `url(${imgUrl})`;
      art.style.backgroundSize = 'cover';
      art.style.backgroundPosition = 'center';
      if (cd) { cd.style.backgroundImage = `url(${imgUrl})`; cd.style.backgroundSize = 'cover'; }
    }
    if (cd) cd.classList.toggle('spinning', d.is_playing);
  } else {
    const trackEl = document.getElementById('now-playing');
    if (trackEl) { trackEl.textContent = '— No track loaded —'; trackEl.classList.add('placeholder'); }
    const cd = document.getElementById('album-cd');
    if (cd) cd.classList.remove('spinning');
  }
  await syncDevice();
  setTimeout(pollSpotify, 4000);
}

// ─── Audio / Scratch Engine ────────────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.connect(audioCtx.destination);
  buildVinylBuffer();
  runVisualizer();
}

function buildVinylBuffer() {
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.12;
    if (Math.random() < 0.0004) data[i] *= 7;
  }
  vinylBuf = buf;
}

function startScratch(badness) {
  stopScratch();
  const intensity = Math.min(10, Math.max(1, badness * (scratchLvl / 5)));
  const now = audioCtx.currentTime;

  scratchOsc = audioCtx.createOscillator();
  scratchOsc.type = 'sawtooth';
  scratchOsc.frequency.value = 80 + intensity * 20;

  scratchLfo = audioCtx.createOscillator();
  scratchLfo.type = 'sine';
  scratchLfo.frequency.value = 4 + intensity * 2;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 20 + intensity * 15;
  scratchLfo.connect(lfoGain);
  lfoGain.connect(scratchOsc.frequency);

  const distortion = audioCtx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = ((Math.PI + 200 * intensity) * x) / (Math.PI + 200 * intensity * Math.abs(x));
  }
  distortion.curve = curve;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800 + intensity * 200;
  filter.Q.value = 3;

  scratchGain = audioCtx.createGain();
  scratchGain.gain.setValueAtTime(0, now);
  scratchGain.gain.linearRampToValueAtTime(3.0 * (intensity / 10), now + 0.1);

  scratchOsc.connect(distortion);
  distortion.connect(filter);
  filter.connect(scratchGain);
  scratchGain.connect(analyser);

  if (vinylBuf) {
    vinylSrc = audioCtx.createBufferSource();
    vinylSrc.buffer = vinylBuf;
    vinylSrc.loop = true;
    const vinylGain = audioCtx.createGain();
    vinylGain.gain.value = 2 * (intensity / 10);
    vinylSrc.connect(vinylGain);
    vinylGain.connect(analyser);
    vinylSrc.start();
  }

  scratchOsc.start();
  scratchLfo.start();

  const stutterMs = Math.max(400, 2000 - intensity * 150);
  let step = 0;
  scratchInt = setInterval(async () => {
    step++;
    if (step % 2 === 0) {
      await sp('PUT', cachedDeviceId
        ? `/me/player/pause?device_id=${cachedDeviceId}`
        : '/me/player/pause');
      setTimeout(() => sp('PUT', cachedDeviceId
        ? `/me/player/play?device_id=${cachedDeviceId}`
        : '/me/player/play'), stutterMs * 0.55);
    }
  }, stutterMs);

  const pct = Math.round(intensity * 10);
  document.getElementById('int-fill').style.width = pct + '%';
  document.getElementById('int-pct').textContent = pct + '%';
}

function stopScratch() {
  [scratchOsc, scratchLfo, vinylSrc].forEach(n => { try { n && n.stop(); } catch (_) {} });
  scratchOsc = scratchLfo = vinylSrc = null;
  if (scratchInt) { clearInterval(scratchInt); scratchInt = null; }
  document.getElementById('int-fill').style.width = '0%';
  document.getElementById('int-pct').textContent = '0%';
  if (token) sp('PUT', cachedDeviceId
    ? `/me/player/play?device_id=${cachedDeviceId}`
    : '/me/player/play');
}

// ─── Visualizer ────────────────────────────────────────────────────────────
function runVisualizer() {
  const wc = document.getElementById('waveform');
  const sc = document.getElementById('spectrum');
  const wCtx = wc.getContext('2d');
  const sCtx = sc.getContext('2d');

  function resize() {
    wc.width = wc.clientWidth; wc.height = wc.clientHeight;
    sc.width = sc.clientWidth; sc.height = sc.clientHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const timeBuf = new Uint8Array(analyser.frequencyBinCount);
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);

  function frame() {
    requestAnimationFrame(frame);
    analyser.getByteTimeDomainData(timeBuf);
    analyser.getByteFrequencyData(freqBuf);

    const color = isBad ? '#e74c3c' : '#1DB954';
    const W = wc.width, H = wc.height;

    wCtx.clearRect(0, 0, W, H);
    wCtx.strokeStyle = color;
    wCtx.lineWidth = 1.5;
    wCtx.beginPath();
    for (let i = 0; i < timeBuf.length; i++) {
      const x = i / timeBuf.length * W;
      const y = (timeBuf[i] / 128 - 1) * (H / 2) + H / 2;
      i === 0 ? wCtx.moveTo(x, y) : wCtx.lineTo(x, y);
    }
    wCtx.stroke();

    const SW = sc.width, SH = sc.height;
    sCtx.clearRect(0, 0, SW, SH);
    const bw = SW / freqBuf.length;
    for (let i = 0; i < freqBuf.length; i++) {
      const h = freqBuf[i] / 255 * SH;
      sCtx.fillStyle = color;
      sCtx.fillRect(i * bw, SH - h, Math.max(1, bw - 1), h);
    }
  }
  frame();
}

// ─── Camera / Pose ─────────────────────────────────────────────────────────
async function startCam() {
  document.getElementById('btn-start').disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 360 }
    });
    const video = document.getElementById('video');
    video.srcObject = stream;
    await video.play();

    poseMesh = new Pose({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${f}`
    });
    poseMesh.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    poseMesh.onResults(onResults);

    mpCam = new Camera(video, {
      onFrame: async () => { try { await poseMesh.send({ image: video }); } catch (_) {} },
      width: 640,
      height: 360,
    });
    mpCam.start();

    initAudio();
    initHistoryChart();

    document.getElementById('btn-cal').disabled = false;
    document.getElementById('btn-stop').disabled = false;
    document.getElementById('btn-start').disabled = false;

    sessionStart = Date.now();
    goodSecs = 0; totalSecs = 0; rewardStreak = 0;
    sessionTimer = setInterval(tickSession, 1000);
    addLog('Camera started — click Calibrate while sitting upright');
  } catch (e) {
    document.getElementById('btn-start').disabled = false;
    alert('Camera error: ' + e.message);
  }
}

function stopCam() {
  if (mpCam) mpCam.stop();
  const v = document.getElementById('video');
  if (v.srcObject) v.srcObject.getTracks().forEach(t => t.stop());
  clearInterval(sessionTimer);
  clearBad();
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-cal').disabled = true;
  document.getElementById('btn-stop').disabled = true;
  addLog('Camera stopped');
}

function calibrate() {
  calibBase = null;
  showToast('Hold your best posture...');
  setTimeout(() => showToast('Baseline set! Coachellaign is watching.'), 2200);
  addLog('Calibrated posture baseline');
}

// ─── Session timer ─────────────────────────────────────────────────────────
function tickSession() {
  totalSecs++;
  const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
  document.getElementById('m-time').textContent = fmtSec(elapsed);

  if (!isBad) { goodSecs++; rewardStreak++; } else { rewardStreak = 0; }

  document.getElementById('m-good').textContent =
    Math.round(goodSecs / Math.max(1, totalSecs) * 100) + '%';

  const pct = Math.min(100, Math.round(rewardStreak / 600 * 100));
  document.getElementById('streak-fill').style.width = pct + '%';
  document.getElementById('streak-lbl').textContent = fmtSec(rewardStreak) + ' / 10:00';

  if (rewardStreak === 600) checkRewards();

  if (totalSecs % 15 === 0 && histChart) {
    const score = parseInt(document.getElementById('m-score').textContent) || 50;
    histChart.data.labels.push(fmtSec(elapsed));
    histChart.data.datasets[0].data.push(score);
    if (histChart.data.labels.length > 40) {
      histChart.data.labels.shift();
      histChart.data.datasets[0].data.shift();
    }
    histChart.update();
  }
}

// ─── Pose detection ────────────────────────────────────────────────────────
function onResults(results) {
  const cv = document.getElementById('canvas');
  const ctx = cv.getContext('2d');
  cv.width = results.image.width;
  cv.height = results.image.height;
  ctx.clearRect(0, 0, cv.width, cv.height);

  if (!results.poseLandmarks) return;
  const lm = results.poseLandmarks;
  const ls = lm[11], rs = lm[12], nose = lm[0];
  if (!ls || !rs || !nose) return;

  const shoulderMidY = (ls.y + rs.y) / 2;
  const noseDrop = nose.y - shoulderMidY;
  const slant = Math.abs(ls.y - rs.y);

  if (calibBase === null) calibBase = noseDrop;

  const drift = noseDrop - calibBase;
  const threshold = 0.025 + (10 - sens) * 0.006;
  const slantThresh = 0.04;
  const badness = Math.max(0, drift / threshold * 0.7 + slant / slantThresh * 0.3);
  const bad = badness > 1;

  const score = Math.max(0, Math.min(100, Math.round(100 - badness * 60)));
  const scoreEl = document.getElementById('m-score');
  if (scoreEl) {
    scoreEl.textContent = score;
    scoreEl.style.color = score > 70 ? '#22c55e' : score > 40 ? '#f59e0b' : '#ef4444';
  }
  const camBadge = document.getElementById('cam-score-badge');
  if (camBadge) {
    camBadge.textContent = score;
    if (score > 70) { camBadge.style.color='#22c55e'; camBadge.style.background='rgba(34,197,94,0.15)'; camBadge.style.borderColor='rgba(34,197,94,0.3)'; }
    else if (score > 40) { camBadge.style.color='#f59e0b'; camBadge.style.background='rgba(245,158,11,0.15)'; camBadge.style.borderColor='rgba(245,158,11,0.3)'; }
    else { camBadge.style.color='#ef4444'; camBadge.style.background='rgba(239,68,68,0.15)'; camBadge.style.borderColor='rgba(239,68,68,0.3)'; }
  }
  const needle = document.getElementById('dial-needle');
  if (needle) { const a = -90 + (score/100)*180; needle.setAttribute('transform', `rotate(${a} 60 60)`); }
  const arc = document.getElementById('dial-arc');
  if (arc) arc.style.strokeDashoffset = 157 - (score/100)*157;
  const dt = document.getElementById('dial-score-text');
  if (dt) dt.textContent = score;
  const csNagged = document.getElementById('cs-nagged');
  if (csNagged) csNagged.textContent = nagCount;
  const csGood = document.getElementById('cs-good');
  if (csGood) csGood.textContent = Math.round(goodSecs / Math.max(1, totalSecs) * 100) + '%';

  drawSkeleton(ctx, lm, cv.width, cv.height, bad);

  if (bad && !isBad) {
    if (!graceStart) graceStart = Date.now();
    if (Date.now() - graceStart > graceSec * 1000) triggerBad(badness);
  } else if (!bad) {
    graceStart = null;
    if (isBad) clearBad();
  } else if (bad && isBad) {
    startScratch(badness);
  }
}

function triggerBad(badness) {
  isBad = true;
  nagCount++;
  document.getElementById('m-nagged').textContent = nagCount;
  const [title, msg] = NAGS[nagCount % NAGS.length];
  document.getElementById('nag-title').textContent = title;
  document.getElementById('nag-msg').textContent = msg;
  document.getElementById('bad-overlay').style.display = 'flex';
  startScratch(badness);
  addLog('Scratch #' + nagCount + ': ' + title);
}

function clearBad() {
  isBad = false;
  graceStart = null;
  document.getElementById('bad-overlay').style.display = 'none';
  stopScratch();
  addLog('Good posture restored');
}

function drawSkeleton(ctx, lm, w, h, bad) {
  const color = bad ? '#e74c3c' : '#1DB954';
  const pairs = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]];
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  for (const [a, b] of pairs) {
    if (!lm[a] || !lm[b] || lm[a].visibility < 0.5 || lm[b].visibility < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const i of [11,12,13,14,15,16,23,24]) {
    if (!lm[i] || lm[i].visibility < 0.5) continue;
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Posture history chart ─────────────────────────────────────────────────
function initHistoryChart() {
  if (histChart) { histChart.destroy(); histChart = null; }
  histChart = new Chart(document.getElementById('posture-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Score',
        data: [],
        borderColor: '#1DB954',
        backgroundColor: 'rgba(29,185,84,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.3,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { size: 10 }, maxTicksLimit: 8, autoSkip: true }, grid: { display: false } },
        y: { min: 0, max: 100, ticks: { font: { size: 10 }, stepSize: 50 }, grid: { color: 'rgba(0,0,0,0.05)' } }
      }
    }
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────────
const savedCid = localStorage.getItem('ca_cid');
if (savedCid) document.getElementById('cid').value = savedCid;

(async () => {
  const didParse = await parseToken();
  if (!didParse) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) addLog('Connect Spotify to get started');
  }
})();