/* ==========================================================
   應用程式初始化進入點 (app.js)
   ========================================================== */

window.addEventListener("DOMContentLoaded", function() {
  buildIconPicker();
  renderGroupRail();
  updateGroupBadge();
  renderWall();
  switchView("wall");
  setupGlobalKeyboardShortcuts();
  setupModalBackdropClose();
  setupRailOverlay();
  initTheme();
  registerServiceWorker();

  // 搜尋框的清空鈕預設藏著，有字才出現
  const clear = el("searchClearBtn");
  if (clear) clear.style.visibility = "hidden";
});

/* 手機版的作品抽屜：點旁邊的暗色區域要關掉。
   沒有這個的話，抽屜開著時整個畫面都點不動，看起來像當掉。 */
function setupRailOverlay() {
  const overlay = el("railOverlay");
  if (overlay) overlay.addEventListener("click", closeRailMobile);
}


/* ---------- Service worker ----------

   讓 app 可以安裝到主畫面並離線使用。只在 https 或 localhost 底下有效；
   用 file:// 直接開會靜默略過。 */

// 開著不動也要能發現新版，不然裝成 app 的人可能好幾天都停在舊版
const SW_UPDATE_CHECK_MS = 30 * 60 * 1000;

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1") return;

  // 要在 register() 之前就抓，而且要抓在最前面。
  // sw.js 有 skipWaiting() + clients.claim()，新的 worker 一裝好就立刻接管，
  // 晚一步去看 controller 就分不出「第一次安裝」和「更新」了。
  let hadController = !!navigator.serviceWorker.controller;

  // 新 worker 接管的那一刻。第一次安裝與更新都會觸發，靠上面那個旗標區分。
  // 用這個而不是只靠 updatefound：register() 回傳時，第一次安裝的
  // updatefound 可能已經發生過了，監聽器掛上去也接不到。
  navigator.serviceWorker.addEventListener("controllerchange", function() {
    if (!hadController) { hadController = true; return; }
    showUpdateModal();
  });

  navigator.serviceWorker.register("sw.js").then(function(reg) {
    // 備援路徑：萬一哪天 sw.js 拿掉了 skipWaiting，新 worker 會停在 waiting
    // 不接管，controllerchange 就不會來，這時要靠 updatefound 才發現得到。
    reg.addEventListener("updatefound", function() {
      const incoming = reg.installing;
      if (!incoming || !hadController) return;
      incoming.addEventListener("statechange", function() {
        if (incoming.state === "installed" || incoming.state === "activated") {
          showUpdateModal();
        }
      });
    });

    // 每次開起來先問一次伺服器有沒有新版
    reg.update().catch(function() {});
    setInterval(function() { reg.update().catch(function() {}); }, SW_UPDATE_CHECK_MS);
  }).catch(function(e) {
    // 註冊失敗只代表沒有離線能力，app 本身照常運作，不需要打擾使用者
    console.warn("Service worker 註冊失敗：", e);
  });
}
