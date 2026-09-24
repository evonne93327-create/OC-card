/* ==========================================================
   日間／夜間模式與設定總表 (theme.js)

   主題偏好存在 localStorage，刻意不放進 appData：主題是「這台裝置」的事。
   iPad 晚上想用暗的、電腦想用亮的，放進 appData 會在備份還原時互相覆蓋。

   解析後的結果寫成 <html data-theme="light|dark">，CSS 與 JS 都只看這一個
   值（見 ui-tokens.css 的夜間區塊與 state.js 的 isDarkTheme）。讓 JS 成為
   唯一的判斷來源，是因為卡片的標籤底色是 JS 直接寫進 style 的，CSS 的
   @media (prefers-color-scheme) 管不到它們——兩邊各自解讀就會出現一半亮
   一半暗的畫面。

   index.html 的 <head> 裡有一份同樣邏輯的極短版，在 CSS 生效前先跑一次，
   避免夜間模式開場閃一下白畫面。兩邊的 key 必須一致。
   ========================================================== */

const THEME_KEY = "oc_theme";                     // 與 index.html <head> 內那份一致
const THEME_CHOICES = ["auto", "light", "dark"];

function getThemePref() {
  const v = safeStorageGet(THEME_KEY);
  return THEME_CHOICES.indexOf(v) >= 0 ? v : "auto";
}

function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return systemPrefersDark() ? "dark" : "light";
}

function applyTheme(pref) {
  const resolved = resolveTheme(pref || getThemePref());
  document.documentElement.setAttribute("data-theme", resolved);

  // 瀏覽器自己的外框（iOS 的狀態列、Android 的網址列）也要跟著換，
  // 不然深色的 app 頂著一條米色的列
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-main").trim();
    if (bg) meta.setAttribute("content", bg);
  }
  return resolved;
}

function setThemePref(pref) {
  if (THEME_CHOICES.indexOf(pref) < 0) pref = "auto";
  safeStorageSet(THEME_KEY, pref);
  applyTheme(pref);
  repaintThemedContent();
  renderThemeChoice();
  renderSettingsRows();
}

/* CSS 變數換完畫面就跟著變了，但卡片的色條、標籤底色、完成度量表是 JS
   直接寫進 style 的，那些得重畫才會換過來。 */
function repaintThemedContent() {
  if (typeof renderWall === "function") renderWall();
  if (typeof renderCardDetail === "function" && openedCardId) renderCardDetail();
  if (activeView === "edit" && typeof renderEditor === "function" && editingCardId) renderEditor();
  const palette = el("paletteModal");
  if (palette && palette.classList.contains("active")) renderPaletteModal();
}

function initTheme() {
  applyTheme();

  // 選「跟隨系統」的時候，系統在半夜自己切換也要跟著換，
  // 不能只在開啟 app 的那一刻判斷一次
  if (!window.matchMedia) return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = function() {
    if (getThemePref() !== "auto") return;
    applyTheme("auto");
    repaintThemedContent();
    renderThemeChoice();
  };
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);   // 舊版 Safari
}


/* ---------- 設定總表 ----------

   設定是一張總表，每一列點進去開各自的視窗。

   點進子視窗時會先把設定關掉，不讓兩個彈窗疊著——它們的 z-index 一樣，
   疊起來只是靠 DOM 順序分勝負，很脆。

   子視窗關掉之後一律回到設定總表：從總表點進去的人心裡是「進了一層」，
   關掉那一層應該退回上一層，而不是整個關光回到主畫面。 */

function openSettingsModal() {
  renderSettingsRows();
  el("settingsModal").classList.add("active");
}

function closeSettingsModal() {
  settingsChildModalId = null;   // 是使用者自己關掉總表，不要再回來
  el("settingsModal").classList.remove("active");
}

let settingsChildModalId = null;

function settingsGoTo(open) {
  closeSettingsModal();
  if (typeof open !== "function") return;
  open();

  /* 哪一個彈窗被打開了，由「開完之後誰是 active」決定，不用在每個
     settingsGoTo(...) 的呼叫點各自寫死 id——那種東西一定會有人漏掉。
     匯入是叫出檔案選擇器、根本沒開彈窗，這時候就什麼都不記。 */
  const opened = document.querySelectorAll(".modal-overlay.active");
  settingsChildModalId = opened.length ? opened[opened.length - 1].id : null;
  if (settingsChildModalId) watchSettingsChild(settingsChildModalId);
}

/* 子視窗關掉時把設定叫回來。

   用 MutationObserver 而不是去改每個 closeXxxModal()：那些關閉函式有好
   幾個，而且有些（垃圾桶、匯出）還會從別的入口打開，在裡面寫死「關掉就
   開設定」會讓從別處進來的人莫名其妙跳出設定。這裡只認「這一次是從設定
   點進去的」。 */
