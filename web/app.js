// 아라비오 — 웹 시제품
// 데이터: data/sentences.json (build_data.py가 sentences_300.csv로 만든다)
// 진도: 브라우저 localStorage에 방언별로 저장한다.

const STORE_KEY = "three-sentences-arabic-v1";
const REVIEW_INTERVALS = [1, 3, 7, 14, 30]; // '외웠어요'를 누를 때마다 다음 복습까지 늘어나는 날 수
const DIALECTS = {
  egypt: { name: "이집트", ar: "مصر", en: "EGYPT", city: "카이로", lang: "ar-EG" },
  jordan: { name: "요르단", ar: "الأردن", en: "JORDAN", city: "암만", lang: "ar-JO" },
};
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
  const value = { dialect: Object.keys(DIALECTS).includes(raw?.dialect) ? raw.dialect : null, progress: {}, audioRate: [0.8, 1, 1.2].includes(raw?.audioRate) ? raw.audioRate : 1 };
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

function withSlot(text, word, filled = false) {
  const i = text.indexOf(word);
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<span class="slot${filled ? " filled" : ""}" role="img" aria-label="${filled ? esc(word) : "빈칸"}"><span aria-hidden="true">${esc(word)}</span></span>${esc(text.slice(i + word.length))}`;
}

function withMark(text, word) {
  const i = word ? text.indexOf(word) : -1;
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(word)}</mark>${esc(text.slice(i + word.length))}`;
}

// 아랍어 조각이 섞인 한국어 설명을 순서가 꼬이지 않게 감싼다.
function mixed(text) {
  return esc(text).replace(/[؀-ۿ]+(?:[ .…]+[؀-ۿ]+)*/g, (m) => `<bdi dir="rtl" lang="ar" class="ar-inline">${m}</bdi>`);
}

function variantLabel(s, word) {
  const other = state.dialect === "egypt" ? "jordan" : "egypt";
  if (word === s[state.dialect].blank) return DIALECTS[state.dialect].name;
  if (word === s[other].blank) return DIALECTS[other].name;
  if (word === s.fusha.blank) return "푸스하";
  return "";
}

