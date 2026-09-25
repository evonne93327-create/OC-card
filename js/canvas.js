/* ==========================================================
   關係圖 (canvas.js)

   把角色卡投射成節點，拖到想要的位置，彼此拉關係線。
   一個作品一張圖（節點與連線存在 group.canvas）。

   連線的幾何是從姊妹專案 world_2 的白板移植過來的，連同它踩過的坑——
   詳見下面〈連線幾何〉那一段。那套算法不是「一種畫法」，是唯一能保證
   同一對節點的多條線不互相穿越的畫法，不要為了簡潔換回去。
   ========================================================== */

const SVG_NS = "http://www.w3.org/2000/svg";


/* ---------- 目前這個作品的關係圖 ---------- */

function currentCanvas() {
  const g = currentGroup();
  if (!g) return { nodes: [], edges: [] };
  if (!g.canvas) ensureGroupShape(g);
  return g.canvas;
}

function findNode(id) {
  return currentCanvas().nodes.find(function(n) { return n.id === id; }) || null;
}

function nodeCard(node) {
  return node ? findCard(node.cardId) : null;
}

/* 還沒放到關係圖上的卡片。「加入角色」的清單看這個——已經在圖上的
   再加一次只會疊在原本那個節點上面，看起來像重複的卡。 */
function cardsNotOnCanvas() {
  const used = new Set(currentCanvas().nodes.map(function(n) { return n.cardId; }));
  return cardsInGroup(activeGroupId).filter(function(c) { return !used.has(c.id); });
}


/* ---------- 座標轉換 ---------- */

/* 世界座標 → 畫面座標。節點層用 CSS transform 做同一件事，
   這個函式是給「點在畫面哪裡 → 是世界的哪裡」這類換算用的。 */
function screenToWorld(sx, sy) {
  const stage = el("canvasStage");
  if (!stage) return { x: 0, y: 0 };
  const box = stage.getBoundingClientRect();
  return {
    x: (sx - box.left - canvasTransform.x) / canvasTransform.scale,
    y: (sy - box.top - canvasTransform.y) / canvasTransform.scale
  };
}

function clampScale(s) {
  return Math.max(CANVAS_MIN_SCALE, Math.min(CANVAS_MAX_SCALE, s));
}

function applyCanvasTransform() {
  const layer = el("canvasNodes");
  if (layer) {
    layer.style.transform = "translate(" + canvasTransform.x + "px," + canvasTransform.y +
      "px) scale(" + canvasTransform.scale + ")";
  }
  applySvgViewBox();
  const zoom = el("canvasZoomText");
  if (zoom) zoom.textContent = Math.round(canvasTransform.scale * 100) + "%";
}

/* 連線畫在一張鋪滿舞台的 SVG 上，用 viewBox 跟著平移縮放。

   不把線也塞進那個 scale() 過的節點層：那樣線寬、箭頭、標籤文字會跟著
   一起縮，縮小時細到看不見、放大時粗得像香腸。viewBox 只換座標系，
   筆畫寬度仍然是畫面上的 px。 */
function applySvgViewBox() {
  const svg = el("canvasSvg");
  const stage = el("canvasStage");
  if (!svg || !stage) return;
  const box = stage.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const s = canvasTransform.scale;
  svg.setAttribute("viewBox",
    (-canvasTransform.x / s) + " " + (-canvasTransform.y / s) + " " +
    (box.width / s) + " " + (box.height / s));
}

function resetCanvasView() {
  canvasTransform = { x: 0, y: 0, scale: 1 };
  applyCanvasTransform();
}

/* 把所有節點裝進畫面。節點被拖到很遠的地方之後，「重設檢視」回到原點
   可能還是什麼都看不到——這個是真的「找得回來」的那一顆。 */
function fitCanvasView() {
  const canvas = currentCanvas();
  const stage = el("canvasStage");
  if (!stage || !canvas.nodes.length) { resetCanvasView(); return; }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  canvas.nodes.forEach(function(n) {
    const size = nodeSize(n.id);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + size.w);
    maxY = Math.max(maxY, n.y + size.h);
  });

  const box = stage.getBoundingClientRect();
  const pad = 40;
  /* 只縮小、不放大：兩個節點的圖如果放大到 230% 填滿畫面，字大得很荒謬，
     而且再拖一個人進來就要重來。「裝進畫面」的意思是「全部看得到」，
     不是「填滿」。 */
  const scale = clampScale(Math.min(1,
    (box.width - pad * 2) / Math.max(1, maxX - minX),
    (box.height - pad * 2) / Math.max(1, maxY - minY)
  ));
  canvasTransform.scale = scale;
  canvasTransform.x = (box.width - (maxX - minX) * scale) / 2 - minX * scale;
  canvasTransform.y = (box.height - (maxY - minY) * scale) / 2 - minY * scale;
  applyCanvasTransform();
}


