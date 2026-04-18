// EDM DJ Console — multi-song, Tone.js stem playback
const STEM_EXT = 'mp3';

let currentSong = null;
let players = {};
let stemGains = {};
let meters = {};
let masterLPF, masterHPF, masterGain;
let looping = false;
let seekDragging = false;
let meterRAF = null;
let controlsBound = false;

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
      } else {
        alert(`"${song.title}"의 스템이 아직 렌더링되지 않았습니다.\n\nReaper에서 해당 프로젝트 열고 렌더 후 web_dj/stems/${song.id}/ 폴더에 소문자 mp3로 저장해주세요.`);
      }
    });
    list.appendChild(card);
  });
}

function selectSong(song) {
  currentSong = song;
  document.getElementById('song-selector').classList.add('hidden');
  document.getElementById('start-section').classList.remove('hidden');
  document.getElementById('current-song-title').textContent = song.title;
  document.getElementById('current-song-meta').textContent =
    `${song.bpm} BPM · ${song.key} · ${fmtDur(song.duration)} · ${song.stems.length} stems`;
}

function backToSongList() {
  cleanupAudio();
  currentSong = null;
  document.getElementById('song-selector').classList.remove('hidden');
  ['start-section','transport','channels','master'].forEach((id) => {
    document.getElementById(id).classList.add('hidden');
  });
}

// ---------- Audio init ----------

function cleanupAudio() {
  try {
    Tone.Transport.stop();
    Tone.Transport.cancel();
  } catch (e) {}
  Object.values(players).forEach((p) => { try { p.dispose(); } catch (e) {} });
  Object.values(stemGains).forEach((g) => { try { g.dispose(); } catch (e) {} });
  Object.values(meters).forEach((m) => { try { m.dispose(); } catch (e) {} });
  if (masterLPF) { try { masterLPF.dispose(); } catch (e) {} }
  if (masterHPF) { try { masterHPF.dispose(); } catch (e) {} }
  if (masterGain) { try { masterGain.dispose(); } catch (e) {} }
  players = {}; stemGains = {}; meters = {};
  if (meterRAF) { cancelAnimationFrame(meterRAF); meterRAF = null; }
}

async function init() {
  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = true;
  startBtn.textContent = 'LOADING...';

  await Tone.start();
  cleanupAudio();

  masterGain = new Tone.Gain(1).toDestination();
  masterHPF = new Tone.Filter(20, 'highpass').connect(masterGain);
  masterLPF = new Tone.Filter(20000, 'lowpass').connect(masterHPF);

  renderChannels(currentSong.stems);

  const loadPromises = currentSong.stems.map((name) => {
    const gain = new Tone.Gain(1);
    const meter = new Tone.Meter({ smoothing: 0.6 });
    gain.connect(masterLPF);
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
    startBtn.disabled = false;
    startBtn.textContent = '❌ 로드 실패';
    alert(`stems/${currentSong.id}/ 폴더에 다음 파일이 필요합니다:\n${currentSong.stems.map(n => n + '.mp3').join(', ')}`);
    return;
  }

  // 기본 tempo 슬라이더를 이 곡의 BPM으로 초기화
  const tempoSlider = document.getElementById('tempo');
  tempoSlider.value = currentSong.bpm;
  document.getElementById('tempo-val').textContent = currentSong.bpm + ' BPM';
  Tone.Transport.bpm.value = currentSong.bpm;

  // 마스터 리셋
  document.getElementById('lpf').value = 20000; document.getElementById('lpf-val').textContent = '20000 Hz';
  document.getElementById('hpf').value = 20; document.getElementById('hpf-val').textContent = '20 Hz';
  document.getElementById('master-vol').value = 100; document.getElementById('master-vol-val').textContent = '100%';
  masterLPF.frequency.value = 20000;
  masterHPF.frequency.value = 20;
  masterGain.gain.value = 1;

  document.getElementById('start-section').classList.add('hidden');
  document.getElementById('transport').classList.remove('hidden');
  document.getElementById('channels').classList.remove('hidden');
  document.getElementById('master').classList.remove('hidden');
  document.getElementById('playing-title').textContent = currentSong.title;

  if (!controlsBound) {
    bindGlobalControls();
    controlsBound = true;
  }
  bindChannelControls();
  startMeterLoop();
  updateTimeDisplay();

  startBtn.disabled = false;
  startBtn.textContent = '🎧 LOAD & START';
}

// ---------- Channels dynamic rendering ----------

function renderChannels(stems) {
  const container = document.getElementById('channels');
  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${stems.length}, 1fr)`;
  stems.forEach((stem) => {
    const div = document.createElement('div');
    div.className = 'channel';
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
    muteBtn.addEventListener('click', () => {
      muteBtn.classList.toggle('active');
      applyMix();
    });
    soloBtn.addEventListener('click', () => {
      soloBtn.classList.toggle('active');
      applyMix();
    });
  });
}

// ---------- Global transport / master bindings (한 번만) ----------

function bindGlobalControls() {
  document.getElementById('play-btn').addEventListener('click', togglePlay);
  document.getElementById('stop-btn').addEventListener('click', stopTransport);
  document.getElementById('cue-btn').addEventListener('click', cueToStart);
  document.getElementById('loop-btn').addEventListener('click', toggleLoop);

  const seek = document.getElementById('seek');
  seek.addEventListener('input', () => { seekDragging = true; });
  seek.addEventListener('change', () => {
    const pct = +seek.value / 1000;
    Tone.Transport.seconds = pct * currentSong.duration;
    seekDragging = false;
    updateTimeDisplay();
  });

  const lpf = document.getElementById('lpf');
  const hpf = document.getElementById('hpf');
  const tempo = document.getElementById('tempo');
  const masterVol = document.getElementById('master-vol');

  lpf.addEventListener('input', () => {
    masterLPF.frequency.rampTo(+lpf.value, 0.02);
    document.getElementById('lpf-val').textContent = lpf.value + ' Hz';
  });
  hpf.addEventListener('input', () => {
    masterHPF.frequency.rampTo(+hpf.value, 0.02);
    document.getElementById('hpf-val').textContent = hpf.value + ' Hz';
  });
  tempo.addEventListener('input', () => {
    const bpm = +tempo.value;
    const rate = bpm / currentSong.bpm;
    Object.values(players).forEach((p) => { p.playbackRate = rate; });
    Tone.Transport.bpm.value = bpm;
    document.getElementById('tempo-val').textContent = bpm + ' BPM';
  });
  masterVol.addEventListener('input', () => {
    masterGain.gain.rampTo(+masterVol.value / 100, 0.05);
    document.getElementById('master-vol-val').textContent = masterVol.value + '%';
  });

  document.getElementById('change-song-btn').addEventListener('click', backToSongList);
  document.getElementById('back-btn').addEventListener('click', backToSongList);
}

// ---------- Transport actions ----------

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
  document.getElementById('play-btn').textContent = '▶';
  document.getElementById('play-btn').classList.remove('active');
  updateTimeDisplay();
}

function cueToStart() {
  Tone.Transport.seconds = 0;
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
    meterRAF = requestAnimationFrame(loop);
  }
  meterRAF = requestAnimationFrame(loop);
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

// ---------- Boot ----------

document.getElementById('start-btn').addEventListener('click', init);
renderSongList();
