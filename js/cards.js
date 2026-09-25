/* ==========================================================
   卡片牆、篩選列、卡片詳情 (cards.js)

   這裡一律用 DOM API 組畫面，不用 innerHTML 拼字串。角色名、標籤、
   段落內容全部是使用者輸入，拼字串只要漏跳脫一處就是注入；而且匯入的
   JSON 是外來檔案，那些字串同樣會走到這裡來。
   ========================================================== */

/* ---------- 篩選後的結果 ---------- */

/* 目前這個作品裡、通過搜尋與篩選的卡片，已排好序。
   卡片牆、批次操作、匯出「目前畫面上的卡片」都看這一份，
   各自再算一次一定會有人算得不一樣。 */
function visibleCards() {
  const list = cardsInGroup(activeGroupId).filter(function(c) {
    if (filterFavorite && !c.favorite) return false;
    if (filterColor && c.color !== filterColor) return false;
    if (filterTag && (c.tags || []).indexOf(filterTag) < 0) return false;
    return cardMatchesQuery(c, searchQuery);
  });
  return sortCards(list, sortMode);
}

/* 這個作品裡用過的標籤，依使用次數排序（多的在前）。
   照筆劃或加入順序排的話，最常用的那幾個會沉到後面，篩選列就白做了。 */
function tagsInGroup(groupId) {
  const count = new Map();
  cardsInGroup(groupId).forEach(function(c) {
    (c.tags || []).forEach(function(t) { count.set(t, (count.get(t) || 0) + 1); });
  });
  return Array.from(count.entries())
    .sort(function(a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"); })
    .map(function(e) { return { tag: e[0], count: e[1] }; });
}


/* ---------- 卡片牆 ---------- */

function renderWall() {
  renderFilterUI();
  renderCharList();
  updateGroupBadge();

  const wall = el("cardWall");
  if (!wall) return;
  wall.innerHTML = "";

  const list = visibleCards();
  const total = cardsInGroup(activeGroupId).length;

  const countEl = el("wallCountText");
  if (countEl) {
    countEl.textContent = (list.length === total)
      ? total + " 張卡片"
      : list.length + " / " + total + " 張";
  }

  if (!list.length) {
    wall.appendChild(buildEmptyState(total));
    renderBatchBar();
    return;
  }

  list.forEach(function(card) { wall.appendChild(buildCardEl(card)); });
  renderBatchBar();
}


/* ---------- 側欄的角色清單 ----------

   跟卡片牆看的是同一份 visibleCards()，所以搜尋與篩選在兩邊一致——
   側欄還列著卡片牆上沒有的角色，只會讓人以為畫面壞了。 */

function renderCharList() {
  const box = el("charList");
  if (!box) return;
  const list = visibleCards();
  box.innerHTML = "";

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = cardsInGroup(activeGroupId).length
      ? "沒有符合條件的角色。" : "這個作品還沒有角色。";
    box.appendChild(empty);
    return;
  }

  list.forEach(function(card) {
    const pal = getPalette(card.color);

    /* 一行一個角色，照 world_2 目錄列的尺寸：小圖示、名字、右邊一顆分類
       色點。原本做成「圓形頭像＋名字＋別名」兩行，看起來像通訊錄而不是
       目錄，而且一個畫面只放得下六七個人。 */
    const row = document.createElement("button");
    row.type = "button";
    row.className = "node-row";
    if (card.id === editingCardId) row.classList.add("active");
    if (isBatchMode && batchSelected.has(card.id)) row.classList.add("batch-checked");
    row.title = card.name || "未命名角色";

    const icon = document.createElement("span");
    icon.className = "node-icon";
    if (card.avatar && isSafeImageSrc(card.avatar)) {
      const img = document.createElement("img");
      img.src = card.avatar;
      img.alt = "";
      img.loading = "lazy";
      icon.appendChild(img);
    } else {
      icon.textContent = card.icon || nameInitial(card.name);
    }
    row.appendChild(icon);

    const name = document.createElement("span");
    name.className = "node-name";
    name.textContent = card.name || "未命名角色";
    row.appendChild(name);

    if (card.favorite) {
      const star = document.createElement("span");
      star.className = "node-star";
      star.textContent = "★";
      row.appendChild(star);
    }

    const dot = document.createElement("span");
    dot.className = "node-dot";
    dot.style.background = pal.text;
    dot.title = pal.name;
    row.appendChild(dot);

    row.onclick = function() {
      if (isBatchMode) { toggleBatchSelect(card.id); return; }
      openCardModal(card.id, "view");
      closeSidebarMobile();
    };
    box.appendChild(row);
  });
}


/* 空畫面要講清楚「為什麼是空的」。

   「這個作品還沒有卡片」跟「有卡片但被篩選條件擋掉了」是兩件完全不同
   的事，給同一句話會讓人以為資料不見了——尤其是篩選條件還留在上一個
   作品的時候。 */
function buildEmptyState(totalInGroup) {
  const box = document.createElement("div");
  box.className = "empty-state";

  const icon = document.createElement("div");
  icon.className = "empty-icon";
  icon.textContent = totalInGroup ? "🔍" : "🎭";
  box.appendChild(icon);

  const title = document.createElement("p");
  title.className = "empty-title";
  title.textContent = totalInGroup ? "沒有符合條件的卡片" : "這個作品還沒有角色";
  box.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "empty-hint";
  hint.textContent = totalInGroup
    ? "目前有搜尋或篩選條件擋著。"
    : "建一張卡片，把腦子裡的設定倒出來。";
  box.appendChild(hint);

  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  if (totalInGroup) {
    btn.textContent = "清除所有篩選";
    btn.onclick = clearAllFilters;
  } else {
    btn.textContent = "＋ 新增角色卡";
    btn.onclick = createCard;
  }
  box.appendChild(btn);
  return box;
}

function buildCardEl(card) {
  const pal = getPalette(card.color);

  const box = document.createElement("article");
  box.className = "oc-card";
  box.setAttribute("data-card-id", card.id);
  box.tabIndex = 0;
  box.setAttribute("role", "button");
  box.setAttribute("aria-label", (card.name || "未命名角色") + " 的角色卡");
  if (isBatchMode && batchSelected.has(card.id)) box.classList.add("batch-on");

  // 卡片上緣的色條：一眼看出分類，不用讀標籤
  const band = document.createElement("div");
  band.className = "card-band";
  band.style.background = pal.text;
  box.appendChild(band);

  // 我的最愛
  const star = document.createElement("button");
  star.className = "card-star" + (card.favorite ? " on" : "");
  star.title = card.favorite ? "取消我的最愛" : "加入我的最愛";
  star.setAttribute("aria-pressed", card.favorite ? "true" : "false");
  star.textContent = card.favorite ? "★" : "☆";
  star.onclick = function(e) { e.stopPropagation(); toggleFavorite(card.id); };
  box.appendChild(star);

  // 頭像：上傳的圖片 > 選的 emoji > 名字的第一個字
  const avatar = document.createElement("div");
  avatar.className = "card-avatar";
  avatar.style.background = pal.bg;
  avatar.style.color = pal.text;
  if (card.avatar && isSafeImageSrc(card.avatar)) {
    const img = document.createElement("img");
    img.src = card.avatar;
    img.alt = "";
    img.loading = "lazy";
    avatar.appendChild(img);
  } else {
    avatar.textContent = card.icon || nameInitial(card.name);
  }
  box.appendChild(avatar);

  const name = document.createElement("h3");
  name.className = "card-name";
  name.textContent = card.name || "未命名角色";
  box.appendChild(name);

  if (card.alias) {
    const alias = document.createElement("p");
    alias.className = "card-alias";
    alias.textContent = card.alias;
    box.appendChild(alias);
  }

  // 卡面上放兩格最短的資料（通常是性別／年齡），讓一排卡片掃過去
  // 就能分辨誰是誰，不用一張一張點開
  const preview = (card.fields || []).filter(function(f) {
    return String(f.value || "").trim();
  }).slice(0, 2);
  if (preview.length) {
    const row = document.createElement("div");
    row.className = "card-fieldrow";
    preview.forEach(function(f) {
      const chip = document.createElement("span");
      chip.className = "field-chip";
      chip.textContent = (f.label ? f.label + " " : "") + f.value;
      row.appendChild(chip);
    });
    box.appendChild(row);
  }

  if (card.tagline) {
    const line = document.createElement("p");
    line.className = "card-tagline";
    line.textContent = card.tagline;
    box.appendChild(line);
  }

  if ((card.tags || []).length) {
    const tagBox = document.createElement("div");
    tagBox.className = "card-tags";
    card.tags.slice(0, 4).forEach(function(t) {
      const chip = document.createElement("button");
      chip.className = "tag-chip";
      chip.style.background = pal.bg;
      chip.style.color = pal.text;
      chip.textContent = "#" + t;
      chip.title = "只看有這個標籤的卡片";
      chip.onclick = function(e) { e.stopPropagation(); setTagFilter(t); };
      tagBox.appendChild(chip);
    });
    if (card.tags.length > 4) {
      const more = document.createElement("span");
      more.className = "tag-more";
      more.textContent = "+" + (card.tags.length - 4);
      tagBox.appendChild(more);
    }
    box.appendChild(tagBox);
  }

  // 完成度：提醒還有哪些格子空著。100% 的卡片不畫，免得整面牆都是滿格條
  const done = cardCompletion(card);
  if (done.percent < 100) {
    const meter = document.createElement("div");
    meter.className = "card-meter";
    meter.title = "完成度 " + done.percent + "%（" + done.filled + "/" + done.total + " 格已填）";
    const bar = document.createElement("span");
    bar.style.width = done.percent + "%";
    bar.style.background = pal.text;
    meter.appendChild(bar);
    box.appendChild(meter);
  }

  box.onclick = function() {
    if (isBatchMode) { toggleBatchSelect(card.id); return; }
    openCardModal(card.id, "view");
  };
  box.onkeydown = function(e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); box.click(); }
  };
  return box;
}


