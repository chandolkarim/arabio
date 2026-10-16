// 아라비오 — 웹 시제품
// 데이터: data/sentences.json (build_data.py가 sentences_300.csv로 만든다)
// 진도: 브라우저 localStorage에 방언별로 저장한다.

const STORE_KEY = "three-sentences-arabic-v1";
const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
const XP_PER_SENTENCE = 10;
// 하루 목표(경험치): 대화 1개 = 10 XP라서 30 XP는 하루치 학습(대화 3개) 한 번이다.
const DAILY_GOALS = [30, 60, 90];
// 음성 속도: 기본 1.0배(자연스러운 속도), 느리게 0.7·0.8배, 고급 학습자용 1.1·1.2배 (교수님 조언)
const RATES = [0.7, 0.8, 1, 1.1, 1.2];
const rateLabel = (r) => `${r.toFixed(1)}×`; // '외웠어요'를 누를 때마다 다음 복습까지 늘어나는 날 수
const DIALECTS = {
  egypt: { name: "이집트", ar: "مصر", en: "EGYPT", city: "카이로", lang: "ar-EG" },
  jordan: { name: "요르단", ar: "الأردن", en: "JORDAN", city: "암만", lang: "ar-JO" },
};
// 하트: 연습 문제에서 틀리면 1개 줄고, 3시간마다 1개씩 다시 생긴다. 틀린 문장을 연습하면 가득 찬다.
const MAX_HEARTS = 5;
const HEART_REFILL_MS = 3 * 60 * 60 * 1000;
const STAR = "M50 2 L62 26 L88 14 L76 40 L98 50 L76 60 L88 86 L62 74 L50 98 L38 74 L12 86 L24 60 L2 50 L24 40 L12 14 L38 26 Z";
const app = document.getElementById("app");
const tabbar = document.getElementById("tabbar");

let DATA = null;
let state = loadState();

// ---------- 저장 ----------

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORE_KEY)));
  } catch {
    return { dialect: null, progress: {} };
  }
}

function normalizeState(raw) {
  const value = { dialect: Object.keys(DIALECTS).includes(raw?.dialect) ? raw.dialect : null, progress: {}, audioRate: RATES.includes(raw?.audioRate) ? raw.audioRate : 1, sfx: raw?.sfx !== false };
  for (const d of Object.keys(DIALECTS)) {
    const p = raw?.progress?.[d];
    if (!p || typeof p !== "object") continue;
    const srs = {};
    for (const [id, entry] of Object.entries(p.srs || {})) {
      if (!/^\d{3}$/.test(id) || !entry || !/^\d{4}-\d{2}-\d{2}$/.test(entry.due)) continue;
      srs[id] = { box: Math.max(0, Math.min(4, Number.isInteger(entry.box) ? entry.box : 0)), due: entry.due,
        hard: Number.isInteger(entry.hard) && entry.hard >= 0 ? entry.hard : 0, last: entry.last === "외웠어요" ? "외웠어요" : "헷갈려요" };
    }
    value.progress[d] = {
      completedDays: [...new Set((Array.isArray(p.completedDays) ? p.completedDays : []).filter(day => Number.isInteger(day) && day >= 1 && day <= 100))].sort((a, b) => a - b),
      srs,
      history: Object.fromEntries(Object.entries(p.history || {}).filter(([date, count]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isInteger(count) && count >= 0)),
      xp: Number.isFinite(p.xp) && p.xp >= 0 ? Math.floor(p.xp) : 0,
    };
  }
  const count = Number.isInteger(raw?.hearts?.count) ? Math.max(0, Math.min(MAX_HEARTS, raw.hearts.count)) : MAX_HEARTS;
  const refillAt = Number.isFinite(raw?.hearts?.refillAt) ? raw.hearts.refillAt : null;
  value.dailyGoal = DAILY_GOALS.includes(raw?.dailyGoal) ? raw.dailyGoal : DAILY_GOALS[0];
  value.hearts = { count, refillAt: count < MAX_HEARTS ? refillAt ?? Date.now() + HEART_REFILL_MS : null };
  // 첫 방문 안내는 한 번만. 이미 학습 기록이 있는 사용자는 보지 않는다.
  value.introSeen = raw?.introSeen === true || Object.values(value.progress).some(p => p.completedDays.length > 0);
  return value;
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    const notice = document.getElementById("service-status");
    if (notice?.dataset?.kind === "storage") notice.hidden = true;
  } catch {
    notify("진도를 저장하지 못했어요. 이 창을 닫기 전에 브라우저 저장 공간을 확인해주세요.", "storage");
  }
}

function progress() {
  const d = state.dialect;
  if (!state.progress[d]) state.progress[d] = { completedDays: [], srs: {}, history: {}, xp: 0 };
  return state.progress[d];
}

// ---------- 하트 ----------

// 지난 시간만큼 하트를 채운 뒤 돌려준다. 방언과 상관없이 하나로 쓴다.
function hearts(now = Date.now()) {
  const h = state.hearts ||= { count: MAX_HEARTS, refillAt: null };
  while (h.count < MAX_HEARTS && h.refillAt && now >= h.refillAt) {
    h.count += 1;
    h.refillAt += HEART_REFILL_MS;
  }
  if (h.count >= MAX_HEARTS) h.refillAt = null;
  return h;
}

function loseHeart(now = Date.now()) {
  const h = hearts(now);
  if (h.count > 0) {
    h.count -= 1;
    h.refillAt ??= now + HEART_REFILL_MS;
    saveState();
  }
  return h.count;
}

function gainHearts(n = MAX_HEARTS) {
  const h = hearts();
  const before = h.count;
  h.count = Math.min(MAX_HEARTS, h.count + n);
  if (h.count >= MAX_HEARTS) h.refillAt = null;
  return h.count - before;
}

// 새 학습과 다시 학습만 하트를 쓴다. 복습과 하트 채우기 연습은 틀려도 줄지 않는다.
const costsHearts = (mode = lesson?.mode) => mode === "lesson" || mode === "again";

function waitText(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  return `${min >= 60 ? `${Math.floor(min / 60)}시간 ` : ""}${min % 60 ? `${min % 60}분` : ""}`.trim();
}

// ---------- 날짜 ----------

function today(offset = 0) {
  const t = new Date();
  t.setDate(t.getDate() + offset);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function streak() {
  const days = new Set(Object.keys(progress().history));
  let n = 0;
  let offset = days.has(today()) ? 0 : -1;
  while (days.has(today(offset))) {
    n += 1;
    offset -= 1;
  }
  return n;
}

// 오늘 얻은 경험치: 기록(history)의 날짜별 문장 수 × 10. 두 방언을 합친다.
function todayXp(date = today()) {
  return Object.values(state.progress).reduce((sum, p) => sum + (p.history?.[date] || 0) * XP_PER_SENTENCE, 0);
}

const dailyGoal = () => (DAILY_GOALS.includes(state.dailyGoal) ? state.dailyGoal : DAILY_GOALS[0]);

// 이번 주 월~일. 학습한 날은 done, 오늘은 today.
function weekDays() {
  const history = progress().history;
  const monday = -((new Date().getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => {
    const date = today(monday + i);
    return { label: "월화수목금토일"[i], done: Boolean(history[date]), today: monday + i === 0 };
  });
}

function goalRing(ratio, size = 44) {
  const r = 20, c = 2 * Math.PI * r;
  return `<svg class="goal-ring" viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><circle cx="24" cy="24" r="${r}"/><circle class="fill" cx="24" cy="24" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(1, ratio))}" transform="rotate(-90 24 24)"/></svg>`;
}

// ---------- 진도 계산 ----------

function nextDay() {
  const done = new Set(progress().completedDays);
  for (let day = 1; day <= 100; day += 1) if (!done.has(day)) return day;
  return 100;
}

function sentencesOfDay(day) {
  return DATA.sentences.filter((s) => s.day === day).sort((a, b) => a.order - b.order);
}

function unitOfDay(day) {
  return DATA.units.find((u) => day >= u.firstDay && day <= u.lastDay);
}

function unitDone(u) {
  const done = new Set(progress().completedDays);
  for (let d = u.firstDay; d <= u.lastDay; d += 1) if (!done.has(d)) return false;
  return true;
}

function dueReviews() {
  const srs = progress().srs;
  return DATA.sentences.filter((s) => srs[s.id] && srs[s.id].due <= today());
}

function rate(id, remembered, persist = true) {
  const srs = progress().srs;
  const prev = srs[id] || { box: -1, hard: 0 };
  const box = remembered ? Math.min(prev.box + 1, REVIEW_INTERVALS.length - 1) : 0;
  srs[id] = {
    box,
    due: today(remembered ? REVIEW_INTERVALS[box] : 1),
    hard: prev.hard + (remembered ? 0 : 1),
    last: remembered ? "외웠어요" : "헷갈려요",
  };
  if (persist) saveState();
}

// ---------- 도구 ----------

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const arNum = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]);
const ar = (html, extra = "") => `<p class="ar ${extra}" dir="rtl" lang="ar">${html}</p>`;