/* ---------- 節點 ---------- */

/* 節點在世界座標裡的大小。寬度是固定的（CANVAS_NODE_W），高度要看內容，
   所以從畫出來的元素量。量不到（還沒畫）就給一個合理的預設，不要回傳 0
   ——0 高度的矩形會讓連線的裁切算出退化的結果。 */
const nodeSizeCache = new Map();

function nodeSize(nodeId) {
  const cached = nodeSizeCache.get(nodeId);
  if (cached) return cached;
  return { w: CANVAS_NODE_W, h: 72 };
}

function nodeRect(node) {
  const size = nodeSize(node.id);
  return { left: node.x, top: node.y, right: node.x + size.w, bottom: node.y + size.h };
}

function renderCanvasNodes() {
  const layer = el("canvasNodes");
  if (!layer) return;
  const canvas = currentCanvas();
  layer.innerHTML = "";

  canvas.nodes.forEach(function(node) {
    const card = nodeCard(node);
    if (!card) return;                       // 卡片被刪掉了，storage 會清掉這個節點
    const pal = getPalette(card.color);

    const box = document.createElement("div");
    box.className = "canvas-node";
    if (connectingFromNodeId === node.id) box.classList.add("connecting");
    box.style.left = node.x + "px";
    box.style.top = node.y + "px";
    box.style.width = CANVAS_NODE_W + "px";
    box.style.background = pal.bg;
    box.style.borderColor = pal.text;
    box.setAttribute("data-node-id", node.id);

    const face = document.createElement("div");
    face.className = "canvas-node-face";
    face.style.color = pal.text;
    if (card.avatar && isSafeImageSrc(card.avatar)) {
      const img = document.createElement("img");
      img.src = card.avatar;
      img.alt = "";
      face.appendChild(img);
    } else {
      face.textContent = card.icon || nameInitial(card.name);
    }
    box.appendChild(face);

    const text = document.createElement("div");
    text.className = "canvas-node-text";
    const name = document.createElement("strong");
    name.style.color = pal.text;
    name.textContent = card.name || "未命名角色";
    text.appendChild(name);
    if (card.alias) {
      const alias = document.createElement("span");
      alias.textContent = card.alias;
      text.appendChild(alias);
    }
    box.appendChild(text);

    enableNodeDrag(box, node);
    layer.appendChild(box);

    // 量完真實高度再存起來，下一次畫連線就有正確的矩形可以裁
    nodeSizeCache.set(node.id, { w: box.offsetWidth || CANVAS_NODE_W, h: box.offsetHeight || 72 });
  });
}


/* ==========================================================
   連線幾何（移植自 world_2 的白板）

   關鍵在於「出發點」不是另外挑的，而是曲線跟節點邊框的交點。

   早期版本把「出發點」與「彎曲方向」當成兩件事分開算：出發點沿邊框排開、
   彎曲卻沿兩節點中心連線的法線，節點斜向擺放時兩者的排列方向會相反，
   線就一定會在中段互相穿越。拿掉彎曲變直線沒事、加回彎曲又交叉，
   怎麼調參數都治不好。

   改成先畫完整的中心到中心曲線、再裁掉兩端節點內部那一段之後，出發點
   由曲線自己決定：彎得越開的線，交點自然落在越外側，順序必定跟彎曲一致，
   結構上不可能交叉。
   ========================================================== */

