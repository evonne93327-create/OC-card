/* ==========================================================
   應用程式初始化進入點 (app.js)
   ========================================================== */

window.addEventListener("DOMContentLoaded", function() {
  verifyAssetVersions();
  buildIconPicker();
  renderGroupRail();
  updateGroupBadge();
  switchView("wall");          // 內含 renderWall()
  setupGlobalKeyboardShortcuts();
  setupModalBackdropClose();
  setupLayoutWatch();
  setupCanvasStage();
  initTheme();
  registerServiceWorker();
});


/* ==========================================================
   開機健檢：HTML 與 CSS 是不是同一版

   實際發生過的事：手機上拿到新的 index.html，但 style.css 還是舊的那一份
   （瀏覽器自己的 HTTP 快取還沒過期）。新 HTML 的 class 名稱在舊 CSS 裡
   一條都不存在，版面整個散掉——使用者看到的是「壞掉的 app」，完全不會
   聯想到快取，也不知道能怎麼辦。

   `?v=` 版本戳讓這件事以後不會再發生，但已經卡在壞狀態的裝置救不回來，
   而且誰也不敢保證沒有別的快取壞法。所以這裡再加一道：

     CSS 自己在 :root 宣告 --css-build，JS 拿它跟 APP_BUILD 比。
     對不上（或根本讀不到，表示 CSS 沒載進來）就自己清快取重載一次。

   只救一次：用 sessionStorage 當旗標，避免「壞掉 → 重載 → 還是壞 → 重載」
   的無限迴圈。救不回來就把話講白，讓使用者知道發生什麼事、可以做什麼。
   ========================================================== */

const CSS_RECOVERY_FLAG = "oc_css_recovery";

function cssBuildVersion() {
  try {
    return getComputedStyle(document.documentElement)
      .getPropertyValue("--css-build").trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    return "";
  }
}

function verifyAssetVersions() {
  const css = cssBuildVersion();
  if (css === APP_BUILD) {
    // 這次是好的，把旗標清掉，下次真的壞了才救得到
    try { sessionStorage.removeItem(CSS_RECOVERY_FLAG); } catch (e) {}
    return;
  }

  let tried = null;
  try { tried = sessionStorage.getItem(CSS_RECOVERY_FLAG); } catch (e) {}

  if (tried) {
    // 救過一次還是不對，別再重載了——講清楚，讓使用者自己決定下一步
    showVersionMismatchNotice(css);
    return;
  }

  try { sessionStorage.setItem(CSS_RECOVERY_FLAG, "1"); } catch (e) {
    /* 隱私模式下連 sessionStorage 都可能不能寫。寫不了就不自動重載，
       直接顯示提示——沒有旗標就沒有防迴圈的保險。 */
    showVersionMismatchNotice(css);
    return;
  }

  console.warn("HTML 是 v" + APP_BUILD + "、CSS 是 v" + (css || "?") + "，自動清快取重載一次");
  forceRefreshApp({ silent: true });
}

/* 救不回來時的提示。

   刻意用 inline style 寫死，不吃 style.css 的任何 class——會走到這裡就
   表示 CSS 本身有問題，用 class 做的提示很可能也是壞的（或根本看不見）。 */
function showVersionMismatchNotice(cssBuild) {
  const box = document.createElement("div");
  box.setAttribute("style", [
    "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483647",
    "background:#7A2016", "color:#fff", "padding:14px 16px",
    "font:600 14px/1.6 system-ui,-apple-system,sans-serif",
    "box-shadow:0 -4px 16px rgba(0,0,0,.35)", "text-align:left"
  ].join(";"));

  const msg = document.createElement("div");
  msg.textContent = "這個瀏覽器抓到的程式檔案版本不一致（畫面 v" + APP_BUILD +
    "、樣式 v" + (cssBuild || "讀不到") + "），版面會跑掉。自動修復沒有成功。";
  box.appendChild(msg);

  const hint = document.createElement("div");
  hint.setAttribute("style", "font-weight:400;opacity:.85;margin-top:4px");
  hint.textContent = "你的角色卡都還在，不會因為這個不見。";
  box.appendChild(hint);

  const btn = document.createElement("button");
  btn.setAttribute("style", [
    "margin-top:10px", "padding:8px 14px", "border:none", "border-radius:8px",
    "background:#fff", "color:#7A2016", "font:600 14px system-ui,sans-serif", "cursor:pointer"
  ].join(";"));
  btn.textContent = "清除快取並重新載入";
  btn.onclick = function() { forceRefreshApp({ silent: true }); };
  box.appendChild(btn);

  document.body.appendChild(box);
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