/* ---------- 篩選列 ---------- */

function renderFilterUI() {
  // 標籤篩選
  const box = el("tagFilterRow");
  if (box) {
    box.innerHTML = "";
    const tags = tagsInGroup(activeGroupId);
    box.classList.toggle("is-empty", !tags.length);
    tags.forEach(function(t) {
      const chip = document.createElement("button");
      chip.className = "filter-chip" + (filterTag === t.tag ? " on" : "");
      chip.textContent = "#" + t.tag;
      const n = document.createElement("span");
      n.className = "filter-count";
      n.textContent = t.count;
      chip.appendChild(n);
      chip.onclick = function() { setTagFilter(filterTag === t.tag ? null : t.tag); };
      box.appendChild(chip);
    });
  }

  // 分類顏色
  const colorBox = el("colorFilterRow");
  if (colorBox) {
    colorBox.innerHTML = "";
    paletteKeys().forEach(function(k) {
      const pal = getPalette(k);
      const dot = document.createElement("button");
      dot.className = "color-dot" + (filterColor === k ? " on" : "");
      dot.style.background = pal.text;
      dot.title = pal.name;
      dot.setAttribute("aria-label", "只看「" + pal.name + "」");
      dot.onclick = function() { setColorFilter(filterColor === k ? null : k); };
      colorBox.appendChild(dot);
    });
  }

  const favBtn = el("favFilterBtn");
  if (favBtn) {
    favBtn.classList.toggle("on", filterFavorite);
    favBtn.setAttribute("aria-pressed", filterFavorite ? "true" : "false");
  }

  const sortBtn = el("sortSelect");
  if (sortBtn && sortBtn.value !== sortMode) sortBtn.value = sortMode;

  renderWallActiveFilters();
}

