# 開發筆記（交接用）

給接手的人／下一個對話看的。README 講「這個 app 是什麼」，這份講
**「改它的時候要知道什麼」**——主要是踩過坑之後才立下的規則，
以及還沒做完的事。

姊妹專案：[`evonne93327-create/world_2`](https://github.com/evonne93327-create/world_2)（世界觀架構工作台）。
下面的〈硬規則〉幾乎是從那邊搬過來的同一份，因為是同樣的架構、同樣的坑。

---

## 現況

| | |
|---|---|
| service worker | **v1** |
| 開發分支 | `claude/oc-character-card-archive-tqvgd6` |
| 測試 | `node --test`，23 項全綠 |
| 雲端同步 | 還沒做（見下方〈還沒做的事〉） |

---

## 硬規則

這幾條不是風格偏好，是出過事才立的，不要為了「比較簡潔」退回去。

### 1. localStorage 一律走 `safeStorage*`（`js/state.js`）

不是只有「空間滿了」一種壞法。瀏覽器設定關掉網站資料、企業政策、某些嚴格的
隱私模式下，**光是讀 `window.localStorage` 這個屬性本身就會丟 `SecurityError`**。
沒包起來的話，一丟例外整個檔案就在那行中斷，後面的 `let` 宣告全部沒執行到；
函式因為提升看起來還在，一呼叫就撞上 TDZ。

結果是 app 看起來完全正常、打字切換都能用，但每次存檔都在背景丟例外、
什麼都沒存進去，而且不會告訴使用者。

`saveData()` 會看回傳值，存不了就跳 `storageFullModal` 要人立刻備份。
不要為了「不要吵使用者」把那個提示拿掉——靜默的資料遺失比一個彈窗糟得多。

### 2. 畫面一律用 DOM API 組，不要 innerHTML 拼字串

角色名、標籤、段落內容全部是使用者輸入，而且匯入的 JSON 是外來檔案。
拼字串只要漏跳脫一處就是注入。唯一用字串拼 HTML 的地方是
`exportAsHTML()`，那裡每一個值都過 `escapeHtml()`，改那段的時候要特別小心。

`isSafeImageSrc()` 是另一半：頭像會被直接塞進 `<img src>`，白名單只留
`data:image/`。放行 http(s) 會讓一份匯入檔變成追蹤像素（開啟就對外連線），
放行 `javascript:` 更糟。

### 3. Service worker：網路優先、不碰跨網域、改了就加 VERSION

- **網路優先、離線才回退快取。** 快取優先會把使用者鎖在舊版程式碼裡，
  而且很難自己救回來——強制重新整理也未必有用，因為回應是 service worker
  給的，根本沒碰到網路。
- **絕不快取跨網域請求**（Google Fonts）。
- **動到 `index.html` 引用的任何檔案，就把 `sw.js` 的 `VERSION` 加一號。**
  不加的話舊快取不會被清掉。`tests/shell-manifest.test.js` 會檢查 SHELL
  清單跟 index.html 對不對得上，但它檢查不到「你忘記加版號」。

### 4. `<script>` 的載入順序有相依性

`js/main.js` 必須排在 `js/storage.js` 前面：storage.js 在載入時就會跑
`ensureCardShape()`，而它用到的 `isSafeImageSrc`／`dedupeTags`／`formatTime`
都住在 main.js。順序反了會在開啟 app 的第一秒炸掉。

`tests/shell-manifest.test.js` 有釘住這件事，`tests/helpers/load-app.js`
也照同一個順序載入。

### 5. 主題的唯一判斷來源是 `<html data-theme>`

卡片的色條、標籤底色、完成度量表是 JS 直接寫進 `style` 的，CSS 的
`@media (prefers-color-scheme)` 管不到它們。所以主題解析一律走
`js/theme.js`，CSS 與 JS 都只看 `data-theme` 那一個值——兩邊各自解讀
就會出現一半亮一半暗的畫面。

`index.html` 的 `<head>` 裡有一份極短版（避免開場閃白畫面），**它的 key
必須跟 `theme.js` 的 `THEME_KEY` 一致**，測試有檢查。

### 6. 刪除一律進垃圾桶

角色設定是累積很久的東西，誤刪的代價跟「刪一則便條」完全不同。
垃圾桶保留 60 天（`TRASH_RETENTION_DAYS`），過期在載入時自動清掉。
清理邏輯看不懂的時間格式一律**保留**，寧可留著也不要誤刪別人的角色。

---

## 跟 world_2 的格式約定

`js/import-export.js` 的 `buildWorldviewDocs()` 輸出的形狀，是那邊的
`importDocsArray()` 直接吃得下的：一個陣列，每筆 `{ title, content, icon, tags }`。

內文裡有兩個井號的規則，是那邊的既有約定，不是這裡發明的：

| 寫法 | 那邊的行為 |
|---|---|
| `# 外觀`（井號後**有空白**） | 抽成章節快速跳轉 |
| `#主角群`（井號後**沒有空白**） | 抽成 hashtag，套分類色，可篩選 |

所以段落標題一定要寫成 `# 標題`，標籤一定要寫成 `#標籤` 且放在最後一行。
`tests/bridge.test.js` 把這兩條釘住了——誰改了輸出形狀，那邊的匯入會默默
失效（看起來有匯入、但章節與標籤全沒了），這裡會先紅。

反向的 `parseWorldviewDocToCard()` 同樣有測試。它會把 `# 基本資料` 那一段
的「鍵：值」拆回資料列，不然從那邊改完再匯回來，欄位會全部擠成一大塊文字。

---

## 如果要併進 world_2

目前的定位是「兩個 app，資料走得過去」（見 README）。如果哪天想真的合併成
同一個站，這個專案從第一天就是照那個前提寫的：

1. **CSS 可以整份搬過去。** `ui-tokens.css` 的變數名稱與配色跟那邊完全一致，
   `style.css` 只引用變數，沒有寫死的色碼。把卡片相關的 class 貼進那邊的
   `style.css` 就會長得一模一樣。
2. **加一個檢視，而不是加一個頁面。** 那邊的 `switchView()` 已經在管
   「文檔／白板」兩個 tab，卡片牆就是第三個 tab。這裡的
   `body[data-view]` 作法跟那邊同源。
3. **資料要併進 `appData`。** 這裡是獨立的 localStorage key
   （`oc_card_archive_v1`），合併時把 `cards` 掛進那邊的 `appData`，並且
   **一定要寫一次性的遷移**把舊 key 讀進來（參考那邊 `storage.js` 裡幾個
   `migrateXxx` 的寫法：讀到就轉、轉完存回去、只跑一次）。
4. **`saveData()` 只能有一個。** 那邊的 `saveData()` 是所有資料異動的唯一
   出口，而且雲端同步掛在它後面（`onDataSaved()`）。合併之後這裡的
   `saveData()` 要整個換成那邊那一個，卡片才會跟著同步上雲端。
5. **作品（group）與世界觀（worldview）要決定是不是同一件事。**
   兩邊的概念很像但不完全一樣：那邊的世界觀底下是資料夾樹，這裡的作品底下
   是一片卡片牆。最省事的作法是讓卡片直接掛在世界觀底下（`worldId`），
   把這裡的 `groups` 丟掉——但那會讓「同一個世界觀想分兩批角色」做不到。
   這件事沒有想清楚之前不要動手。

---

## 還沒做的事

- **雲端同步。** 那邊有 Supabase 與 Google Drive 兩個 provider，這裡完全沒有。
  資料只在這台裝置的瀏覽器裡，換裝置不會跟著走。目前靠「匯出備份」兜底，
  設定裡有講。要做的話直接搬那邊的 `api.js`／`gdrive.js`／`sync.js`——
  但要先讀那邊 NOTES 裡「寧可停下來問，也不默默覆蓋」那一節，衝突處理的
  原則不能自己重新發明。
- **卡片之間的關係。** 「A 是 B 的師父」這種現在只能寫在「人際關係」段落裡
  的純文字。真的要做關係線的話，那正是 world_2 白板的強項，先想清楚要不要
  在這裡重做一次。
- **卡片排序拖曳。** 目前只能用排序方式決定順序，不能手動拖到想要的位置。
- **多張插圖。** 現在一張卡只有一個頭像。要放立繪／表情差分的話，
  得先解決 localStorage 5MB 的天花板（可能要換 IndexedDB），不是加個欄位
  就好的事。
- **匯出 PNG 卡圖。** 使用者最可能想要的是「一張可以直接貼到社群的圖」，
  現在只到 HTML。要做的話 `<canvas>` 自己畫比用第三方套件划算——這個專案
  不想引入依賴。