const ICON = {
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z"/></svg>`,
  check: `<svg class="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
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

// 아랍어 문장을 단어 단위로 차례로 띄운다
function wordsIn(el, base = 300) {
  if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let i = 0;
  [...el.childNodes].forEach((node) => {
    if (node.nodeType !== 3) {
      node.classList.add("w-in");
      node.style.animationDelay = `${base + i++ * 100}ms`;
      return;
    }
    const frag = document.createDocumentFragment();
    node.textContent.split(/(\s+)/).forEach((part) => {
      if (!part.trim()) { frag.append(part); return; }
      const s = document.createElement("span");
      s.className = "w-in";
      s.textContent = part;
      s.style.animationDelay = `${base + i++ * 100}ms`;
      frag.append(s);
    });
    node.replaceWith(frag);
  });
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

document.addEventListener("visibilitychange", () => { if (document.hidden) stopAudio(); });

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
    const audio = new Audio(`audio/${file}`);
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
  document.querySelector(".sheet")?.remove();
  app.getAnimations().forEach(animation => animation.cancel());
  app.innerHTML = html;
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    app.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  app.dataset.screen = tab || (app.querySelector(".ob") ? "onboarding" : "lesson");
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

// ---------- 시작: 방언 고르기 ----------

function screenOnboarding() {
  window.onscroll = null;
  const savedDialect = DIALECTS[state.dialect];
  show(`
    <section class="ob">
      <div class="top">
        <h1 class="brand-name in" style="--d:0">아라비오</h1>
      </div>
      ${savedDialect ? `<div class="resume-learning in" style="--d:1"><p>${savedDialect.name} 아랍어 · ${progress().completedDays.length}일 완료</p><button class="btn henna" id="resume-learning">학습 이어하기 ${ICON.arrow}</button></div>` : ""}
      <div class="picks">
        ${Object.entries(DIALECTS).map(([key, d], i) => `
          <button class="pick in" style="--d:${4 + i}" data-dialect="${key}">
            <span class="pick-index" aria-hidden="true">0${i + 1}</span><span><span class="nm">${d.name}</span><span class="sub" style="display:block">${d.city} · 100일 300문장</span></span>
            <span class="arn" lang="ar" dir="rtl">${d.ar}</span><span class="pick-arrow">${ICON.arrow}</span>
          </button>`).join("")}
      </div>
      <p class="foot in" style="--d:6">나중에 설정에서 바꿀 수 있어요. 진도는 방언별로 따로 저장돼요.</p>
    </section>`, { tabs: false });
  document.getElementById("resume-learning")?.addEventListener("click", screenHome);
  app.querySelectorAll("[data-dialect]").forEach((b) => b.addEventListener("click", () => {
    state.dialect = b.dataset.dialect;
    progress();
    saveState();
    screenHome();
  }));
}

// ---------- 홈: 100일의 길 ----------

function unitBanner(u) {
  return `
    <div class="swap">
      <p class="label">UNIT ${u.unit} · DAY ${u.firstDay}–${u.lastDay} · ${u.level}</p>
      <p class="un">${esc(u.name)}</p>
      <p class="uk" dir="rtl" lang="ar">${esc(u.key.startsWith("(") ? "" : u.key.replace(/→/g, "←"))}</p>
    </div>
    <span class="unum">${arNum(u.unit)}</span>`;
}

function screenHome() {
  const p = progress();
  const now = nextDay();
  const finished = p.completedDays.length >= 100;
  const st = streak();
  const due = dueReviews().length;
  show(`
    <header class="topbar">
      <span class="wordmark">아라비오</span>
      <span class="streak ${st ? "" : "off"}">${ICON.flame} ${st}일 연속</span>
    </header>
    <section class="home-hero in">
      <div><h1>${DIALECTS[state.dialect].name} 아랍어</h1>
      <p class="hero-note">${finished ? "100일 학습 완료" : `DAY ${now} · ${esc(unitOfDay(now).name)}`}</p></div>
      <span class="country-script" lang="ar" dir="rtl">${DIALECTS[state.dialect].ar}</span>
    </section>
    <div class="home-stats"><div><b>${p.completedDays.length}<small> / 100</small></b><span>완료한 날</span></div><div><b>${Object.keys(p.srs).length}<small> 문장</small></b><span>배운 문장</span></div><div><b>${p.xp}<small> XP</small></b><span>경험치</span></div></div>
    <section class="today-card in" style="--d:1"><div class="today-heading"><span class="eyebrow">${finished ? "다시 만나는 세 문장" : "오늘의 세 문장"}</span><span class="day-chip">DAY ${now}</span></div>
      <p class="daily-ar" lang="ar" dir="rtl">${esc(sentencesOfDay(now)[0][state.dialect].blank)}</p>
      <h2>${esc(sentencesOfDay(now)[0].gloss[sentencesOfDay(now)[0][state.dialect].blank] || unitOfDay(now).name)}</h2><p class="lesson-types">대화 / 표현 비교 / 연습 / 말하기</p>
      <button class="btn henna" id="today-start">${finished ? "다시 연습하기" : "오늘 학습 시작"} ${ICON.arrow}</button>
    </section>
    ${due ? `<button class="review-link" id="review"><span>오늘 복습 <b>${due}문장 복습</b></span>${ICON.arrow}</button>` : ""}
    <div class="journey-heading"><h2>학습 단원</h2><label class="unit-select"><span class="sr-only">학습 단원</span><select id="unit-select">${DATA.units.map(u => `<option value="${u.unit}" ${u.unit === unitOfDay(now).unit ? "selected" : ""}>UNIT ${u.unit} · ${esc(u.name)}</option>`).join("")}</select></label></div>
    <div class="unitban" id="unitban">${unitBanner(unitOfDay(now))}</div>
    <div class="path" id="path"></div>`, { tab: "home" });
  document.getElementById("today-start").addEventListener("click", () => startLesson(now, sentencesOfDay(now), finished ? "again" : "lesson"));
  document.getElementById("review")?.addEventListener("click", screenReview);
  renderPath(now, finished, unitOfDay(now).unit);
  document.getElementById("unit-select").addEventListener("change", e => {
    const unit = Number(e.target.value);
    document.getElementById("unitban").innerHTML = unitBanner(DATA.units.find(u => u.unit === unit));
    renderPath(now, finished, unit);
  });
}

function renderPath(now, finished, selectedUnit) {
  const unit = DATA.units.find(u => u.unit === selectedUnit);
  const done = new Set(progress().completedDays);
  const days = Array.from({ length: unit.lastDay - unit.firstDay + 1 }, (_, i) => unit.firstDay + i);
  const box = document.getElementById("path");
  box.innerHTML = days.map((day, index) => {
    const completed = done.has(day);
    const current = !finished && day === now;
    const locked = !completed && !current;
    const list = sentencesOfDay(day);
    return `<article class="day-entry ${current ? "current" : ""} ${completed ? "completed" : ""} in" style="--d:${index}">
      <button class="day-row" data-day="${day}" ${locked ? "disabled" : ""} aria-label="${day}일차${completed ? " 다시 학습" : current ? " 학습 시작" : " 잠김"}">
        <span class="day-index">${String(day).padStart(2, "0")}</span>
        <span class="day-copy"><b>${esc(list[0].ko[list[0].blankSide])}</b><small>${current ? "학습 가능" : completed ? "학습 완료 · 다시 연습" : "이전 학습 완료 후 시작"} · 3문장</small></span>
        <span class="day-status" aria-hidden="true">${completed ? "✓" : locked ? "—" : ICON.arrow}</span>
      </button>
      ${current ? `<div class="day-detail"><ol>${list.map(sentence => `<li>${esc(sentence.ko[sentence.blankSide])}</li>`).join("")}</ol><button class="btn henna" id="start">DAY ${day} 시작 ${ICON.arrow}</button></div>` : ""}
    </article>`;
  }).join("");
  box.querySelectorAll("[data-day]:not(:disabled)").forEach(button => button.addEventListener("click", () => {
    const day = Number(button.dataset.day);
    startLesson(day, sentencesOfDay(day), done.has(day) ? "again" : "lesson");
  }));
  document.getElementById("start")?.addEventListener("click", () => startLesson(now));
  window.onscroll = null;
}

// ---------- 레슨 ----------

let lesson = null;

function lessonQueue(list, mode) {
  if (mode === "review") return list.flatMap((_, index) => [{ index, type: 4 }, { index, type: 6 }]);
  // Pair each Fusha dialogue with its dialect expression before practice.
  return [
    ...list.flatMap((_, index) => [{ index, type: 0 }, { index, type: 3 }]),
    ...list.map((_, index) => ({ index, type: index % 2 === 1 ? 4 : 1 })),
    ...list.map((_, index) => ({ index, type: 6 })),
  ];
}

function startLesson(day, list = sentencesOfDay(day), mode = "lesson") {
  window.onscroll = null;
  lesson = { day, list, mode, queue: lessonQueue(list, mode), cursor: 0, index: 0, ratings: {}, mistakes: {}, transitioning: false };
  renderStep();
}

function lessonPos() { return lesson.cursor; }

function frame(inner) {
  const s = lesson.list[lesson.index];
  const total = lesson.queue.length;
  show(`
    <header class="lhead">
      <button class="icon" id="quit" aria-label="그만하기">${ICON.x}</button>
      <div class="prog"><i style="width:${(lessonPos() / total) * 100}%"></i></div>
      <span class="stepno">${lessonPos() + 1} / ${total}</span>
    </header>
    <div class="lesson-stage"><span>${({0:"01 푸스하 · 대화 보기",3:"01 암미야 · 표현 비교",1:"02 연습하기",4:lesson.mode === "review" ? "복습" : "02 연습하기",6:"03 말하기"})[lesson.queue[lesson.cursor].type]}</span><span>표현 ${lesson.index + 1} / ${lesson.list.length}</span></div>
    <section class="lesson">${inner}</section>
    `, { tabs: false });
  requestAnimationFrame(() => {
    const bar = app.querySelector(".prog i");
    if (bar) bar.style.width = `${((lessonPos() + 1) / total) * 100}%`;
  });
  document.getElementById("quit").addEventListener("click", () => {
    if (confirm("지금 그만두면 이번 학습 진도는 저장되지 않아요. 그만할까요?")) screenHome();
  });
  bindPlay(s);
}

function next() {
  if (lesson.transitioning) return;
  stopAudio();
  const activeLesson = lesson;
  lesson.transitioning = true;
  document.querySelector(".sheet")?.classList.remove("up");
  setTimeout(() => {
    if (lesson !== activeLesson || !document.getElementById("quit")) return;
    lesson.cursor += 1;
    lesson.transitioning = false;
    if (lesson.cursor >= lesson.queue.length) finishLesson();
    else renderStep();
  }, 180);
}

function renderStep() {
  const entry = lesson.queue[lesson.cursor];
  lesson.index = entry.index;
  const s = lesson.list[entry.index];
  ({ 0: stepPreview, 1: stepMeaning, 3: stepCompare, 4: stepDialectBlank, 6: stepRecall })[entry.type](s);
}

function dialogueLines(s, variant, korean = true) {
  return ["A", "B"].map(side => `<div class="dialogue-line"><div class="speaker-line"><span>${side}</span>${playBtn(variant, side, "듣기")}</div>${ar(esc(s[variant][side]))}${korean ? `<p class="dialogue-ko">${esc(s.ko[side])}</p>` : ""}</div>`).join("");
}

function stepPreview(s) {
  frame(`<p class="label in">${esc(s.unitName)} · 푸스하</p>
    <h2 class="title in" style="--d:1">대화를 먼저 읽고 들어보세요</h2>
    <div class="dialogue-preview in" style="--d:2">${dialogueLines(s, "fusha")}</div>
    <button class="btn henna in" style="--d:3;margin-top:24px" id="go">${DIALECTS[state.dialect].name} 암미야 보기 ${ICON.arrow}</button>`);
  document.getElementById("go").addEventListener("click", next);
}

function openSheet({ good, title, body }) {
  document.querySelector(".sheet")?.remove();
  const sh = document.createElement("div");
  sh.className = `sheet ${good ? "" : "bad"}`;
  sh.setAttribute("role", "region");
  sh.setAttribute("aria-labelledby", "feedback-title");
  sh.innerHTML = `<p class="t" id="feedback-title">${title}</p><div class="msg">${body}</div><button class="btn ${good ? "ok" : ""}" id="next">계속</button>`;
  document.body.appendChild(sh);
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add("up")));
  sh.querySelector("#next").addEventListener("click", next);
  bindPlay(lesson.list[lesson.index], sh);
  sh.querySelector("#next").focus({ preventScroll: true });
}

// 3지선다 공통
function quiz({ kicker, title, prompt, answer, wrong, arabic, glossOf, onRight, sheetBody }) {
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
      openSheet({ good: right, title: right ? "정답이에요" : "아쉬워요, 정답은 이거예요", body: sheetBody() });
    }, right ? 0 : 450);
  }));
}

function stepMeaning(s) {
  const side = s.blankSide;
  const hasAudio = Boolean(s.fusha.audio[side]);
  quiz({
    kicker: hasAudio ? "푸스하 · 듣기" : "푸스하 · 읽기",
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
    <div class="expression-pair in" style="--d:2">
      <div><span class="label">푸스하</span>${ar(esc(s.fusha.blank), "big")}</div>
      <span class="expression-arrow" aria-hidden="true">↓</span>
      <div><span class="label">${DIALECTS[d].name}</span>${ar(esc(s[d].blank), "big")}</div>
    </div>
    <div class="target-example in" style="--d:3">${playBtn(d, s.blankSide, "문장 듣기")}${ar(withMark(s[d][s.blankSide], s[d].blank))}<p class="dialogue-ko">${esc(s.ko[s.blankSide])}</p></div>
    <details class="other"><summary>전체 대화와 설명</summary>
      <div class="dialogue-preview">${dialogueLines(s, d)}</div>
      <ul class="notes">${(s.notesByDialect[d] || []).map(n => `<li>${mixed(n)}</li>`).join("")}</ul>
      ${(s.memosByDialect[d] || []).map(memo => `<p class="memo">${mixed(memo)}</p>`).join("")}
    </details>
    <details class="other"><summary>${DIALECTS[other].name} 표현도 보기</summary>${ar(esc(s[other].A))}${ar(esc(s[other].B))}</details>
    <button class="btn henna" style="margin-top:24px" id="go">${lesson.index === lesson.list.length - 1 ? "연습 시작" : "다음 푸스하 대화"} ${ICON.arrow}</button>`);
  document.getElementById("go").addEventListener("click", next);
}