function withMark(text, word) {
  const i = word ? text.indexOf(word) : -1;
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(word)}</mark>${esc(text.slice(i + word.length))}`;
}

// ---------- 단어 눌러서 뜻 보기: DATA.words는 word_gloss.csv(발음 기호를 뺀 형태 → 뜻) ----------

const AR_WORD = /[\u0621-\u064a\u064b-\u065f\u0670\u0640]+/g;
const plainAr = (word) => word.replace(/[\u064b-\u065f\u0670\u0640]/g, "");

// 숙어(DATA.phrases, 최대 6단어)가 있으면 그 구를 한 덩어리로, 아니면 단어별로 누를 수 있게 감싼다.
function wordify(text) {
  const words = DATA?.words || {}, phrases = DATA?.phrases || {};
  const toks = [...text.matchAll(AR_WORD)].map(m => ({ s: m.index, e: m.index + m[0].length, w: m[0], k: plainAr(m[0]) }));
  let out = "", pos = 0;
  for (let i = 0; i < toks.length;) {
    let len = Math.min(6, toks.length - i);
    for (; len >= 2; len--) {
      const span = toks.slice(i, i + len);
      // 구 안에 쉼표·마침표가 끼면 다른 문장 성분이므로 묶지 않는다.
      if (span.slice(1).every((t, j) => /^\s+$/.test(text.slice(span[j].e, t.s))) && phrases[span.map(t => t.k).join(" ")]) break;
    }
    const t = toks[i];
    out += esc(text.slice(pos, t.s));
    if (len >= 2) {
      const end = toks[i + len - 1].e;
      out += `<span class="w p" role="button" tabindex="0" data-p="${esc(toks.slice(i, i + len).map(x => x.k).join(" "))}">${esc(text.slice(t.s, end))}</span>`;
      pos = end;
      i += len;
    } else {
      out += words[t.k] ? `<span class="w" role="button" tabindex="0" data-w="${t.k}">${esc(t.w)}</span>` : esc(t.w);
      pos = t.e;
      i += 1;
    }
  }
  return out + esc(text.slice(pos));
}

// wordify + 핵심 표현 강조. 빈칸·핵심 표현은 단어 경계로 맞춰져 있어 앞뒤를 따로 감싸도 단어가 잘리지 않는다.
function arText(text, mark = "") {
  const i = mark ? text.indexOf(mark) : -1;
  if (i < 0) return wordify(text);
  return `${wordify(text.slice(0, i))}<mark>${wordify(mark)}</mark>${wordify(text.slice(i + mark.length))}`;
}

let glossPop = null;

function hideGloss() {
  glossPop?.remove();
  glossPop = null;
  document.querySelectorAll(".w.on").forEach(w => w.classList.remove("on"));
}

function showGloss(el) {
  hideGloss();
  const pop = glossPop = document.createElement("div");
  pop.id = "wpop";
  pop.className = "wpop";
  pop.setAttribute("role", "status");
  const phrase = el.dataset.p;
  pop.innerHTML = phrase
    ? `<b lang="ar" dir="rtl">${esc(el.textContent)}</b><span class="mean">${esc(DATA.phrases[phrase])}</span>
       <span class="parts">${phrase.split(" ").filter(k => DATA.words?.[k]).map(k => `<span><bdi lang="ar" dir="rtl">${esc(k)}</bdi> ${esc(DATA.words[k])}</span>`).join("")}</span>`
    : `<b lang="ar" dir="rtl">${esc(el.textContent)}</b><span class="mean">${esc(DATA.words[el.dataset.w])}</span>`;
  document.body.appendChild(pop);
  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + r.width / 2 - pop.offsetWidth / 2), innerWidth - pop.offsetWidth - 8);
  const above = r.top - pop.offsetHeight - 10;
  pop.style.left = `${left + scrollX}px`;
  pop.style.top = `${(above > 8 ? above : r.bottom + 10) + scrollY}px`;
  el.classList.add("on");
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("click", (e) => {
    const w = e.target.closest?.(".w");
    if (w) w.classList.contains("on") ? hideGloss() : showGloss(w);
    else if (!e.target.closest?.("#wpop")) hideGloss();
  });
  document.addEventListener("keydown", (e) => {
    const w = e.target.closest?.(".w");
    if (w && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showGloss(w); }
    if (e.key === "Escape") hideGloss();
  });
}

// 아랍어 조각이 섞인 한국어 설명을 순서가 꼬이지 않게 감싼다.
function mixed(text) {
  return esc(text).replace(/[؀-ۿ]+(?:[ .…]+[؀-ۿ]+)*/g, (m) => `<bdi dir="rtl" lang="ar" class="ar-inline">${m}</bdi>`);
}

const ICON = {
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z"/></svg>`,
  check: `<svg class="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3.1 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.7 0 5.9 3.7 4.4 7.2C19.5 16.4 12 21 12 21Z"/></svg>`,
  flame: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.4 1 2.5 2.3 2.5 1.5 0 2.4-1.2 2.2-3 2.3 1.6 4 4.2 4 7a7 7 0 0 1-14 0c0-5 4.5-7.4 7-14Z"/></svg>`,
};

function sealSvg(id, got) {
  return `<svg viewBox="0 0 100 100">
    <defs><linearGradient id="sg${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${got ? "#f1d79a" : "#f3ece1"}"/><stop offset=".5" stop-color="${got ? "#c9a24e" : "#e2d7c7"}"/><stop offset="1" stop-color="${got ? "#9a7432" : "#cbbca6"}"/></linearGradient></defs>
    <path transform="translate(0 7)" fill="${got ? "#7d5d27" : "#b9a991"}" d="${STAR}"/>
    <path fill="url(#sg${id})" stroke="${got ? "#fff3cf" : "#fff"}" stroke-opacity=".7" stroke-width="1.2" d="${STAR}"/>
    <path fill="none" stroke="${got ? "#7d5d27" : "#c8baa4"}" stroke-opacity=".5" stroke-width="1" transform="translate(50 50) scale(.72) translate(-50 -50)" d="${STAR}"/></svg>`;
}

// ---------- 효과 ----------

function burst(el, n = 12) {
  if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const size = Math.min(r.width, 160);
  const rip = document.createElement("span");
  rip.className = "ripple";
  Object.assign(rip.style, { left: `${cx - size / 2}px`, top: `${cy - size / 2}px`, width: `${size}px`, height: `${size}px` });
  document.body.appendChild(rip);
  setTimeout(() => rip.remove(), 1000);
  for (let i = 0; i < n; i += 1) {
    const s = document.createElement("span");
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 40 + Math.random() * 50;
    s.className = "spark";
    s.style.left = `${cx}px`;
    s.style.top = `${cy}px`;
    s.style.setProperty("--x", `${Math.cos(a) * dist}px`);
    s.style.setProperty("--y", `${Math.sin(a) * dist}px`);
    s.style.animationDelay = `${Math.random() * 0.12}s`;
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }
}

// 정답·오답 효과음: 파일 없이 Web Audio로 짧게 합성한다. 설정에서 끌 수 있다.
let sfxCtx = null;

function sfx(good) {
  if (state.sfx === false) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    sfxCtx ||= new Ctx();
    sfxCtx.resume?.();
    // 정답: 위로 올라가는 두 음, 오답: 아래로 내려가는 낮은 두 음
    const notes = good ? [[784, 0], [1175, 0.09]] : [[330, 0], [247, 0.13]];
    for (const [freq, delay] of notes) {
      const osc = sfxCtx.createOscillator(), gain = sfxCtx.createGain();
      const start = sfxCtx.currentTime + delay;
      osc.type = good ? "sine" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.connect(gain).connect(sfxCtx.destination);
      osc.start(start);
      osc.stop(start + 0.34);
    }
  } catch { /* 소리를 못 내도 학습은 계속 */ }
}

// 등장 애니메이션이 끝나면 클래스를 떼서 다른 애니메이션과 겹치지 않게 한다
document.addEventListener("animationend", (e) => {
  if (e.animationName === "in" || e.animationName === "editorial-in") e.target.classList.remove("in", "w-in");
});

// ---------- 음성 ----------
// 지정한 목소리의 파일만 재생한다. 방언이 다른 브라우저 음성으로 대체하지 않는다.

let currentAudio = null;
let currentAudioFile = null;

function notify(message, kind = "audio") {
  let notice = document.getElementById("service-status");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "service-status";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = false;
  if (kind === "audio") setTimeout(() => { if (notice.dataset.kind === "audio" && notice.textContent === message) notice.hidden = true; }, 6000);
}

function resetAudioButtons() {
  (app.querySelectorAll?.("[data-play]") || []).forEach(button => {
    if (button.disabled) return;
    button.innerHTML = `${ICON.play}${esc(button.dataset.playLabel || "듣기")}`;
    button.setAttribute("aria-pressed", "false");
  });
  (app.querySelectorAll?.("[data-mine]") || []).forEach(button => {
    button.innerHTML = `${ICON.play}내 목소리`;
    button.setAttribute("aria-pressed", "false");
  });
  document.querySelectorAll?.(".sheet [data-play]").forEach(button => {
    button.innerHTML = `${ICON.play}${esc(button.dataset.playLabel || "듣기")}`;
    button.setAttribute("aria-pressed", "false");
  });
}

function stopAudio() {
  if (currentAudio) currentAudio.pause();
  currentAudio = null;
  currentAudioFile = null;
  resetAudioButtons();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

document.addEventListener("visibilitychange", () => { if (document.hidden) { stopAudio(); stopRecording(); } });

function speak(s, variant, side, button = null) {
  const file = s[variant].audio[side];
  if (button && file === currentAudioFile && currentAudio && !currentAudio.paused) {
    stopAudio();
    return;
  }
  stopAudio();
  if (file) {
    const notice = document.getElementById("service-status");
    if (notice?.dataset?.kind === "audio") notice.hidden = true;
    const revision = s[variant].audioRevision?.[side];
    const audio = new Audio(`audio/${file}${revision ? `?v=${encodeURIComponent(revision)}` : ""}`);
    currentAudio = audio;
    currentAudioFile = file;
    audio.playbackRate = state.audioRate || 1;
    if (button) {
      button.textContent = "재생 중 · 멈추기";
      button.setAttribute("aria-pressed", "true");
    }
    const failed = () => {
      if (currentAudio !== audio) return;
      stopAudio();
      notify("음성을 재생하지 못했어요. 연결을 확인하고 듣기를 다시 눌러주세요.");
    };
    audio.addEventListener("error", failed, { once: true });
    audio.addEventListener("ended", () => { if (currentAudio === audio) stopAudio(); }, { once: true });
    audio.play().catch(failed);
    return;
  }
}

// ---------- 내 목소리 녹음: 말하기 단계에서 원어민 음성과 비교. 녹음은 이 기기 메모리에만 있고 어디에도 보내지 않는다. ----------

const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
let recorder = null;

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
}

async function toggleRecording(id, onChange) {
  if (recorder?.state === "recording") { recorder.stop(); return; }
  stopAudio();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    notify("마이크를 쓸 수 없어요. 브라우저 설정에서 마이크 권한을 허용해 주세요.");
    return;
  }
  const chunks = [];
  const rec = new MediaRecorder(stream);
  recorder = rec;
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(track => track.stop());
    if (recorder === rec) recorder = null;
    if (chunks.length && lesson) {
      if (lesson.recordings[id]) URL.revokeObjectURL(lesson.recordings[id]);
      lesson.recordings[id] = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || chunks[0].type }));
    }
    onChange();
  };
  rec.start();
  onChange();
  setTimeout(() => { if (rec.state === "recording") rec.stop(); }, 15000); // 한 문장 기준 최대 15초
}

