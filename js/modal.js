/* ==========================================================
   彈出視窗：圖示選擇器、作品設定、分類設定、垃圾桶 (modal.js)
   ========================================================== */

/* ---------- Emoji 圖示選擇器 ----------

   同一個選擇器給「角色卡」與「作品」共用，iconPickerTarget 記住這次是
   誰叫出來的。兩份幾乎一樣的選擇器維護起來一定會分岔。 */

function buildIconPicker() {
  const box = el("iconPickerGrid");
  if (!box) return;
  box.innerHTML = "";
  COMMON_ICONS.forEach(function(ic) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-opt";
    btn.textContent = ic;
    btn.onclick = function() { applyPickedIcon(ic); };
    box.appendChild(btn);
  });
}

function openIconPicker() {
  const modal = el("iconPickerModal");
  if (!modal) return;
  const input = el("iconCustomInput");
  if (input) input.value = "";
  modal.classList.add("active");
}

function closeIconPicker() {
  const modal = el("iconPickerModal");
  if (modal) modal.classList.remove("active");
  // target 不在這裡清掉：作品設定會在關掉選擇器之後接著把自己開回來
}

/* 自己打一個 emoji。清單裡那 30 個只是常用款，使用者的角色可能是一隻
   章魚，總不能因為清單裡沒有就不能選。

   取前兩個「字」而不是兩個 char：emoji 常常是多個 code unit 組成的
   （👨‍👩‍👧 更是好幾個），用 slice(0,2) 會把它切成亂碼。 */
function applyCustomIcon() {
  const input = el("iconCustomInput");
  if (!input) return;
  const chars = Array.from(String(input.value).trim());
  if (!chars.length) { toast("先輸入一個符號"); return; }
  applyPickedIcon(chars.slice(0, 2).join(""));
}

function applyPickedIcon(icon) {
  if (iconPickerTarget === "group") {
    const g = appData.groups.find(function(x) { return x.id === editingGroupId; });
    if (g) { g.icon = icon; saveData(); renderGroupRail(); updateGroupBadge(); }
    closeIconPicker();
    iconPickerTarget = null;
    openGroupModal(editingGroupId);      // 回到作品設定，使用者是從那裡進來的
    return;
  }

  const card = findCard(editingCardId);
  if (card) {
    card.icon = icon;
    // 選了 emoji 通常是想拿它當臉用，但上傳過的頭像不該被默默丟掉
    markEditorDirty();
    renderEditorAvatar();
    if (card.avatar) toast("已更換符號（目前顯示的是上傳的頭像圖片）");
  }
  closeIconPicker();
  iconPickerTarget = null;
}


/* ---------- 作品（分組） ---------- */

let editingGroupId = null;

function promptCreateGroup() {
  const name = prompt("新作品的名稱：", "新作品");
  if (name === null) return;
  const trimmed = name.trim().slice(0, MAX_NAME_LEN);
  if (!trimmed) { toast("名稱不能空白"); return; }
  const g = { id: newId("g"), name: trimmed, icon: "📁" };
  appData.groups.push(g);
  saveData();
  switchGroup(g.id);
  toast("已新增作品");
}

function openGroupModal(id) {
  editingGroupId = id;
  const g = appData.groups.find(function(x) { return x.id === id; });
  if (!g) return;
  el("groupNameInput").value = g.name;
  el("groupIconBtn").textContent = g.icon || "📁";
  el("groupCardCount").textContent = cardsInGroup(id).length + " 張卡片";
  // 只剩一個作品時不給刪：刪光之後卡片沒有地方去，畫面會變成
  // 一個連「新增」都按不到的死路
  el("groupDeleteBtn").disabled = appData.groups.length <= 1;
  el("groupModal").classList.add("active");
}

function closeGroupModal() {
  const modal = el("groupModal");
  if (modal) modal.classList.remove("active");
  editingGroupId = null;
}

function saveGroupEdit() {
  const g = appData.groups.find(function(x) { return x.id === editingGroupId; });
  if (!g) return;
  const name = el("groupNameInput").value.trim().slice(0, MAX_NAME_LEN);
  if (!name) { toast("名稱不能空白"); return; }
  g.name = name;
  saveData();
  renderGroupRail();
  updateGroupBadge();
  closeGroupModal();
}

function openGroupIconPicker() {
  iconPickerTarget = "group";
  el("groupModal").classList.remove("active");   // 兩層疊著只會靠 DOM 順序分勝負，很脆
  openIconPicker();
}

/* 刪掉一個作品，裡面的卡片跟著進垃圾桶（連同作品本身）。

   刻意不「順便把卡片搬到別的作品」：使用者說要刪的是整個企劃，
   把它的角色偷偷塞進另一個作品裡只會造成更大的困惑。垃圾桶裡兩者
   都還在，要救得回來。 */
function deleteGroup() {
  const g = appData.groups.find(function(x) { return x.id === editingGroupId; });
  if (!g) return;
  if (appData.groups.length <= 1) { toast("至少要留一個作品"); return; }

  const cards = cardsInGroup(g.id);
  if (!confirm("刪除作品「" + g.name + "」？\n裡面的 " + cards.length +
               " 張卡片會一起移到垃圾桶（60 天內都可以還原）。")) return;

  const now = formatTime(new Date());
  const ts = Date.now();
  cards.forEach(function(c) {
    appData.trash.cards.push(Object.assign({}, c, { deletedAt: now, deletedTs: ts }));
  });
  appData.cards = appData.cards.filter(function(c) { return c.groupId !== g.id; });
  appData.groups = appData.groups.filter(function(x) { return x.id !== g.id; });
  appData.trash.groups.push(Object.assign({}, g, { deletedAt: now, deletedTs: ts }));

  closeGroupModal();
  activeGroupId = appData.groups[0].id;
  saveData();
  renderGroupRail();
  renderWall();
  toast("已刪除作品");
}


