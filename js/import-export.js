/* ==========================================================
   匯出與匯入 (import-export.js)

   這個檔案有兩個工作：
     1. 備份與還原（整包 JSON）
     2. 跟姊妹專案「世界觀架構工作台」(world_2) 互通

   第 2 點是刻意做的。那個 app 的匯入接受「一個 JSON 陣列，每筆是
   { title, content, icon, tags }」，所以這裡把角色卡攤平成那個形狀，
   使用者在那邊選「匯入」就會多出一批角色文檔，不需要任何整合工作。
   反過來也通：從那邊匯出的文檔陣列丟進來，會被拆回角色卡。
   ========================================================== */

/* ---------- 純函式：兩種格式的互轉 ---------- */

/* 角色卡 → 世界觀工作台的文檔。

   內文用該 app 認得的寫法：
     「# 標題」開頭的行會被它抽成章節快速跳轉，所以段落標題用 #
     「#標籤」會被它自動抽成 hashtag 並套色，所以標籤寫在最後一行
   兩件事共用一個井號但規則不同（前者後面有空白），這是那邊的既有約定，
   不是這裡自己發明的。 */
function buildWorldviewDocs(cards) {
  return (cards || []).map(function(card) {
    const lines = [];
    const head = [];
    if (card.alias) head.push("別名：" + card.alias);
    if (card.tagline) head.push(card.tagline);
    if (head.length) { lines.push(head.join("\n")); lines.push(""); }

    const filled = (card.fields || []).filter(function(f) { return f.label || f.value; });
    if (filled.length) {
      lines.push("# 基本資料");
      filled.forEach(function(f) { lines.push((f.label || "－") + "：" + (f.value || "")); });
      lines.push("");
    }

    (card.sections || []).forEach(function(s) {
      if (!s.label && !s.text) return;
      lines.push("# " + (s.label || "未命名段落"));
      lines.push(s.text || "");
      lines.push("");
    });

    // 標籤放最後一行，讓那邊抽 hashtag 時不會跟段落標題混在一起
    if ((card.tags || []).length) {
      lines.push(card.tags.map(function(t) { return "#" + t; }).join(" "));
    }

    return {
      title: card.name || "未命名角色",
      icon: card.icon || "🎭",
      tags: (card.tags || []).slice(),
      content: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
    };
  });
}

/* 世界觀工作台的文檔 → 角色卡。

   內文用「# 段落標題」切段；第一段如果沒有標題，就當成一句話簡介。
   「基本資料」那一段裡的「鍵：值」會拆回資料列——這樣從那邊改完再
   匯回來，欄位不會全部擠成一大塊文字。 */