/* 卡片牆上方的「目前條件」。

   篩選面板是收起來的，所以一定要有個地方講「你現在只看得到一部分」，
   否則使用者換了作品或關掉分頁再回來，會以為卡片不見了。
   每個條件自己就是一顆可以按掉的 chip。 */
function renderWallActiveFilters() {
  const box = el("wallActiveFilters");
  if (!box) return;
  box.innerHTML = "";

  const add = function(label, onClear) {
    const chip = document.createElement("button");
    chip.className = "filter-chip on";
    chip.textContent = label + " ✕";
    chip.title = "取消這個條件";
    chip.onclick = onClear;
    box.appendChild(chip);
  };

  if (searchQuery) add("搜尋「" + searchQuery + "」", clearSearch);
  if (filterColor) add(getPalette(filterColor).name, function() { setColorFilter(null); });
  if (filterTag) add("#" + filterTag, function() { setTagFilter(null); });
  if (filterFavorite) add("★ 我的最愛", toggleFavFilter);

  // 篩選按鈕上也要看得出「有條件開著」，不然面板收起來就沒有線索了
  const toggleBtn = el("filterToggleBtn");
  if (toggleBtn) toggleBtn.classList.toggle("active", !!(filterColor || filterTag || filterFavorite));
}

function toggleFilterPanel() {
  const panel = el("filterPanel");
  if (panel) panel.classList.toggle("open");
}