function playMine(url, button) {
  if (url === currentAudioFile && currentAudio && !currentAudio.paused) { stopAudio(); return; }
  stopAudio();
  const audio = new Audio(url);
  currentAudio = audio;
  currentAudioFile = url;
  button.textContent = "재생 중 · 멈추기";
  button.setAttribute("aria-pressed", "true");
  audio.addEventListener("ended", () => { if (currentAudio === audio) stopAudio(); }, { once: true });
  audio.play().catch(() => { if (currentAudio === audio) { stopAudio(); notify("녹음을 재생하지 못했어요. 다시 녹음해 주세요."); } });
}

function forgetRecordings() {
  stopRecording();
  Object.values(lesson?.recordings || {}).forEach(url => URL.revokeObjectURL(url));
}

const playBtn = (variant, side, label = "듣기") => `<button class="play" data-play data-play-label="${esc(label)}" data-variant="${variant}" data-side="${side}" aria-pressed="false">${ICON.play}${label}</button>`;

function bindPlay(s, root = app) {
  root.querySelectorAll("[data-play]").forEach((b) => {
    const { variant, side } = b.dataset;
    if (!s[variant].audio[side]) {
      b.disabled = true;
      b.textContent = "음성 준비 중";
      return;
    }
    b.title = ({ fusha: "아이만 · 푸스하", egypt: "아슈라프 · 이집트", jordan: "야잔 · 요르단" })[variant];
    b.setAttribute("aria-label", `${b.title} · ${side} · ${b.dataset.playLabel || "듣기"}`);
    b.onclick = () => speak(s, variant, side, b);
  });
}

// ---------- 화면 공통 ----------

function show(html, { tabs = true, tab = null } = {}) {
  stopAudio();
  stopRecording();
  hideGloss();
  // Country colours (world.css) follow the chosen dialect on every screen, lessons included.
  document.documentElement.dataset.country = DIALECTS[state.dialect] ? state.dialect : "egypt";
  document.querySelector(".sheet")?.remove();
  app.getAnimations().forEach(animation => animation.cancel());
  app.innerHTML = html;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    app.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  app.dataset.screen = tab || "lesson";
  tabbar.hidden = !tabs;
  tabbar.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.go === tab);
    if (b.dataset.go === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const selectedTab = [...tabbar.querySelectorAll("button")].findIndex(button => button.dataset.go === tab);
  tabbar.style.setProperty("--tab-index", Math.max(0, selectedTab));
  window.scrollTo(0, 0);
}

tabbar.addEventListener("click", (e) => {
  const go = e.target.closest("button")?.dataset.go;
  if (go) SCREENS[go]();
});

// ---------- 고양이 선생님: 꾸꾸(푸스하, 점잖은 말투)와 아꿍(암미야, 친근한 말투) ----------

