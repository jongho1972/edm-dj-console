// EDM DJ Console — multi-song, visualizer, crossfader, recording
const STEM_EXT = 'mp3';

// 드럼 계열 stem 이름 집합 (크로스페이더 분류용)
const DRUM_STEMS = new Set(['kick', 'clap', 'roll', 'chat', 'ohat', 'riser', 'impact', 'rcrash']);

let currentSong = null;
let currentSongIndex = -1;
let players = {};
let stemGains = {};
let meters = {};
let masterGain, masterLPF, masterHPF, drumBus, melodicBus, analyser;
let looping = false;
let seekDragging = false;
let meterRAF = null;
let controlsBound = false;
let endTriggered = false;

// Recording
let mediaRecorder = null;
let recChunks = [];
let recStartTime = 0;
let recTimerRAF = null;
let recDest = null;

// ---------- Song selector ----------

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

function renderSongList() {
  const list = document.getElementById('song-list');
  list.innerHTML = '';
  SONGS.forEach((song) => {
    const card = document.createElement('div');
    card.className = 'song-card ' + (song.status === 'ready' ? 'ready' : 'pending');
    card.innerHTML = `
      <div class="song-card-head">
        <div class="song-title">${song.title}</div>
        <div class="song-status">${song.status === 'ready' ? '✓ READY' : '⏳ 스템 대기'}</div>
      </div>
      <div class="song-subtitle">${song.subtitle}</div>
      <div class="song-stats">
        <span>${song.bpm} BPM</span>
        <span>${song.key}</span>
        <span>${fmtDur(song.duration)}</span>
        <span>${song.stems.length} stems</span>
      </div>
      <div class="song-stems">${song.stems.map(s => s.toUpperCase()).join(' · ')}</div>
    `;
    card.addEventListener('click', () => {
      if (song.status === 'ready') {
        selectSong(song);
        init();  // 카드 클릭 자체가 user gesture이므로 여기서 바로 Tone.start() 호출
      } else {
        alert(`"${song.title}"의 스템이 아직 렌더링되지 않았습니다.`);
      }
    });
    list.appendChild(card);
  });
}

function selectSong(song) {
  currentSong = song;
  currentSongIndex = SONGS.indexOf(song);
  document.getElementById('song-selector').classList.add('hidden');
  document.getElementById('start-section').classList.remove('hidden');
  document.getElementById('current-song-title').textContent = song.title;
  document.getElementById('current-song-meta').textContent =
    `${song.bpm} BPM · ${song.key} · ${fmtDur(song.duration)} · ${song.stems.length} stems`;
}

function backToSongList() {
  cleanupAudio();
  stopRecording(false);
  currentSong = null;
  document.getElementById('song-selector').classList.remove('hidden');
  ['start-section','transport','channels','master','visualizer','crossfader'].forEach((id) => {
    document.getElementById(id).classList.add('hidden');
  });
}

// ---------- Audio init ----------

function cleanupAudio() {
  try { Tone.Transport.stop(); Tone.Transport.cancel(); } catch (e) {}
  Object.values(players).forEach((p) => { try { p.dispose(); } catch (e) {} });
  Object.values(stemGains).forEach((g) => { try { g.dispose(); } catch (e) {} });
  Object.values(meters).forEach((m) => { try { m.dispose(); } catch (e) {} });
  [masterLPF, masterHPF, masterGain, drumBus, melodicBus, analyser].forEach((n) => {
    if (n) { try { n.dispose(); } catch (e) {} }
  });
  players = {}; stemGains = {}; meters = {};
  if (meterRAF) { cancelAnimationFrame(meterRAF); meterRAF = null; }
  endTriggered = false;
}