function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rectCenter(rect) {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

// 節點矩形外擴一點點，箭頭才不會貼死在邊框上
const NODE_EDGE_PAD = 2;

function pointInRect(p, rect) {
  return p.x >= rect.left - NODE_EDGE_PAD && p.x <= rect.right + NODE_EDGE_PAD &&
         p.y >= rect.top - NODE_EDGE_PAD && p.y <= rect.bottom + NODE_EDGE_PAD;
}

function lerpPoint(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicPointAt(c, t) {
  const mt = 1 - t;
  return {
    x: mt*mt*mt*c[0].x + 3*mt*mt*t*c[1].x + 3*mt*t*t*c[2].x + t*t*t*c[3].x,
    y: mt*mt*mt*c[0].y + 3*mt*mt*t*c[1].y + 3*mt*t*t*c[2].y + t*t*t*c[3].y
  };
}

// De Casteljau：把三次貝茲在 t 處切開，回傳左右兩段的控制點
function splitCubic(c, t) {
  const a = lerpPoint(c[0], c[1], t);
  const b = lerpPoint(c[1], c[2], t);
  const d = lerpPoint(c[2], c[3], t);
  const e = lerpPoint(a, b, t);
  const f = lerpPoint(b, d, t);
  const g = lerpPoint(e, f, t);
  return { left: [c[0], a, e, g], right: [g, f, d, c[3]] };
}

function subCubic(c, t0, t1) {
  if (t0 > 0) c = splitCubic(c, t0).right;
  if (t1 < 1) {
    const s = t0 < 1 ? (t1 - t0) / (1 - t0) : 0;
    c = splitCubic(c, clampNum(s, 0, 1)).left;
  }
  return c;
}

// 曲線離開 rect 的那個 t（fromStart = 從頭找），先粗掃再二分逼近
function findExitT(c, rect, fromStart) {
  const STEPS = 48;
  let inside = fromStart ? 0 : 1;
  let outside = null;
  for (let i = 1; i <= STEPS; i++) {
    const t = fromStart ? i / STEPS : 1 - i / STEPS;
    if (!pointInRect(cubicPointAt(c, t), rect)) { outside = t; break; }
    inside = t;
  }
  if (outside === null) return fromStart ? 0 : 1;   // 整條都在框內（節點重疊）
  for (let i = 0; i < 14; i++) {
    const mid = (inside + outside) / 2;
    if (pointInRect(cubicPointAt(c, mid), rect)) inside = mid;
    else outside = mid;
  }
  return outside;
}

/* 每條線離開節點中心的方向，相對中心連線最多轉這個角度。

   用「出發角度」而不是「中段彎曲量」當控制參數是必要的：彎曲量必須設
   上限（否則長線會鼓得很誇張），但控制桿長度隨節點距離成長，一旦設了
   上限，節點拉遠時所有線離開節點的方向就會趨近平行、端點擠成一點。 */
const MAX_DEPART_ANGLE = 0.56;
const MAX_HANDLE_LEN = 260;

function buildEdgeCurve(rectA, rectB, spread) {
  const cA = rectCenter(rectA);
  const cB = rectCenter(rectB);
  const dx = cB.x - cA.x, dy = cB.y - cA.y;
  const len = Math.hypot(dx, dy);

  /* 兩個節點被拖到幾乎重疊時，中心連線沒有方向可言。這裡要直接放棄：
     回傳退化的曲線會讓箭頭在那個點上畫出一個孤零零的箭頭。 */
  if (len < 1) return null;
  const ux = dx / len, uy = dy / len;

  const theta = spread * MAX_DEPART_ANGLE;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const k = Math.min(len / 3, MAX_HANDLE_LEN);

  const full = [
    cA,
    { x: cA.x + (ux * cos - uy * sin) * k, y: cA.y + (ux * sin + uy * cos) * k },
    { x: cB.x - (ux * cos + uy * sin) * k, y: cB.y - (uy * cos - ux * sin) * k },
    cB
  ];

  const t0 = findExitT(full, rectA, true);
  const t1 = findExitT(full, rectB, false);
  if (!(t1 > t0)) return null;
  return subCubic(full, t0, t1);
}

function cubicToPath(c) {
  return "M " + c[0].x + " " + c[0].y +
         " C " + c[1].x + " " + c[1].y + ", " + c[2].x + " " + c[2].y +
         ", " + c[3].x + " " + c[3].y;
}

/* 同一對節點之間的多條線要往兩側對稱展開。

   展開的方向不該取決於「使用者剛好先畫了哪一條」（那會忽左忽右、每次
   重畫都不一樣），所以排序依據取一個跟拖曳位置無關的穩定值：連線本身的
   id 排序。 */
function computeEdgeSpreads(edges) {
  const pairs = {};
  edges.forEach(function(e) {
    const key = [e.source, e.target].sort().join("|");
    (pairs[key] = pairs[key] || []).push(e);
  });

  const spread = {};
  Object.keys(pairs).forEach(function(key) {
    const list = pairs[key].slice().sort(function(a, b) { return a.id < b.id ? -1 : 1; });
    const n = list.length;
    list.forEach(function(e, i) {
      // 一條線就走正中間（spread 0）；多條線則在 -1..+1 之間均分
      const base = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      /* 同一對節點的兩條線方向相反時（A→B 與 B→A），要以同一個方向為
         基準算展開，否則兩條會疊在一起。用排序後的 source 當基準。 */
      const flip = [e.source, e.target].sort()[0] === e.source ? 1 : -1;
      spread[e.id] = base * flip;
    });
  });
  return spread;
}


/* ---------- 畫連線 ---------- */

function renderCanvasEdges() {
  const svg = el("canvasSvg");
  if (!svg) return;
  const canvas = currentCanvas();
  svg.innerHTML = "";

  // 箭頭：每個顏色一個 marker（marker 不能吃 currentColor）
  const defs = document.createElementNS(SVG_NS, "defs");
  edgeColorKeys().forEach(function(key) {
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "oc_arrow_" + key);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto-start-reverse");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    p.setAttribute("fill", getEdgeStroke(key));
    marker.appendChild(p);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);

  const spreads = computeEdgeSpreads(canvas.edges);

  canvas.edges.forEach(function(edge) {
    const a = findNode(edge.source);
    const b = findNode(edge.target);
    if (!a || !b) return;
    const curve = buildEdgeCurve(nodeRect(a), nodeRect(b), spreads[edge.id] || 0);
    if (!curve) return;

    const stroke = getEdgeStroke(edge.color);

    /* 先畫一條看不見的粗線當作點擊範圍。細線在手機上根本點不到，
       而這條線是使用者唯一能叫出「編輯關係」的入口。 */
    const hit = document.createElementNS(SVG_NS, "path");
    hit.setAttribute("d", cubicToPath(curve));
    hit.setAttribute("fill", "none");
    hit.setAttribute("stroke", "transparent");
    hit.setAttribute("stroke-width", "18");
    hit.setAttribute("class", "edge-hit");
    hit.onclick = function(e) { e.stopPropagation(); openEdgeModal(edge.id); };
    svg.appendChild(hit);

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", cubicToPath(curve));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("class", "edge-line");
    if (edge.arrow === "to" || edge.arrow === "both") {
      path.setAttribute("marker-end", "url(#oc_arrow_" + (EDGE_COLORS[edge.color] ? edge.color : "e_gray") + ")");
    }
    if (edge.arrow === "both") {
      path.setAttribute("marker-start", "url(#oc_arrow_" + (EDGE_COLORS[edge.color] ? edge.color : "e_gray") + ")");
    }
    svg.appendChild(path);

    if (edge.label) {
      // 標籤放在曲線中點；同一對節點的多條線靠 spread 錯開，不會疊在一起
      const mid = cubicPointAt(curve, 0.5);
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", mid.x);
      text.setAttribute("y", mid.y);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.setAttribute("class", "edge-label");
      text.setAttribute("fill", stroke);
      text.textContent = edge.label;
      text.onclick = function(e) { e.stopPropagation(); openEdgeModal(edge.id); };

      // 文字底下鋪一塊底色，壓過線與點陣底紋才讀得動
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.setAttribute("class", "edge-label-bg");
      svg.appendChild(bg);
      svg.appendChild(text);

      // 量完文字才知道底色要多大
      try {
        const bb = text.getBBox();
        bg.setAttribute("x", bb.x - 5);
        bg.setAttribute("y", bb.y - 2);
        bg.setAttribute("width", bb.width + 10);
        bg.setAttribute("height", bb.height + 4);
        bg.setAttribute("rx", "4");
      } catch (e) {
        // 隱藏狀態下 getBBox 會丟例外，那時本來也看不到，忽略就好
        bg.remove();
      }
    }
  });
}

function renderCanvas() {
  if (activeView !== "canvas") return;
  renderCanvasNodes();
  renderCanvasEdges();
  applyCanvasTransform();
  renderCanvasToolbar();
}

function renderCanvasToolbar() {
  const canvas = currentCanvas();
  const count = el("canvasCountText");
  if (count) {
    count.textContent = canvas.nodes.length + " 個角色 ・ " + canvas.edges.length + " 條關係";
  }
  const connectBtn = el("connectModeBtn");
  if (connectBtn) {
    connectBtn.classList.toggle("on", connectMode);
    connectBtn.textContent = connectMode ? "✕ 取消" : "🔗 連關係";
  }
  const hint = el("canvasHint");
  if (hint) {
    hint.textContent = !connectMode ? ""
      : (connectingFromNodeId ? "再點另一個角色，完成這條關係" : "點一個角色當起點");
    hint.classList.toggle("show", !!hint.textContent);
  }
  const empty = el("canvasEmpty");
  if (empty) empty.classList.toggle("show", !canvas.nodes.length);
}


/* ---------- 拖曳節點、平移與縮放 ----------

   全部用 pointer events 一套寫完：滑鼠、觸控、觸控筆走同一條路徑，
   不需要分別掛 mouse* 與 touch*（那種寫法在手機上很容易變成一次拖兩份）。 */

function enableNodeDrag(box, node) {
  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, origX = 0, origY = 0;

  box.addEventListener("pointerdown", function(e) {
    if (e.button === 2) return;
    e.stopPropagation();          // 不要讓舞台把它當成平移
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    origX = node.x;
    origY = node.y;
    box.setPointerCapture(e.pointerId);
    box.classList.add("dragging");
  });

  box.addEventListener("pointermove", function(e) {
    if (!dragging) return;
    const dx = (e.clientX - startX) / canvasTransform.scale;
    const dy = (e.clientY - startY) / canvasTransform.scale;
    // 手指的細微晃動不算拖曳，否則每次點擊都會被當成移動而存檔
    if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
    moved = true;
    node.x = Math.round(origX + dx);
    node.y = Math.round(origY + dy);
    box.style.left = node.x + "px";
    box.style.top = node.y + "px";
    renderCanvasEdges();
  });

  const finish = function(e) {
    if (!dragging) return;
    dragging = false;
    box.classList.remove("dragging");
    try { box.releasePointerCapture(e.pointerId); } catch (err) {}
    if (moved) { saveData(); return; }
    // 沒有移動就是「點了一下」
    handleNodeTap(node);
  };
  box.addEventListener("pointerup", finish);
  box.addEventListener("pointercancel", finish);
}

/* 點一個節點：連線模式中就接上這條線，否則打開那張卡片。 */
function handleNodeTap(node) {
  if (!connectMode) {
    openCardModal(node.cardId, "view");
    return;
  }
  if (!connectingFromNodeId) {
    connectingFromNodeId = node.id;     // 第一個端點
    renderCanvas();
    return;
  }
  if (connectingFromNodeId === node.id) {
    connectingFromNodeId = null;        // 再點自己一次＝改選別人
    renderCanvas();
    return;
  }
  createEdge(connectingFromNodeId, node.id);
}

/* 連線模式用一個布林值，不要拿 connectingFromNodeId 當旗標。

   第一版把「還沒選第一個端點」寫成 connectingFromNodeId = ""，結果
   `if (!connectingFromNodeId)` 對空字串也成立，點下去直接打開卡片視窗，
   連線模式看起來完全沒作用。狀態與資料要分開兩個變數。 */
function toggleConnectMode() {
  if (connectMode) {
    connectMode = false;
    connectingFromNodeId = null;
    renderCanvas();
    return;
  }
  if (currentCanvas().nodes.length < 2) { toast("至少要有兩個角色才能連關係"); return; }
  connectMode = true;
  connectingFromNodeId = null;
  toast("點第一個角色，再點第二個");
  renderCanvas();
}

function createEdge(sourceId, targetId) {
  const canvas = currentCanvas();
  const edge = {
    id: newId("e"),
    source: sourceId,
    target: targetId,
    label: "",
    color: "e_gray",
    arrow: "to"
  };
  canvas.edges.push(edge);
  connectMode = false;
  connectingFromNodeId = null;
  saveData();
  renderCanvas();
  openEdgeModal(edge.id);     // 連完立刻問「這是什麼關係」，不然之後沒人會回來補
}

function setupCanvasStage() {
  const stage = el("canvasStage");
  if (!stage) return;

  let panning = false;
  let startX = 0, startY = 0, origX = 0, origY = 0;
  const pointers = new Map();
  let pinchStart = null;

  stage.addEventListener("pointerdown", function(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // 兩指：開始縮放，把平移停掉
      panning = false;
      const pts = Array.from(pointers.values());
      pinchStart = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        scale: canvasTransform.scale,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        tx: canvasTransform.x,
        ty: canvasTransform.y
      };
      return;
    }
    panning = true;
    startX = e.clientX;
    startY = e.clientY;
    origX = canvasTransform.x;
    origY = canvasTransform.y;
    stage.classList.add("panning");
  });

  stage.addEventListener("pointermove", function(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchStart && pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchStart.dist > 0) {
        const next = clampScale(pinchStart.scale * (dist / pinchStart.dist));
        const box = stage.getBoundingClientRect();
        const ax = pinchStart.cx - box.left, ay = pinchStart.cy - box.top;
        // 以兩指中點為錨點縮放，畫面才不會往角落跑
        const k = next / pinchStart.scale;
        canvasTransform.scale = next;
        canvasTransform.x = ax - (ax - pinchStart.tx) * k;
        canvasTransform.y = ay - (ay - pinchStart.ty) * k;
        applyCanvasTransform();
      }
      return;
    }

    if (!panning) return;
    canvasTransform.x = origX + (e.clientX - startX);
    canvasTransform.y = origY + (e.clientY - startY);
    applyCanvasTransform();
  });

  const endPointer = function(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (!pointers.size) { panning = false; stage.classList.remove("panning"); }
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener("pointerleave", endPointer);

  stage.addEventListener("wheel", function(e) {
    e.preventDefault();
    const box = stage.getBoundingClientRect();
    const ax = e.clientX - box.left, ay = e.clientY - box.top;
    const next = clampScale(canvasTransform.scale * (e.deltaY < 0 ? 1.1 : 0.9));
    const k = next / canvasTransform.scale;
    canvasTransform.scale = next;
    canvasTransform.x = ax - (ax - canvasTransform.x) * k;
    canvasTransform.y = ay - (ay - canvasTransform.y) * k;
    applyCanvasTransform();
  }, { passive: false });

  // 視窗大小改變時 viewBox 要跟著重算，不然線會跟節點對不上
  window.addEventListener("resize", function() {
    if (activeView === "canvas") applySvgViewBox();
  });
}


