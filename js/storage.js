/* ==========================================================
   存儲與資料遷移 (storage.js)

   saveData() 是所有資料異動的唯一出口。要改 appData 的地方一律改完
   呼叫它一次，不要自己去碰 localStorage——集中在這裡才有辦法統一處理
   「存不進去」這件事。
   ========================================================== */

const DATA_KEY = "oc_card_archive_v1";
const UI_KEY = "oc_card_ui_state";

const savedRaw = safeStorageGet(DATA_KEY);
if (savedRaw) {
  try {
    const parsed = JSON.parse(savedRaw);
    // 只要解析得出來、而且形狀對，就採用。空的 cards 是合法狀態
    // （使用者可能真的把卡片全刪了），不能拿長度當「有沒有資料」的判準。
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.cards) &&
        Array.isArray(parsed.groups)) {
      appData = parsed;
    }
  } catch (e) { console.error("讀取存檔失敗：", e); }
}

const savedUI = safeStorageGet(UI_KEY);
if (savedUI) {
  try {
    const ui = JSON.parse(savedUI);
    if (typeof ui.activeGroupId === "string") activeGroupId = ui.activeGroupId;
    if (SORT_MODES[ui.sortMode]) sortMode = ui.sortMode;
  } catch (e) { console.error(e); }
}


/* ---------- 形狀補齊 ----------

   舊版存檔缺欄位、或使用者手動改過 JSON 又匯回來的情況，一律在這裡補成
   完整形狀。渲染端因此可以直接假設欄位存在，不用每處都寫 `|| []`——那種
   防禦寫法漏一個地方就是一個白畫面。 */
(function normalizeLoadedData() {
  if (!appData || typeof appData !== "object") appData = JSON.parse(JSON.stringify(INITIAL_APP_DATA));
  if (!Array.isArray(appData.groups) || !appData.groups.length) {
    appData.groups = [{ id: "g_main", name: "我的角色", icon: "🎭" }];
  }
  if (!Array.isArray(appData.cards)) appData.cards = [];
  if (!appData.colorPalette || typeof appData.colorPalette !== "object") {
    appData.colorPalette = JSON.parse(JSON.stringify(DEFAULT_PALETTES));
  }
  // 新增的分類色要補進舊存檔，不然「分類設定」會少幾格
  paletteKeys().forEach(function(k) {
    if (!appData.colorPalette[k]) {
      appData.colorPalette[k] = JSON.parse(JSON.stringify(DEFAULT_PALETTES[k]));
    }
  });

  if (!appData.trash || typeof appData.trash !== "object") appData.trash = {};
  if (!Array.isArray(appData.trash.cards)) appData.trash.cards = [];
  if (!Array.isArray(appData.trash.groups)) appData.trash.groups = [];

  appData.cards.forEach(function(c) { ensureCardShape(c); });

  // 上次停留的分組被刪掉了就回到第一個，否則會看到一片空的卡片牆，
  // 而且怎麼按都沒反應
  if (!appData.groups.some(function(g) { return g.id === activeGroupId; })) {
    activeGroupId = appData.groups[0].id;
  }
})();