function setTagFilter(tag) {
  filterTag = tag || null;
  renderWall();
}

function setColorFilter(key) {
  filterColor = key || null;
  renderWall();
}

function toggleFavFilter() {
  filterFavorite = !filterFavorite;
  renderWall();
}

function clearAllFilters() {
  filterTag = null;
  filterColor = null;
  filterFavorite = false;
  searchQuery = "";
  const input = el("searchInput");
  if (input) input.value = "";
  const clear = el("searchClearBtn");
  if (clear) clear.classList.remove("show");
  renderWall();
}

function handleSearchInput(input) {
  searchQuery = input.value;
  const clear = el("searchClearBtn");
  if (clear) clear.classList.toggle("show", !!searchQuery);
  renderWall();
}

function clearSearch() {
  const input = el("searchInput");
  if (input) { input.value = ""; input.focus(); }
  searchQuery = "";
  const clear = el("searchClearBtn");
  if (clear) clear.classList.remove("show");
  renderWall();
}

function focusSearch() {
  const input = el("searchInput");
  if (input) { input.focus(); input.select(); }
}

function changeSortMode(value) {
  sortMode = SORT_MODES[value] ? value : "updated";
  saveUIState();
  renderWall();
}


/* ---------- 單張卡片的動作 ---------- */

function touchCard(card) {
  card.updatedAt = formatTime(new Date());
}

function toggleFavorite(id) {
  const card = findCard(id);
  if (!card) return;
  card.favorite = !card.favorite;
  // 加最愛不改 updatedAt：那是「內容改了」的時間，按個星星把整張卡
  // 推到「最近修改」的最前面會讓排序失真
  saveData();
  renderWall();
  if (editingCardId === id && cardModalMode === "view") renderCardDetail();
}

function createCard() {
  const card = ensureCardShape({
    id: newId("card"),
    groupId: activeGroupId,
    name: "",
    icon: "🎭",
    color: "c_gray",
    // 新卡片預先鋪好預設欄位，使用者面對的是一張「待填的表」而不是空白。
    // 不想要的格子可以刪掉，比從零開始想「我該填什麼」容易得多。
    fields: DEFAULT_FIELD_LABELS.map(function(l) { return { label: l, value: "" }; }),
    sections: DEFAULT_SECTION_LABELS.map(function(l) { return { label: l, text: "" }; }),
    createdAt: formatTime(new Date())
  });
  appData.cards.push(card);
  saveData();
  renderWall();
  openCardModal(card.id, "edit");
}