/* ---------- 分類設定 ----------

   顏色本身固定（七色是刻意的：再多就分不出來了），可以改的是名稱。
   「紫色」對使用者沒有意義，「反派／對立」才有。 */

function openPaletteModal() {
  renderPaletteModal();
  el("paletteModal").classList.add("active");
}

function closePaletteModal() {
  el("paletteModal").classList.remove("active");
}

function renderPaletteModal() {
  const box = el("paletteList");
  if (!box) return;
  box.innerHTML = "";

  paletteKeys().forEach(function(k) {
    const pal = getPalette(k);
    const row = document.createElement("div");
    row.className = "palette-row";

    const swatch = document.createElement("span");
    swatch.className = "palette-swatch";
    swatch.style.background = pal.bg;
    swatch.style.borderColor = pal.text;
    row.appendChild(swatch);

    const input = document.createElement("input");
    input.type = "text";
    input.value = pal.name;
    input.maxLength = 20;
    input.setAttribute("aria-label", "分類名稱");
    input.oninput = function() {
      // 名稱存在 appData.colorPalette，兩個主題共用同一份（見 state.js）
      if (!appData.colorPalette[k]) appData.colorPalette[k] = { name: "", bg: "", text: "" };
      appData.colorPalette[k].name = input.value;
    };
    input.onchange = function() { saveData(); renderWall(); };
    row.appendChild(input);

    const count = document.createElement("span");
    count.className = "palette-count";
    count.textContent = appData.cards.filter(function(c) { return c.color === k; }).length + " 張";
    row.appendChild(count);

    box.appendChild(row);
  });
}

function resetPaletteNames() {
  if (!confirm("把所有分類名稱還原成預設值？")) return;
  paletteKeys().forEach(function(k) {
    appData.colorPalette[k] = JSON.parse(JSON.stringify(DEFAULT_PALETTES[k]));
  });
  saveData();
  renderPaletteModal();
  renderWall();
}


/* ---------- 垃圾桶 ---------- */

function openTrashModal() {
  renderTrashModal();
  el("trashModal").classList.add("active");
}

function closeTrashModal() {
  el("trashModal").classList.remove("active");
}

function renderTrashModal() {
  const box = el("trashList");
  if (!box) return;
  box.innerHTML = "";

  const items = appData.trash.cards.slice().sort(function(a, b) {
    return (b.deletedTs || 0) - (a.deletedTs || 0);
  });

  const hint = el("trashHint");
  if (hint) {
    hint.textContent = items.length
      ? "刪掉的卡片會保留 " + TRASH_RETENTION_DAYS + " 天，之後自動清除。"
      : "垃圾桶是空的。";
  }

  items.forEach(function(c) {
    const row = document.createElement("div");
    row.className = "trash-row";

    const icon = document.createElement("span");
    icon.className = "trash-icon";
    icon.textContent = c.icon || "🎭";
    row.appendChild(icon);

    const text = document.createElement("div");
    text.className = "trash-text";
    const name = document.createElement("strong");
    name.textContent = c.name || "未命名角色";
    text.appendChild(name);
    const when = document.createElement("span");
    when.textContent = "刪除於 " + (c.deletedAt || "未知時間");
    text.appendChild(when);
    row.appendChild(text);

    const restore = document.createElement("button");
    restore.className = "btn btn-secondary";
    restore.textContent = "還原";
    restore.onclick = function() { restoreCard(c.id); };
    row.appendChild(restore);

    const purge = document.createElement("button");
    purge.className = "btn btn-danger";
    purge.textContent = "永久刪除";
    purge.onclick = function() { purgeTrashCard(c.id); };
    row.appendChild(purge);

    box.appendChild(row);
  });
}


/* ---------- 更新提示 ----------

   偵測到新版時提示，但不自動重載。靜默重載很誘人（反正資料都在
   localStorage），但正在打字的人被硬生生重整會很惱火，而且捲動位置、
   展開的段落都會跑掉。什麼時候換版讓使用者自己決定。 */

let updateModalShown = false;
let updatePendingTimer = null;

function otherModalOpen() {
  const open = document.querySelector(".modal-overlay.active");
  return !!open && open.id !== "updateModal";
}

function showUpdateModal() {
  if (updateModalShown) return;     // 一次就好，不要每次檢查都跳
  const elx = el("updateModal");
  if (!elx) return;

  if (otherModalOpen()) {
    // 排隊重試，而不是直接放棄——放棄的話這次更新就再也不會通知了
    if (!updatePendingTimer) {
      updatePendingTimer = setInterval(function() {
        if (updateModalShown) { clearInterval(updatePendingTimer); updatePendingTimer = null; return; }
        if (!otherModalOpen()) showUpdateModal();
      }, 5000);
    }
    return;
  }

  if (updatePendingTimer) { clearInterval(updatePendingTimer); updatePendingTimer = null; }
  updateModalShown = true;
  elx.classList.add("active");
}

function dismissUpdateModal() {
  const elx = el("updateModal");
  if (elx) elx.classList.remove("active");
}

function reloadForUpdate() {
  dismissUpdateModal();
  location.reload();
}