const TEACHERS = {
  fusha: { name: "꾸꾸", role: "푸스하 선생님", img: "kkuku",
    praise: ["훌륭해요!", "정확해요. 잘 들었네요.", "아주 좋아요."],
    sad: ["괜찮아요, 같이 다시 볼까요?", "아깝네요. 정답을 확인해 봐요."],
    recover: ["이번엔 정확해요. 금방 익혔네요.", "좋아요, 바로 고쳐 냈어요."],
    combo: ["{n}연속 정답이에요. 집중력이 대단해요.", "흐름이 아주 좋아요. {n}개 연속이에요."] },
  ammiya: { name: "아꿍", role: "암미야 선생님", img: "akkung",
    praise: ["오, 완전 현지인인데?", "맞아! 잘했어!", "그거지!"],
    sad: ["아깝다! 다시 보자.", "괜찮아, 다음엔 맞힐 거야!"],
    recover: ["봐, 금방 맞히잖아!", "그렇지, 이번엔 제대로야!"],
    combo: ["{n}연속! 이제 현지인 다 됐네!", "와, {n}개 연속이야. 멈추지 마!"] },
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const COMBO_AT = 3; // 이만큼 연속으로 맞히면 연속 정답 표시와 축하 표정

// 채점 직후(누른 순간) 반응: 효과음·진동·연속 정답 계산. 시트는 그 뒤에 열린다.
function judge(right) {
  const recovered = right && lesson.lastWrong;
  lesson.combo = right ? (lesson.combo || 0) + 1 : 0;
  lesson.lastWrong = !right;
  lesson.graded = (lesson.graded || 0) + 1;
  if (right) lesson.correct = (lesson.correct || 0) + 1;
  sfx(right);
  if (!right) {
    navigator.vibrate?.(80);
    if (costsHearts()) heartChip(loseHeart(), true);
  } else app.querySelector(".prog")?.classList.add("hit");
  return { combo: lesson.combo, recovered };
}

// 레슨 머리줄의 하트 칩. 잃을 때는 흔들리고 -1이 떠오른다.
function heartChip(count, lost = false) {
  const el = document.getElementById("hearts");
  if (!el) return;
  el.querySelector("b").textContent = count;
  el.setAttribute("aria-label", `남은 하트 ${count}개`);
  el.classList.toggle("empty", count === 0);
  if (!lost || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.classList.remove("lost");
  void el.offsetWidth; // 연달아 틀려도 애니메이션을 처음부터 다시 재생
  el.classList.add("lost");
  const minus = document.createElement("span");
  minus.className = "minus";
  minus.textContent = "-1";
  el.appendChild(minus);
  setTimeout(() => minus.remove(), 900);
}

function teacherLine(who, good, combo, recovered) {
  const t = TEACHERS[who];
  if (!good) return { mood: "sad", text: pick(t.sad) };
  if (combo >= COMBO_AT) return { mood: "celebrate", text: pick(t.combo).replace("{n}", combo) };
  return { mood: "praise", text: pick(recovered ? t.recover : t.praise) };
}

function teacher(who, mood, text, cls = "") {
  const t = TEACHERS[who];
  return `<div class="teacher ${cls}"><img src="assets/teachers/${t.img}-${mood}.webp" alt="${t.role} ${t.name}" width="64" height="64"><p class="say"><b>${t.name} · ${t.role}</b>${esc(text)}</p></div>`;
}

// ---------- 첫 방문 안내: 누구를 위한 앱인지 ----------

// 처음 화면: 고양이가 통통 떨어지며 등장하고, 말풍선이 타자 치듯 나온다. 고양이를 누르면 뛰며 한마디 한다.
const INTRO_SAY = {
  kkuku: ["안녕하세요, 푸스하 선생님 꾸꾸예요.", "표준 아랍어는 제가 맡을게요.", "أهلاً وسهلاً! 반가워요."],
  akkung: ["나는 암미야 담당 아꿍!", "현지에서 진짜 쓰는 말 알려 줄게.", "إزيك؟ 잘 지냈어?"],
};
const INTRO_WORDS = ["مرحبا", "أهلاً", "إزيك؟", "كيفك؟", "يلا", "تمام"];

function screenIntro() {
  show(`
    <section class="intro">
      <div class="intro-sky" aria-hidden="true">${INTRO_WORDS.map((w, i) => `<span lang="ar" dir="rtl" style="--i:${i}">${w}</span>`).join("")}</div>
      <p class="intro-bubble" id="intro-bubble"><span class="typed">안녕! 우리는 <b>꾸꾸</b>랑 <b>아꿍</b>이야. 같이 방언으로 말해 보자!</span></p>
      <div class="intro-cats">
        <button class="intro-cat" data-cat="kkuku" style="--i:0" aria-label="푸스하 선생님 꾸꾸 누르기"><img src="assets/teachers/kkuku-smile.webp" alt="" width="120" height="120"><span class="name">꾸꾸<small>푸스하 선생님</small></span></button>
        <button class="intro-cat" data-cat="akkung" style="--i:1" aria-label="암미야 선생님 아꿍 누르기"><img src="assets/teachers/akkung-smile.webp" alt="" width="120" height="120"><span class="name">아꿍<small>암미야 선생님</small></span></button>
      </div>
      <p class="intro-mark in" style="--d:14">아라비오</p>
      <h1 class="in" style="--d:15">문법과 단어는 아는데,<br>막상 말하려면 막히나요?</h1>
      <p class="intro-body in" style="--d:16">아라비오는 푸스하를 배운 분이 같은 문장을 이집트·요르단 방언으로 비교하며, <b>실제로 꺼내 쓸 수 있는 문장</b>으로 익히도록 만든 앱이에요.</p>
      <button class="btn henna intro-start" id="intro-start">시작하기 ${ICON.arrow}</button>
      <p class="intro-note in" style="--d:20">푸스하가 처음이라면 기초 문법을 먼저 익히고 오면 훨씬 수월해요.</p>
    </section>`, { tabs: false });
  const bubble = document.getElementById("intro-bubble");
  const said = { kkuku: 0, akkung: 0 };
  // 눌렀을 때 표정이 바로 바뀌도록 미리 받아 둔다.
  for (const who of ["kkuku", "akkung"]) for (const mood of ["praise", "celebrate"]) new Image().src = `assets/teachers/${who}-${mood}.webp`;
  app.addEventListener("animationend", e => { if (e.animationName === "cat-jump") e.target.closest(".intro-cat")?.classList.remove("hop"); });
  app.querySelectorAll(".intro-cat").forEach(cat => cat.addEventListener("click", () => {
    const who = cat.dataset.cat;
    cat.classList.remove("hop");
    void cat.offsetWidth; // 연달아 눌러도 다시 뛴다
    cat.classList.add("hop");
    cat.querySelector("img").src = `assets/teachers/${who}-praise.webp`;
    bubble.dataset.who = who;
    bubble.innerHTML = `<span class="typed">${mixed(INTRO_SAY[who][said[who]++ % INTRO_SAY[who].length])}</span>`;
  }));
  document.getElementById("intro-start").addEventListener("click", (e) => {
    if (e.currentTarget.disabled) return;
    e.currentTarget.disabled = true;
    state.introSeen = true;
    progress();
    saveState();
    // 두 고양이가 신나서 뛰고 난 뒤 홈으로
    app.querySelectorAll(".intro-cat").forEach(cat => {
      cat.querySelector("img").src = `assets/teachers/${cat.dataset.cat}-celebrate.webp`;
      cat.classList.add("cheer");
    });
    bubble.innerHTML = `<span class="typed">좋아, 출발!</span>`;
    setTimeout(screenHome, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 650);
  });
}

// ---------- 홈: 나라별 학습 경로 ----------

let homeUnlock = null;
const HOME_ICON = {
  chat: '<svg viewBox="0 0 24 24"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>',
};
function screenHome() {
  if (!DIALECTS[state.dialect]) state.dialect = "egypt";
  const p = progress(), now = nextDay(), finished = p.completedDays.length >= 100;
  const u = unitOfDay(now), country = state.dialect, due = dueReviews().length;
  show(`
    <div class="world-scene" aria-hidden="true"><img src="assets/landmarks/${country}.jpg" alt="" width="960" height="${country === "egypt" ? 542 : 1440}"></div>
    <header class="world-masthead"><span class="${p.history[today()] ? "" : "cold"}" aria-label="연속 학습 ${streak()}일${p.history[today()] ? "" : ", 오늘은 아직 안 했어요"}">${ICON.flame} ${streak()}일</span><b>아라비오</b><span><span class="mast-heart" aria-label="하트 ${hearts().count}개">${ICON.heart} ${hearts().count}</span>${p.xp} XP</span></header>
    <section class="world-hero" aria-label="${country === "egypt" ? "기자 피라미드" : "페트라 알카즈네"} 배경">
      <img src="assets/landmarks/${country}.jpg" alt="${country === "egypt" ? "이집트 기자의 피라미드" : "요르단 페트라의 알카즈네"}" width="960" height="${country === "egypt" ? 542 : 1440}" fetchpriority="high">
      <div class="world-title"><small>${country === "egypt" ? "CAIRO · EGYPT" : "AMMAN · JORDAN"}</small><div lang="ar" dir="rtl">${DIALECTS[country].ar}</div><p>${DIALECTS[country].name} 아랍어 <span>100일 · 300문장</span></p></div>
    </section>
    <div class="world-panel">
      <div class="world-picker" role="group" aria-label="학습 나라 선택">${Object.entries(DIALECTS).map(([key,d])=>`<button data-country="${key}" aria-pressed="${key === country}">${d.name} <span lang="ar">${d.ar}</span></button>`).join("")}</div>
      ${goalCard()}
    </div>
    ${due ? `<button class="world-review" id="review">오늘 복습 · ${due}문장 ${ICON.arrow}</button>` : ""}
    <div class="world-sticky"><section class="world-unit"><div><label for="unit-select" id="world-unit-no">UNIT ${String(u.unit).padStart(2,"0")}</label><h1 id="world-unit-name">${esc(u.name)}</h1></div><select id="unit-select" aria-label="학습 단원 선택">${DATA.units.map(unit=>`<option value="${unit.unit}" ${unit.unit===u.unit ? "selected" : ""}>UNIT ${unit.unit} · ${esc(unit.name)}</option>`).join("")}</select></section>
    <div class="world-progress" id="world-progress"></div></div>
    <section class="world-path" id="path" aria-label="단원 학습 경로"></section>
    <div id="world-next"></div>
    <details class="world-credit"><summary>사진 출처</summary><a href="https://commons.wikimedia.org/wiki/File:Giza_Pyramids_Panorama.jpg">Giza Pyramids Panorama · Benjamin Inbar</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a><br><a href="https://commons.wikimedia.org/wiki/File:Petra_Treasury.jpg">Petra Treasury · David Bjorgen</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a><p>원본 사진에 화면 크롭·색 필터를 적용했습니다.</p></details>`, {tab:"home"});
  app.dataset.country = country;
  renderPath(now, finished, u.unit);
  document.getElementById("review")?.addEventListener("click",screenReview);
  document.getElementById("unit-select").addEventListener("change",e=>renderPath(now,finished,Number(e.target.value)));
  app.querySelectorAll("[data-country]").forEach(button=>button.addEventListener("click",()=>{
    const nextCountry=button.dataset.country;
    if (nextCountry===state.dialect) return;
    homeUnlock=null;
    state.dialect=nextCountry;progress();saveState();screenHome();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const pill=app.querySelector(".world-picker");
      pill.animate([{transform:"translateX("+(nextCountry==="jordan"?-8:8)+"px)"},{transform:"translateX(0)"}],{duration:500,easing:"cubic-bezier(.2,.85,.25,1.12)"});
    }
  }));
  const hero=app.querySelector(".world-hero");
  hero.addEventListener("pointermove",e=>{
    if(e.pointerType!=="mouse" || matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const r=hero.getBoundingClientRect();hero.style.setProperty("--px",((e.clientX-r.left)/r.width-.5)*9+"px");hero.style.setProperty("--py",((e.clientY-r.top)/r.height-.5)*7+"px");
  });
  hero.addEventListener("pointerleave",()=>{hero.style.setProperty("--px","0px");hero.style.setProperty("--py","0px")});
  homeUnlock=null;
}

// 홈의 하루 목표 카드. 오늘 아직 안 했으면 스트릭이 이어질 수 있다고 알려 준다.
function goalCard() {
  const goal = dailyGoal(), xp = todayXp(), n = streak(), studied = Boolean(progress().history[today()]);
  const note = xp >= goal ? "목표 달성 · 내일 또 만나요"
    : !studied && n > 0 ? `오늘 학습하면 ${n + 1}일 연속이에요`
    : `${Math.ceil((goal - xp) / XP_PER_SENTENCE)}대화 더 하면 달성`;
  return `<div class="world-goal ${xp >= goal ? "met" : ""}">${goalRing(xp / goal, 34)}<div><small>오늘 목표</small><b>${xp} / ${goal} XP</b><p>${note}</p></div></div>`;
}

// 길 옆 빈 자리에 선생님: 4번째 칸(왼쪽으로 치우침) 오른편에 꾸꾸, 6번째 칸(오른쪽) 왼편에 아꿍.
// 오늘 학습 카드와 겹치지 않게 오늘 칸 바로 옆이면 뺀다. 단원을 다 끝내면 축하 표정.
function pathCats(points, unitFinished, currentIndex) {
  return [{ i: 3, who: "kkuku", side: "right" }, { i: 5, who: "akkung", side: "left" }]
    .filter(c => points[c.i] && (currentIndex < 0 || Math.abs(currentIndex - c.i) > 1))
    .map(c => `<img class="world-cat ${c.side}" src="assets/teachers/${c.who}-${unitFinished ? "celebrate" : "smile"}.webp" alt="" aria-hidden="true" width="118" height="118" style="top:${points[c.i].y - 70}px">`).join("");
}

function renderPath(now, finished, selectedUnit) {
  const unit=DATA.units.find(u=>u.unit===selectedUnit),done=new Set(progress().completedDays);
  const days=Array.from({length:unit.lastDay-unit.firstDay+1},(_,i)=>unit.firstDay+i);
  const positions=[32,60,38,26,54,76,42];let y=50;
  const points=days.map((day,i)=>{const point={day,x:positions[i%positions.length]*4,y};y+=day===now&&!finished?210:130;return point});
  const height=y+10;
  const route=points.map((point,i)=>i===0?`M${point.x} ${point.y}`:`C${points[i-1].x} ${points[i-1].y+55} ${point.x} ${point.y-55} ${point.x} ${point.y}`).join(" ");
  const lastDone=points.map(point=>done.has(point.day)).lastIndexOf(true);
  const travelled=points.slice(0,lastDone+1).map((point,i)=>i===0?`M${point.x} ${point.y}`:`C${points[i-1].x} ${points[i-1].y+55} ${point.x} ${point.y-55} ${point.x} ${point.y}`).join(" ");
  const box=document.getElementById("path");box.style.height=height+"px";
  box.innerHTML=`<svg class="world-route" viewBox="0 0 400 ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="${route}"/><path class="travelled" d="${travelled}" pathLength="1"/></svg>`+points.map(({day,x,y},i)=>{
    const completed=done.has(day),current=!finished&&day===now,locked=!completed&&!current;
    return `<div class="world-node ${completed?"completed":""} ${current?"current":""} ${homeUnlock?.country===state.dialect&&current?"unlocked":""}" style="left:${x/4}%;top:${y-30}px;--delay:${i*65}ms"><button data-day="${day}" ${locked?"disabled":""} aria-label="${day}일차 ${completed?"다시 학습":current?"학습 시작":"잠김"}">${completed?ICON.check:locked?HOME_ICON.lock:HOME_ICON.chat}</button><small>DAY ${String(day).padStart(2,"0")}</small></div>${current?`<div class="world-day-card ${x>200?"left":"right"}" style="top:${y-35}px"><small>${homeUnlock?.country===state.dialect?"다음 단계 열림":"오늘의 학습"}</small><h2>${day}일차 대화</h2><p>푸스하 + ${DIALECTS[state.dialect].name} 암미야<br>대화 3개 · 듣기 · 말하기</p><button id="today-start">학습 시작 ${ICON.arrow}</button></div>`:""}`;
  }).join("")+pathCats(points,days.every(day=>done.has(day)),finished?-1:points.findIndex(point=>point.day===now));
  document.getElementById("world-unit-name").textContent=unit.name;
  document.getElementById("world-unit-no").textContent=`UNIT ${String(unit.unit).padStart(2,"0")}`;
  const count=days.filter(day=>done.has(day)).length;
  document.getElementById("world-progress").innerHTML=`<span>${count} / ${days.length} 완료</span><div>${days.map(day=>`<i class="${done.has(day)?"done":""}"></i>`).join("")}</div>`;
  const nextUnit=DATA.units.find(u=>u.unit===unit.unit+1);
  document.getElementById("world-next").innerHTML=nextUnit?`<div class="world-next">${HOME_ICON.chat}<div><small>다음 단원 · UNIT ${String(nextUnit.unit).padStart(2,"0")}</small><h2>${esc(nextUnit.name)}</h2></div>${HOME_ICON.lock}</div>`:`<div class="world-next"><div><small>100일 · 300문장</small><h2>${finished?"전체 학습 완료":"마지막 단원"}</h2></div></div>`;
  box.querySelectorAll("[data-day]:not(:disabled)").forEach(button=>button.addEventListener("click",()=>{const day=Number(button.dataset.day);startLesson(day,sentencesOfDay(day),done.has(day)?"again":"lesson")}));
  document.getElementById("today-start")?.addEventListener("click",()=>startLesson(now));
  window.onscroll=null;
}

// ---------- 레슨 ----------

let lesson = null;

function lessonQueue(list, mode) {
  if (mode === "review" || mode === "heal") return list.flatMap((_, index) => [{ index, type: 4 }, { index, type: 6 }]);
  // Pair each Fusha dialogue with its dialect expression before practice.
  return [
    ...list.flatMap((_, index) => [{ index, type: 0 }, { index, type: 3 }]),
    // 연습: 대화마다 듣기(뜻 고르기) 1 + 단어 블록 1 → 하루 블록 문제 3개
    ...list.flatMap((_, index) => [{ index, type: 1 }, { index, type: 4 }]),
    ...list.map((_, index) => ({ index, type: 6 })),
  ];
}

function startLesson(day, list = sentencesOfDay(day), mode = "lesson", resumeDay = null) {
  window.onscroll = null;
  if (costsHearts(mode) && hearts().count === 0) { screenNoHearts(day); return; }
  forgetRecordings();
  lesson = { day, list, mode, resumeDay, queue: lessonQueue(list, mode), cursor: 0, index: 0, ratings: {}, mistakes: {}, recordings: {}, transitioning: false,
    startedAt: Date.now(), graded: 0, correct: 0 };
  renderStep();
}

// 하트 채우기 연습 문장: 방금 틀린 문장 → 오늘 복습 → 자주 헷갈린 문장 → 그날 문장 순으로 최대 3개.
function healList(day) {
  const srs = progress().srs;
  const missed = lesson?.day === day ? lesson.list.filter(s => lesson.mistakes[s.id]) : [];
  for (const list of [missed, dueReviews(), DATA.sentences.filter(s => srs[s.id]?.hard > 0), sentencesOfDay(day ?? nextDay())]) {
    if (list.length) return list.slice(0, 3);
  }
  return sentencesOfDay(nextDay());
}

const heartRow = (n, animate = false) => `<div class="heart-row" role="img" aria-label="하트 ${n} / ${MAX_HEARTS}">${Array.from({ length: MAX_HEARTS }, (_, i) => `<span class="${i < n ? "full" : ""} ${animate ? "pop" : ""}" style="--i:${i}">${ICON.heart}</span>`).join("")}</div>`;

function screenNoHearts(day) {
  const list = healList(day);
  const h = hearts();
  show(`
    <section class="done-screen no-hearts">
      ${heartRow(h.count)}
      <h2 class="title in" style="--d:1">하트를 모두 썼어요</h2>
      <p class="lead in" style="--d:2">이번 학습은 저장되지 않았어요. 헷갈린 문장을 한 번 더 연습하면 하트가 가득 채워져요.</p>
      ${teacher("ammiya", "sad", "괜찮아! 틀린 걸 한 번 더 보면 확실히 기억나.", "in")}
      <button class="btn henna in" style="--d:3" id="heal">연습하고 하트 채우기 · ${list.length}문장 ${ICON.arrow}</button>
      <button class="btn ghost in" style="--d:4" id="home">홈으로</button>
      ${h.refillAt ? `<p class="small muted in refill-wait" style="--d:5">기다리면 ${waitText(h.refillAt - Date.now())} 뒤에 하트 1개가 생겨요.</p>` : ""}
    </section>`, { tabs: false });
  document.getElementById("heal").addEventListener("click", () => startLesson(day, list, "heal", day));
  document.getElementById("home").addEventListener("click", screenHome);
}

function screenHealed(day) {
  show(`
    <section class="done-screen no-hearts">
      ${heartRow(MAX_HEARTS, true)}
      <h2 class="title in" style="--d:1">하트가 다시 가득 찼어요</h2>
      <div class="done-cats in" style="--d:2"><img src="assets/teachers/kkuku-celebrate.webp" alt="푸스하 선생님 꾸꾸가 축하해요" width="96" height="96"><img src="assets/teachers/akkung-celebrate.webp" alt="암미야 선생님 아꿍이 축하해요" width="96" height="96"></div>
      <p class="lead in" style="--d:3">헷갈린 문장을 다시 익혔어요. 이제 이어서 학습해 볼까요?</p>
      ${day ? `<button class="btn henna in" style="--d:4" id="resume">${day}일차 다시 시작 ${ICON.arrow}</button>` : ""}
      <button class="btn ${day ? "ghost" : "henna"} in" style="--d:5" id="home">홈으로</button>
    </section>`, { tabs: false });
  document.getElementById("resume")?.addEventListener("click", () => startLesson(day, sentencesOfDay(day), progress().completedDays.includes(day) ? "again" : "lesson"));
  document.getElementById("home").addEventListener("click", screenHome);
}

function lessonPos() { return lesson.cursor; }

function frame(inner) {
  const s = lesson.list[lesson.index];
  const total = lesson.queue.length;
  show(`
    <header class="lhead">
      <button class="icon" id="quit" aria-label="그만하기">${ICON.x}</button>
      <div class="prog"><i style="width:${(lessonPos() / total) * 100}%"></i></div>
      ${costsHearts() ? `<span class="heart-chip ${hearts().count === 0 ? "empty" : ""}" id="hearts" role="img" aria-label="남은 하트 ${hearts().count}개">${ICON.heart}<b>${hearts().count}</b></span>` : ""}
      <button class="speed-chip" id="speed" aria-label="음성 속도 바꾸기, 지금 ${rateLabel(state.audioRate || 1)}">${rateLabel(state.audioRate || 1)}</button>
      <span class="stepno">${lessonPos() + 1} / ${total}</span>
    </header>
    <div class="lesson-stage"><span>${({0:"01 푸스하 · 대화 보기",3:"01 암미야 · 표현 비교",1:"02 연습하기",4:({ review: "복습", heal: "하트 채우기 연습" })[lesson.mode] || "02 연습하기",6:"03 말하기"})[lesson.queue[lesson.cursor].type]}</span><span>표현 ${lesson.index + 1} / ${lesson.list.length}</span></div>
    <section class="lesson">${inner}</section>
    `, { tabs: false });
  requestAnimationFrame(() => {
    const bar = app.querySelector(".prog i");
    if (bar) bar.style.width = `${((lessonPos() + 1) / total) * 100}%`;
  });
  document.getElementById("speed").addEventListener("click", (e) => {
    state.audioRate = RATES[(RATES.indexOf(state.audioRate || 1) + 1) % RATES.length];
    if (currentAudio) currentAudio.playbackRate = state.audioRate;
    e.currentTarget.textContent = rateLabel(state.audioRate);
    e.currentTarget.setAttribute("aria-label", `음성 속도 바꾸기, 지금 ${rateLabel(state.audioRate)}`);
    saveState();
  });
  document.getElementById("quit").addEventListener("click", () => {
    if (confirm("지금 그만두면 이번 학습 진도는 저장되지 않아요. 그만할까요?")) screenHome();
  });
  bindPlay(s);
}

function next() {
  if (lesson.transitioning) return;
  stopAudio();
  stopRecording();
  const activeLesson = lesson;
  lesson.transitioning = true;
  document.querySelector(".sheet")?.classList.remove("up");
  setTimeout(() => {
    if (lesson !== activeLesson || !document.getElementById("quit")) return;
    lesson.cursor += 1;
    lesson.transitioning = false;
    // 하트를 다 쓰면 이번 학습은 저장하지 않고 멈춘다.
    if (costsHearts() && hearts().count === 0) screenNoHearts(lesson.day);
    else if (lesson.cursor >= lesson.queue.length) finishLesson();
    else renderStep();
  }, 180);
}

function renderStep() {
  const entry = lesson.queue[lesson.cursor];
  lesson.index = entry.index;
  const s = lesson.list[entry.index];
  ({ 0: stepPreview, 1: stepMeaning, 3: stepCompare, 4: stepDialectBlank, 6: stepRecall })[entry.type](s);
}

function dialogueLines(s, variant, korean = true, mark = false) {
  return ["A", "B"].map(side => `<div class="dialogue-line"><div class="speaker-line"><span>${side}</span>${playBtn(variant, side, "듣기")}</div>${ar(arText(s[variant][side], mark && side === s.blankSide ? s[variant].blank : ""))}${korean ? `<p class="dialogue-ko">${esc(s.ko[side])}</p>` : ""}</div>`).join("");
}

function stepPreview(s) {
  frame(`<p class="label in">${esc(s.unitName)} · 푸스하</p>
    <h2 class="title in" style="--d:1">대화를 먼저 읽고 들어보세요</h2>
    ${teacher("fusha", "smile", lesson.index === 0 && lesson.mode === "lesson" ? "오늘은 푸스하로 아는 표현을 방언으로 바꿔 말하는 연습이에요. 먼저 푸스하로 읽고 들어 볼까요?" : "이번 대화도 먼저 푸스하로 읽고 들어 봐요.", "in")}
    ${lesson.index === 0 ? `<p class="ko word-hint in" style="--d:1">모르는 아랍어 단어는 눌러 보세요. 뜻이 나와요.</p>` : ""}
    <div class="dialogue-preview in" style="--d:2">${dialogueLines(s, "fusha")}</div>
    <button class="btn henna in" style="--d:3;margin-top:24px" id="go">${DIALECTS[state.dialect].name} 암미야 보기 ${ICON.arrow}</button>`);
  document.getElementById("go").addEventListener("click", next);
}

function openSheet({ good, title, body, teacher: who, combo = 0, recovered = false }) {
  document.querySelector(".sheet")?.remove();
  const sh = document.createElement("div");
  sh.className = `sheet ${good ? "" : "bad"}`;
  sh.setAttribute("role", "region");
  sh.setAttribute("aria-labelledby", "feedback-title");
  const line = who ? teacherLine(who, good, combo, recovered) : null;
  sh.innerHTML = `${line ? teacher(who, line.mood, line.text, `in-sheet react-${good ? "good" : "bad"}`) : ""}
    <div class="fb-head"><p class="t" id="feedback-title"><span class="fb-icon" aria-hidden="true">${good ? ICON.check : ICON.x}</span>${title}</p>${good && combo >= COMBO_AT ? `<span class="combo">${ICON.flame}${combo}연속 정답</span>` : ""}</div>
    <div class="msg">${body}</div>${!good && costsHearts() && hearts().count === 0 ? `<p class="out-note">${ICON.heart}하트를 모두 썼어요. 틀린 문장을 연습하면 다시 채워져요.</p>` : ""}<button class="btn ${good ? "ok" : ""}" id="next">계속</button>`;
  document.body.appendChild(sh);
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add("up")));
  sh.querySelector("#next").addEventListener("click", next);
  bindPlay(lesson.list[lesson.index], sh);
  sh.querySelector("#next").focus({ preventScroll: true });
}