function duplicateCard(id) {
  const src = findCard(id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newId("card");
  copy.name = (src.name || "未命名角色") + "（複製）";
  copy.favorite = false;
  copy.createdAt = formatTime(new Date());
  copy.updatedAt = copy.createdAt;
  appData.cards.push(ensureCardShape(copy));
  saveData();
  closeCardModal();
  renderWall();
  toast("已複製一張卡片");
}

/* 刪除一律進垃圾桶，不直接消失。

   角色設定是累積很久的東西，誤刪的代價跟「刪一則便條」完全不同。
   垃圾桶保留 60 天後自動清掉（見 storage.js），使用者可以在設定裡
   提早清空。 */
function deleteCard(id, opts) {
  const card = findCard(id);
  if (!card) return;
  const silent = opts && opts.silent;
  if (!silent && !confirm("要把「" + (card.name || "未命名角色") + "」移到垃圾桶嗎？\n（60 天內都可以還原）")) return;

  appData.cards = appData.cards.filter(function(c) { return c.id !== id; });
  appData.trash.cards.push(Object.assign({}, card, {
    deletedAt: formatTime(new Date()),
    deletedTs: Date.now()
  }));

  /* 被刪掉的正好是編輯器開著的那張，就把編輯器放掉。
     不放的話 editingCardId 會指向一張不存在的卡，之後每次 markEditorDirty()
     都找不到東西可改——畫面上還打得動字，但什麼都沒存進去。 */
  /* 關係圖上那個節點與它的連線也要一起收掉，否則圖上會留下一個
     指向垃圾桶裡的卡片的空節點。還原卡片時節點不會自己回來——
     那是刻意的，重新加一次比留著一個半殘的節點好。 */
  appData.groups.forEach(function(g) {
    if (!g.canvas) return;
    const gone = g.canvas.nodes.filter(function(n) { return n.cardId === id; })
      .map(function(n) { return n.id; });
    if (!gone.length) return;
    g.canvas.nodes = g.canvas.nodes.filter(function(n) { return n.cardId !== id; });
    g.canvas.edges = g.canvas.edges.filter(function(e) {
      return gone.indexOf(e.source) < 0 && gone.indexOf(e.target) < 0;
    });
  });

  if (editingCardId === id) {
    editingCardId = null;
    editorDirty = false;
    clearTimeout(editorAutosaveTimer);
    editorAutosaveTimer = null;
    const modal = el("cardModal");
    if (modal) modal.classList.remove("active");
  }
  if (!silent) {
    saveData();
    closeCardModal();
    renderWall();
    toast("已移到垃圾桶");
  }
}

function restoreCard(id) {
  const idx = appData.trash.cards.findIndex(function(c) { return c.id === id; });
  if (idx < 0) return;
  const card = appData.trash.cards.splice(idx, 1)[0];
  delete card.deletedAt;
  delete card.deletedTs;

  // 原本所屬的作品可能已經被刪掉了，那就放回目前這個，
  // 不然卡片會還原到一個看不見的地方，使用者只會覺得「還原沒有用」
  if (!appData.groups.some(function(g) { return g.id === card.groupId; })) {
    card.groupId = activeGroupId;
  }
  appData.cards.push(ensureCardShape(card));
  saveData();
  renderTrashModal();
  renderWall();
  toast("已還原");
}

function purgeTrashCard(id) {
  const card = appData.trash.cards.find(function(c) { return c.id === id; });
  if (!card) return;
  if (!confirm("永久刪除「" + (card.name || "未命名角色") + "」？這個動作無法復原。")) return;
  appData.trash.cards = appData.trash.cards.filter(function(c) { return c.id !== id; });
  saveData();
  renderTrashModal();
}

function emptyTrash() {
  const n = appData.trash.cards.length;
  if (!n) { toast("垃圾桶是空的"); return; }
  if (!confirm("永久刪除垃圾桶裡的 " + n + " 張卡片？這個動作無法復原。")) return;
  appData.trash.cards = [];
  saveData();
  renderTrashModal();
  toast("垃圾桶已清空");
}


/* ---------- 批次模式 ---------- */

function toggleBatchMode() {
  isBatchMode = !isBatchMode;
  batchSelected.clear();
  document.body.classList.toggle("batch-mode", isBatchMode);
  renderWall();
}

function toggleBatchSelect(id) {
  if (batchSelected.has(id)) batchSelected.delete(id); else batchSelected.add(id);
  renderWall();
}

/* 批次模式有兩條列：側欄一條（清單也能選）、卡片牆上方一條（動作都在那）。
   兩條的文字由同一個地方產生，免得一邊說 3 張、一邊說 4 張。 */
function renderBatchBar() {
  const text = batchSelected.size
    ? "已選取 " + batchSelected.size + " 張"
    : "批次模式：點卡片或清單來選取";

  const bar = el("batchBar");
  if (bar) bar.classList.toggle("active", isBatchMode);
  const txt = el("batchCountText");
  if (txt) txt.textContent = text;

  const actionBar = el("batchActionBar");
  if (actionBar) actionBar.classList.toggle("active", isBatchMode);
  const actionTxt = el("batchActionText");
  if (actionTxt) actionTxt.textContent = text;

  const toggleBtn = el("batchToggleBtn");
  if (toggleBtn) toggleBtn.classList.toggle("active", isBatchMode);
}

function batchSelectAll() {
  visibleCards().forEach(function(c) { batchSelected.add(c.id); });
  renderWall();
}

function batchDelete() {
  if (!batchSelected.size) { toast("還沒有選取任何卡片"); return; }
  if (!confirm("要把選取的 " + batchSelected.size + " 張卡片移到垃圾桶嗎？\n（60 天內都可以還原）")) return;
  // 每張都 silent，最後才存一次、重畫一次——一張一張存的話，
  // 選了五十張會寫五十次 localStorage，手機上會明顯卡住
  Array.from(batchSelected).forEach(function(id) { deleteCard(id, { silent: true }); });
  const n = batchSelected.size;
  batchSelected.clear();
  saveData();
  renderWall();
  toast("已移動 " + n + " 張到垃圾桶");
}

/* 把選取的卡片搬到另一個作品。角色常常在「我的角色」跟某個企劃之間
   搬來搬去，一張一張改 groupId 太慢。 */
function batchMoveTo(groupId) {
  if (!batchSelected.size) { toast("還沒有選取任何卡片"); return; }
  if (!appData.groups.some(function(g) { return g.id === groupId; })) return;
  let n = 0;
  batchSelected.forEach(function(id) {
    const card = findCard(id);
    if (card && card.groupId !== groupId) { card.groupId = groupId; touchCard(card); n++; }
  });
  batchSelected.clear();
  saveData();
  renderWall();
  toast("已搬移 " + n + " 張");
}


/* ---------- 卡片視窗 ----------

   檢視與編輯是同一個視窗的兩個模式，不是兩個地方。編輯永遠是即時存檔
   （見 js/editor.js），所以切模式、關視窗都不需要問「要不要儲存」。 */

function openCardModal(id, mode) {
  const card = findCard(id);
  if (!card) return;
  // 換一張卡之前先把上一張還沒寫進去的補存，切太快才不會掉字
  if (editingCardId && editingCardId !== id) flushEditorDraft();
  editingCardId = id;
  setCardModalMode(mode === "edit" ? "edit" : "view");
  el("cardModal").classList.add("active");
  renderCharList();
}

function closeCardModal() {
  flushEditorDraft();
  editingCardId = null;
  el("cardModal").classList.remove("active");
  renderWall();
}

function setCardModalMode(mode) {
  cardModalMode = mode === "edit" ? "edit" : "view";
  document.body.classList.toggle("card-editing", cardModalMode === "edit");

  const viewBtn = el("cardModeViewBtn");
  const editBtn = el("cardModeEditBtn");
  if (viewBtn) viewBtn.classList.toggle("active", cardModalMode === "view");
  if (editBtn) editBtn.classList.toggle("active", cardModalMode === "edit");

  if (cardModalMode === "edit") {
    renderEditor();
  } else {
    // 切回檢視之前先補存：剛打的最後一句話要看得到
    flushEditorDraft();
    renderCardDetail();
  }
  const mark = el("editorSaveMark");
  if (mark && cardModalMode === "view") mark.textContent = "";
}

function renderCardDetail() {
  const card = findCard(editingCardId);
  const body = el("cardDetailBody");
  if (!card || !body) return;
  const pal = getPalette(card.color);
  body.innerHTML = "";

  const head = document.createElement("header");
  head.className = "detail-head";
  head.style.background = pal.bg;

  const avatar = document.createElement("div");
  avatar.className = "detail-avatar";
  avatar.style.color = pal.text;
  if (card.avatar && isSafeImageSrc(card.avatar)) {
    const img = document.createElement("img");
    img.src = card.avatar;
    img.alt = "";
    avatar.appendChild(img);
  } else {
    avatar.textContent = card.icon || nameInitial(card.name);
  }
  head.appendChild(avatar);

  const headText = document.createElement("div");
  headText.className = "detail-headtext";

  const h = document.createElement("h2");
  h.style.color = pal.text;
  h.textContent = card.name || "未命名角色";
  headText.appendChild(h);

  if (card.alias) {
    const alias = document.createElement("p");
    alias.className = "detail-alias";
    alias.style.color = pal.text;
    alias.textContent = card.alias;
    headText.appendChild(alias);
  }

  const meta = document.createElement("p");
  meta.className = "detail-meta";
  meta.style.color = pal.text;
  const done = cardCompletion(card);
  meta.textContent = pal.name + " ・ 完成度 " + done.percent + "% ・ 更新於 " + card.updatedAt;
  headText.appendChild(meta);

  head.appendChild(headText);
  body.appendChild(head);

  if (card.tagline) {
    const line = document.createElement("p");
    line.className = "detail-tagline";
    line.textContent = card.tagline;
    body.appendChild(line);
  }

  const filled = (card.fields || []).filter(function(f) { return f.label || f.value; });
  if (filled.length) {
    const grid = document.createElement("dl");
    grid.className = "detail-fields";
    filled.forEach(function(f) {
      const dt = document.createElement("dt");
      dt.textContent = f.label || "－";
      const dd = document.createElement("dd");
      dd.textContent = f.value || "—";
      if (!f.value) dd.classList.add("is-blank");
      grid.appendChild(dt);
      grid.appendChild(dd);
    });
    body.appendChild(grid);
  }

  (card.sections || []).forEach(function(s) {
    if (!s.label && !s.text) return;
    const sec = document.createElement("section");
    sec.className = "detail-section";

    const title = document.createElement("h3");
    title.textContent = s.label || "未命名段落";
    sec.appendChild(title);

    const p = document.createElement("p");
    // 段落是多行純文字，使用者自己排的換行要保留（CSS 的 white-space: pre-wrap）
    p.textContent = s.text || "（還沒寫）";
    if (!s.text) p.classList.add("is-blank");
    sec.appendChild(p);
    body.appendChild(sec);
  });

  if ((card.tags || []).length) {
    const tagBox = document.createElement("div");
    tagBox.className = "detail-tags";
    card.tags.forEach(function(t) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.style.background = pal.bg;
      chip.style.color = pal.text;
      chip.textContent = "#" + t;
      tagBox.appendChild(chip);
    });
    body.appendChild(tagBox);
  }

  /* 這個角色在關係圖上的線，直接列在卡片底下。

     關係寫在「人際關係」那個段落裡是純文字，改了關係圖不會同步；
     這一段是真的從圖上讀出來的，兩邊永遠一致。 */
  renderCardRelations(body, card);

  const star = el("detailFavBtn");
  if (star) {
    star.textContent = card.favorite ? "★ 我的最愛" : "☆ 我的最愛";
    star.classList.toggle("on", !!card.favorite);
  }
}