/* ---------- 把角色加到關係圖 ---------- */

function addCardToCanvas(cardId, opts) {
  const canvas = currentCanvas();
  const card = findCard(cardId);
  if (!card) return null;
  if (canvas.nodes.some(function(n) { return n.cardId === cardId; })) {
    if (!(opts && opts.silent)) toast("這個角色已經在圖上了");
    return null;
  }

  /* 新節點擺在目前畫面的中間偏左，然後依已有數量往右下錯開。
     全部疊在同一點的話，使用者要一個一個拖開才看得到。 */
  const stage = el("canvasStage");
  const box = stage ? stage.getBoundingClientRect() : { width: 600, height: 400 };
  const base = screenToWorld(box.left + box.width * 0.3, box.top + box.height * 0.3);
  const i = canvas.nodes.length;

  const node = {
    id: newId("n"),
    cardId: cardId,
    x: Math.round(base.x + (i % 4) * (CANVAS_NODE_W + 40)),
    y: Math.round(base.y + Math.floor(i / 4) * 110)
  };
  canvas.nodes.push(node);
  if (!(opts && opts.silent)) { saveData(); renderCanvas(); }
  return node;
}

function addAllCardsToCanvas() {
  const rest = cardsNotOnCanvas();
  if (!rest.length) { toast("這個作品的角色都在圖上了"); return; }
  if (!confirm("把剩下的 " + rest.length + " 個角色都加到關係圖上嗎？")) return;
  rest.forEach(function(c) { addCardToCanvas(c.id, { silent: true }); });
  saveData();
  renderCanvas();
  fitCanvasView();
  toast("已加入 " + rest.length + " 個角色");
}