function stepDialectBlank(s) {
  const d = state.dialect;
  const side = s.blankSide;
  quiz({
    kicker: `${DIALECTS[d].name} 사람처럼`,
    title: "빈칸에 들어갈 말은?",
    prompt: `<p class="ko in" style="--d:2">${esc(s.ko[side])}</p><div class="sent" id="sent">${ar(withSlot(s[d][side], s[d].blank))}</div>`,
    answer: s[d].blank,
    wrong: s[d].wrong,
    arabic: true,
    glossOf: (o) => [s.gloss[o], variantLabel(s, o)].filter(Boolean).join(" · "),
    onRight: () => {
      const slot = document.querySelector("#sent .slot");
      slot.classList.add("filled");
      slot.setAttribute("aria-label", s[d].blank);
      speak(s, d, side);
    },
    sheetBody: () => `<div style="display:flex;align-items:center;gap:10px">${playBtn(d, side)}${ar(esc(s[d][side]))}</div><p style="margin-top:6px">${esc(s[d].blank)} = ${esc(s.gloss[s[d].blank] || "")}</p>`,
  });
  wordsIn(document.querySelector("#sent .ar"), 300);
}

// End with each original A/B dialogue; do not splice unrelated source dialogues.
function stepRecall(s) {
  const d = state.dialect;
  frame(`<p class="label in">${DIALECTS[d].name} · 대화 ${lesson.index + 1}</p>
    <h2 class="title in" style="--d:1">한국어만 보고 대화해 보세요</h2>
    <p class="ko">상대의 말을 읽고, ‘핵심 표현’이 표시된 역할을 아랍어로 말해 보세요.</p>
    <div class="recall card in" style="--d:2">${["A","B"].map(side => `<p class="who">${side}${side === s.blankSide ? " · 핵심 표현" : ""}</p><p class="big-ko">${esc(s.ko[side])}</p>`).join("")}</div>
    <div class="answer" id="answer"><button class="btn" id="reveal">말해봤어요 · 정답 확인</button></div>`);
  document.getElementById("reveal").addEventListener("click", () => {
    const box = document.getElementById("answer");
    box.innerHTML = `<div class="dialogue-preview in">${dialogueLines(s, d, false)}</div>
      <p class="rating-hint">${lesson.mistakes[s.id] ? "연습에서 틀린 표현은 내일 다시 복습해요." : "헷갈린 표현은 내일, 기억한 표현은 복습 일정에 반영해요."}</p>
      <div class="rate"><button class="btn ghost" data-rate="0">헷갈려요</button><button class="btn henna" data-rate="1">말할 수 있어요</button></div>`;
    bindPlay(s);
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
  for (const s of lesson.list) rate(s.id, lesson.ratings[s.id] === true, false);
  const p = progress();
  const counts = lesson.mode === "lesson";
  const gained = lesson.list.length * 10;
  p.xp += gained;
  p.history[today()] = (p.history[today()] || 0) + lesson.list.length;
  let unitJustDone = null;
  if (counts && !p.completedDays.includes(lesson.day)) {
    p.completedDays.push(lesson.day);
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
      <p class="xp in" style="--d:3"><span>연속 <b>${streak()}일</b></span><span><b>+${gained}</b> 경험치</span></p>
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
      <button class="btn in" style="--d:6" id="home">홈으로</button>
    </section>`, { tabs: false });
  if (isDay) setTimeout(() => burst(document.getElementById("seal"), 14), 1650);
  document.getElementById("home").addEventListener("click", screenHome);
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
  const other = state.dialect === "egypt" ? "jordan" : "egypt";
  show(`
    <div class="page-head"><h1>설정</h1><span class="wordmark">아라비오</span></div><p class="page-description">학습 방언 및 진도 관리</p>
    <div class="setting in" style="--d:0">
      <p>지금 배우는 방언 · <b>${DIALECTS[state.dialect].name}</b> <span class="ar-inline" style="color:var(--henna)">${DIALECTS[state.dialect].ar}</span></p>
      <button class="btn ghost" id="switch">${DIALECTS[other].name} 방언으로 바꾸기</button>
      <p class="small muted" style="margin-top:8px">진도는 방언별로 따로 저장돼요. 다시 바꾸면 이어서 할 수 있어요.</p>
    </div>
    <div class="setting in" style="--d:1">
      <p>${DIALECTS[state.dialect].name} 진도를 처음부터 다시 시작해요.</p>
      <button class="btn line" id="reset">진도 초기화</button>
    </div>
    <div class="setting in" style="--d:2">
      <p class="small muted">푸스하: 아이만 · 이집트: 아슈라프 · 요르단: 야잔<br>AI 생성 음성 · 발음 검수 중. 없는 음성은 준비 중으로 표시해요.<br>문장 300개 · 15단원 · 100일 (원어민 검수 전 초안)</p>
    </div>
    <div class="setting"><div class="audio-speed"><label for="audio-speed">음성 재생 속도</label><select id="audio-speed">${[[0.8,"천천히 · 0.8배"],[1,"기본 · 1배"],[1.2,"빠르게 · 1.2배"]].map(([value,label])=>`<option value="${value}" ${(state.audioRate || 1) === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div>
    ${['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? `<div class="setting"><p>로컬 검수 · 진도 저장 없이 모든 일차 확인</p><a class="btn ghost" href="admin.html?day=8">관리자 검수 열기</a></div>` : ''}`, { tab: "settings" });
  document.getElementById("audio-speed").addEventListener("change", e => {
    state.audioRate = Number(e.target.value);
    saveState();
  });
  document.getElementById("switch").addEventListener("click", () => {
    state.dialect = other;
    progress();
    saveState();
    screenHome();
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

(async function boot() {
  // The interface uses a static paper background; no ambient particles.
  app.innerHTML = `<p class="loading">불러오는 중…</p>`;
  try {
    DATA = await fetch("data/sentences.json", { cache: "no-cache" }).then((r) => r.json());
  } catch {
    app.innerHTML = `<p class="loading">문장 데이터를 불러오지 못했어요. 로컬 서버로 열었는지 확인해 주세요.</p>`;
    return;
  }
  if ("speechSynthesis" in window) speechSynthesis.getVoices();
  screenOnboarding();
})();
