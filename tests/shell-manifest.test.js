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

function assetsInHtml() {
  const out = [];
  const re = /(?:src|href)="((?:js|icons)\/[^"]+|[^":/]+\.(?:css|json))"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function shellList() {
  const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  assert.ok(block, "sw.js 裡找不到 SHELL 清單");
  return block[1].split(",").map(function(s) {
    const m = s.match(/'([^']+)'/);
    return m ? m[1].replace(/^\.\//, "") : null;
  }).filter(Boolean);
}

test("index.html 載入的每個檔案都在 sw.js 的 SHELL 裡", function() {
  const shell = shellList();
  assetsInHtml().forEach(function(asset) {
    assert.ok(shell.indexOf(asset) >= 0,
      asset + " 有被 index.html 載入，但不在 sw.js 的 SHELL 裡（離線會少這一塊）");
  });
});

test("SHELL 裡的每個檔案都真的存在", function() {
  shellList().forEach(function(rel) {
    if (rel === "" || rel === "/") return;          // './' 是首頁本身
    assert.ok(fs.existsSync(path.join(ROOT, rel)), "SHELL 裡的 " + rel + " 不存在");
  });
});

test("js 的載入順序：main.js 必須排在 storage.js 前面", function() {
  const order = [];
  const re = /<script src="(js\/[^"]+)"><\/script>/g;
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