async function init() {
  const startBtn = document.getElementById('start-btn');
  startBtn.textContent = '🎧 LOADING...';

  await Tone.start();
  cleanupAudio();

  masterGain = new Tone.Gain(1).toDestination();
  masterHPF = new Tone.Filter(20, 'highpass').connect(masterGain);
  masterLPF = new Tone.Filter(20000, 'lowpass').connect(masterHPF);
  drumBus = new Tone.Gain(1).connect(masterLPF);
  melodicBus = new Tone.Gain(1).connect(masterLPF);
  analyser = new Tone.Analyser('fft', 128);
  masterGain.connect(analyser);

  // Recording destination 준비
  recDest = Tone.context.createMediaStreamDestination();
  masterGain.connect(recDest);

  renderChannels(currentSong.stems);

  const loadPromises = currentSong.stems.map((name) => {
    const gain = new Tone.Gain(1);
    const meter = new Tone.Meter({ smoothing: 0.6 });
    const bus = DRUM_STEMS.has(name) ? drumBus : melodicBus;
    gain.connect(bus);
    gain.connect(meter);
    stemGains[name] = gain;
    meters[name] = meter;

    return new Promise((resolve, reject) => {
      const player = new Tone.Player({
        url: `stems/${currentSong.id}/${name}.${STEM_EXT}`,
        loop: false,
        onload: () => resolve(),
        onerror: (e) => reject(e),
      }).connect(gain);
      player.sync().start(0);
      players[name] = player;
    });
  });

  try {
    await Promise.all(loadPromises);
  } catch (e) {
    console.error(e);
    startBtn.textContent = '❌ 로드 실패';
    alert(`stems/${currentSong.id}/ 폴더 mp3 로드 실패`);
    return;
  }

  const tempoSlider = document.getElementById('tempo');
  tempoSlider.value = currentSong.bpm;
  document.getElementById('tempo-val').textContent = currentSong.bpm + ' BPM';
  Tone.Transport.bpm.value = currentSong.bpm;

  document.getElementById('lpf').value = 20000; document.getElementById('lpf-val').textContent = '20000 Hz';
  document.getElementById('hpf').value = 20; document.getElementById('hpf-val').textContent = '20 Hz';
  document.getElementById('master-vol').value = 100; document.getElementById('master-vol-val').textContent = '100%';
  document.getElementById('xfader').value = 50;
  masterLPF.frequency.value = 20000;
  masterHPF.frequency.value = 20;
  masterGain.gain.value = 1;
  applyCrossfader();

  ['start-section'].forEach((id) => document.getElementById(id).classList.add('hidden'));
  ['transport','channels','master','visualizer','crossfader'].forEach((id) =>
    document.getElementById(id).classList.remove('hidden'));
  document.getElementById('playing-title').textContent = currentSong.title;

  if (!controlsBound) {
    bindGlobalControls();
    controlsBound = true;
  }
  bindChannelControls();
  startMeterLoop();
  startSpectrumLoop();
  updateTimeDisplay();

  startBtn.textContent = '🎧 LOADING...';
}

// ---------- Channels ----------

