/* ==========================================================
   角色卡編輯面板 (editor.js)

   編輯是「直接改 appData 裡的那張卡 + 自動存檔」，沒有草稿複本。

   試過草稿複本的作法（改完按儲存才寫回去），但這個 app 的使用情境是
   一邊想一邊打，手機上切出去接個電話回來草稿就沒了；而且「忘記按儲存」
   是最容易發生、後果最嚴重的一件事。改成即時寫入之後，離開時不需要問
   「要不要儲存」，誤刪則由垃圾桶兜底。
   ========================================================== */

const EDITOR_SAVE_DELAY_MS = 600;

function openEditor(id) {
  const card = findCard(id);
  if (!card) return;
  // 換一張卡之前先把上一張還沒寫進去的補存，不然切太快會掉最後幾個字
  flushEditorDraft();
  if (activeView === "wall") rememberWallScroll();
  editingCardId = id;
  renderEditor();
  switchView("card");
  renderCharList();
  // 新卡片一開起來就把游標放在名字上：這時使用者腦子裡想的就是名字
  if (!card.name) {
    const input = el("fieldName");
    if (input) input.focus();
  }
}

/* 預覽：開那張展示用的詳情卡。

   編輯器是「一格一格填」的介面，看不出成品長什麼樣；預覽就是給這件事的。
   先 flush 再開，不然剛打的最後一句話不會出現在預覽裡。 */
function previewEditingCard() {
  if (!editingCardId) return;
  flushEditorDraft();
  openCardDetail(editingCardId);
}

/* 把還沒寫進 localStorage 的修改補存。離開編輯器、切到背景、關分頁
   都會呼叫這個（見 storage.js 的 flushBeforeLeaving）。 */
function flushEditorDraft() {
  if (!editorDirty) return;
  clearTimeout(editorAutosaveTimer);
  editorAutosaveTimer = null;
  editorDirty = false;
  saveData();
  renderEditorSavedMark("已儲存");
}

/* 改完停手 600ms 才存。每按一個鍵就 JSON.stringify 整包資料寫一次
   localStorage，卡片一多就會開始掉字——尤其是手機。 */
function markEditorDirty() {
  const card = findCard(editingCardId);
  if (card) touchCard(card);
  editorDirty = true;
  renderEditorSavedMark("編輯中…");
  clearTimeout(editorAutosaveTimer);
  editorAutosaveTimer = setTimeout(function() {
    editorAutosaveTimer = null;
    editorDirty = false;
    saveData();
    renderEditorSavedMark("已儲存");
    renderEditorMeter();
    // 側欄那一列的名字／別名要跟著改。放在存檔後而不是每個按鍵都重畫，
    // 角色多的時候才不會每打一個字就重建整份清單
    renderCharList();
  }, EDITOR_SAVE_DELAY_MS);
}

function renderEditorSavedMark(text) {
  const mark = el("editorSaveMark");
  if (mark) mark.textContent = text;
}

function renderEditorMeter() {
  const card = findCard(editingCardId);
  const bar = el("editorMeterBar");
  const txt = el("editorMeterText");
  if (!card || !bar || !txt) return;
  const done = cardCompletion(card);
  bar.style.width = done.percent + "%";
  bar.style.background = getPalette(card.color).text;
  txt.textContent = "完成度 " + done.percent + "%（" + done.filled + "/" + done.total + " 格）";
}


/* ---------- 畫出整張表單 ---------- */

function renderEditor() {
  const card = findCard(editingCardId);
  if (!card) return;

  el("fieldName").value = card.name || "";
  el("fieldAlias").value = card.alias || "";
  el("fieldTagline").value = card.tagline || "";
  el("fieldTags").value = (card.tags || []).join("、");

  renderEditorAvatar();
  renderEditorColors();
  renderEditorGroupSelect();
  renderEditorFields();
  renderEditorSections();
  renderEditorTagSuggest();
  renderEditorMeter();
  renderEditorSavedMark("已儲存");
}

function editorSetName(v) {
  const card = findCard(editingCardId);
  if (!card) return;
  card.name = String(v).slice(0, MAX_NAME_LEN);
  markEditorDirty();
}

