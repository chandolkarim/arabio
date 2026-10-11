# 아라비오 (Arabio)

현재 메인 화면 디자인과 수정 위치는 [DESIGN.md](DESIGN.md)를 참고하세요. 나라별 사진 배경·단계형 학습 경로가 실제 `web/` 앱에 반영되어 있습니다.

한국인 아랍어 학습자가 하루 세 문장씩, 같은 문장을 푸스하와 방언(이집트·요르단)으로 익히는 웹 앱입니다.
처음 열면 바로 학습 메인으로 들어가며(기본 이집트), 메인 위쪽에서 이집트·요르단을 바꿀 수 있습니다. 메인은 나라 사진 배경과 단원별 곡선 학습 경로이고, 단원(7일)을 끝낼 때마다 별 도장을 얻습니다.

배포: https://chandolkarim.github.io/arabio/ (main에 push하면 GitHub Actions가 `web/`을 Pages로 배포)

## 실행

```bash
python3 build_data.py                              # sentences_300.csv → web/data/sentences.json
cd web && python3 -m http.server 8765              # http://localhost:8765 에서 열기
```

## 파일

| 파일 | 역할 |
|---|---|
| `sentences_300.csv` | 문장 원본. 대화 300개 · 15단원 · 100일, 빈칸·오답·보기 뜻 포함 |
| `build_data.py` | CSV를 앱용 JSON으로 바꾸고, `web/audio/`의 음성 파일을 연결 |
| `web/index.html` | 앱 화면 틀 |
| `web/app.js` | 화면과 학습 흐름(시작, 100일의 길, 레슨 5단계, 하루 완료, 복습, 기록, 설정) |
| `web/style.css` | 기본 레이아웃과 학습 애니메이션 |
| `web/world.css` | 메인 화면(나라 사진·학습 경로) 배치와 팔레트. `style.css`, `arabio.css` 다음에 읽힘 |
| `web/assets/landmarks/` | 메인 배경 사진(출처·라이선스는 앱 하단 ‘사진 출처’) |
| `web/arabio.css` | 아라비오 디자인 시스템: 크림색·헤나, 중앙 워드마크, 아랍어 타이포그래피, 단원 목록과 조작 모션 |
| `web/design_drafts.html` | 디자인 시안 페이지 |
| `web/audio/` | 대사별 음성. `{id}_{fusha\|egypt\|jordan}_{A\|B}.m4a` (MP3·WAV도 지원) |
| `make_review.py`, `make_professor_pdf.py` | 검수용 HTML, 교수님 검토용 PDF 생성 |

## 하루 학습 흐름 (12단계)

1. 푸스하 대화 → 암미야 표현 비교를 한 쌍씩 3회 반복합니다.
   - 대화 보기: 푸스하 A/B 대화와 한국어 뜻을 먼저 읽고, 각 발화를 들어봅니다.
   - 표현 비교: 핵심 표현 하나씩 푸스하와 선택 방언을 비교합니다. 전체 대화·설명·다른 방언은 펼쳐볼 수 있습니다.
2. 연습 × 3: 듣기 뜻 고르기와 방언 빈칸을 섞어서 풉니다.
3. 말하기 × 3: 한국어 A/B 대화에서 핵심 역할을 말하고, 정답 확인 후 자기 평가합니다.

오답 또는 ‘헷갈려요’는 다음 날 복습하고, 기억한 표현은 기존 간격 반복 일정에 반영합니다. 평가는 학습 완료 시 진도·경험치와 함께 저장합니다. 복습 모드는 방언 빈칸과 말하기만 진행합니다.

검증: `node tests/learning-flow.cjs`, `node tests/audio-routing.cjs`, `node tests/service-reliability.cjs`

음성 파일이 없으면 ‘음성 준비 중’으로 표시하며 브라우저 기계음으로 대체하지 않습니다.
듣기 문제의 음성이 없으면 읽기 문제로 진행합니다. 진도는 브라우저(localStorage)에 방언별로 저장됩니다.

## Sawtak 음성 제작

푸스하 **أيمن**, 이집트 **أشرف**, 요르단 **يزن**을 사용합니다. A/B 대사별로
생성하므로 전체 300개 대화는 1,800개 음성 파일입니다. 원문을 그대로 전달하고
`enhance_pronunciation`은 샘플과 동일하게 끕니다. 발음의 언어학적 검수는 별도입니다.

API 키는 웹 폴더 밖 `~/.config/arabio/sawtak.env`의 `SAWTAK_API_KEY`에 저장합니다.
키를 소스 코드·브라우저·공유 파일에 넣지 않습니다.
원본 WAV는 `samples/generation/wav/`에 보관하고, 웹에서는 `web/audio/`의 압축 M4A만 재생합니다.
설정에서 0.8·1·1.2배 음성 재생 속도를 선택할 수 있습니다.

음량은 `python3 scripts/normalize_audio.py`로 원본 WAV의 말소리 크기를 -20 dB에 맞춰 M4A를 다시 만듭니다(일부만: 파일 이름을 인자로). 처음 실행 시 기존 M4A는 `samples/audio-prenorm/`에 백업하고, 끝나면 `build_data.py`를 자동으로 돌려 음성 버전(해시)을 갱신합니다. 새로 만드는 음성(`package_audio.py`)과 교체 음성(`replace_audio.py`)도 같은 기준으로 맞춰 넣습니다. 무음·빈 파일은 건너뛰고 알려줍니다.

```bash
python3 scripts/generate_audio.py --limit 6  # 첫 대화의 세 변형 A/B
python3 scripts/generate_audio.py            # 전체 생성, 완료분 재사용
python3 scripts/package_audio.py             # macOS: AAC 압축 및 앱 연결
```

생성 기록과 요청 ID는 `samples/generation/`에 남습니다. 완료된 음성은 재사용하며,
수신 중 끊기거나 과금 여부가 불명확한 요청은 자동으로 재생성하지 않습니다.
재실행은 먼저 완료 상태와 받은 바이트 수를 대조해 복구를 시도합니다.
생성은 기존 크레딧 잔액이 예상 비용보다 적으면 시작하지 않습니다.
저장된 파일을 앱에서 재생할 때는 Sawtak API를 호출하지 않습니다.
