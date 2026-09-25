/* ==========================================================
   Service Worker — 離線支援

   策略刻意選「網路優先、離線才回退快取」，而不是一般 PWA 常見的
   快取優先。這個 app 靠 GitHub Pages 持續更新，快取優先會讓使用者
   被鎖在舊版程式碼裡，而且很難自己救回來（強制重新整理也未必有用，
   因為回應是 service worker 給的，根本沒碰到網路）。

   代價是連線正常時不會變快——對這個 app 來說無所謂，反正資料都在
   本機 localStorage，網路只負責抓靜態檔。換來的是「更新一定拿得到」。

   動到 index.html 引用的任何檔案，就把下面的 VERSION 加一號，
   否則舊快取不會被清掉。tests/shell-manifest.test.js 會檢查 SHELL
   這份清單跟 index.html 實際載入的檔案對不對得上。

   ---- 為什麼 css/js 的網址要帶 ?v= ----

   網路優先只保證「每個檔案各自是新的」，不保證「這一批是同一版」。
   實際踩到的情況：手機拿到新的 index.html，但 style.css 因為還在瀏覽器
   的 HTTP 快取有效期內（GitHub Pages 給 max-age=600）而是舊的那一份。
   新 HTML 的 class 名稱在舊 CSS 裡一條都不存在，版面整個散掉——而且
   看起來像程式壞了，不像快取問題。

   帶上 ?v=<VERSION> 之後這件事從結構上不可能發生：版本一跳，css/js 的
   網址就變成一個任何快取裡都沒有的新網址，一定會去拿新的；而舊的
   index.html 只會去要舊網址，配到的也是一整套舊的（一致的舊版總比
   半新半舊好，而且十分鐘內會自己好）。
   ========================================================== */

const VERSION = '6';                  // 動到 index.html 引用的檔案就加一號
const CACHE = 'oc-card-v' + VERSION;
const STAMP = '?v=' + VERSION;        // 必須跟 index.html 裡的 ?v= 完全一致

// 離線時要能完整開起來所需的檔案
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './ui-tokens.css' + STAMP,
  './style.css' + STAMP,
  './js/state.js' + STAMP,
  './js/main.js' + STAMP,
  './js/storage.js' + STAMP,
  './js/cards.js' + STAMP,
  './js/editor.js' + STAMP,
  './js/canvas.js' + STAMP,
  './js/modal.js' + STAMP,
  './js/import-export.js' + STAMP,
  './js/theme.js' + STAMP,
  './js/app.js' + STAMP,
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/favicon-48.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 個別加入而不是 addAll：任何一個檔案失敗都會讓 addAll 整批拒絕，
      // 導致 service worker 安裝不起來，離線功能整個沒有。
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* 單一檔案失敗不影響其他 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE) return caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;

  // 只處理自家的 GET。Google Fonts 等跨網域請求一律放行讓瀏覽器自己處理。
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  /* 首頁本身要強制跟伺服器對一次（If-None-Match），不要吃瀏覽器的
     HTTP 快取——不然剛部署的十分鐘內，重新整理拿到的還是舊的 index.html。
     css/js 靠 ?v= 分版就夠了，不需要每次都重新驗證。

     從導覽請求建出帶 cache 選項的 Request 在少數瀏覽器會丟例外，
     所以包起來，失敗就退回原本的請求。 */
  let request = req;
  if (req.mode === 'navigate') {
    try { request = new Request(req, { cache: 'no-cache' }); } catch (e) { request = req; }
  }

  event.respondWith(
    fetch(request).then(function (res) {
      // 只快取正常的同源回應，避免把錯誤頁或不透明回應存進去
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        // 導覽請求（例如離線時直接開 app）退回快取的首頁
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