// 3지선다 공통
function quiz({ kicker, title, prompt, answer, wrong, arabic, glossOf, onRight, sheetBody, teacher: who }) {
  const opts = shuffle([answer, ...wrong]);
  frame(`
    <p class="label in" style="--d:0">${kicker}</p>
    <h2 class="title in" style="--d:1">${title}</h2>
    ${prompt}
    <div class="opts" id="opts">
      ${opts.map((o, i) => `
        <button class="opt in" style="--d:${4 + i}" data-o="${esc(o)}">
          <span class="bg"></span>${ICON.check}<span class="n">${i + 1}</span>
          ${arabic ? `<span class="g">${esc(glossOf(o))}</span><span class="w" lang="ar">${esc(o)}</span>` : `<span class="txt">${esc(o)}</span>`}
        </button>`).join("")}
    </div>`);
  const box = document.getElementById("opts");
  box.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => {
    if (box.dataset.answered) return;
    box.dataset.answered = "true";
    const right = b.dataset.o === answer;
    const correct = [...box.querySelectorAll(".opt")].find((x) => x.dataset.o === answer);
    b.classList.add("selected");
    const { combo, recovered } = judge(right);
    if (!right) {
      b.classList.add("wrong");
      lesson.mistakes[lesson.list[lesson.index].id] = true;
    }
    const activeLesson = lesson;
    const activeCursor = lesson.cursor;
    setTimeout(() => {
      if (lesson !== activeLesson || lesson.cursor !== activeCursor || !box.isConnected) return;
      correct.classList.add("right");
      box.classList.add("reveal");
      if (right) burst(correct, 12);
      onRight?.();
      openSheet({ good: right, title: right ? "정답이에요" : "아쉬워요, 정답은 이거예요", body: sheetBody(), teacher: who, combo, recovered });
    }, right ? 0 : 450);
  }));
}

