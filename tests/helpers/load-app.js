/* 把瀏覽器端的 js 檔載進 Node 的沙箱，好拿裡面的純函式來測。

   這個專案刻意零依賴、無打包——檔案都是靠 <script> 直接掛上全域，沒有
   module.exports。要在 node --test 裡測它們，最省事的做法就是用 node:vm
   建一個共用的沙箱，照 index.html 的順序把檔案丟進去，再補上那些檔案在
   載入時會碰到的瀏覽器物件。

   刻意不引進 jsdom 之類的東西：那會讓這個專案從「零依賴」變成「要先
   npm install 才跑得動測試」，違背原本的取捨。這裡需要的 DOM 少到用
   幾個空殼就夠了。 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");

function stubElement() {
  const el = {
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], childNodes: [],
    appendChild() {}, removeChild() {}, insertBefore() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, blur() {}, click() {},
    value: "", textContent: "", innerHTML: "", disabled: false
  };
  return el;
}

function makeStorageStub() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    get length() { return map.size; }
  };
}

/* 照 index.html 的順序載入。只載測試會用到的那幾支——載越多，需要補的
   瀏覽器物件就越多，而那些補丁本身也會變成要維護的東西。

   main.js 要排在 storage.js 前面：storage.js 載入時就會呼叫
   ensureCardShape()，而它用到的 isSafeImageSrc／dedupeTags／formatTime
   都住在 main.js。index.html 的 <script> 順序也是這樣，兩邊必須一致。 */
const DEFAULT_FILES = [
  "js/state.js",
  "js/main.js",
  "js/storage.js",
  "js/cards.js",
  "js/import-export.js"
];

function loadApp(files) {
  const doc = {
    documentElement: stubElement(),
    body: stubElement(),
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubElement(); },
    addEventListener() {},
    get visibilityState() { return "visible"; },
    hidden: false
  };

  const sandbox = {
    console,
    document: doc,
    localStorage: makeStorageStub(),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Map, Set, JSON, Math, Date, RegExp, Error, Promise,
    Array, Object, String, Number, Boolean,
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
    navigator: {},
    alert() {}, confirm() { return true; }, prompt() { return null; }
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = function() {};
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  (files || DEFAULT_FILES).forEach(function(rel) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    vm.runInContext(src, sandbox, { filename: rel });
  });
  return sandbox;
}

/* 沙箱裡建立的陣列／物件，原型是沙箱自己的 Array／Object，不是 Node 主
   環境那一個。assert.deepStrictEqual 會因為原型不同而判定不相等——不是
   值錯，是跨 realm 的假警報。過一次 JSON 轉回主環境就對齊了。

   也因此這個工具只適用於「可以 JSON 序列化」的回傳值，那正好是這裡要
   測的純函式的全部。 */
function host(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/* 在沙箱裡求值，用來讀 const 宣告的常數。

   vm 的全域物件上只看得到 function 宣告與 var；state.js 那些用 const 宣告
   的上限值（MAX_TAG_LEN…）住在腳本自己的語彙環境裡，從外面 sandbox.X 讀
   出來是 undefined——而 undefined 拿去跟長度比對會靜悄悄地永遠通過。
   測試要對照真正的常數就走這裡。 */
function evalIn(sandbox, expr) {
  return vm.runInContext(expr, sandbox);
}

module.exports = { loadApp, host, evalIn, ROOT };
