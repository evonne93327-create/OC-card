/* 純函式的單元測試。不需要瀏覽器、不需要 npm install，
   直接 node --test 就會跑。 */

const test = require("node:test");
const assert = require("node:assert");
const { loadApp, host, evalIn } = require("./helpers/load-app.js");

const app = loadApp();

test("normalizeTagInput：各種分隔符都要吃得下", function() {
  const f = app.normalizeTagInput;

  assert.deepStrictEqual(host(f("騎士, 主角群 劍")), ["騎士", "主角群", "劍"]);
  assert.deepStrictEqual(host(f("騎士、主角群")), ["騎士", "主角群"]);
  assert.deepStrictEqual(host(f("#騎士 #主角群")), ["騎士", "主角群"]);
  assert.deepStrictEqual(host(f("")), []);
  assert.deepStrictEqual(host(f(null)), []);

  // 重複的只留一個，順序照第一次出現
  assert.deepStrictEqual(host(f("劍 劍 盾")), ["劍", "盾"]);
});

test("dedupeTags：去重之外還要擋住數量與長度", function() {
  const f = app.dedupeTags;

  assert.deepStrictEqual(host(f(["a", "a", "b"])), ["a", "b"]);
  assert.deepStrictEqual(host(f([" a ", "a"])), ["a"]);      // 前後空白視為同一個
  assert.deepStrictEqual(host(f([])), []);

  // 一份畸形的匯入檔塞一萬個標籤進來，不能讓它全部進到卡片裡
  const many = [];
  for (let i = 0; i < 10000; i++) many.push("t" + i);
  assert.strictEqual(f(many).length, evalIn(app, "MAX_TAGS_PER_CARD"));

  // 超長的標籤要截斷，不然卡片牆會被一條標籤撐爆
  const long = "x".repeat(500);
  assert.strictEqual(f([long])[0].length, evalIn(app, "MAX_TAG_LEN"));
});

test("isSafeImageSrc：只放行自己壓出來的 base64 圖片", function() {
  const f = app.isSafeImageSrc;

  assert.strictEqual(f("data:image/jpeg;base64,AAAA"), true);
  assert.strictEqual(f("data:image/png;base64,"), true);

  // 匯入檔裡的這幾種都會被直接塞進 <img src>，一律擋掉
  assert.strictEqual(f("https://example.com/a.png"), false, "外部網址會變成追蹤像素");
  assert.strictEqual(f("javascript:alert(1)"), false);
  assert.strictEqual(f("data:text/html;base64,AAAA"), false);
  assert.strictEqual(f(""), false);
  assert.strictEqual(f(null), false);
  assert.strictEqual(f({}), false);
});

test("cardMatchesQuery：搜得到深埋在段落裡的字", function() {
  const f = app.cardMatchesQuery;
  const card = {
    name: "艾莉亞",
    alias: "銀霜",
    tagline: "前皇家騎士",
    fields: [{ label: "種族", value: "人類" }],
    sections: [{ label: "背景", text: "在北境的霜雪之役後被除籍。" }],
    tags: ["主角群"]
  };

  assert.strictEqual(f(card, ""), true, "沒有關鍵字時全部都算符合");
  assert.strictEqual(f(card, "艾莉亞"), true);
  assert.strictEqual(f(card, "銀霜"), true);
  assert.strictEqual(f(card, "霜雪之役"), true, "段落內文也要搜得到");
  assert.strictEqual(f(card, "主角群"), true);
  assert.strictEqual(f(card, "人類"), true);
  assert.strictEqual(f(card, "海盜"), false);

  // 多個關鍵字是 AND，用來縮小範圍
  assert.strictEqual(f(card, "艾莉亞 騎士"), true);
  assert.strictEqual(f(card, "艾莉亞 海盜"), false);
});