const settingsChildWatched = {};

function watchSettingsChild(id) {
  if (settingsChildWatched[id]) return;
  const modal = el(id);
  if (!modal) return;
  settingsChildWatched[id] = true;

  new MutationObserver(function() {
    if (modal.classList.contains("active")) return;
    if (settingsChildModalId !== id) return;
    settingsChildModalId = null;

    // 子視窗自己又開了別的彈窗（垃圾桶裡的「確定永久刪除？」）時不要插隊，
    // 等那一層也收掉了再回來——否則設定會蓋在確認視窗底下
    if (document.querySelector(".modal-overlay.active")) return;
    openSettingsModal();
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });
}

function renderSettingsRows() {
  const v = el("appearanceRowValue");
  if (v) {
    const pref = getThemePref();
    v.textContent = pref === "light" ? "日間" : (pref === "dark" ? "夜間" : "跟隨系統");
  }

  const t = el("trashRowValue");
  if (t) t.textContent = appData.trash.cards.length + " 張";

  /* 「多少張卡」放說明那一行、「用掉多少空間」放右邊的值。
     反過來的話，右邊那串長字會把說明擠成兩行，兩邊都難讀。 */
  const desc = el("statsRowDesc");
  if (desc) {
    desc.textContent = appData.cards.length + " 張角色卡 ・ " +
      appData.groups.length + " 個作品（瀏覽器本機上限約 5MB）";
  }

  const used = localStorageUsage();
  const size = el("storageRowValue");
  if (size) {
    size.textContent = used === null ? "—"
      : (used / 1024 < 1024 ? Math.round(used / 1024) + " KB"
                            : (used / 1024 / 1024).toFixed(1) + " MB");
  }

  const b = el("buildRowValue");
  if (b) b.textContent = "v" + APP_BUILD;
}

/* 強制更新：把 service worker 與它的快取全部丟掉再重新載入。

   這是「自救按鈕」。網路優先的策略已經讓人很難被鎖在舊版，但快取這種
   東西總有想不到的壞法（瀏覽器自己的 HTTP 快取、裝成 app 之後的
   啟動畫面、同步到一半斷線…），而使用者遇到時只會看到「版面跑掉了」，
   不會知道那是快取問題，更不會知道怎麼救。

   卡片資料在 localStorage，完全不碰——這件事一定要在確認視窗裡講明白，
   不然沒有人敢按下去。 */
function forceRefreshApp() {
  if (!confirm("清掉這個 app 的程式快取並重新載入？\n\n" +
               "你的角色卡存在瀏覽器本機，不會被清掉，也不需要重新匯入。\n" +
               "這個動作只是把畫面與程式碼換成伺服器上最新的那一份。")) return;

  const done = function() {
    /* 網址加一個時間戳再重新載入：光是 reload() 有可能還是吃到瀏覽器
       自己的 HTTP 快取，那就白清了。 */
    location.replace(location.pathname + "?r=" + Date.now());
  };

  const jobs = [];
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function(regs) {
        return Promise.all(regs.map(function(r) { return r.unregister(); }));
      }));
    }
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      }));
    }
  } catch (e) {
    console.error("清快取失敗：", e);
  }

  // 清不掉也要重新載入——帶時間戳的網址本身就已經繞過大部分快取了
  Promise.all(jobs).then(done).catch(function(e) { console.error(e); done(); });
}

function openAppearanceModal() {
  /* 自己也把設定收起來，不倚賴呼叫端先做。settingsGoTo() 已經關過一次，
     重複關是無害的；但從別處直接呼叫這個函式時，少了這一行就會兩層疊著。 */
  closeSettingsModal();
  renderThemeChoice();
  el("appearanceModal").classList.add("active");
}

function closeAppearanceModal() {
  /* 外觀視窗只有設定總表一個入口，所以在這裡直接回去就好，不用等監看器。
     從 settingsGoTo() 進來的情況也不會開兩次：監看器看到「已經有彈窗
     開著」就不會再動作。 */
  el("appearanceModal").classList.remove("active");
  openSettingsModal();
}

function renderThemeChoice() {
  const pref = getThemePref();
  const row = el("themeChoiceRow");
  if (!row) return;

  row.querySelectorAll(".theme-opt").forEach(function(btn) {
    const on = btn.getAttribute("data-theme") === pref;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  // 選「跟隨系統」時，把現在實際是哪一邊講出來，否則使用者只看到一個
  // 沒有回饋的選項，不知道系統現在給的是什麼
  const hint = el("themeAutoHint");
  if (hint) {
    hint.textContent = (pref === "auto")
      ? ("跟隨這台裝置的設定，目前是" + (resolveTheme("auto") === "dark" ? "夜間" : "日間"))
      : "";
  }
}
