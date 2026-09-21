/* ==========================================================
   常數、預設資料、全域狀態 (state.js)
   ========================================================== */

/* 標籤與卡片的分類色。排序是「灰 紅 橙 黃 綠 藍 紫」——灰是中性放最前，
   其餘照色相環。顯示順序一律以這個物件的鍵順序為準，要改排序改這裡就好。
   注意：不要改成去迭代 appData.colorPalette，那是使用者存檔裡的複本，
   鍵的順序停在他第一次存檔的那一天，改了這裡也不會動。 */
const DEFAULT_PALETTES = {
  "c_gray":   { name: "未分類", bg: "#EFE9DC", text: "#5A4F42" },
  "c_rose":   { name: "主角群", bg: "#F3DAD5", text: "#8C3527" },
  "c_orange": { name: "夥伴／配角", bg: "#F3E1CC", text: "#8A4F1F" },
  "c_yellow": { name: "設定中", bg: "#F2E8C9", text: "#7A5B12" },
  "c_green":  { name: "已完成", bg: "#DCEAE1", text: "#2C5A44" },
  "c_blue":   { name: "勢力／陣營", bg: "#DCE7F0", text: "#28506B" },
  "c_purple": { name: "反派／對立", bg: "#E7DFF0", text: "#553B76" }
};

/* 夜間版的同一組分類。深色底配亮字，色相跟日間版對齊，
   所以「紫色＝反派」在兩個主題下都還是紫的，只是換了明暗。

   名稱不放在這裡：使用者在「分類設定」改的名字存在 appData.colorPalette，
   兩個主題共用同一份。這裡只管顏色。 */
const DARK_PALETTES = {
  "c_gray":   { bg: "#33302A", text: "#D5CCBC" },
  "c_rose":   { bg: "#3A2220", text: "#E7A194" },
  "c_orange": { bg: "#3A2A1B", text: "#E2B079" },
  "c_yellow": { bg: "#363019", text: "#DCC98A" },
  "c_green":  { bg: "#1E3229", text: "#99D0B3" },
  "c_blue":   { bg: "#1F2E3C", text: "#9FC4E2" },
  "c_purple": { bg: "#2D2539", text: "#C4AFDD" }
};

/* 主題目前是不是暗的。唯一的判斷來源是 <html data-theme>，
   由 js/theme.js 寫入；CSS 與 JS 都看同一個值，不會各自解讀。 */
function isDarkTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

/* 取一個分類的顏色。名稱一律來自使用者改過的 appData.colorPalette，
   顏色則看現在是哪個主題。所有要畫標籤／卡片顏色的地方都走這裡，
   不要再自己去讀 colorPalette，不然切主題會漏掉。 */
function getPalette(key) {
  const id = DEFAULT_PALETTES[key] ? key : "c_gray";
  const saved = (typeof appData !== "undefined" && appData && appData.colorPalette &&
                 appData.colorPalette[id]) || DEFAULT_PALETTES[id];
  const colors = isDarkTheme() ? (DARK_PALETTES[id] || DARK_PALETTES.c_gray) : saved;
  return { name: saved.name || DEFAULT_PALETTES[id].name, bg: colors.bg, text: colors.text };
}

function paletteKeys() {
  return Object.keys(DEFAULT_PALETTES);
}


/* ==========================================================
   localStorage 的安全存取

   不是只有「空間滿了」一種壞法：瀏覽器設定裡關掉網站資料、企業政策、
   某些嚴格的隱私模式下，光是讀取 window.localStorage 這個屬性本身就會
   丟 SecurityError。沒包起來的話，一丟例外整個檔案就在那裡中斷，後面的
   let 宣告全部沒執行到；函式因為提升看起來還在，一呼叫就撞上 TDZ。

   結果是 app 看起來完全正常、打字切換都能用，但每次存檔都在背景丟例外、
   什麼都沒存進去，而且不會告訴使用者。

   這三個工具讓所有存取都不會把呼叫端炸掉；真正需要知道「存進去了沒」的
   地方（saveData）自己看回傳值。
   ========================================================== */
function storageAvailable() {
  try {
    const k = "__probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}

function safeStorageGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}

/* 存成功回傳 null，失敗回傳那個 error——呼叫端要據此決定怎麼告訴使用者 */
function safeStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); return null; } catch (e) { return e; }
}

function safeStorageRemove(key) {
  try { window.localStorage.removeItem(key); } catch (e) { /* 存不了就不用刪 */ }
}


/* ==========================================================
   卡片的形狀

   一張卡片分成三層，對應三種輸入手感：
     fields   短短的一行（性別、年齡…），排成兩欄的資料列
     sections 大段文字（外觀、性格、背景…），排成可摺疊的段落
     tags     一個一個的標籤 chip

   三層的標籤（label）都可以改、可以增刪，因為每個人記角色的方式不一樣：
   有人要「聲線」「口頭禪」，有人要「血統」「魔力屬性」。寫死欄位的版本
   試過，第一個角色就卡住了。
   ========================================================== */

const DEFAULT_FIELD_LABELS = ["性別", "年齡", "種族", "身分", "生日", "身高"];
const DEFAULT_SECTION_LABELS = ["外觀", "性格", "背景", "人際關係"];

