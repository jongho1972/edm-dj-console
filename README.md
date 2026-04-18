# EDM · DJ Console

Python으로 생성한 Reaper 프로젝트의 스템(트랙별 mp3)을 브라우저에서 독립 제어하는 웹 DJ 콘솔.

## 기능

- **곡 선택**: 카드 UI로 여러 곡 탐색
- **트랙별 컨트롤**: Mute / Solo / Volume, 실시간 VU 미터
- **마스터**: LPF · HPF · Tempo · Master Volume
- **Transport**: Play/Pause/Stop/Cue/Loop, Seek 바

## 곡 목록

- **001 · TECH HOUSE** — Ibiza Tech House (125 BPM · A minor · 10 stems)
- **002 · FUTURE HOUSE** — Future House (126 BPM · F minor · 12 stems)

## 기술 스택

- Vanilla HTML/CSS/JS
- Tone.js (Web Audio 기반 스템 동기 재생)
- 빌드 시스템 없음 (정적 사이트)

## 로컬 실행

```bash
python3 -m http.server 8080
# http://localhost:8080
```

`file://` 직접 열기는 CORS 에러 — 로컬 서버 필수.

## 스템 추가

1. `stems/<id>/` 폴더에 소문자 mp3 저장 (`kick.mp3`, `clap.mp3`, ...)
2. `songs.js`의 `SONGS` 배열에 항목 추가, `status: 'ready'`로 설정