function stepMeaning(s) {
  const side = s.blankSide;
  const hasAudio = Boolean(s.fusha.audio[side]);
  quiz({
    kicker: hasAudio ? "푸스하 · 듣기" : "푸스하 · 읽기",
    teacher: "fusha",
    title: hasAudio ? "들리는 문장의 뜻은?" : "이 문장의 뜻은?",
    prompt: hasAudio ? `<div class="listen in" style="--d:2">${playBtn("fusha", side, "다시 듣기")}</div>` : `${ar(esc(s.fusha[side]))}<p class="small muted">음성 준비 중 · 읽기 문제로 진행해요.</p>`,
    answer: s.ko[side],
    wrong: s.koWrong,
    arabic: false,
    sheetBody: () => `${ar(esc(s.fusha[side]))}`,
  });
  if (hasAudio) {
    const activeLesson = lesson;
    const cursor = lesson.cursor;
    setTimeout(() => {
      if (lesson === activeLesson && lesson.cursor === cursor && document.getElementById("quit")) speak(s, "fusha", side);
    }, 350);
  }
}

function stepCompare(s) {
  const d = state.dialect;
  const other = d === "egypt" ? "jordan" : "egypt";
  frame(`<p class="label in">푸스하 → ${DIALECTS[d].name}</p>
    <h2 class="title in" style="--d:1">${esc(s.gloss[s[d].blank] || s.gloss[s.fusha.blank] || "핵심 표현")}</h2>
    ${teacher("ammiya", "smile", `${DIALECTS[d].name}에선 이렇게 말해!`, "in")}
    <div class="expression-pair in" style="--d:2">
      <div><span class="label">푸스하</span>${ar(esc(s.fusha.blank), "big")}</div>
      <span class="expression-arrow" aria-hidden="true">↓</span>
      <div><span class="label">${DIALECTS[d].name}</span>${ar(esc(s[d].blank), "big")}</div>
    </div>
    <div class="dialogue-preview in" style="--d:3">${dialogueLines(s, d, true, true)}</div>
    ${(s.tipsByDialect?.[d] || []).length ? `<div class="compare-notes in" style="--d:4"><p class="label">알아두면 좋은 점</p>
      <ul class="notes">${s.tipsByDialect[d].map(n => `<li>${mixed(n)}</li>`).join("")}</ul></div>` : ""}
    <details class="other"><summary>${DIALECTS[other].name} 표현도 보기</summary>${ar(wordify(s[other].A))}${ar(wordify(s[other].B))}</details>
    <button class="btn henna" style="margin-top:24px" id="go">${lesson.index === lesson.list.length - 1 ? "연습 시작" : "다음 푸스하 대화"} ${ICON.arrow}</button>`);
  document.getElementById("go").addEventListener("click", next);
}