test("cardCompletion：分母只算卡片上真的存在的格子", function() {
  const f = app.cardCompletion;

  const empty = { name: "", tagline: "", fields: [], sections: [] };
  assert.deepStrictEqual(host(f(empty)), { filled: 0, total: 2, percent: 0 });

  const full = {
    name: "甲", tagline: "乙",
    fields: [{ label: "性別", value: "女" }],
    sections: [{ label: "外觀", text: "銀髮" }]
  };
  assert.deepStrictEqual(host(f(full)), { filled: 4, total: 4, percent: 100 });

  // 刪掉一個空欄位，完成度應該上升而不是下降——不然沒人敢刪用不到的格子
  const withBlank = {
    name: "甲", tagline: "乙",
    fields: [{ label: "性別", value: "女" }, { label: "身高", value: "" }],
    sections: []
  };
  const afterDelete = { name: "甲", tagline: "乙", fields: [{ label: "性別", value: "女" }], sections: [] };
  assert.ok(f(afterDelete).percent > f(withBlank).percent);

  assert.strictEqual(f(null).percent, 0);
});

test("sortCards：我的最愛永遠在最前面，而且不動到原本的陣列", function() {
  const f = app.sortCards;
  const cards = [
    { name: "丙", favorite: false, updatedAt: "2026-01-03 00:00", createdAt: "2026-01-01 00:00", color: "c_blue" },
    { name: "甲", favorite: false, updatedAt: "2026-01-01 00:00", createdAt: "2026-01-03 00:00", color: "c_gray" },
    { name: "乙", favorite: true, updatedAt: "2026-01-02 00:00", createdAt: "2026-01-02 00:00", color: "c_purple" }
  ];
  const snapshot = host(cards);

  assert.strictEqual(f(cards, "updated")[0].name, "乙");
  assert.strictEqual(f(cards, "name")[0].name, "乙");
  assert.strictEqual(f(cards, "created")[0].name, "乙");

  // 最愛之後才照排序方式
  assert.deepStrictEqual(f(cards, "updated").map(function(c) { return c.name; }), ["乙", "丙", "甲"]);
  assert.deepStrictEqual(f(cards, "created").map(function(c) { return c.name; }), ["乙", "甲", "丙"]);

  // 顏色排序照 DEFAULT_PALETTES 的鍵順序（灰在最前）
  assert.deepStrictEqual(f(cards, "color").map(function(c) { return c.name; }), ["乙", "甲", "丙"]);

  assert.deepStrictEqual(host(cards), snapshot, "不可以就地排序，呼叫端常拿篩選結果再排");
});

test("escapeHtml：匯出的 HTML 不能把名字當程式碼跑", function() {
  const f = app.escapeHtml;
  assert.strictEqual(f("<script>x</script>"), "&lt;script&gt;x&lt;/script&gt;");
  assert.strictEqual(f('a"b\'c&d'), "a&quot;b&#39;c&amp;d");
  assert.strictEqual(f(null), "");
});

test("cardToPlainText：段落標題用「# 」開頭，標籤在最後一行", function() {
  const text = app.cardToPlainText({
    name: "艾莉亞",
    alias: "銀霜",
    tagline: "前皇家騎士",
    fields: [{ label: "種族", value: "人類" }],
    sections: [{ label: "背景", text: "北境。" }],
    tags: ["主角群"]
  });

  assert.ok(text.indexOf("【艾莉亞】（銀霜）") === 0);
  assert.ok(text.indexOf("種族：人類") > 0);
  assert.ok(text.indexOf("# 背景") > 0);
  assert.ok(/#主角群$/.test(text));
  assert.ok(!/\n{3,}/.test(text), "不要留下連續空行");
});

test("formatTime：輸出的字串可以直接拿來字典序排序", function() {
  const a = app.formatTime(new Date(2026, 0, 2, 3, 4));
  const b = app.formatTime(new Date(2026, 0, 10, 3, 4));
  assert.strictEqual(a, "2026-01-02 03:04");
  assert.ok(a < b, "補零過的格式，字串比較就等於時間比較");
});

test("nameInitial：沒有頭像也沒選 emoji 時的退路", function() {
  assert.strictEqual(app.nameInitial("艾莉亞"), "艾");
  assert.strictEqual(app.nameInitial("aria"), "A");
  assert.strictEqual(app.nameInitial(""), "？");
  assert.strictEqual(app.nameInitial(null), "？");
});
