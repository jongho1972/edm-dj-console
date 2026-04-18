// 곡 목록 manifest. 새 곡 추가 시 아래 배열 **맨 앞에** 항목 추가하고
// stems/<id>/ 폴더에 소문자 mp3를 넣으면 됨. (최신 곡이 화면 왼쪽에 표시됨)
window.SONGS = [
  {
    id: '003',
    title: 'PSYTRANCE',
    subtitle: 'Full-On rolling 16th bass, deep pump, Em-C-G-D breakdown',
    bpm: 140,
    key: 'E minor',
    duration: 150.86,
    stems: ['kick', 'clap', 'roll', 'chat', 'ohat', 'riser', 'impact', 'vox', 'rcrash', 'bass', 'lead', 'pad'],
    status: 'ready',
  },
  {
    id: '002',
    title: 'FUTURE HOUSE',
    subtitle: 'bouncy bass, sidechain pumping, breakdown pad',
    bpm: 126,
    key: 'F minor',
    duration: 167.62,
    stems: ['kick', 'clap', 'roll', 'chat', 'ohat', 'riser', 'impact', 'vox', 'rcrash', 'bass', 'lead', 'pad'],
    status: 'ready',
  },
  {
    id: '001',
    title: 'TECH HOUSE',
    subtitle: 'Ibiza rolling bassline, call-response lead',
    bpm: 125,
    key: 'A minor',
    duration: 168.96,
    stems: ['kick', 'clap', 'roll', 'chat', 'ohat', 'riser', 'impact', 'rcrash', 'bass', 'lead'],
    status: 'ready',
  },
];