function parseWorldviewDocToCard(doc) {
  if (!doc || typeof doc !== "object") return null;
  const title = typeof doc.title === "string" ? doc.title.trim() : "";
  const content = typeof doc.content === "string" ? doc.content : "";
  if (!title && !content) return null;

  const sections = [];
  let preamble = [];
  let current = null;

  content.split("\n").forEach(function(rawLine) {
    const line = rawLine.replace(/\r$/, "");
    const m = line.match(/^#\s+(.+)$/);      // 「# 」後面要有空白，才不會吃到 #標籤
    if (m) {
      current = { label: m[1].trim(), text: [] };
      sections.push(current);
      return;
    }
    if (current) current.text.push(line);
    else preamble.push(line);
  });

  const fields = [];
  const kept = [];
  sections.forEach(function(s) {
    const text = s.text.join("\n").trim();
    if (s.label === "基本資料") {
      text.split("\n").forEach(function(line) {
        const kv = line.split(/[：:]/);
        if (kv.length >= 2 && kv[0].trim()) {
          fields.push({ label: kv[0].trim(), value: kv.slice(1).join("：").trim() });
        }
      });
      return;
    }
    kept.push({ label: s.label, text: text });
  });

  // 前言裡把「別名：」挑出來，剩下的當簡介
  let alias = "";
  const taglineLines = [];
  preamble.join("\n").split("\n").forEach(function(line) {
    const t = line.trim();
    if (!t) return;
    // 只有最後一行的純標籤行要丟掉，內文裡提到的標籤不動
    if (/^#\S+(\s+#\S+)*$/.test(t)) return;
    const m = t.match(/^別名[：:]\s*(.*)$/);
    if (m) { alias = m[1].trim(); return; }
    taglineLines.push(t);
  });

  return {
    name: title || "匯入角色",
    alias: alias,
    icon: typeof doc.icon === "string" ? doc.icon : "🎭",
    tagline: taglineLines.join(" ").slice(0, 200),
    fields: fields,
    sections: kept,
    tags: Array.isArray(doc.tags) ? doc.tags.filter(function(t) { return typeof t === "string"; }) : []
  };
}

/* 把外來的一筆資料整成一張能用的卡片；整不出來就回傳 null。

   匯入檔是不可信的輸入：可能是別人給的、可能是手改壞的、也可能根本
   是另一個 app 的檔案。這裡把每一個欄位都當成「不知道是什麼」來處理，
   長度也要截——一個十萬字的名字會把整面卡片牆撐爛。 */
const IMPORT_MAX_TAGLINE = 500;

function coerceImportedCard(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const str = function(v) { return typeof v === "string" ? v : ""; };

  // 看起來像世界觀工作台的文檔（有 title/content、沒有 name）就先轉一手
  const src = (!str(raw.name) && (str(raw.title) || str(raw.content)))
    ? parseWorldviewDocToCard(raw) : raw;
  if (!src) return null;

  const name = str(src.name).trim().slice(0, MAX_NAME_LEN);
  const tagline = str(src.tagline).slice(0, IMPORT_MAX_TAGLINE);
  const fields = Array.isArray(src.fields) ? src.fields.filter(isPlainObject).map(function(f) {
    return { label: str(f.label).slice(0, 40), value: str(f.value).slice(0, 500) };
  }).slice(0, MAX_FIELDS_PER_CARD) : [];
  const sections = Array.isArray(src.sections) ? src.sections.filter(isPlainObject).map(function(s) {
    return { label: str(s.label).slice(0, 40), text: str(s.text) };
  }).slice(0, MAX_SECTIONS_PER_CARD) : [];
  const tags = dedupeTags(Array.isArray(src.tags) ? src.tags : []);

  // 全空的不是一張卡片，只是雜訊（[1,2,3] 或 [{}] 這種檔案匯進來的結果）
  const hasBody = fields.some(function(f) { return f.value; }) ||
                  sections.some(function(s) { return s.text; });
  if (!name && !tagline && !hasBody && !tags.length) return null;

  return {
    name: name || "匯入角色",
    alias: str(src.alias).slice(0, MAX_NAME_LEN),
    icon: Array.from(str(src.icon)).slice(0, 2).join("") || "🎭",
    avatar: isSafeImageSrc(src.avatar) ? src.avatar : "",
    color: DEFAULT_PALETTES[src.color] ? src.color : "c_gray",
    tagline: tagline,
    fields: fields,
    sections: sections,
    tags: tags,
    favorite: !!src.favorite
  };
}

/* 一份 JSON 看起來像不像「這個 app 的完整備份」 */
function looksLikeFullBackup(data) {
  return !!data && !Array.isArray(data) && typeof data === "object" &&
         Array.isArray(data.cards) && Array.isArray(data.groups);
}

function safeParseJSON(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}


/* ---------- 下載 ---------- */

function downloadFile(content, fileName, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立刻 revoke 在 Safari 上會讓下載中斷，晚一點再收
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

/* 檔名一律 ASCII。實測非 ASCII 的檔名在 Chromium 下會變成沒有副檔名的
   "download"，備份檔的名字一定要認得出來。 */
function stamp() {
  const d = new Date();
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
         "_" + pad2(d.getHours()) + pad2(d.getMinutes());
}


/* ---------- 匯出視窗 ---------- */

function openExportModal() {
  renderExportScope();
  el("exportModal").classList.add("active");
}

function closeExportModal() {
  el("exportModal").classList.remove("active");
}

/* 使用者要匯出的是哪些卡片。三個選項的差別在畫面上要講清楚，
   不然「我明明有 50 張，怎麼只匯出 3 張」會變成客訴。 */
function exportScopeCards() {
  const scope = (el("exportScope") || {}).value || "group";
  if (scope === "all") return appData.cards.slice();
  if (scope === "visible") return visibleCards();
  if (scope === "selected") {
    return appData.cards.filter(function(c) { return batchSelected.has(c.id); });
  }
  return cardsInGroup(activeGroupId);
}

function renderExportScope() {
  const sel = el("exportScope");
  if (!sel) return;
  const g = currentGroup();
  sel.innerHTML = "";
  [
    ["group", "這個作品（" + (g ? g.name : "") + "）：" + cardsInGroup(activeGroupId).length + " 張"],
    ["visible", "目前畫面上的結果：" + visibleCards().length + " 張"],
    ["all", "全部作品：" + appData.cards.length + " 張"],
    ["selected", "批次模式選取的：" + batchSelected.size + " 張"]
  ].forEach(function(pair) {
    const opt = document.createElement("option");
    opt.value = pair[0];
    opt.textContent = pair[1];
    sel.appendChild(opt);
  });
}

function exportAsJSON() {
  const cards = exportScopeCards();
  if (!cards.length) { toast("這個範圍裡沒有卡片"); return; }
  downloadFile(JSON.stringify(cards, null, 2), "oc_cards_" + stamp() + ".json", "application/json");
  closeExportModal();
}

function exportAsWorldviewJSON() {
  const cards = exportScopeCards();
  if (!cards.length) { toast("這個範圍裡沒有卡片"); return; }
  const docs = buildWorldviewDocs(cards);
  downloadFile(JSON.stringify(docs, null, 2), "oc_to_worldbuilder_" + stamp() + ".json", "application/json");
  closeExportModal();
  toast("在世界觀工作台選「匯入」→ 挑這個檔案就會變成 " + docs.length + " 篇角色文檔");
}

function exportAsTXT() {
  const cards = exportScopeCards();
  if (!cards.length) { toast("這個範圍裡沒有卡片"); return; }
  // 分隔線跟世界觀工作台的 TXT 匯出一致，那邊可以直接吃
  const text = cards.map(cardToPlainText).join("\n\n====================\n\n");
  downloadFile(text, "oc_cards_" + stamp() + ".txt", "text/plain;charset=utf-8");
  closeExportModal();
}

/* 匯出成一頁可以列印、可以直接看的 HTML。

   這是「給別人看」的格式：貼到噗浪或寄給朋友的時候，對方不需要裝
   任何東西就能打開。所有使用者輸入都要跳脫——這份檔案會被瀏覽器
   當成 HTML 執行，名字裡的 <script> 不擋就會真的跑起來。 */
function exportAsHTML() {
  const cards = exportScopeCards();
  if (!cards.length) { toast("這個範圍裡沒有卡片"); return; }

  const body = cards.map(function(c) {
    const pal = DEFAULT_PALETTES[c.color] || DEFAULT_PALETTES.c_gray;
    const fields = (c.fields || []).filter(function(f) { return f.label || f.value; })
      .map(function(f) {
        return "<div class='f'><dt>" + escapeHtml(f.label || "－") + "</dt><dd>" +
               escapeHtml(f.value || "—") + "</dd></div>";
      }).join("");
    const sections = (c.sections || []).filter(function(s) { return s.label || s.text; })
      .map(function(s) {
        return "<section><h3>" + escapeHtml(s.label || "未命名段落") + "</h3><p>" +
               escapeHtml(s.text || "") + "</p></section>";
      }).join("");
    const tags = (c.tags || []).map(function(t) {
      return "<span class='tag'>#" + escapeHtml(t) + "</span>";
    }).join("");
    const avatar = (c.avatar && isSafeImageSrc(c.avatar))
      ? "<img class='avatar' src='" + escapeHtml(c.avatar) + "' alt=''>"
      : "<div class='avatar emoji'>" + escapeHtml(c.icon || "🎭") + "</div>";

    return "<article class='oc-card' data-tags='" + escapeHtml((c.tags || []).join(",")) +
      "' style='--pal-bg:" + escapeHtml(pal.bg) + ";--pal-text:" + escapeHtml(pal.text) + "'>" +
      "<header>" + avatar + "<div><h2>" + escapeHtml(c.name || "未命名角色") + "</h2>" +
      (c.alias ? "<p class='alias'>" + escapeHtml(c.alias) + "</p>" : "") + "</div></header>" +
      (c.tagline ? "<p class='tagline'>" + escapeHtml(c.tagline) + "</p>" : "") +
      (fields ? "<dl class='fields'>" + fields + "</dl>" : "") +
      sections +
      (tags ? "<div class='tags'>" + tags + "</div>" : "") +
      "</article>";
  }).join("\n");

  const html = "<!DOCTYPE html>\n<html lang='zh-TW'><head><meta charset='UTF-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>OC 角色卡</title><style>" +
    "body{background:#F3EEE2;color:#2A2420;font-family:'Noto Sans TC',system-ui,sans-serif;" +
    "margin:0;padding:24px;display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}" +
    ".oc-card{background:#FFFDF8;border:1px solid #E1D7C1;border-top:5px solid var(--pal-text);" +
    "border-radius:14px;padding:20px;width:340px;box-shadow:0 6px 18px rgba(42,36,32,.08)}" +
    "header{display:flex;gap:12px;align-items:center;margin-bottom:10px}" +
    ".avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--pal-bg);" +
    "display:flex;align-items:center;justify-content:center;font-size:30px;flex-shrink:0}" +
    "h2{margin:0;font-size:20px}.alias{margin:2px 0 0;color:#6E6152;font-size:13px}" +
    ".tagline{color:#6E6152;font-size:14px;line-height:1.7;margin:0 0 12px}" +
    ".fields{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;margin:0 0 14px}" +
    ".f{background:#F3EEE2;border-radius:8px;padding:6px 10px}" +
    "dt{font-size:11px;color:#A0937E;margin:0}dd{margin:2px 0 0;font-size:13px}" +
    "section{margin-bottom:12px}h3{font-size:13px;margin:0 0 4px;color:var(--pal-text)}" +
    "section p{margin:0;font-size:13px;line-height:1.8;white-space:pre-wrap}" +
    ".tags{display:flex;flex-wrap:wrap;gap:6px}" +
    ".tag{background:var(--pal-bg);color:var(--pal-text);border-radius:12px;padding:3px 10px;font-size:11px}" +
    "@media print{body{background:#fff}.oc-card{break-inside:avoid;box-shadow:none}}" +
    "</style></head><body>\n" + body + "\n</body></html>";

  downloadFile(html, "oc_cards_" + stamp() + ".html", "text/html;charset=utf-8");
  closeExportModal();
}

function exportFullBackup() {
  downloadFile(JSON.stringify(appData, null, 2),
    "oc_card_backup_" + stamp() + ".json", "application/json");
  toast("已下載完整備份");
}


/* ---------- 匯入 ---------- */

function triggerImportFile() {
  const input = el("importFileInput");
  if (input) { input.value = ""; input.click(); }
}

function handleImportFileSelected(e) {
  const file = e && e.target && e.target.files && e.target.files[0];
  if (!file) return;
  // 一份很大的檔案讀進來會把分頁凍住，而且多半是選錯檔案（影片、壓縮檔）
  if (file.size > 20 * 1024 * 1024) {
    alert("這個檔案超過 20MB，看起來不是角色卡備份檔。");
    return;
  }
  const reader = new FileReader();
  reader.onload = function() { importFromJSON(String(reader.result)); };
  reader.onerror = function() { alert("讀取檔案失敗。"); };
  reader.readAsText(file);
}

function importFromJSON(text) {
  const data = safeParseJSON(text);
  if (data === null) { alert("匯入失敗：這個檔案不是有效的 JSON。"); return; }

  if (looksLikeFullBackup(data)) { importFullBackup(data); return; }
  if (Array.isArray(data)) { importCardsArray(data); return; }

  alert("匯入失敗：無法辨識這個 JSON 的內容。\n\n" +
        "支援的格式有三種：本工具的完整備份、卡片陣列，以及世界觀架構工作台匯出的文檔陣列。");
}

/* 整包還原會蓋掉現有資料，所以覆蓋之前一定要先把現有的存成檔案。

   直接 appData = data 就洗掉了，匯到一半發現拿錯檔案就回不去。
   備份走下載而不是存進 localStorage，是因為這種時候 localStorage
   很可能正好是滿的。 */
function importFullBackup(data) {
  if (!confirm("這是一份完整備份，匯入會覆蓋現在的全部資料（" + appData.cards.length +
               " 張卡片）。\n\n按下確定之後會先把目前的資料下載一份備份檔，再進行匯入。\n\n確定要繼續嗎？")) return;

  try {
    downloadFile(JSON.stringify(appData, null, 2),
      "oc_card_backup_before_import_" + Date.now() + ".json", "application/json");
  } catch (e) {
    if (!confirm("自動備份失敗，繼續匯入會蓋掉現有資料而且無法復原。還是要繼續嗎？")) return;
  }

  const groups = data.groups.filter(isPlainObject).map(function(g) {
    return {
      id: typeof g.id === "string" && g.id ? g.id : newId("g"),
      name: (typeof g.name === "string" ? g.name : "未命名作品").slice(0, MAX_NAME_LEN),
      icon: Array.from(typeof g.icon === "string" ? g.icon : "").slice(0, 2).join("") || "📁"
    };
  });
  if (!groups.length) groups.push({ id: "g_main", name: "我的角色", icon: "🎭" });
  const groupIds = new Set(groups.map(function(g) { return g.id; }));

  const cards = data.cards.filter(isPlainObject).map(function(c) {
    const card = ensureCardShape(JSON.parse(JSON.stringify(c)));
    // 指向不存在的作品會讓卡片憑空消失（哪個作品都看不到它）
    if (!groupIds.has(card.groupId)) card.groupId = groups[0].id;
    return card;
  });

  appData = {
    version: 1,
    colorPalette: isPlainObject(data.colorPalette) ? data.colorPalette
      : JSON.parse(JSON.stringify(DEFAULT_PALETTES)),
    groups: groups,
    cards: cards,
    trash: {
      cards: isPlainObject(data.trash) && Array.isArray(data.trash.cards) ? data.trash.cards : [],
      groups: isPlainObject(data.trash) && Array.isArray(data.trash.groups) ? data.trash.groups : []
    }
  };
  paletteKeys().forEach(function(k) {
    if (!isPlainObject(appData.colorPalette[k])) {
      appData.colorPalette[k] = JSON.parse(JSON.stringify(DEFAULT_PALETTES[k]));
    }
  });
  activeGroupId = groups[0].id;
  saveData();
  location.reload();
}

/* 一個陣列：可能是這個 app 的卡片，也可能是世界觀工作台的文檔。
   兩種都走 coerceImportedCard，它自己會認。 */
function importCardsArray(list) {
  if (!list.length) { alert("這個檔案裡沒有可匯入的資料。"); return; }

  const usable = [];
  let skipped = 0;
  list.forEach(function(item) {
    const card = coerceImportedCard(item);
    if (card) usable.push(card); else skipped++;
  });

  if (!usable.length) {
    alert("這個檔案裡沒有可匯入的角色卡。" + (skipped ? "（有 " + skipped + " 筆資料無法辨識）" : ""));
    return;
  }

  // 數量要在檢查之後才報，不然會出現「即將匯入 2 張」後面接「匯入失敗」
  const g = currentGroup();
  if (!confirm("即將匯入 " + usable.length + " 張角色卡到「" + (g ? g.name : "") + "」" +
        (skipped ? "（另有 " + skipped + " 筆資料無法辨識，會略過）" : "") + "，確定嗎？")) return;

  const now = formatTime(new Date());
  usable.forEach(function(c) {
    appData.cards.push(ensureCardShape(Object.assign({}, c, {
      id: newId("card"),
      groupId: activeGroupId,
      createdAt: now,
      updatedAt: now
    })));
  });
  saveData();
  renderWall();
  toast("已匯入 " + usable.length + " 張卡片");
}