function renderChannels(stems) {
  const container = document.getElementById('channels');
  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${Math.min(stems.length, 12)}, 1fr)`;
  stems.forEach((stem) => {
    const div = document.createElement('div');
    div.className = 'channel ' + (DRUM_STEMS.has(stem) ? 'drum' : 'melodic');
    div.dataset.stem = stem;
    div.innerHTML = `
      <div class="label">${stem.toUpperCase()}</div>
      <div class="vu"><div class="vu-fill"></div></div>
      <input type="range" class="vol" min="0" max="150" value="100">
      <div class="vol-val">100%</div>
      <button class="mute">MUTE</button>
      <button class="solo">SOLO</button>
    `;
    container.appendChild(div);
  });
}

function bindChannelControls() {
  document.querySelectorAll('.channel').forEach((ch) => {
    const volSlider = ch.querySelector('.vol');
    const volVal = ch.querySelector('.vol-val');
    const muteBtn = ch.querySelector('.mute');
    const soloBtn = ch.querySelector('.solo');

    volSlider.addEventListener('input', () => {
      volVal.textContent = volSlider.value + '%';
      applyMix();
    });
    muteBtn.addEventListener('click', () => { muteBtn.classList.toggle('active'); applyMix(); });
    soloBtn.addEventListener('click', () => { soloBtn.classList.toggle('active'); applyMix(); });
  });
}

// ---------- Global bindings ----------

function bindGlobalControls() {
  document.getElementById('play-btn').addEventListener('click', togglePlay);
  document.getElementById('stop-btn').addEventListener('click', stopTransport);
  document.getElementById('cue-btn').addEventListener('click', cueToStart);
  document.getElementById('loop-btn').addEventListener('click', toggleLoop);
  document.getElementById('record-btn').addEventListener('click', toggleRecord);

  const seek = document.getElementById('seek');
  seek.addEventListener('input', () => { seekDragging = true; });
  seek.addEventListener('change', () => {
    const pct = +seek.value / 1000;
    Tone.Transport.seconds = pct * currentSong.duration;
    seekDragging = false;
    endTriggered = false;
    updateTimeDisplay();
  });

  document.getElementById('lpf').addEventListener('input', (e) => {
    masterLPF.frequency.rampTo(+e.target.value, 0.02);
    document.getElementById('lpf-val').textContent = e.target.value + ' Hz';
  });
  document.getElementById('hpf').addEventListener('input', (e) => {
    masterHPF.frequency.rampTo(+e.target.value, 0.02);
    document.getElementById('hpf-val').textContent = e.target.value + ' Hz';
  });
  document.getElementById('tempo').addEventListener('input', (e) => {
    const bpm = +e.target.value;
    const rate = bpm / currentSong.bpm;
    Object.values(players).forEach((p) => { p.playbackRate = rate; });
    Tone.Transport.bpm.value = bpm;
    document.getElementById('tempo-val').textContent = bpm + ' BPM';
  });
  document.getElementById('master-vol').addEventListener('input', (e) => {
    masterGain.gain.rampTo(+e.target.value / 100, 0.05);
    document.getElementById('master-vol-val').textContent = e.target.value + '%';
  });
  document.getElementById('xfader').addEventListener('input', applyCrossfader);
  document.getElementById('xfader-center').addEventListener('click', () => {
    document.getElementById('xfader').value = 50;
    applyCrossfader();
  });

  document.getElementById('change-song-btn').addEventListener('click', backToSongList);
  document.getElementById('back-btn').addEventListener('click', backToSongList);
}

// ---------- Transport ----------

function togglePlay() {
  const btn = document.getElementById('play-btn');
  if (Tone.Transport.state === 'started') {
    Tone.Transport.pause();
    btn.textContent = '▶';
    btn.classList.remove('active');
  } else {
    Tone.Transport.start();
    btn.textContent = '⏸';
    btn.classList.add('active');
  }
}

function stopTransport() {
  Tone.Transport.stop();
  Tone.Transport.seconds = 0;
  endTriggered = false;
  document.getElementById('play-btn').textContent = '▶';
  document.getElementById('play-btn').classList.remove('active');
  updateTimeDisplay();
}

function cueToStart() {
  Tone.Transport.seconds = 0;
  endTriggered = false;
  updateTimeDisplay();
}

function toggleLoop() {
  looping = !looping;
  const btn = document.getElementById('loop-btn');
  btn.classList.toggle('active', looping);
  Tone.Transport.loop = looping;
  if (looping) {
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = currentSong.duration;
  }
}

// ---------- Mix / Crossfader ----------

function applyMix() {
  const soloed = [...document.querySelectorAll('.channel')]
    .filter((ch) => ch.querySelector('.solo').classList.contains('active'))
    .map((ch) => ch.dataset.stem);

  document.querySelectorAll('.channel').forEach((ch) => {
    const stem = ch.dataset.stem;
    const vol = +ch.querySelector('.vol').value / 100;
    const muted = ch.querySelector('.mute').classList.contains('active');
    let target = soloed.length > 0
      ? (soloed.includes(stem) ? vol : 0)
      : (muted ? 0 : vol);
    if (stemGains[stem]) stemGains[stem].gain.rampTo(target, 0.05);
  });
}

function applyCrossfader() {
  // 0 = DRUMS only, 50 = 양쪽 -3dB, 100 = MELODIC only. Equal power curve.
  const p = +document.getElementById('xfader').value / 100;  // 0..1
  const drumsVol = Math.cos(p * Math.PI / 2);
  const melVol = Math.sin(p * Math.PI / 2);
  if (drumBus) drumBus.gain.rampTo(drumsVol, 0.05);
  if (melodicBus) melodicBus.gain.rampTo(melVol, 0.05);
}

// ---------- Visualizer ----------

function startSpectrumLoop() {
  const canvas = document.getElementById('spectrum');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  function draw() {
    const values = analyser.getValue();  // Float32Array of dB values
    ctx.fillStyle = 'rgba(10, 10, 18, 0.35)';
    ctx.fillRect(0, 0, W, H);

    const barCount = values.length;
    const barWidth = W / barCount;
    for (let i = 0; i < barCount; i++) {
      // dB → 0..1 normalization (values range roughly -100 to 0)
      const db = values[i];
      const norm = Math.max(0, Math.min(1, (db + 100) / 100));
      const h = norm * H;
      const hue = 170 - (i / barCount) * 60; // teal → green spectrum
      ctx.fillStyle = `hsl(${hue}, 80%, ${30 + norm * 40}%)`;
      ctx.fillRect(i * barWidth + 1, H - h, barWidth - 2, h);
    }
    meterRAF = requestAnimationFrame(draw);
  }
  draw();
}

// ---------- Meters + time display ----------

function startMeterLoop() {
  function loop() {
    Object.keys(meters).forEach((stem) => {
      const db = meters[stem].getValue();
      const pct = Math.max(0, Math.min(100, (db + 60) * 1.6));
      const fill = document.querySelector(`.channel[data-stem="${stem}"] .vu-fill`);
      if (fill) fill.style.height = pct + '%';
    });
    if (!seekDragging) updateTimeDisplay();
    checkAutoAdvance();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

function updateTimeDisplay() {
  if (!currentSong) return;
  const sec = Tone.Transport.seconds;
  const total = currentSong.duration;
  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  };
  document.getElementById('time').textContent = `${fmt(sec)} / ${fmt(total)}`;
  if (!seekDragging) {
    document.getElementById('seek').value = Math.floor((sec / total) * 1000);
  }
}

// ---------- Auto-advance playlist ----------

function checkAutoAdvance() {
  if (!currentSong || endTriggered) return;
  if (Tone.Transport.state !== 'started') return;
  if (Tone.Transport.seconds < currentSong.duration - 0.15) return;
  endTriggered = true;
  const autoplay = document.getElementById('autoplay').checked;
  if (!autoplay) { stopTransport(); return; }
  // 다음 READY 곡 찾기 (순환)
  for (let i = 1; i <= SONGS.length; i++) {
    const next = SONGS[(currentSongIndex + i) % SONGS.length];
    if (next.status === 'ready') {
      selectSong(next);
      init().then(() => {
        Tone.Transport.start();
        document.getElementById('play-btn').textContent = '⏸';
        document.getElementById('play-btn').classList.add('active');
      });
      return;
    }
  }
  stopTransport();
}

// ---------- Recording ----------

function toggleRecord() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording(true);
  } else {
    startRecording();
  }
}

function startRecording() {
  if (!recDest) return;
  recChunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  mediaRecorder = new MediaRecorder(recDest.stream, { mimeType: mime, bitsPerSecond: 192000 });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recChunks, { type: mime });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dj-mix-${currentSong?.id || 'mix'}-${ts}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  mediaRecorder.start(250);
  recStartTime = Date.now();
  const btn = document.getElementById('record-btn');
  btn.textContent = '⏹ STOP';
  btn.classList.add('active');
  document.getElementById('rec-time').classList.remove('hidden');
  updateRecTimer();
}

function updateRecTimer() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  const elapsed = (Date.now() - recStartTime) / 1000;
  const m = Math.floor(elapsed / 60);
  const s = Math.floor(elapsed % 60);
  document.getElementById('rec-time').textContent = `${m}:${String(s).padStart(2,'0')}`;
  recTimerRAF = requestAnimationFrame(updateRecTimer);
}

function stopRecording(save) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    if (!save) mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  if (recTimerRAF) { cancelAnimationFrame(recTimerRAF); recTimerRAF = null; }
  const btn = document.getElementById('record-btn');
  btn.textContent = '● REC';
  btn.classList.remove('active');
  document.getElementById('rec-time').classList.add('hidden');
}

// ---------- Boot ----------

renderSongList();

// 배포 일시 표시 (Netlify 빌드 시 deploy-time.txt 생성)
fetch('deploy-time.txt', { cache: 'no-store' })
  .then(r => r.ok ? r.text() : null)
  .then(t => {
    if (!t) return;
    const el = document.getElementById('deploy-time');
    if (el) el.textContent = '최종 배포: ' + t.trim();
  })
  .catch(() => {});
