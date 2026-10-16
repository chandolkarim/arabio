// 아라비오 서비스 워커: 인터넷이 없어도 앱이 열리고, 한 번 받은 음성은 다시 받지 않는다.
// VERSION은 index.html의 ?v= 값, version.txt와 같아야 한다(tests/pwa.cjs가 확인). 배포할 때 셋을 함께 올린다.
const VERSION = "20261016-pwa";
const SHELL = `arabio-shell-${VERSION}`;
const AUDIO = "arabio-audio-v1"; // 음성 파일은 이름(?v=검수 번호 포함)으로 구분하므로 버전이 바뀌어도 유지한다
const RUNTIME = "arabio-runtime-v1"; // 글꼴처럼 다른 주소에서 오는 파일

const TEACHERS = ["kkuku", "akkung"].flatMap(who => ["smile", "praise", "sad", "celebrate"].map(mood => `assets/teachers/${who}-${mood}.webp`));
const SHELL_FILES = [
  "./", "index.html", "privacy.html", "manifest.webmanifest", "icon.svg", "data/sentences.json",
  `style.css?v=${VERSION}`, `arabio.css?v=${VERSION}`, `world.css?v=${VERSION}`, `app.js?v=${VERSION}`,
  "assets/landmarks/egypt.jpg", "assets/landmarks/jordan.jpg",
  "assets/icons/icon-192.png", "assets/icons/apple-touch-icon.png", "assets/icons/favicon-32.png",
  ...TEACHERS,
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith("arabio-shell-") && key !== SHELL).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  if (same && url.pathname.endsWith("/version.txt")) return; // 새 버전 확인은 항상 네트워크로
  if (same && url.pathname.includes("/audio/")) event.respondWith(audio(req));
  else if (req.mode === "navigate") event.respondWith(page(req));
  else if (same && url.pathname.endsWith("/data/sentences.json")) event.respondWith(networkFirst(req, SHELL));
  else if (/^https?:$/.test(url.protocol)) event.respondWith(staleWhileRevalidate(req, same ? SHELL : RUNTIME));
});

// 페이지: 새 버전을 먼저 시도하고, 3초 안에 안 오거나 오프라인이면 저장해 둔 페이지.
// 페이지마다 자기 주소로 저장한다(소개 페이지가 앱 첫 화면을 덮어쓰지 않게). ?v= 같은 꼬리는 무시하고 찾는다.
async function page(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000))]);
    if (res.ok) cache.put(new URL(req.url).pathname, res.clone());
    return res;
  } catch {
    const path = new URL(req.url).pathname;
    return (await cache.match(path, { ignoreSearch: true }))
      || (path.endsWith("/") ? (await cache.match("index.html")) || (await cache.match("./")) : null)
      || (await cache.match("index.html"))
      || Response.error();
  }
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const cached = await cache.match(req);
  const update = fetch(req).then(res => {
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  }).catch(() => cached || Response.error());
  return cached || update;
}

// 음성: 한 번 받으면 저장해 두고, 사파리가 보내는 구간 요청(Range)은 저장한 파일을 잘라서 돌려준다.
async function audio(req) {
  const cache = await caches.open(AUDIO);
  const key = req.url;
  let res = await cache.match(key);
  if (!res) {
    const net = await fetch(key); // Range 없이 파일 전체를 받아 저장
    if (!net.ok) return net;
    await cache.put(key, net.clone());
    res = net;
  }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (!range) return res;
  const buf = await res.arrayBuffer();
  const start = range[1] ? Number(range[1]) : Math.max(0, buf.byteLength - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "audio/mp4",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