/* 把一張卡片補成完整形狀。匯入、還原垃圾桶、載入舊存檔都會經過這裡。 */
function ensureCardShape(c) {
  if (!c || typeof c !== "object") return c;
  const str = function(v) { return typeof v === "string" ? v : ""; };

  c.id = str(c.id) || ("card_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7));
  c.groupId = str(c.groupId);
  c.name = str(c.name);
  c.alias = str(c.alias);
  c.icon = str(c.icon) || "🎭";
  c.avatar = isSafeImageSrc(c.avatar) ? c.avatar : "";
  c.color = DEFAULT_PALETTES[c.color] ? c.color : "c_gray";
  c.tagline = str(c.tagline);

  c.fields = Array.isArray(c.fields) ? c.fields.filter(isPlainObject).map(function(f) {
    return { label: str(f.label), value: str(f.value) };
  }).slice(0, MAX_FIELDS_PER_CARD) : [];

  c.sections = Array.isArray(c.sections) ? c.sections.filter(isPlainObject).map(function(s) {
    return { label: str(s.label), text: str(s.text) };
  }).slice(0, MAX_SECTIONS_PER_CARD) : [];

  c.tags = Array.isArray(c.tags)
    ? dedupeTags(c.tags.filter(function(t) { return typeof t === "string"; })) : [];

  c.favorite = !!c.favorite;
  c.createdAt = str(c.createdAt) || formatTime(new Date());
  c.updatedAt = str(c.updatedAt) || c.createdAt;
  return c;
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/* 垃圾桶超過保留天數就自動清掉。

   不清的話，刪掉的卡片會永遠佔著 localStorage 那 5MB——帶頭像的更兇。
   使用者以為刪掉了，空間卻沒還回來。

   看不懂的時間格式一律保留，寧可留著也不要誤刪別人的角色。 */
(function purgeExpiredTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = function(item) {
    if (!item) return false;
    if (typeof item.deletedTs === "number") return item.deletedTs < cutoff;
    if (typeof item.deletedAt === "string") {
      // "2026-09-20 22:43" → Safari 不吃空白分隔，要換成 T
      const t = Date.parse(item.deletedAt.replace(" ", "T"));
      if (!isNaN(t)) return t < cutoff;
    }
    return false;
  };

  let removed = 0;
  ["cards", "groups"].forEach(function(kind) {
    const before = appData.trash[kind].length;
    appData.trash[kind] = appData.trash[kind].filter(function(i) { return !expired(i); });
    removed += before - appData.trash[kind].length;
  });
  if (removed) safeStorageSet(DATA_KEY, JSON.stringify(appData));
})();


/* ---------- 存檔 ---------- */

/* localStorage 滿了的時候只提醒一次，不要每敲一個字就跳一次。
   等到真的存成功了才把旗標放掉——中間都還在危險狀態。 */
let storageFullNotified = false;

function saveData() {
  const err = safeStorageSet(DATA_KEY, JSON.stringify(appData));
  if (!err) {
    saveUIState();
    storageFullNotified = false;
    return true;
  }

  /* localStorage 大約只有 5MB，而頭像是整張 base64 存進去的。滿了之後
     setItem 會丟 QuotaExceededError——沒接的話畫面上還是使用者剛打的字、
     硬碟上卻還是上一次成功存檔的版本，而且完全沒有任何提示。
     關掉分頁就沒了。這裡一定要讓它浮出水面。 */
  console.error("saveData 失敗：", err);
  notifyStorageFull(err);
  return false;
}

function saveUIState() {
  safeStorageSet(UI_KEY, JSON.stringify({ activeGroupId: activeGroupId, sortMode: sortMode }));
}

function notifyStorageFull(err) {
  const isQuota = err && (err.name === "QuotaExceededError" ||
                          err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22);
  // 空間滿了跟「瀏覽器根本不讓存」是兩回事，能做的事也完全不同
  const isBlocked = !isQuota && !storageAvailable();
  if (storageFullNotified) return;
  storageFullNotified = true;

  const modal = document.getElementById("storageFullModal");
  if (!modal) {
    // 極端狀況（彈窗還沒載入）至少要吵一下，不能靜悄悄
    alert(isQuota ? "儲存空間已滿，這次的修改沒有存進這台裝置！請立刻備份。"
      : isBlocked ? "這個瀏覽器不允許本機儲存，你的修改不會被保存！請立刻備份。"
      : "存檔失敗：" + (err && err.message ? err.message : "未知錯誤"));
    return;
  }

  const detail = document.getElementById("storageFullDetail");
  if (detail) {
    detail.textContent = isQuota
      ? "這台裝置的瀏覽器儲存空間（約 5MB）已經滿了，通常是卡片的頭像圖片佔掉的。"
      : isBlocked
      ? "這個瀏覽器不允許網站在本機儲存資料（可能是隱私／無痕模式，或設定裡關掉了網站資料）。" +
        "在這個狀態下，所有的修改都只存在記憶體裡，關掉分頁就會消失。"
      : "存檔時發生錯誤：" + (err && err.message ? err.message : "未知錯誤");
  }

  const hint = document.getElementById("storageFullHint");
  if (hint) {
    hint.textContent = isBlocked
      ? "解決方法：關掉隱私／無痕模式，或在瀏覽器設定裡允許這個網站儲存資料。"
      : "騰出空間的方法：把不用的卡片頭像換成 emoji、清空垃圾桶（設定 → 垃圾桶），" +
        "或先匯出成 JSON 備份之後刪掉幾張卡片。";
  }
  modal.classList.add("active");
}

function closeStorageFullModal() {
  document.getElementById("storageFullModal").classList.remove("active");
}

/* 目前用掉多少 localStorage，給提示視窗顯示用 */
function localStorageUsage() {
  let used = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      used += k.length + (localStorage.getItem(k) || "").length;
    }
  } catch (e) { return null; }
  return used;
}