function editorSetAlias(v) {
  const card = findCard(editingCardId);
  if (!card) return;
  card.alias = String(v).slice(0, MAX_NAME_LEN);
  markEditorDirty();
}

function editorSetTagline(v) {
  const card = findCard(editingCardId);
  if (!card) return;
  card.tagline = String(v);
  markEditorDirty();
}

/* 標籤輸入框是一整行文字，離開輸入框時才正規化成標籤陣列。

   邊打邊切成 chip 的作法很漂亮，但打到一半的「騎」會先變成一個叫「騎」
   的標籤，然後使用者再打「士」又變成第二個。等使用者打完再切才合理。 */
function editorCommitTags() {
  const card = findCard(editingCardId);
  const input = el("fieldTags");
  if (!card || !input) return;
  card.tags = normalizeTagInput(input.value);
  input.value = card.tags.join("、");
  markEditorDirty();
  renderEditorTagSuggest();
}

/* 同一個作品裡用過的標籤，點一下就加進來。
   角色多了之後最怕的是「主角群」跟「主角」各打了一半變成兩個標籤，
   這排建議就是為了讓人照著點而不是重打。 */
function renderEditorTagSuggest() {
  const box = el("tagSuggestRow");
  const card = findCard(editingCardId);
  if (!box || !card) return;
  box.innerHTML = "";

  const used = new Set(card.tags || []);
  const suggestions = tagsInGroup(activeGroupId)
    .filter(function(t) { return !used.has(t.tag); }).slice(0, 12);
  if (!suggestions.length) { box.classList.add("is-empty"); return; }
  box.classList.remove("is-empty");

  suggestions.forEach(function(t) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggest-chip";
    chip.textContent = "+ " + t.tag;
    chip.onclick = function() {
      card.tags = dedupeTags((card.tags || []).concat([t.tag]));
      el("fieldTags").value = card.tags.join("、");
      markEditorDirty();
      renderEditorTagSuggest();
    };
    box.appendChild(chip);
  });
}


/* ---------- 頭像 ---------- */

function renderEditorAvatar() {
  const card = findCard(editingCardId);
  const box = el("editorAvatar");
  if (!card || !box) return;
  const pal = getPalette(card.color);
  box.innerHTML = "";
  box.style.background = pal.bg;
  box.style.color = pal.text;

  if (card.avatar && isSafeImageSrc(card.avatar)) {
    const img = document.createElement("img");
    img.src = card.avatar;
    img.alt = "";
    box.appendChild(img);
  } else {
    box.textContent = card.icon || nameInitial(card.name);
  }

  const removeBtn = el("avatarRemoveBtn");
  if (removeBtn) removeBtn.style.display = card.avatar ? "inline-flex" : "none";
}

function triggerAvatarPick() {
  const input = el("avatarFileInput");
  if (input) { input.value = ""; input.click(); }
}

/* 上傳的圖一律縮小再存。

   原圖直接 base64 塞進 localStorage 的話，一張手機照片就是 3～5MB，
   而整個 localStorage 只有約 5MB——第一張就滿了，而且是在使用者完全
   沒有感覺的情況下（saveData 會擋下來提醒，但那時已經很難善後）。

   縮到 320px 邊長、JPEG 0.82，一張大約 20～40KB，一百張角色卡也還在
   安全範圍內。頭像在畫面上最大也才 96px，肉眼看不出差別。 */
function handleAvatarFile(e) {
  const file = e && e.target && e.target.files && e.target.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast("請選擇圖片檔"); return; }

  const reader = new FileReader();
  reader.onload = function() {
    const img = new Image();
    img.onload = function() {
      try {
        const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        // 透明底的 PNG 轉成 JPEG 會變黑底，先鋪一層白
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", AVATAR_JPEG_QUALITY);

        const card = findCard(editingCardId);
        if (!card) return;
        card.avatar = dataUrl;
        touchCard(card);
        renderEditorAvatar();
        // 圖片是大東西，不要等自動存檔的 600ms——中間關掉分頁就白傳了
        saveData();
        toast("頭像已更新（已自動縮圖）");
      } catch (err) {
        console.error(err);
        toast("這張圖片處理失敗，換一張試試");
      }
    };
    img.onerror = function() { toast("讀不到這張圖片"); };
    img.src = reader.result;
  };
  reader.onerror = function() { toast("讀取檔案失敗"); };
  reader.readAsDataURL(file);
}

