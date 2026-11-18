// 말하기 AI 채점 Vercel 함수 · 학습자의 녹음을 오픈하사 Whisper로 받아쓰고, 정답 방언 문장과 단어별로 비교합니다.
//
//   주소    POST /api/check-speech   (multipart/form-data: audio=녹음 파일, id=문장 번호(예: 001), dialect=egypt|jordan|gulf)
//   AI      오픈하사 https://open.hasa.re.kr/v1/audio/transcriptions (OpenAI 호환), 모델 whisper-large-v3-turbo
//   인증키  Vercel 환경 변수 HASA_API_KEY (코드·저장소·로그·응답에는 적지 않습니다)
//
// 흐름: ① 방법·크기 확인 → ② 입력 검사(정답 문장은 서버가 data/sentences.json에서 직접 찾음) → ③ 키 확인
//       → ④ 받아쓰기 → ⑤ 정규화해서 단어별 비교(채점은 AI가 아니라 이 코드가 함) → ⑥ 돌려주기
//
// 개인정보: 녹음은 받아쓰기에만 쓰고 저장하지 않습니다. 로그에는 녹음 내용도 받아쓴 글도 남기지 않습니다.
import data from '../data/sentences.json' with { type: 'json' };

export const STT_URL = 'https://open.hasa.re.kr/v1/audio/transcriptions';
export const MODEL = 'whisper-large-v3-turbo';
export const MAX_BYTES = 1024 * 1024;   // 녹음 최대 1MB (앱은 15초에서 녹음을 멈춥니다. 15초 녹음은 보통 0.3MB 안쪽)
const TIMEOUT_MS = 20000;               // 받아쓰기를 기다리는 최대 시간
const DIALECTS = ['egypt', 'jordan', 'gulf'];
const SENTENCES = new Map(data.sentences.map((s) => [s.id, s]));