function renderCardRelations(body, card) {
  const canvas = currentCanvas();
  const node = canvas.nodes.find(function(n) { return n.cardId === card.id; });
  if (!node) return;

  const related = canvas.edges.filter(function(e) {
    return e.source === node.id || e.target === node.id;
  });
  if (!related.length) return;

  const sec = document.createElement("section");
  sec.className = "detail-section";
  const title = document.createElement("h3");
  title.textContent = "關係圖上的連線";
  sec.appendChild(title);

  const list = document.createElement("div");
  list.className = "relation-list";
  related.forEach(function(e) {
    const otherId = e.source === node.id ? e.target : e.source;
    const other = nodeCard(findNode(otherId));
    const row = document.createElement("button");
    row.type = "button";
    row.className = "relation-row";
    row.onclick = function() { openEdgeModal(e.id); };

    const dot = document.createElement("span");
    dot.className = "relation-dot";
    dot.style.background = getEdgeStroke(e.color);
    row.appendChild(dot);

    const who = document.createElement("strong");
    who.textContent = other ? (other.name || "未命名角色") : "（已刪除）";
    row.appendChild(who);

    const label = document.createElement("span");
    label.textContent = e.label || "（還沒寫關係）";
    if (!e.label) label.classList.add("is-blank");
    row.appendChild(label);

    list.appendChild(row);
  });
  sec.appendChild(list);
  body.appendChild(sec);
}

function toggleOpenedFavorite() {
  if (editingCardId) toggleFavorite(editingCardId);
}

function deleteOpenedCard() {
  if (editingCardId) deleteCard(editingCardId);
}

function duplicateOpenedCard() {
  if (editingCardId) duplicateCard(editingCardId);
}

/* 把這張卡複製成純文字，方便貼到 Discord、噗浪或任何地方。
   Clipboard API 在非 https 與舊瀏覽器上不存在，所以要留退路——
   複製失敗卻什麼都不說，使用者會一直按同一顆按鈕。 */
function copyOpenedCardText() {
  const card = findCard(editingCardId);
  if (!card) return;
  const text = cardToPlainText(card);

  const fallback = function() {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    toast(ok ? "已複製整張卡片的文字" : "這個瀏覽器不讓程式複製，請手動選取");
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      toast("已複製整張卡片的文字");
    }).catch(fallback);
  } else {
    fallback();
  }
}