const COMMON_ICONS = [
  "🧝", "🧙", "🧛", "🧚", "🦸", "🦹", "👑", "🗡️", "🏹", "🛡️",
  "🐉", "🔮", "🎭", "🌙", "⭐", "🔥", "❄️", "🌿", "🐺", "🦊",
  "🎻", "📖", "⚗️", "🕯️", "💎", "🪶", "🩸", "⚙️", "🎀", "☠️"
];

/* 角色卡的欄位上限。不是怕記憶體，是怕 localStorage：
   圖片是整張 base64 存進去的，而瀏覽器只給大約 5MB。 */
const MAX_TAGS_PER_CARD = 30;
const MAX_FIELDS_PER_CARD = 40;
const MAX_SECTIONS_PER_CARD = 30;
const MAX_NAME_LEN = 60;
const MAX_TAG_LEN = 30;

/* 頭像圖片：上傳後一律縮到這個邊長再存，並且壓成 JPEG。
   原圖直接存的話，一張手機拍的照片就是 3MB 起跳，兩張就把整個
   localStorage 吃光，而且是在使用者毫無感覺的情況下。 */
const AVATAR_MAX_EDGE = 320;
const AVATAR_JPEG_QUALITY = 0.82;

/* 垃圾桶保留天數。超過就自動清掉，否則刪掉的卡片會永遠佔著那 5MB
   ——尤其是帶頭像的。 */
const TRASH_RETENTION_DAYS = 60;

/* 卡片牆的排序方式。值會存進 UI 狀態，改名字要記得做遷移。 */
const SORT_MODES = {
  "updated": "最近修改",
  "created": "建立時間",
  "name": "名稱",
  "color": "分類顏色"
};


/* ==========================================================
   第一次打開時看到的東西

   刻意放兩張「寫好的」示範卡，而不是空畫面：這個 app 的重點是「一張卡
   要填哪些東西」，空的卡片牆講不出這件事。使用者刪掉它們就好。
   ========================================================== */
const INITIAL_APP_DATA = {
  version: 1,
  colorPalette: JSON.parse(JSON.stringify(DEFAULT_PALETTES)),
  groups: [
    { id: "g_main", name: "我的角色", icon: "🎭" },
    { id: "g_side", name: "同人／客串", icon: "✨" }
  ],
  trash: { cards: [], groups: [] },
  cards: [
    {
      id: "card_demo_1",
      groupId: "g_main",
      name: "艾莉亞・維斯特",
      alias: "銀霜",
      icon: "🗡️",
      avatar: "",
      color: "c_rose",
      tagline: "把自己活成一把刀的前皇家騎士，話少，賬記得很清楚。",
      fields: [
        { label: "性別", value: "女" },
        { label: "年齡", value: "27" },
        { label: "種族", value: "人類" },
        { label: "身分", value: "流亡騎士" },
        { label: "生日", value: "11/03" },
        { label: "身高", value: "172cm" }
      ],
      sections: [
        { label: "外觀", text: "銀灰長髮束成低馬尾，左眼下有一道舊疤。慣穿深藍色外套，領口別著已經失效的騎士徽章。" },
        { label: "性格", text: "不擅長把話說軟，但會默默把最後一份口糧留給隊友。討厭被人道謝，會轉身就走。" },
        { label: "背景", text: "原為皇家近衛第三隊隊長，因為拒絕執行屠村命令而被除籍。現在接零星的護衛委託維生。" },
        { label: "人際關係", text: "與「夜鴉」是舊識，互相看不順眼但性命相托。" }
      ],
      tags: ["騎士", "主角群", "劍"],
      favorite: true,
      createdAt: "2026-09-01 10:00",
      updatedAt: "2026-09-01 10:00"
    },
    {
      id: "card_demo_2",
      groupId: "g_main",
      name: "夜鴉",
      alias: "本名不詳",
      icon: "🐺",
      avatar: "",
      color: "c_purple",
      tagline: "在黑市裡賣情報的人，笑得最開的時候通常最不該相信他。",
      fields: [
        { label: "性別", value: "男" },
        { label: "年齡", value: "不詳（自稱三十出頭）" },
        { label: "種族", value: "半精靈" },
        { label: "身分", value: "情報商" }
      ],
      sections: [
        { label: "外觀", text: "亂翹的黑髮，總是穿著不合身的大衣，口袋裡塞滿別人的秘密。" },
        { label: "性格", text: "油腔滑調，把所有事情都標好價錢——包括自己的命。" },
        { label: "背景", text: "童年在戰後的難民營度過，學會了「消息比麵包有用」。" }
      ],
      tags: ["情報", "黑市"],
      favorite: false,
      createdAt: "2026-09-01 10:20",
      updatedAt: "2026-09-01 10:20"
    }
  ]
};


/* ===== 全域狀態 ===== */
let appData = JSON.parse(JSON.stringify(INITIAL_APP_DATA));

let activeGroupId = "g_main";
let openedCardId = null;        // 詳情視窗正在看的那張
let editingCardId = null;       // 編輯面板正在改的那張（null = 沒在編輯）
let activeView = "wall";        // "wall" | "edit"

let searchQuery = "";
let filterTag = null;           // 只看某個標籤
let filterColor = null;         // 只看某個分類顏色
let filterFavorite = false;     // 只看我的最愛
let sortMode = "updated";

let isBatchMode = false;
let batchSelected = new Set();

let iconPickerTarget = null;    // "card" | "group"
let editorDirty = false;        // 編輯面板有沒有還沒存的修改
let editorAutosaveTimer = null;
