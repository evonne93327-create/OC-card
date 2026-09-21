/* ==========================================================
   共用工具、版面切換、分組側欄 (main.js)

   這個檔案裡「上半部」是純函式（不碰 DOM、不碰全域狀態），tests/ 直接
   拿它們來測；「下半部」才是會動畫面的東西。新增函式時請照這個分界放，
   純函式一旦混進 document.getElementById 就再也測不動了。
   ========================================================== */

/* ---------- 純函式 ---------- */

function pad2(n) { return n < 10 ? "0" + n : String(n); }

/* 存檔裡的時間一律是 "YYYY-MM-DD HH:mm"，給人看也給排序用。
   刻意不存 ISO 字串：使用者會打開 JSON 檔案自己看，本地時間比 UTC 好懂。 */
function formatTime(d) {
  const t = d instanceof Date ? d : new Date();
  return t.getFullYear() + "-" + pad2(t.getMonth() + 1) + "-" + pad2(t.getDate()) +
         " " + pad2(t.getHours()) + ":" + pad2(t.getMinutes());
}

function escapeHtml(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* 頭像只接受「自己壓出來的 base64 圖片」。

   匯入的 JSON 是外來檔案，裡面的 avatar 會被直接塞進 <img src>。
   放行 http(s) 會讓一份匯入檔變成追蹤像素（開啟就對外連線），
   放行 javascript: 更糟。白名單只留 data:image/，其餘一律當成沒有頭像。 */
const SAFE_IMAGE_PREFIX = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/;

function isSafeImageSrc(src) {
  return typeof src === "string" && SAFE_IMAGE_PREFIX.test(src);
}

/* 標籤去重，保留第一次出現的順序與大小寫。
   Set 直接丟進去就好，但上限要在這裡擋——不然一份畸形的匯入檔可以塞
   一萬個標籤進一張卡，畫面會被標籤淹掉。 */
function dedupeTags(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach(function(t) {
    const s = String(t).trim().slice(0, MAX_TAG_LEN);
    if (!s || seen.has(s)) return;
    seen.add(s);
    if (out.length < MAX_TAGS_PER_CARD) out.push(s);
  });
  return out;
}

/* 使用者在標籤輸入框裡打的東西 → 標籤陣列。
   逗號（半形與全形）、空白、換行、井號都當成分隔符，因為每個人的習慣
   不一樣，而「#主角群, 騎士 劍」這種混著打的輸入最常見。 */
function normalizeTagInput(text) {
  return dedupeTags(String(text || "").split(/[,，、\s\n]+/).map(function(t) {
    return t.replace(/^#+/, "").trim();
  }));
}

/* 一張卡片的所有可搜尋文字，攤平成一條字串。
   搜尋要能打到「背景故事裡提過的地名」，不是只有名字——角色多了之後，
   使用者記得的往往是某個細節而不是名字。 */
function cardSearchText(card) {
  if (!card) return "";
  const parts = [card.name, card.alias, card.tagline];
  (card.fields || []).forEach(function(f) { parts.push(f.label, f.value); });
  (card.sections || []).forEach(function(s) { parts.push(s.label, s.text); });
  (card.tags || []).forEach(function(t) { parts.push(t); });
  return parts.filter(Boolean).join("\n").toLowerCase();
}

function cardMatchesQuery(card, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const hay = cardSearchText(card);
  // 空白分隔的多個關鍵字要「全部都中」，才能用「艾莉亞 騎士」縮小範圍
  return q.split(/\s+/).every(function(term) { return hay.indexOf(term) >= 0; });
}

/* 卡片完成度。

   這個 app 的用途是「把腦子裡的設定倒出來」，所以最有用的提示不是
   字數，而是「哪幾格還空著」。分母只算「卡片上存在的格子」——使用者
   自己刪掉的欄位不該拖累完成度，不然刪一格反而變低就沒人敢刪了。 */
function cardCompletion(card) {
  if (!card) return { filled: 0, total: 0, percent: 0 };
  let total = 2, filled = 0;                 // 名字與一句話簡介是每張卡都有的
  if (String(card.name || "").trim()) filled++;
  if (String(card.tagline || "").trim()) filled++;

  (card.fields || []).forEach(function(f) {
    total++;
    if (String(f.value || "").trim()) filled++;
  });
  (card.sections || []).forEach(function(s) {
    total++;
    if (String(s.text || "").trim()) filled++;
  });

  return { filled: filled, total: total, percent: total ? Math.round(filled / total * 100) : 0 };
}

/* 排序。回傳新陣列，不動原本那個——呼叫端常常是拿篩選後的結果再排，
   就地排序會讓 appData.cards 的順序被搜尋結果帶著跑。

   「我的最愛」一律排在最前面，不管選的是哪一種排序：那是使用者主動
   標記的「這幾張要常常看到」，排序方式不該把它推下去。 */
function sortCards(cards, mode) {
  const list = (cards || []).slice();
  const byName = function(a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
  };
  const colorOrder = paletteKeys();

  list.sort(function(a, b) {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    if (mode === "name") return byName(a, b);
    if (mode === "created") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    if (mode === "color") {
      const d = colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color);
      if (d !== 0) return d;
      return byName(a, b);
    }
    // 預設：最近修改的在前面
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  return list;
}

/* 卡片 → 純文字。匯出 TXT、複製到剪貼簿、以及丟進世界觀工作台的內文
   都走這一份，格式只有一種，改了三個地方會一起變。 */
function cardToPlainText(card) {
  if (!card) return "";
  const lines = [];
  const title = card.name || "未命名角色";
  lines.push("【" + title + "】" + (card.alias ? "（" + card.alias + "）" : ""));
  if (card.tagline) lines.push(card.tagline);
  lines.push("");

  const filled = (card.fields || []).filter(function(f) { return f.label || f.value; });
  if (filled.length) {
    filled.forEach(function(f) { lines.push((f.label || "－") + "：" + (f.value || "")); });
    lines.push("");
  }

  (card.sections || []).forEach(function(s) {
    if (!s.label && !s.text) return;
    lines.push("# " + (s.label || "未命名段落"));
    lines.push(s.text || "");
    lines.push("");
  });

  if ((card.tags || []).length) {
    lines.push("標籤：" + card.tags.map(function(t) { return "#" + t; }).join(" "));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* 名字的縮寫，給沒有頭像也沒選 emoji 的卡片用。
   中文取第一個字，英文取首字母。 */
function nameInitial(name) {
  const s = String(name || "").trim();
  if (!s) return "？";
  return s.slice(0, 1).toUpperCase();
}


/* ---------- 以下開始會碰 DOM ---------- */

function el(id) { return document.getElementById(id); }

function currentGroup() {
  return appData.groups.find(function(g) { return g.id === activeGroupId; }) || appData.groups[0];
}

function cardsInGroup(groupId) {
  return appData.cards.filter(function(c) { return c.groupId === groupId; });
}

function findCard(id) {
  return appData.cards.find(function(c) { return c.id === id; }) || null;
}

function newId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

/* 提示條。用它取代大部分的 alert()：alert 會把整個分頁卡住，
   在手機上還會把鍵盤收起來，改完一個欄位跳一次會很煩。
   真正需要使用者停下來決定的事才用 confirm/彈窗。 */
let toastTimer = null;

function toast(msg) {
  const box = el("toast");
  if (!box) return;
  box.textContent = msg;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { box.classList.remove("show"); }, 2600);
}


/* ---------- 分組（作品）側欄 ---------- */

function renderGroupRail() {
  const box = el("groupRailList");
  if (!box) return;
  box.innerHTML = "";

  appData.groups.forEach(function(g) {
    const btn = document.createElement("button");
    btn.className = "rail-btn" + (g.id === activeGroupId ? " active" : "");
    btn.title = g.name + "（" + cardsInGroup(g.id).length + " 張）";
    btn.textContent = g.icon || "📁";
    btn.onclick = function() { switchGroup(g.id); };
    // 長按／右鍵改名或刪除。跟世界觀工作台的作法一致：
    // 「顯示」與「設定」分開，免得點一下就誤觸設定
    btn.oncontextmenu = function(e) { e.preventDefault(); openGroupModal(g.id); };
    let pressTimer = null;
    btn.addEventListener("touchstart", function() {
      pressTimer = setTimeout(function() { openGroupModal(g.id); }, 550);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach(function(ev) {
      btn.addEventListener(ev, function() { clearTimeout(pressTimer); }, { passive: true });
    });

    const count = document.createElement("span");
    count.className = "rail-badge";
    count.textContent = cardsInGroup(g.id).length;
    btn.appendChild(count);

    box.appendChild(btn);
  });
}

function switchGroup(id) {
  if (!appData.groups.some(function(g) { return g.id === id; })) return;
  activeGroupId = id;
  // 換了作品，篩選條件留著只會讓人看到空畫面卻不知道為什麼
  filterTag = null;
  filterColor = null;
  saveUIState();
  closeRailMobile();
  renderGroupRail();
  renderWall();
  updateGroupBadge();
}

function updateGroupBadge() {
  const g = currentGroup();
  if (el("currentGroupIcon")) el("currentGroupIcon").textContent = g ? (g.icon || "📁") : "📁";
  if (el("currentGroupName")) el("currentGroupName").textContent = g ? g.name : "";
}


/* ---------- 手機版的作品抽屜 ---------- */

function openRailMobile() {
  document.body.classList.add("rail-open");
}

function closeRailMobile() {
  document.body.classList.remove("rail-open");
}

function toggleRailMobile() {
  document.body.classList.toggle("rail-open");
}


/* ---------- 版面切換 ---------- */

/* 卡片牆與編輯面板是兩個檢視，不是兩個彈窗。

   編輯一張卡要填十幾個欄位，用彈窗的話手機上永遠只看得到三行，而且
   鍵盤一彈出來就把視窗推到看不見。做成整頁檢視，回上一頁就回到牆上。 */
function switchView(view) {
  activeView = view === "edit" ? "edit" : "wall";
  document.body.setAttribute("data-view", activeView);
  if (activeView === "wall") {
    renderWall();
  }
  window.scrollTo(0, 0);
  const scroller = el(activeView === "wall" ? "wallScroll" : "editScroll");
  if (scroller) scroller.scrollTop = activeView === "wall" ? (wallScrollMemo || 0) : 0;
}

/* 從卡片牆進編輯器之前記下捲動位置，改完回來才不會跳回最頂端——
   角色一多，每次都要重新捲到剛剛那張會很煩。 */
let wallScrollMemo = 0;

function rememberWallScroll() {
  const s = el("wallScroll");
  if (s) wallScrollMemo = s.scrollTop;
}


/* ---------- 全域鍵盤快捷鍵 ---------- */

function setupGlobalKeyboardShortcuts() {
  document.addEventListener("keydown", function(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") ||
                    (e.target && e.target.isContentEditable);

    // Esc：由外而內關掉一層。彈窗 → 詳情 → 編輯器
    if (e.key === "Escape") {
      const openModal = document.querySelector(".modal-overlay.active");
      if (openModal) { closeModalEl(openModal); return; }
      if (document.body.classList.contains("rail-open")) { closeRailMobile(); return; }
      if (activeView === "edit") { exitEditor(); return; }
      if (searchQuery) { clearSearch(); return; }
      return;
    }

    if (inField) {
      // 編輯器裡按 Ctrl/Cmd+S：存檔。瀏覽器的「儲存網頁」在這裡沒有意義，
      // 而寫東西的人手指會自己按下去
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activeView === "edit") { flushEditorDraft(); toast("已儲存"); }
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flushEditorDraft();
      toast("已儲存");
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "/") { e.preventDefault(); focusSearch(); return; }
    if (e.key.toLowerCase() === "n" && activeView === "wall") { e.preventDefault(); createCard(); return; }
  });
}

/* 彈窗共用的關閉：點背景、按 Esc 都走這裡。
   每個彈窗各自的 closeXxx() 只負責它自己的收尾（例如把編輯中的 id 清掉），
   真正拿掉 active 的動作集中在這裡一份。 */
function closeModalEl(modal) {
  if (!modal) return;
  const id = modal.id;
  // 有自訂收尾的就走它的，其餘直接關
  const custom = {
    "cardDetailModal": closeCardDetail,
    "groupModal": closeGroupModal,
    "paletteModal": closePaletteModal,
    "trashModal": closeTrashModal,
    "exportModal": closeExportModal,
    "settingsModal": closeSettingsModal,
    "appearanceModal": closeAppearanceModal,
    "iconPickerModal": closeIconPicker
  };
  if (typeof custom[id] === "function") { custom[id](); return; }
  modal.classList.remove("active");
}

function setupModalBackdropClose() {
  document.querySelectorAll(".modal-overlay").forEach(function(overlay) {
    overlay.addEventListener("mousedown", function(e) {
      // 只認「按下與放開都在背景上」的點擊。不然在視窗內選字拖到外面放開，
      // 會被當成點背景而把視窗關掉，剛打的東西就沒了
      if (e.target !== overlay) return;
      const onUp = function(ev) {
        overlay.removeEventListener("mouseup", onUp);
        if (ev.target === overlay) closeModalEl(overlay);
      };
      overlay.addEventListener("mouseup", onUp);
    });
  });
}
