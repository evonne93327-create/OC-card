/* 跟「世界觀架構工作台」(world_2) 互通的格式測試。

   這一組是釘住約定用的：那邊的匯入只吃
   「一個 JSON 陣列，每筆是 { title, content, icon, tags }」，而且內文裡
   「# 標題」會被抽成章節、「#標籤」會被抽成 hashtag。誰改動了
   buildWorldviewDocs 的輸出形狀，這裡就會紅。

   另外一半是匯入的防禦：匯入檔是不可信的輸入，畸形資料不能讓 app 收下
   一堆空白垃圾卡片，更不能讓外部網址混進頭像。 */

const test = require("node:test");
const assert = require("node:assert");
const { loadApp, host, evalIn } = require("./helpers/load-app.js");

const app = loadApp();

const sampleCard = {
  name: "艾莉亞",
  alias: "銀霜",
  icon: "🗡️",
  tagline: "前皇家騎士。",
  fields: [{ label: "種族", value: "人類" }, { label: "年齡", value: "27" }],
  sections: [{ label: "外觀", text: "銀灰長髮。" }, { label: "背景", text: "北境之役後被除籍。" }],
  tags: ["主角群", "騎士"]
};

test("buildWorldviewDocs：輸出的形狀正是那邊匯入要的四個欄位", function() {
  const docs = app.buildWorldviewDocs([sampleCard]);
  assert.strictEqual(docs.length, 1);

  const doc = docs[0];
  assert.deepStrictEqual(Object.keys(host(doc)).sort(), ["content", "icon", "tags", "title"]);
  assert.strictEqual(doc.title, "艾莉亞");
  assert.strictEqual(doc.icon, "🗡️");
  assert.deepStrictEqual(host(doc.tags), ["主角群", "騎士"]);

  // 段落標題要能被那邊抽成章節：井號後面必須有一個空白
  assert.ok(/^# 基本資料$/m.test(doc.content));
  assert.ok(/^# 外觀$/m.test(doc.content));

  // 標籤在最後一行，而且是不帶空白的 #tag 形式（那邊的 hashtag 規則）
  assert.ok(/\n#主角群 #騎士$/.test(doc.content));
});

test("buildWorldviewDocs：沒有名字的卡片也要有標題", function() {
  const docs = app.buildWorldviewDocs([{ name: "", tagline: "", fields: [], sections: [], tags: [] }]);
  assert.strictEqual(docs[0].title, "未命名角色");
  assert.strictEqual(docs[0].icon, "🎭");
});

test("往返：卡片 → 世界觀文檔 → 卡片，重要欄位都要還在", function() {
  const doc = app.buildWorldviewDocs([sampleCard])[0];
  const back = app.coerceImportedCard(host(doc));

  assert.strictEqual(back.name, "艾莉亞");
  assert.strictEqual(back.alias, "銀霜", "別名寫在前言的「別名：」那一行，要認得回來");
  assert.strictEqual(back.icon, "🗡️");
  assert.ok(back.tagline.indexOf("前皇家騎士") >= 0);

  // 「基本資料」那一段要被拆回資料列，而不是變成一整塊文字
  assert.deepStrictEqual(host(back.fields), [
    { label: "種族", value: "人類" },
    { label: "年齡", value: "27" }
  ]);

  const labels = back.sections.map(function(s) { return s.label; });
  assert.deepStrictEqual(host(labels), ["外觀", "背景"]);
  assert.strictEqual(back.sections[0].text, "銀灰長髮。");
  assert.deepStrictEqual(host(back.tags), ["主角群", "騎士"]);
});

test("parseWorldviewDocToCard：吃得下那邊手打的文檔", function() {
  const card = app.parseWorldviewDocToCard({
    title: "夜鴉",
    icon: "🐺",
    tags: ["情報"],
    content: "在黑市裡賣情報的人。\n\n# 性格\n油腔滑調。\n\n# 背景\n難民營長大。\n\n#情報 #黑市"
  });

  assert.strictEqual(card.name, "夜鴉");
  assert.strictEqual(card.tagline, "在黑市裡賣情報的人。");
  assert.deepStrictEqual(host(card.sections.map(function(s) { return s.label; })), ["性格", "背景"]);
  // 最後那行純標籤不該混進簡介裡
  assert.ok(card.tagline.indexOf("#") < 0);
});

test("coerceImportedCard：畸形資料一律擋在門外", function() {
  const f = app.coerceImportedCard;

  // 這些在世界觀工作台的模糊測試裡出現過：整包匯入變成一堆空白垃圾
  assert.strictEqual(f(null), null);
  assert.strictEqual(f(123), null);
  assert.strictEqual(f("字串"), null);
  assert.strictEqual(f([]), null);
  assert.strictEqual(f({}), null);
  assert.strictEqual(f({ name: "   " }), null, "只有空白的名字不算一張卡");

  // 型別不對的欄位不能讓它變成 [object Object]
  const weird = f({ name: { a: 1 }, tagline: 5, fields: "x", sections: {}, tags: "abc" });
  assert.strictEqual(weird, null);

  // 超長輸入要截斷
  const long = f({ name: "x".repeat(1000), tagline: "y".repeat(5000) });
  assert.strictEqual(long.name.length, evalIn(app, "MAX_NAME_LEN"));
  assert.ok(long.tagline.length <= 500);

  // 外來的頭像網址一律丟掉
  const withUrl = f({ name: "甲", avatar: "https://tracker.example/pixel.png" });
  assert.strictEqual(withUrl.avatar, "");
  const withData = f({ name: "甲", avatar: "data:image/jpeg;base64,AAAA" });
  assert.strictEqual(withData.avatar, "data:image/jpeg;base64,AAAA");

  // 不認得的分類顏色退回灰色，而不是讓 getPalette 找不到鍵
  assert.strictEqual(f({ name: "甲", color: "c_neon" }).color, "c_gray");
  assert.strictEqual(f({ name: "甲", color: "c_blue" }).color, "c_blue");
});

test("looksLikeFullBackup：完整備份與卡片陣列要分得出來", function() {
  const f = app.looksLikeFullBackup;
  assert.strictEqual(f({ cards: [], groups: [] }), true);
  assert.strictEqual(f([{ name: "甲" }]), false);
  assert.strictEqual(f({ cards: [] }), false, "少了 groups 就不是完整備份");
  assert.strictEqual(f(null), false);
});

test("ensureCardShape：補齊形狀，讓渲染端可以直接假設欄位存在", function() {
  const c = app.ensureCardShape({ name: "甲" });
  assert.ok(Array.isArray(c.fields));
  assert.ok(Array.isArray(c.sections));
  assert.ok(Array.isArray(c.tags));
  assert.strictEqual(c.color, "c_gray");
  assert.strictEqual(c.avatar, "");
  assert.ok(c.id);
  assert.ok(c.createdAt);
  assert.strictEqual(c.updatedAt, c.createdAt);

  // 陣列裡混進非物件不能讓後面的 render 爆掉
  const messy = app.ensureCardShape({ name: "乙", fields: [null, 1, { label: "a", value: "b" }] });
  assert.deepStrictEqual(host(messy.fields), [{ label: "a", value: "b" }]);
});