function openAddNodeModal() {
  const list = el("addNodeList");
  if (!list) return;
  list.innerHTML = "";

  const rest = cardsNotOnCanvas();
  if (!rest.length) {
    const p = document.createElement("p");
    p.className = "modal-hint";
    p.textContent = "這個作品的角色都已經在圖上了。";
    list.appendChild(p);
  } else {
    sortCards(rest, "name").forEach(function(card) {
      const pal = getPalette(card.color);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "node-row";

      const icon = document.createElement("span");
      icon.className = "node-icon";
      icon.style.background = pal.bg;
      icon.style.color = pal.text;
      icon.textContent = card.icon || nameInitial(card.name);
      row.appendChild(icon);

      const name = document.createElement("span");
      name.className = "node-name";
      name.textContent = card.name || "未命名角色";
      row.appendChild(name);

      row.onclick = function() {
        addCardToCanvas(card.id);
        openAddNodeModal();       // 清單就地更新，可以連續加好幾個
      };
      list.appendChild(row);
    });
  }
  el("addNodeModal").classList.add("active");
}

function closeAddNodeModal() {
  el("addNodeModal").classList.remove("active");
}

/* 把節點從圖上拿掉——卡片本身不動。這件事要講清楚，不然沒人敢按。 */
function removeNodeFromCanvas(nodeId) {
  const canvas = currentCanvas();
  const node = findNode(nodeId);
  if (!node) return;
  const card = nodeCard(node);
  const edges = canvas.edges.filter(function(e) {
    return e.source === nodeId || e.target === nodeId;
  }).length;

  if (!confirm("把「" + (card ? card.name : "這個角色") + "」從關係圖上拿掉？" +
               (edges ? "\n連著的 " + edges + " 條關係線也會一起消失。" : "") +
               "\n\n角色卡本身不會被刪除。")) return;

  canvas.nodes = canvas.nodes.filter(function(n) { return n.id !== nodeId; });
  canvas.edges = canvas.edges.filter(function(e) {
    return e.source !== nodeId && e.target !== nodeId;
  });
  nodeSizeCache.delete(nodeId);
  saveData();
  renderCanvas();
}