function removeAvatar() {
  const card = findCard(editingCardId);
  if (!card) return;
  card.avatar = "";
  touchCard(card);
  renderEditorAvatar();
  saveData();
}


/* ---------- 分類顏色與所屬作品 ---------- */

function renderEditorColors() {
  const card = findCard(editingCardId);
  const box = el("editorColorRow");
  if (!card || !box) return;
  box.innerHTML = "";

  paletteKeys().forEach(function(k) {
    const pal = getPalette(k);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-circle" + (card.color === k ? " on" : "");
    btn.style.background = pal.bg;
    btn.style.borderColor = pal.text;
    btn.title = pal.name;
    btn.setAttribute("aria-label", pal.name);
    btn.onclick = function() {
      card.color = k;
      markEditorDirty();
      renderEditorColors();
      renderEditorAvatar();
      renderEditorMeter();
    };
    box.appendChild(btn);
  });

  const label = el("editorColorName");
  if (label) label.textContent = getPalette(card.color).name;
}

function renderEditorGroupSelect() {
  const card = findCard(editingCardId);
  const sel = el("editorGroupSelect");
  if (!card || !sel) return;
  sel.innerHTML = "";
  appData.groups.forEach(function(g) {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = (g.icon || "📁") + " " + g.name;
    if (g.id === card.groupId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function editorChangeGroup(value) {
  const card = findCard(editingCardId);
  if (!card) return;
  card.groupId = value;
  markEditorDirty();
  // 搬到別的作品之後，回去要看得到它，否則使用者會以為卡片不見了
  activeGroupId = value;
  renderGroupRail();
  updateGroupBadge();
}


/* ---------- 資料列（短欄位） ---------- */

function renderEditorFields() {
  const card = findCard(editingCardId);
  const box = el("editorFieldList");
  if (!card || !box) return;
  box.innerHTML = "";

  card.fields.forEach(function(f, i) {
    const row = document.createElement("div");
    row.className = "field-row";

    const label = document.createElement("input");
    label.type = "text";
    label.className = "field-label-input";
    label.value = f.label;
    label.placeholder = "欄位名稱";
    label.setAttribute("aria-label", "欄位名稱");
    label.oninput = function() { f.label = label.value; markEditorDirty(); };

    const value = document.createElement("input");
    value.type = "text";
    value.className = "field-value-input";
    value.value = f.value;
    value.placeholder = "內容";
    value.setAttribute("aria-label", (f.label || "欄位") + "的內容");
    value.oninput = function() { f.value = value.value; markEditorDirty(); renderEditorMeter(); };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "row-del-btn";
    del.title = "刪除這一列";
    del.textContent = "✕";
    del.onclick = function() {
      card.fields.splice(i, 1);
      markEditorDirty();
      renderEditorFields();
      renderEditorMeter();
    };

    row.appendChild(label);
    row.appendChild(value);
    row.appendChild(del);
    box.appendChild(row);
  });

  const addBtn = el("addFieldBtn");
  if (addBtn) addBtn.disabled = card.fields.length >= MAX_FIELDS_PER_CARD;
}

function addEditorField() {
  const card = findCard(editingCardId);
  if (!card) return;
  if (card.fields.length >= MAX_FIELDS_PER_CARD) { toast("資料列最多 " + MAX_FIELDS_PER_CARD + " 條"); return; }
  card.fields.push({ label: "", value: "" });
  markEditorDirty();
  renderEditorFields();
  // 新增完把游標放到新那一列的欄位名稱上，不然使用者還要自己點一下
  const rows = document.querySelectorAll("#editorFieldList .field-label-input");
  if (rows.length) rows[rows.length - 1].focus();
}


/* ---------- 段落（長文） ---------- */

function renderEditorSections() {
  const card = findCard(editingCardId);
  const box = el("editorSectionList");
  if (!card || !box) return;
  box.innerHTML = "";

  card.sections.forEach(function(s, i) {
    const block = document.createElement("div");
    block.className = "section-block";

    const head = document.createElement("div");
    head.className = "section-head";

    const label = document.createElement("input");
    label.type = "text";
    label.className = "section-label-input";
    label.value = s.label;
    label.placeholder = "段落標題（例如：外觀、性格、與誰的關係）";
    label.setAttribute("aria-label", "段落標題");
    label.oninput = function() { s.label = label.value; markEditorDirty(); };
    head.appendChild(label);

    // 上移／下移：段落的順序就是使用者翻卡片時讀到的順序，
    // 「背景」寫到最後想拉到最前面是很常見的事
    const up = document.createElement("button");
    up.type = "button";
    up.className = "row-del-btn";
    up.title = "上移";
    up.textContent = "↑";
    up.disabled = i === 0;
    up.onclick = function() { moveSection(i, -1); };
    head.appendChild(up);

    const down = document.createElement("button");
    down.type = "button";
    down.className = "row-del-btn";
    down.title = "下移";
    down.textContent = "↓";
    down.disabled = i === card.sections.length - 1;
    down.onclick = function() { moveSection(i, 1); };
    head.appendChild(down);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "row-del-btn";
    del.title = "刪除這個段落";
    del.textContent = "✕";
    del.onclick = function() {
      if (String(s.text || "").trim() &&
          !confirm("「" + (s.label || "這個段落") + "」裡還有內容，確定要刪掉嗎？")) return;
      card.sections.splice(i, 1);
      markEditorDirty();
      renderEditorSections();
      renderEditorMeter();
    };
    head.appendChild(del);
    block.appendChild(head);

    const area = document.createElement("textarea");
    area.className = "section-textarea";
    area.value = s.text;
    area.rows = 4;
    area.placeholder = "想到什麼就寫什麼，不用一次寫完。";
    area.setAttribute("aria-label", (s.label || "段落") + "的內容");
    area.oninput = function() {
      s.text = area.value;
      autoGrowTextarea(area);
      markEditorDirty();
      renderEditorMeter();
    };
    block.appendChild(area);
    box.appendChild(block);
    autoGrowTextarea(area);
  });

  const addBtn = el("addSectionBtn");
  if (addBtn) addBtn.disabled = card.sections.length >= MAX_SECTIONS_PER_CARD;
}

function moveSection(index, delta) {
  const card = findCard(editingCardId);
  if (!card) return;
  const to = index + delta;
  if (to < 0 || to >= card.sections.length) return;
  const item = card.sections.splice(index, 1)[0];
  card.sections.splice(to, 0, item);
  markEditorDirty();
  renderEditorSections();
}

function addEditorSection() {
  const card = findCard(editingCardId);
  if (!card) return;
  if (card.sections.length >= MAX_SECTIONS_PER_CARD) { toast("段落最多 " + MAX_SECTIONS_PER_CARD + " 個"); return; }
  card.sections.push({ label: "", text: "" });
  markEditorDirty();
  renderEditorSections();
  const heads = document.querySelectorAll("#editorSectionList .section-label-input");
  if (heads.length) heads[heads.length - 1].focus();
}

/* textarea 跟著內容長高，不要出現內捲軸。

   一個段落裡面自己再捲一次，會讓使用者搞不清楚現在捲的是哪一層——
   手機上尤其明顯。高度先歸零再讀 scrollHeight 是必要的：不歸零的話
   刪字時 scrollHeight 不會變小，框就再也縮不回去了。 */
function autoGrowTextarea(area) {
  if (!area) return;
  area.style.height = "auto";
  area.style.height = (area.scrollHeight + 2) + "px";
}


/* ---------- 編輯器上的其他動作 ---------- */

function deleteEditingCard() {
  const id = editingCardId;
  if (!id) return;
  const card = findCard(id);
  if (!card) return;
  if (!confirm("要把「" + (card.name || "未命名角色") + "」移到垃圾桶嗎？\n（60 天內都可以還原）")) return;
  editingCardId = null;
  editorDirty = false;
  clearTimeout(editorAutosaveTimer);
  editorAutosaveTimer = null;
  deleteCard(id, { silent: true });
  saveData();
  switchView("wall");
  renderWall();
  toast("已移到垃圾桶");
}

function duplicateEditingCard() {
  if (!editingCardId) return;
  flushEditorDraft();
  duplicateCard(editingCardId);
}

function openIconPickerForCard() {
  iconPickerTarget = "card";
  openIconPicker();
}