export default {
  async fetch(request) {
    // ① 방법·크기 확인
    if (request.method !== 'POST') return fail(405, 'METHOD', '이 주소는 POST 요청만 받습니다.');
    const length = Number(request.headers.get('content-length') || 0);
    if (length > MAX_BYTES + 64 * 1024) return fail(413, 'TOO_LARGE', '녹음이 너무 깁니다. 한 문장(15초 안)만 녹음해 주세요.');

    // ② 입력 검사: 잘못된 입력은 AI를 부르기 전에 400
    let form;
    try {
      form = await request.formData();
    } catch {
      return fail(400, 'BAD_FORM', '녹음 파일과 문장 정보를 함께 보내 주세요(multipart/form-data).');
    }
    const id = String(form.get('id') ?? '').trim();
    const dialect = String(form.get('dialect') ?? '').trim();
    const audio = form.get('audio');
    const sentence = SENTENCES.get(id);
    if (!/^\d{3}$/.test(id) || !sentence) return fail(400, 'BAD_ID', '문장 번호가 올바르지 않습니다. 예: 001');
    if (!DIALECTS.includes(dialect) || !sentence[dialect]) return fail(400, 'BAD_DIALECT', '방언은 egypt, jordan, gulf 중 하나로 보냅니다.');
    if (!audio || typeof audio === 'string' || !audio.size) return fail(400, 'NO_AUDIO', '녹음 파일이 없습니다. 먼저 녹음해 주세요.');
    if (audio.size > MAX_BYTES) return fail(413, 'TOO_LARGE', '녹음이 너무 깁니다. 한 문장(15초 안)만 녹음해 주세요.');
    const type = String(audio.type || '').toLowerCase();
    if (type && !type.startsWith('audio/') && !type.startsWith('video/webm')) {
      return fail(400, 'BAD_AUDIO', '음성 파일만 보낼 수 있습니다.');
    }
    // 말하기 단계에서 사용자가 말하는 쪽은 '핵심 표현'이 있는 역할(blankSide)입니다
    const side = sentence.blankSide === 'B' ? 'B' : 'A';
    const target = sentence[dialect][side];

    // ③ 키 확인
    const key = String(process.env.HASA_API_KEY ?? '').trim();
    if (!key) {
      console.error('[check-speech] 환경 변수 HASA_API_KEY가 없습니다.');
      return fail(500, 'NO_KEY', '서버에 AI(오픈하사) 키가 설정되지 않았습니다. 운영자 설정 문제입니다.', {
        hint: 'Vercel 프로젝트 Settings → Environment Variables에 HASA_API_KEY를 추가한 뒤 다시 배포합니다.',
      });
    }

    // ④ 받아쓰기
    const body = new FormData();
    body.append('file', audio, `speech.${extensionFor(type)}`);
    body.append('model', MODEL);
    body.append('language', 'ar');
    body.append('response_format', 'json');
    let res;
    try {
      res = await fetch(STT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        console.error(`[check-speech] ${TIMEOUT_MS / 1000}초 시간 초과 (${id}-${dialect})`);
        return fail(504, 'AI_TIMEOUT', `AI가 ${TIMEOUT_MS / 1000}초 안에 답하지 않았습니다. 잠시 뒤 다시 시도해 주세요.`);
      }
      console.error(`[check-speech] 오픈하사 연결 실패 ${error?.name ?? ''} (${id}-${dialect})`);
      return fail(502, 'AI_NETWORK', 'AI 서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    }
    if (!res.ok) {
      console.error(`[check-speech] 오픈하사 HTTP ${res.status} (${id}-${dialect})`); // 본문에는 받아쓴 글이 있을 수 있어 남기지 않습니다
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        return fail(429, 'AI_LIMIT', 'AI 사용 한도를 넘었습니다. 잠시 뒤 다시 시도해 주세요.', {
          hint: '개발키는 분당 10회, 하루 500건까지입니다(하루 한도는 자정에 초기화).',
        }, retryAfter ? { 'Retry-After': retryAfter } : {});
      }
      if (res.status === 401 || res.status === 403) {
        return fail(500, 'AI_KEY', 'AI 키가 거절되었습니다. 운영자 설정 문제입니다.', {
          hint: 'HASA_API_KEY 값이 오픈하사에서 발급한 개발키(sk-dev-…)와 같은지 확인하고 다시 배포합니다.',
        });
      }
      if (res.status === 400 || res.status === 415 || res.status === 422) {
        return fail(400, 'BAD_AUDIO', '녹음 파일을 읽지 못했습니다. 다시 녹음해 주세요.');
      }
      return fail(502, 'AI_HTTP', `AI 서버가 HTTP ${res.status} 오류로 답했습니다. 잠시 뒤 다시 시도해 주세요.`);
    }
    const result = await res.json().catch(() => null);
    const heard = typeof result?.text === 'string' ? result.text.trim() : '';
    if (!normalize(heard)) {
      return fail(422, 'NO_SPEECH', '목소리가 잘 들리지 않았어요. 조용한 곳에서 조금 더 크게 다시 녹음해 주세요.');
    }

    // ⑤~⑥ 채점해서 돌려주기
    const { score, words } = grade(target, heard);
    return Response.json({ id, dialect, side, score, words, heard, target, model: MODEL },
      { headers: { 'Cache-Control': 'no-store' } });
  },
};

// 아랍어 비교용 정규화: 모음 부호·타트윌 제거, 알리프 변형 통일, ى→ي, ة→ه, 문장부호·라틴 문자 제거
export function normalize(text) {
  return String(text ?? '')
    .replace(/[ً-ٰٟۖ-ۭـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^ء-ي٠-٩0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 정답 문장을 단어로 나눠, 받아쓴 단어와 순서를 지키며 짝을 맞춥니다(최장 공통 부분열).
// 긴 단어에서 철자가 한 글자 다른 것(받아쓰기 흔들림)만 맞은 것으로 봅니다.
export function grade(target, heard) {
  const display = String(target).split(/\s+/).filter(Boolean);
  const tokens = display.map((word) => normalize(word));
  const heardTokens = normalize(heard).split(' ').filter(Boolean);
  const scored = tokens.map((t, i) => ({ i, t })).filter(({ t }) => t);
  const n = scored.length;
  const m = heardTokens.length;
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--) {
    for (let b = m - 1; b >= 0; b--) {
      table[a][b] = similar(scored[a].t, heardTokens[b])
        ? table[a + 1][b + 1] + 1
        : Math.max(table[a + 1][b], table[a][b + 1]);
    }
  }
  const matched = new Set();
  for (let a = 0, b = 0; a < n && b < m;) {
    if (similar(scored[a].t, heardTokens[b]) && table[a][b] === table[a + 1][b + 1] + 1) { matched.add(scored[a].i); a++; b++; }
    else if (table[a + 1][b] >= table[a][b + 1]) a++;
    else b++;
  }
  const words = display.map((word, i) => ({ word, ok: tokens[i] ? matched.has(i) : null }));
  const score = n ? Math.round((matched.size / n) * 100) : 0;
  return { score, words };
}

export function similar(a, b) {
  if (a === b) return true;
  const longer = Math.max(a.length, b.length);
  // 한 글자 차이로 방언이 갈리는 경우가 많아(예: شفتك / شفتكش) 7글자 이상 긴 단어만 한 글자 흔들림을 봐줍니다
  return longer >= 7 && 1 - editDistance(a, b) / longer >= 0.85;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

function extensionFor(type) {
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  return 'm4a'; // Safari(audio/mp4) 등
}

// 오류 응답: 상태 코드와 한국어 안내를 JSON으로 보내고, 캐시에는 저장하지 않습니다
function fail(status, code, message, extra = {}, headers = {}) {
  return Response.json({ error: message, code, ...extra }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