// 단어 블록으로 방언 문장 만들기 (교수님 조언: 보기 고르기보다 직접 꺼내 조립하게).
// 긴 문장은 핵심 표현 주변 최대 7단어만 블록으로, 나머지는 미리 채워 둔다.
// 함정 블록: 같은 자리의 푸스하·다른 방언 표현(s[d].wrong)에서 문장에 없는 단어 2개.
const PUNCT = /[،؟!.,:;"'«»…]/g;
const bare = (w) => plainAr(w.replace(PUNCT, ""));

function blockWindow(words, key) {
  const k = key.split(/\s+/).map(bare);
  let ks = words.findIndex((_, i) => k.every((w, j) => bare(words[i + j] || "") === w));
  if (ks < 0) ks = 0;
  const ke = Math.min(words.length, ks + k.length);
  let start = ks, end = ke;
  while (end - start < Math.min(7, words.length)) {
    if (start > 0 && (end >= words.length || ks - start <= end - ke)) start--;
    else if (end < words.length) end++;
    else break;
  }
  return [start, end];
}

function stepDialectBlank(s) {
  const d = state.dialect;
  const side = s.blankSide;
  const words = s[d][side].trim().split(/\s+/);
  const [start, end] = blockWindow(words, s[d].blank);
  const target = words.slice(start, end);
  const inLine = new Set(target.map(bare));
  const decoys = [...new Set(s[d].wrong.flatMap(o => o.split(/\s+/)).map(w => w.replace(PUNCT, "")))]
    .filter(w => w && !inLine.has(bare(w))).slice(0, 2);
  const bank = shuffle([...target.map(w => w.replace(PUNCT, "")), ...decoys]).map((w, i) => ({ i, w }));
  const picked = [];
  frame(`
    <p class="label in" style="--d:0">${DIALECTS[d].name} 사람처럼</p>
    <h2 class="title in" style="--d:1">단어를 눌러 문장을 완성하세요</h2>
    <p class="ko in" style="--d:2">${esc(s.ko[side])}</p>
    <div class="build in" style="--d:3" dir="rtl" lang="ar" id="build"></div>
    <div class="blocks in" style="--d:4" dir="rtl" lang="ar" id="bank">${bank.map(b => `<button class="blk" data-i="${b.i}">${esc(b.w)}</button>`).join("")}</div>
    <p class="build-hint" id="build-hint" role="status" aria-live="polite"></p>
    <div class="build-actions in" style="--d:5"><button class="btn ghost" id="clear">다시</button><button class="btn henna" id="check" disabled>확인</button></div>`);
  const build = document.getElementById("build");
  const bankBox = document.getElementById("bank");
  const fixed = (list) => list.map(w => `<span class="fixed">${esc(w)}</span>`).join(" ");
  const draw = () => {
    build.innerHTML = `${fixed(words.slice(0, start))} ${picked.length
      ? picked.map(i => `<button class="blk in-line" data-i="${i}">${esc(bank[i].w)}</button>`).join("")
      : `<span class="drop">여기에 단어가 들어가요</span>`} ${fixed(words.slice(end))}`;
    bankBox.querySelectorAll(".blk").forEach(b => b.classList.toggle("used", picked.includes(Number(b.dataset.i))));
    document.getElementById("check").disabled = picked.length === 0;
    if (picked.length >= target.length) document.getElementById("build-hint").textContent = "";
  };
  bankBox.addEventListener("click", (e) => {
    const b = e.target.closest(".blk");
    if (!b || build.dataset.done || picked.includes(Number(b.dataset.i))) return;
    picked.push(Number(b.dataset.i));
    draw();
  });
  build.addEventListener("click", (e) => {
    const b = e.target.closest(".blk");
    if (!b || build.dataset.done) return;
    picked.splice(picked.indexOf(Number(b.dataset.i)), 1);
    draw();
  });
  document.getElementById("clear").addEventListener("click", () => {
    if (build.dataset.done) return;
    picked.length = 0;
    draw();
  });
  const hint = document.getElementById("build-hint");
  document.getElementById("check").addEventListener("click", () => {
    if (build.dataset.done) return;
    // 잘못된 입력: 단어 수가 모자라면 채점하지 않고 몇 개 더 필요한지 알려 준다.
    if (picked.length < target.length) {
      hint.textContent = `아직 단어가 ${target.length - picked.length}개 더 필요해요. 문장을 끝까지 완성한 뒤 확인을 눌러 주세요.`;
      return;
    }
    hint.textContent = "";
    build.dataset.done = "true";
    const right = picked.length === target.length && picked.every((i, j) => bare(bank[i].w) === bare(target[j]));
    // 등장 애니메이션(.in)이 끝나기 전에 답하면 흔들기 애니메이션이 덮어써서 칸이 투명하게 남는다.
    build.classList.remove("in");
    build.classList.add(right ? "ok" : "bad");
    const { combo, recovered } = judge(right);
    if (!right) lesson.mistakes[s.id] = true;
    else {
      burst(build, 12);
      // 효과음이 끝난 뒤 원어민 음성을 들려준다.
      const activeLesson = lesson, cursor = lesson.cursor;
      setTimeout(() => { if (lesson === activeLesson && lesson.cursor === cursor && build.isConnected) speak(s, d, side); }, state.sfx === false ? 0 : 380);
    }
    openSheet({ good: right, title: right ? "정답이에요" : "아쉬워요, 정답은 이거예요", teacher: "ammiya", combo, recovered,
      body: `<div style="display:flex;align-items:center;gap:10px">${playBtn(d, side)}${ar(esc(s[d][side]))}</div><p style="margin-top:6px">${esc(s[d].blank)} = ${esc(s.gloss[s[d].blank] || "")}</p>` });
  });
  draw();
}

// End with each original A/B dialogue; do not splice unrelated source dialogues.
function stepRecall(s) {
  const d = state.dialect;
  frame(`<p class="label in">${DIALECTS[d].name} · 대화 ${lesson.index + 1}</p>
    <h2 class="title in" style="--d:1">한국어만 보고 대화해 보세요</h2>
    ${teacher("ammiya", "smile", `이번엔 네가 ${DIALECTS[d].name} 사람처럼 말해 봐!`, "in")}
    <p class="ko">상대의 말을 읽고, ‘핵심 표현’이 표시된 역할을 아랍어로 말해 보세요.${canRecord ? " 녹음해 두면 정답의 원어민 음성과 비교할 수 있어요." : ""}</p>
    <div class="recall card in" style="--d:2">${["A","B"].map(side => `<p class="who">${side}${side === s.blankSide ? " · 핵심 표현" : ""}</p><p class="big-ko">${esc(s.ko[side])}</p>`).join("")}</div>
    ${canRecord ? `<div class="mine in" style="--d:3" id="mine" data-sid="${s.id}"></div>` : ""}
    <div class="answer" id="answer"><button class="btn" id="reveal">말해봤어요 · 정답 확인</button></div>`);
  let revealed = false;
  const renderMine = () => {
    const box = document.getElementById("mine");
    if (!box || box.dataset.sid !== s.id) return; // 녹음이 끝나기 전에 다음 문장으로 넘어간 경우

    const url = lesson.recordings[s.id];
    const recording = recorder?.state === "recording";
    box.innerHTML = `<button class="btn line rec${recording ? " on" : ""}" id="rec" aria-pressed="${recording}">${recording ? `${ICON.stop}녹음 중 · 멈추기` : `${ICON.mic}${url ? "다시 녹음하기" : "녹음하며 말하기"}`}</button>
      ${url && !recording ? `<div class="mine-play"><button class="play" data-mine aria-pressed="false">${ICON.play}내 목소리</button>${revealed ? playBtn(d, s.blankSide, "원어민") : ""}</div>` : ""}`;
    box.querySelector("#rec").addEventListener("click", () => toggleRecording(s.id, renderMine));
    box.querySelector("[data-mine]")?.addEventListener("click", e => playMine(url, e.currentTarget));
    bindPlay(s, box);
  };
  if (canRecord) renderMine();
  document.getElementById("reveal").addEventListener("click", () => {
    revealed = true;
    stopRecording();
    if (canRecord) renderMine();
    const box = document.getElementById("answer");
    box.innerHTML = `<div class="dialogue-preview in">${dialogueLines(s, d, false)}</div>
      <p class="rating-hint">${lesson.mistakes[s.id] ? "연습에서 틀린 표현은 내일 다시 복습해요." : "헷갈린 표현은 내일, 기억한 표현은 복습 일정에 반영해요."}</p>
      <div class="rate"><button class="btn ghost" data-rate="0">헷갈려요</button><button class="btn henna" data-rate="1">말할 수 있어요</button></div>`;
    bindPlay(s, box);
    box.querySelectorAll("[data-rate]").forEach(button => button.addEventListener("click", () => {
      if (lesson.transitioning) return;
      lesson.ratings[s.id] = button.dataset.rate === "1" && !lesson.mistakes[s.id];
      next();
    }));
  });
}

function finishLesson() {
  if (lesson.finished) return;
  lesson.finished = true;
  // 하트 채우기 연습은 진도·복습 일정·경험치를 바꾸지 않고 하트만 채운다.
  if (lesson.mode === "heal") {
    gainHearts(MAX_HEARTS);
    saveState();
    screenHealed(lesson.resumeDay);
    return;
  }
  const heartGained = lesson.mode === "review" ? gainHearts(1) : 0; // 복습을 마치면 하트 1개
  for (const s of lesson.list) rate(s.id, lesson.ratings[s.id] === true, false);
  const p = progress();
  const counts = lesson.mode === "lesson";
  const gained = lesson.list.length * XP_PER_SENTENCE;
  // 스트릭·목표 축하는 오늘 처음 끝냈을 때, 목표를 막 넘었을 때만 보여 준다.
  const firstToday = !p.history[today()];
  const xpBefore = todayXp();
  p.xp += gained;
  p.history[today()] = (p.history[today()] || 0) + lesson.list.length;
  const goalReached = xpBefore < dailyGoal() && todayXp() >= dailyGoal();
  const accuracy = lesson.graded ? Math.round((lesson.correct / lesson.graded) * 100) : null;
  const elapsed = Math.max(0, Date.now() - (lesson.startedAt || Date.now()));
  let unitJustDone = null;
  if (counts && !p.completedDays.includes(lesson.day)) {
    p.completedDays.push(lesson.day);
    homeUnlock = {country:state.dialect, day:lesson.day};
    const u = unitOfDay(lesson.day);
    if (unitDone(u)) unitJustDone = u;
  }
  saveState();
  const d = state.dialect;
  const isDay = lesson.mode !== "review";
  const dayN = lesson.day;
  show(`
    <section class="done-screen">
      ${isDay ? `<p class="num in" style="--d:0">${arNum(dayN)}</p><p class="label numk in" style="--d:1">DAY ${dayN}</p>` : `<p class="num in" style="--d:0">✓</p>`}
      <h2 class="title in" style="--d:2">${isDay ? `${dayN}일차를 마쳤어요` : "복습을 마쳤어요"}</h2>
      <p class="lead in" style="--d:3">${isDay ? `100일 중 ${p.completedDays.length}일, 300문장 중 ${p.completedDays.length * 3}문장째예요.` : `${lesson.list.length}문장 복습 완료`}</p>
      <div class="done-cats in" style="--d:3"><img src="assets/teachers/kkuku-celebrate.webp" alt="푸스하 선생님 꾸꾸가 축하해요" width="96" height="96"><img src="assets/teachers/akkung-celebrate.webp" alt="암미야 선생님 아꿍이 축하해요" width="96" height="96"></div>
      ${isDay ? `<p class="lesson-purpose in" style="--d:3">오늘 익힌 문장, 실제 상황에서 꺼내 써 보세요.</p>` : ""}
      <div class="done-stats in" style="--d:3">
        <div class="xp-stat"><small>경험치</small><b>+${gained}</b></div>
        ${accuracy === null ? "" : `<div class="acc-stat"><small>정확도</small><b>${accuracy}%</b></div>`}
        <div class="time-stat"><small>걸린 시간</small><b>${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, "0")}</b></div>
      </div>
      ${heartGained ? `<p class="heart-bonus in" style="--d:3">${ICON.heart}복습을 마쳐서 하트 +${heartGained}</p>` : ""}
      ${isDay ? `
      <div class="passport in" style="--d:4">
        <div class="lines"><i></i><i></i><i></i></div>
        <span class="ink"></span>
        <div class="seal" id="seal"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2.5"/><path id="arc" d="M50 50 m-31 0 a31 31 0 1 1 62 0" fill="none"/><text><textPath href="#arc" startOffset="50%" text-anchor="middle">${DIALECTS[d].en} · DAY ${dayN}</textPath></text><text class="big" x="50" y="68" text-anchor="middle">${arNum(dayN)}</text></svg></div>
      </div>` : ""}
      ${unitJustDone ? `<div class="unit-got in" style="--d:5">${sealSvg("got", true)}<div><p class="label">UNIT ${unitJustDone.unit} 완료</p><p class="serif" style="font-weight:700">${esc(unitJustDone.name)} 별 도장을 얻었어요</p></div></div>` : ""}
      <div class="learned in" style="--d:5">
        <p class="label" style="margin-bottom:8px">오늘 익힌 ${DIALECTS[d].name} 표현</p>
        ${lesson.list.map((s) => `<div class="row"><span class="m">${esc(s.gloss[s[d].blank] || "")}</span><span class="w" lang="ar">${esc(s[d].blank)}</span></div>`).join("")}
      </div>
      <button class="btn in" style="--d:6" id="home">${firstToday || goalReached ? "계속" : "홈으로"}</button>
    </section>`, { tabs: false });
  if (isDay) setTimeout(() => burst(document.getElementById("seal"), 14), 1650);
  // 완료 → (오늘 첫 학습이면) 스트릭 → (방금 목표를 넘었으면) 하루 목표 → 홈
  const steps = [firstToday && screenStreak, goalReached && screenGoal].filter(Boolean);
  const advance = () => (steps.length ? steps.shift()(advance) : screenHome());
  document.getElementById("home").addEventListener("click", advance);
}

// 스트릭이 이어진 순간: 불꽃 숫자가 하나 올라가고 이번 주 달력에 오늘이 찍힌다.
function screenStreak(onNext) {
  const n = streak();
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  show(`
    <section class="done-screen streak-screen">
      <div class="streak-flame in" style="--d:0">${ICON.flame}</div>
      <p class="streak-num in" style="--d:1"><b id="streak-n">${calm ? n : Math.max(0, n - 1)}</b>일</p>
      <h2 class="title in" style="--d:2">${n === 1 ? "연속 학습을 시작했어요!" : `${n}일 연속 학습!`}</h2>
      <div class="week in" style="--d:3">${weekDays().map(w => `<span class="${w.done ? "done" : ""} ${w.today ? "today" : ""}"><i>${w.done ? ICON.check : ""}</i>${w.label}</span>`).join("")}</div>
      ${teacher("ammiya", "celebrate", n === 1 ? "좋은 출발이야! 내일도 와서 2일 만들자." : `내일도 하나만 하면 ${n + 1}일이야. 기다릴게!`, "in")}
      <button class="btn henna in" style="--d:5" id="next-step">계속 ${ICON.arrow}</button>
    </section>`, { tabs: false });
  if (!calm) setTimeout(() => {
    const el = document.getElementById("streak-n");
    if (!el) return;
    el.textContent = n;
    el.parentElement.classList.add("bump");
    burst(app.querySelector(".streak-flame"), 10);
  }, 900);
  document.getElementById("next-step").addEventListener("click", onNext);
}

function screenGoal(onNext) {
  const goal = dailyGoal(), xp = todayXp();
  show(`
    <section class="done-screen goal-screen">
      <div class="goal-big in" style="--d:0">${goalRing(1, 132)}<b>${xp}<small>/ ${goal} XP</small></b></div>
      <h2 class="title in" style="--d:1">오늘 목표 달성!</h2>
      <p class="lead in" style="--d:2">하루 목표 ${goal} XP를 채웠어요. 더 하고 싶으면 다음 일차나 복습을 이어서 해도 좋아요.</p>
      ${teacher("fusha", "celebrate", "오늘 목표를 해냈어요. 이렇게 매일 조금씩이 가장 확실한 방법이에요.", "in")}
      <button class="btn henna in" style="--d:4" id="next-step">계속 ${ICON.arrow}</button>
    </section>`, { tabs: false });
  setTimeout(() => burst(app.querySelector(".goal-big"), 14), 700);
  document.getElementById("next-step").addEventListener("click", onNext);
}

// ---------- 복습 ----------

function screenReview() {
  window.onscroll = null;
  const due = dueReviews();
  const all = Object.keys(progress().srs).length;
  show(`
    <div class="page-head"><h1>복습</h1><span class="label">${DIALECTS[state.dialect].name}</span></div>
    <p class="page-description">복습 일정에 따라 문장을 다시 연습해요.</p>
    <div class="review-hero">
      <p class="big in" style="--d:0">${due.length}</p>
      <p class="in" style="--d:1">${due.length ? "오늘 다시 볼 문장이에요." : "오늘 복습할 문장이 없어요."}</p>
      <p class="small muted in" style="--d:2">${all ? "헷갈린 문장은 다음 날, 외운 문장은 1·3·7·14·30일 간격으로 다시 나와요." : "세 문장을 배우면 여기에서 복습할 수 있어요."}</p>
      ${due.length ? `<button class="btn henna in" style="--d:3" id="go">복습 시작 ${ICON.arrow}</button>` : `<button class="btn henna" id="back-to-learning">새로운 문장 배우기 ${ICON.arrow}</button>`}
    </div>`, { tab: "review" });
  document.getElementById("back-to-learning")?.addEventListener("click", screenHome);
  document.getElementById("go")?.addEventListener("click", () => startLesson(null, shuffle(due).slice(0, 10), "review"));
}

// ---------- 기록 ----------

function screenRecords() {
  window.onscroll = null;
  const p = progress();
  const srs = p.srs;
  const learned = Object.keys(srs).length;
  const remembered = Object.values(srs).filter((x) => x.last === "외웠어요").length;
  const hard = DATA.sentences.filter((s) => srs[s.id] && srs[s.id].hard > 0)
    .sort((a, b) => srs[b.id].hard - srs[a.id].hard).slice(0, 10);
  const d = state.dialect;
  show(`
    <div class="page-head"><h1>나의 기록</h1><span class="pill">${DIALECTS[d].name}</span></div><p class="page-description">학습 현황과 단원별 완료 기록</p>
    <div class="metrics in" style="--d:0">
      <div><b>${p.completedDays.length}</b><span>/ 100일</span></div>
      <div><b>${learned}</b><span>배운 문장</span></div>
      <div><b>${remembered}</b><span>외운 문장</span></div>
      <div><b>${streak()}</b><span>연속 학습</span></div>
    </div>
    <p class="label section-title in" style="--d:1">단원 별 도장 · ${DATA.units.filter(unitDone).length} / 15</p>
    <div class="seals in" style="--d:2">${DATA.units.map((u) => `<div class="s ${unitDone(u) ? "got" : ""}">${sealSvg(`r${u.unit}`, unitDone(u))}<span>${u.unit}. ${esc(u.name)}</span></div>`).join("")}</div>
    <p class="label section-title in" style="--d:3">자주 헷갈리는 문장</p>
    <div class="in" style="--d:4">
      ${hard.length ? `<ul class="hard">${hard.map((s) => `<li><p class="ko">${esc(s.ko[s.blankSide])}</p>${ar(esc(s[d][s.blankSide]))}<span class="cnt">헷갈림 ${srs[s.id].hard}번</span></li>`).join("")}</ul>` : `<p class="empty">아직 헷갈린 문장이 없어요.<br><span class="small">연습에서 틀리거나 ‘헷갈려요’를 선택한 문장이 표시돼요.</span></p>`}
    </div>`, { tab: "records" });
}

// ---------- 설정 ----------

function screenSettings() {
  window.onscroll = null;
  // 방언은 홈 위쪽의 이집트·요르단 버튼으로 바꾼다. 설정에서는 지금 방언의 진도만 다룬다.
  show(`
    <div class="page-head"><h1>설정</h1><span class="wordmark">아라비오</span></div><p class="page-description">진도와 학습 환경 관리</p>
    <div class="setting in" style="--d:0">
      <p>${DIALECTS[state.dialect].name} 진도를 처음부터 다시 시작해요.</p>
      <button class="btn line" id="reset">진도 초기화</button>
      <p class="small muted" style="margin-top:8px">방언은 홈 위쪽에서 바꿀 수 있고, 진도는 방언별로 따로 저장돼요.</p>
    </div>
    <div class="setting in" style="--d:1">
      <p class="small muted">푸스하: 아이만 · 이집트: 아슈라프 · 요르단: 야잔<br>AI 생성 음성(Sawtak) · 직접 듣고 검수 완료. 없는 음성은 준비 중으로 표시해요.<br>문장 300개 · 15단원 · 100일 · 검수 완료</p>
    </div>
    <div class="setting"><div class="audio-speed"><label for="audio-speed">음성 재생 속도</label><select id="audio-speed">${RATES.map(value=>`<option value="${value}" ${(state.audioRate || 1) === value ? "selected" : ""}>${value === 1 ? "기본 · 1.0배" : value < 1 ? `느리게 · ${value}배` : `빠르게 · ${value}배`}</option>`).join("")}</select></div></div>
    <div class="setting"><div class="audio-speed"><label for="daily-goal">하루 목표</label><select id="daily-goal">${DAILY_GOALS.map(xp => `<option value="${xp}" ${dailyGoal() === xp ? "selected" : ""}>${xp} XP · 대화 ${xp / XP_PER_SENTENCE}개</option>`).join("")}</select></div></div>
    <div class="setting"><div class="audio-speed"><label for="sfx">정답·오답 효과음</label><select id="sfx"><option value="on" ${state.sfx !== false ? "selected" : ""}>켜기</option><option value="off" ${state.sfx === false ? "selected" : ""}>끄기</option></select></div></div>
    ${['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? `<div class="setting"><p>로컬 검수 · 진도 저장 없이 모든 일차 확인</p><a class="btn ghost" href="admin.html?day=8">관리자 검수 열기</a></div>` : ''}`, { tab: "settings" });
  document.getElementById("audio-speed").addEventListener("change", e => {
    state.audioRate = Number(e.target.value);
    saveState();
  });
  document.getElementById("daily-goal").addEventListener("change", e => {
    state.dailyGoal = Number(e.target.value);
    saveState();
  });
  document.getElementById("sfx").addEventListener("change", e => {
    state.sfx = e.target.value === "on";
    saveState();
    sfx(true); // 켰을 때 바로 들려준다
  });
  document.getElementById("reset").addEventListener("click", () => {
    if (!confirm(`${DIALECTS[state.dialect].name} 진도를 모두 지울까요?`)) return;
    delete state.progress[state.dialect];
    progress();
    saveState();
    screenHome();
  });
}

const SCREENS = { home: screenHome, review: screenReview, records: screenRecords, settings: screenSettings };

// ---------- 시작 ----------

// 로딩 화면: 고양이가 들썩이고 막대가 차오르는 동안 방언 한마디를 돌려 보여 준다.
// 너무 빨리 끝나 깜빡이지 않게 최소 0.9초는 보여 주고, 끝나면 고양이가 뛰며 사라진다.
const SPLASH_TIPS = [
  "이집트에선 ‘지금’을 دلوقتي(딜와으티)라고 해요",
  "요르단에선 ‘뭐?’를 شو(슈)라고 해요",
  "‘어떻게 지내?’ 이집트는 عامل إيه, 요르단은 كيفك",
  "이집트에선 ‘알았어, 좋아’를 ماشي(마시)라고 해요",
  "요르단에선 ‘지금’을 هلأ(할라)라고 해요",
];

function startSplash() {
  const el = document.getElementById("splash");
  const shownAt = performance.now();
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tip = document.getElementById("splash-tip");
  let i = Math.floor(Math.random() * SPLASH_TIPS.length);
  const rotate = () => {
    if (!tip) return;
    tip.classList.remove("swap");
    void tip.offsetWidth;
    tip.innerHTML = mixed(SPLASH_TIPS[i++ % SPLASH_TIPS.length]);
    tip.classList.add("swap");
  };
  let tipTimer = setTimeout(function loop() { rotate(); tipTimer = setTimeout(loop, 1800); }, 350);
  return {
    ready: new Promise(resolve => setTimeout(resolve, Math.max(0, (calm ? 0 : 900) - (performance.now() - shownAt)))),
    finish() {
      clearTimeout(tipTimer);
      if (!el) return;
      if (calm) { el.remove(); return; }
      el.classList.add("done");
      setTimeout(() => el.remove(), 700);
    },
    remove() { clearTimeout(tipTimer); el?.remove(); },
  };
}

(async function boot() {
  // 새 버전 감지: GitHub Pages는 첫 페이지를 최대 10분 캐시해서, 배포 직후 열면 예전 app.js가 뜰 수 있다.
  // version.txt(캐시 없이)와 이 스크립트의 ?v= 값이 다르면 주소를 바꿔 새 페이지를 한 번 받아 온다.
  const APP_VERSION = new URL(document.currentScript?.src || location.href).searchParams.get("v");
  async function ensureLatest() {
    if (!APP_VERSION || !/^https?:$/.test(location.protocol)) return;
    try {
      const latest = (await fetch(`version.txt?t=${Date.now()}`, { cache: "no-store" }).then(r => r.ok ? r.text() : "")).trim();
      const url = new URL(location.href);
      if (latest && latest !== APP_VERSION && url.searchParams.get("v") !== latest) {
        url.searchParams.set("v", latest);
        location.replace(url);
      } else if (url.searchParams.has("v")) {
        url.searchParams.delete("v");
        history.replaceState(null, "", url);
      }
    } catch { /* 오프라인이면 지금 버전으로 계속 */ }
  }
  ensureLatest();
  // 로딩 → 정상 / 오류(이유 + 할 일 + 다시 시도). 문장 데이터가 없으면 학습을 시작할 수 없으므로 여기서 멈춘다.
  const splash = startSplash();
  try {
    DATA = await fetch("data/sentences.json", { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    if (!Array.isArray(DATA?.sentences) || !DATA.sentences.length) throw new Error("empty");
  } catch {
    splash.remove();
    app.innerHTML = `<section class="load-error" role="alert">
      <h1>문장을 불러오지 못했어요</h1>
      <p>인터넷 연결이 끊겼거나 서버가 잠시 응답하지 않는 것 같아요. 연결을 확인한 뒤 다시 시도해 주세요. 지금까지의 학습 기록은 이 기기에 그대로 남아 있어요.</p>
      <button class="btn henna" id="retry">다시 시도</button>
    </section>`;
    document.getElementById("retry").addEventListener("click", () => location.reload());
    return;
  }
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  if (!state.dialect) state.dialect = "egypt";
  await splash.ready;
  if (state.introSeen) screenHome();
  else screenIntro();
  splash.finish();
})();