/* ---------- 關係線的編輯視窗 ---------- */

function openEdgeModal(edgeId) {
  const edge = currentCanvas().edges.find(function(e) { return e.id === edgeId; });
  if (!edge) return;
  editingEdgeId = edgeId;

  const a = nodeCard(findNode(edge.source));
  const b = nodeCard(findNode(edge.target));
  el("edgeEndpoints").textContent = (a ? a.name || "未命名角色" : "？") + " ↔ " +
                                    (b ? b.name || "未命名角色" : "？");
  el("edgeLabelInput").value = edge.label || "";
  el("edgeLabelInput").maxLength = MAX_EDGE_LABEL_LEN;

  const colorRow = el("edgeColorRow");
  colorRow.innerHTML = "";
  edgeColorKeys().forEach(function(key) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "edge-color-dot" + (edge.color === key ? " on" : "");
    btn.style.background = getEdgeStroke(key);
    btn.title = EDGE_COLORS[key].name;
    btn.onclick = function() { edge.color = key; openEdgeModal(edgeId); };
    colorRow.appendChild(btn);
  });

  el("edgeArrowRow").querySelectorAll("button").forEach(function(btn) {
    btn.classList.toggle("on", btn.getAttribute("data-arrow") === edge.arrow);
  });

  el("edgeModal").classList.add("active");
}