/* ---------- 離開之前補存 ----------

   編輯面板是打完停手 600ms 才存的，所以打完最後一句立刻關掉分頁，
   那 600ms 的字會掉。

   而且不能只靠 beforeunload：iOS 的 PWA 幾乎不觸發它（系統把 app 從背景
   回收時根本不會跑）。visibilitychange 的 hidden 才是 iOS 上可靠的那一個，
   pagehide 則補桌面版關分頁的情況。三個都掛上，重複存一次沒有壞處。

   localStorage 是同步寫入的，在這些事件裡寫得完，不用擔心來不及。 */
function flushBeforeLeaving() {
  try {
    if (typeof flushEditorDraft === "function") flushEditorDraft();
  } catch (e) { console.error(e); }
  try { saveUIState(); } catch (e) { /* 滿了的話上面已經提醒過 */ }
}


/* ---------- 多分頁互相覆蓋 ----------

   兩個分頁同時開著，各自的 appData 在記憶體裡分岔，誰後存誰贏——先寫的
   那邊整段進度會被另一邊的舊狀態蓋掉，而且兩邊都不知道發生過這件事。

   storage 事件只會在「其他分頁」寫入時觸發（自己寫不會收到），正好拿來
   偵測。刻意不自動採用：這個分頁可能正打到一半，直接換掉會把使用者手上
   的東西弄丟。跳出來讓他自己選，並且講清楚兩邊各是什麼狀態。 */
let otherTabNoticeShown = false;

function handleOtherTabWrite(e) {
  if (!e || e.key !== DATA_KEY || !e.newValue) return;
  if (otherTabNoticeShown) return;
  otherTabNoticeShown = true;

  let theirCards = "?";
  try { theirCards = (JSON.parse(e.newValue).cards || []).length; } catch (err) {}

  const modal = document.getElementById("otherTabModal");
  if (!modal) {
    if (confirm("另一個分頁修改了資料。要重新載入以採用那一份嗎？\n（這個分頁尚未存檔的修改會遺失）")) {
      location.reload();
    }
    otherTabNoticeShown = false;
    return;
  }

  const info = document.getElementById("otherTabInfo");
  if (info) {
    info.textContent = "另一個分頁剛剛存了一份有 " + theirCards + " 張卡片的資料；" +
      "這個分頁目前是 " + appData.cards.length + " 張。" +
      "兩邊繼續各自編輯的話，後存的那一份會蓋掉先存的。";
  }
  modal.classList.add("active");
}

function closeOtherTabModal() {
  document.getElementById("otherTabModal").classList.remove("active");
  otherTabNoticeShown = false;   // 下次別的分頁再寫入時還要再提醒
}

function reloadForOtherTab() {
  location.reload();
}

window.addEventListener("storage", handleOtherTabWrite);
window.addEventListener("beforeunload", flushBeforeLeaving);
window.addEventListener("pagehide", flushBeforeLeaving);
document.addEventListener("visibilitychange", function() {
  if (document.visibilityState === "hidden") flushBeforeLeaving();
});
