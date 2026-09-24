/* sw.js 的 SHELL 清單跟 index.html 實際載入的檔案必須對得上。

   這兩份清單是手動維護的。加了新的 js 或 css 卻忘記補進 SHELL 的話，
   線上看起來一切正常，只有離線時會無聲少一塊功能——那是最難發現的
   壞法，所以用測試釘住。

   順帶檢查 <script> 的載入順序：main.js 的純函式在 storage.js 載入時
   就會被呼叫到，排錯順序會在開啟 app 的第一秒炸掉。 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./helpers/load-app.js");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");

/* index.html 載入的 css／js／圖示，含 ?v= 查詢字串（那是版本戳，見 sw.js）。 */
function assetsInHtml() {
  const out = [];
  const re = /(?:src|href)="((?:js|icons)\/[^"]+|[^":/]+\.(?:css|json)(?:\?[^"]*)?)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/* SHELL 裡的每一筆。清單寫成 './style.css' + STAMP 的形式，所以要把
   STAMP 換回實際的字串才能跟 index.html 對照。 */
function shellList() {
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, "sw.js 裡找不到 SHELL 清單");
  const stamp = "?v=" + swVersion();
  return block[1].split(",").map(function(line) {
    const m = line.match(/'([^']+)'/);
    if (!m) return null;
    const path = m[1].replace(/^\.\//, "");
    return /\+\s*STAMP/.test(line) ? path + stamp : path;
  }).filter(Boolean);
}

function swVersion() {
  const m = sw.match(/const VERSION = '([^']+)'/);
  assert.ok(m, "sw.js 裡找不到 VERSION");
  return m[1];
}

/* 去掉版本戳，用來檢查檔案是不是真的存在於磁碟上。 */
function stripStamp(p) { return p.replace(/\?.*$/, ""); }

test("index.html 載入的每個檔案都在 sw.js 的 SHELL 裡", function() {
  const shell = shellList();
  assetsInHtml().forEach(function(asset) {
    assert.ok(shell.indexOf(asset) >= 0,
      asset + " 有被 index.html 載入，但不在 sw.js 的 SHELL 裡（離線會少這一塊）");
  });
});

test("SHELL 裡的每個檔案都真的存在", function() {
  shellList().forEach(function(rel) {
    const file = stripStamp(rel);
    if (file === "" || file === "/") return;        // './' 是首頁本身
    assert.ok(fs.existsSync(path.join(ROOT, file)), "SHELL 裡的 " + rel + " 不存在");
  });
});

test("js 的載入順序：main.js 必須排在 storage.js 前面", function() {
  const order = [];
  const re = /<script src="(js\/[^"?]+)[^"]*"><\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) order.push(m[1]);

  assert.ok(order.length >= 2, "index.html 裡找不到 <script> 標籤");
  assert.ok(order.indexOf("js/state.js") === 0, "state.js 要第一個載入（其他檔案都靠它的常數）");
  assert.ok(order.indexOf("js/main.js") < order.indexOf("js/storage.js"),
    "storage.js 載入時就會呼叫 main.js 裡的純函式，順序反了會在開啟時直接炸掉");
});

test("sw.js 的 SHELL 順序與 index.html 的 <script> 一致", function() {
  // 不是功能需求，是維護需求：兩份清單看起來一樣，漏掉一個才看得出來
  const scripts = [];
  const re = /<script src="(js\/[^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) scripts.push(m[1]);

  const shellScripts = shellList().filter(function(f) { return f.indexOf("js/") === 0; });
  assert.deepStrictEqual(shellScripts, scripts);
});

test("manifest.json 引用的圖示都存在", function() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  manifest.icons.forEach(function(icon) {
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)), "manifest 裡的 " + icon.src + " 不存在");
  });
});