function setEdgeArrow(kind) {
  const edge = currentCanvas().edges.find(function(e) { return e.id === editingEdgeId; });
  if (!edge) return;
  edge.arrow = kind;
  openEdgeModal(editingEdgeId);
}

function saveEdgeModal() {
  const edge = currentCanvas().edges.find(function(e) { return e.id === editingEdgeId; });
  if (edge) edge.label = el("edgeLabelInput").value.trim().slice(0, MAX_EDGE_LABEL_LEN);
  closeEdgeModal();
  saveData();
  renderCanvas();
}

function deleteEdge() {
  const canvas = currentCanvas();
  if (!confirm("刪掉這條關係線？")) return;
  canvas.edges = canvas.edges.filter(function(e) { return e.id !== editingEdgeId; });
  closeEdgeModal();
  saveData();
  renderCanvas();
}

function closeEdgeModal() {
  editingEdgeId = null;
  el("edgeModal").classList.remove("active");
}

/* 從卡片視窗把這張卡丟到關係圖上並跳過去看。
   使用者在看某張卡時想到「他跟誰有關係」，這是最短的路徑。 */
function addOpenedCardToCanvas() {
  if (!editingCardId) return;
  const existing = currentCanvas().nodes.find(function(n) { return n.cardId === editingCardId; });
  if (!existing) addCardToCanvas(editingCardId);
  closeCardModal();
  switchView("canvas");
  if (!existing) fitCanvasView();
}