test("index.html 的主題極短版與 theme.js 用同一個 key", function() {
  const themeJs = fs.readFileSync(path.join(ROOT, "js", "theme.js"), "utf8");
  const keyInJs = themeJs.match(/const THEME_KEY = "([^"]+)"/);
  assert.ok(keyInJs, "theme.js 裡找不到 THEME_KEY");
  assert.ok(html.indexOf('localStorage.getItem("' + keyInJs[1] + '")') >= 0,
    "index.html <head> 裡的防閃爍腳本用了不一樣的 key，夜間模式開場會閃一下白畫面");
});

/* style.css 用到的每個 CSS 變數，ui-tokens.css 都要定義得出來。

   這條是踩過坑才加的：style.css 寫了 `padding: var(--sp-7) var(--sp-12)`，
   但 token 檔裡沒有 --sp-7。CSS 的行為是「整條宣告作廢」，不是「那一個
   值當成 0」——結果是按鈕連 padding 都沒有，高度只剩文字的 19px。

   這種錯不會有任何錯誤訊息，畫面也還畫得出來，只是變醜，所以很容易
   一路帶上線。 */
test("style.css 裡的 CSS 變數都在 ui-tokens.css 有定義", function() {
  const tokensCss = fs.readFileSync(path.join(ROOT, "ui-tokens.css"), "utf8");
  const styleCss = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");

  const defined = new Set();
  const defRe = /^\s*(--[a-z0-9-]+)\s*:/gim;
  let m;
  while ((m = defRe.exec(tokensCss)) !== null) defined.add(m[1]);

  const missing = new Set();
  const useRe = /var\((--[a-z0-9-]+)/g;
  while ((m = useRe.exec(styleCss)) !== null) {
    if (!defined.has(m[1])) missing.add(m[1]);
  }

  assert.deepStrictEqual(Array.from(missing), [],
    "這些變數沒有定義，用到它們的那整條 CSS 宣告會被瀏覽器丟掉");
});

/* 版本戳三邊要對得上：sw.js 的 VERSION、index.html 的 ?v=、state.js 的 APP_BUILD。

   這條擋的是一個真的發生過、而且很難從症狀看出原因的狀況：手機拿到新的
   index.html，但 style.css 還在瀏覽器 HTTP 快取的有效期內而是舊的那一份。
   新 HTML 的 class 在舊 CSS 裡一條都不存在，版面整個散掉，看起來像程式壞了。

   只要 css/js 的網址帶著版本戳，版本一跳就是一個全新的網址，任何快取裡
   都沒有，這種半新半舊就不可能組得出來——前提是三個地方的版本一致。 */
test("版本戳：sw.js、index.html、state.js、style.css 四邊一致", function() {
  const version = swVersion();

  const stateJs = fs.readFileSync(path.join(ROOT, "js", "state.js"), "utf8");
  const build = stateJs.match(/const APP_BUILD = "([^"]+)"/);
  assert.ok(build, "state.js 裡找不到 APP_BUILD");
  assert.strictEqual(build[1], version,
    "state.js 的 APP_BUILD 跟 sw.js 的 VERSION 不一樣，設定裡顯示的版本會是錯的");

  const styleCss = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
  const cssBuild = styleCss.match(/--css-build:\s*"([^"]+)"/);
  assert.ok(cssBuild, "style.css 的 :root 裡找不到 --css-build");
  assert.strictEqual(cssBuild[1], version,
    "style.css 的 --css-build 跟 sw.js 的 VERSION 不一樣，開機健檢會誤判成快取錯配並一直想自救");

  const stamped = assetsInHtml().filter(function(a) { return /\.(css|js)(\?|$)/.test(a); });
  assert.ok(stamped.length >= 10, "index.html 裡找不到預期數量的 css/js");
  stamped.forEach(function(asset) {
    assert.ok(asset.indexOf("?v=" + version) > 0,
      asset + " 沒有帶 ?v=" + version + "（新 HTML 會配到舊快取裡的這個檔案）");
  });
});
