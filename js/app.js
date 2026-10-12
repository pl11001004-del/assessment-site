/* ============================================================
 * 人情世故段位测评 · 主逻辑
 * 路由：#/ 首页 → #/test 答题 → #/result/:id 结果 → #/admin 管理后台
 * 双模式：已配置 Supabase → 线上模式；否则 → 本地演示模式（localStorage）
 * ============================================================ */
"use strict";

const $app = document.getElementById("app");
const $ = (sel, el = document) => el.querySelector(sel);

/* ---------------- 存储层（Supabase / 演示 双实现） ---------------- */
const DEMO_SEED = [
  { code: "DEMO-8888", max_uses: 3, used_count: 0, status: "active", batch: "演示批次", created_at: new Date().toISOString() },
  { code: "DEMO-6666", max_uses: 3, used_count: 1, status: "active", batch: "演示批次", created_at: new Date().toISOString() },
];
const DemoStore = {
  _read() {
    let db = JSON.parse(localStorage.getItem("rsr_demo_db") || "null");
    if (!db) { db = { codes: structuredClone(DEMO_SEED), subs: {} }; localStorage.setItem("rsr_demo_db", JSON.stringify(db)); }
    return db;
  },
  _write(db) { localStorage.setItem("rsr_demo_db", JSON.stringify(db)); },
  async peek(code) {
    const c = this._read().codes.find(x => x.code === code.toUpperCase().trim());
    return c && c.status === "active" ? c.max_uses - c.used_count : -1;
  },
  async redeem(code) {
    const db = this._read();
    const c = db.codes.find(x => x.code === code.toUpperCase().trim());
    if (!c || c.status !== "active" || c.used_count >= c.max_uses) return -1;
    c.used_count += 1; this._write(db);
    return c.max_uses - c.used_count;
  },
  async saveSub(sub) { const db = this._read(); db.subs[sub.id] = sub; this._write(db); },
  async getSub(id) { return this._read().subs[id] || null; },
  async adminVerify(pw) { return pw === "admin888"; },
  async adminList() { return this._read().codes.map(c => ({ ...c })); },
  async adminCreate(pw, count, maxUses, batch) {
    if (!(await this.adminVerify(pw))) throw new Error("管理密码错误");
    const db = this._read(); const made = [];
    const b = batch || new Date().toISOString().slice(0, 16).replace("T", " ");
    for (let i = 0; i < count; i++) {
      const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
      const code = `RQ-${seg()}-${seg()}-${seg()}`;
      const c = { code, max_uses: maxUses, used_count: 0, status: "active", batch: b, created_at: new Date().toISOString() };
      db.codes.unshift(c); made.push(c);
    }
    this._write(db); return made;
  },
  async adminSetStatus(pw, code, status) {
    const db = this._read();
    const c = db.codes.find(x => x.code === code); if (c) { c.status = status; this._write(db); }
  },
  async adminStats() {
    const db = this._read();
    return {
      total: db.codes.length,
      active: db.codes.filter(c => c.status === "active" && c.used_count < c.max_uses).length,
      uses: db.codes.reduce((s, c) => s + c.used_count, 0),
      subs: Object.keys(db.subs).length,
    };
  },
};

const SB = { client: null, ok: false };
async function initStore() {
  if (CONFIG.isConfigured && typeof supabase !== "undefined") {
    try {
      SB.client = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      SB.ok = true; // 连接问题在具体请求时报错（均有超时保护），不做启动预检以免卡住
    } catch (e) { console.warn("Supabase 初始化失败，进入演示模式", e); }
  }
  return SB.ok ? "online" : "demo";
}

const Store = {
  peek: (c) => SB.ok ? withTimeout(SB.client.rpc("peek_code", { p_code: c }).then(r => r.data)) : DemoStore.peek(c),
  redeem: (c) => SB.ok ? withTimeout(SB.client.rpc("redeem_code", { p_code: c }).then(r => r.data)) : DemoStore.redeem(c),
  saveSub: (s) => SB.ok
    ? SB.client.rpc("save_submission", { p_id: s.id, p_code: s.code, p_answers: s.answers, p_dimension_scores: s.scores, p_total: s.total, p_rank: s.rank })
    : DemoStore.saveSub(s),
  getSub: (id) => SB.ok
    ? withTimeout(SB.client.from("submissions").select("*").eq("id", id).maybeSingle().then(r => {
        if (!r.data) return null;
        // 数据库字段名与页面字段名归一
        const d = r.data;
        return { id: d.id, code: d.code, answers: d.answers, scores: d.dimension_scores, total: Number(d.total_score), rank: d.rank_name, created_at: d.created_at };
      }))
    : DemoStore.getSub(id),
  adminVerify: (pw) => SB.ok ? withTimeout(SB.client.rpc("admin_verify", { p_password: pw }).then(r => r.data)) : DemoStore.adminVerify(pw),
  adminList: (pw) => SB.ok ? SB.client.rpc("admin_list_codes", { p_password: pw }).then(r => r.data) : DemoStore.adminList(),
  adminCreate: (pw, n, mu, b) => SB.ok ? SB.client.rpc("admin_create_codes", { p_password: pw, p_count: n, p_max_uses: mu, p_batch: b }) : DemoStore.adminCreate(pw, n, mu, b),
  adminSetStatus: (pw, code, st) => SB.ok ? SB.client.rpc("admin_set_code_status", { p_password: pw, p_code: code, p_status: st }) : DemoStore.adminSetStatus(pw, code, st),
  adminStats: (pw) => SB.ok ? SB.client.rpc("admin_stats", { p_password: pw }).then(r => Array.isArray(r.data) ? r.data[0] : r.data) : DemoStore.adminStats(),
};

/* ---------------- 工具 ---------------- */
const esc = (s) => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
function toast(msg) {
  let t = $("#toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
}
function shortId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("网络请求超时，请点刷新重试")), ms)),
  ]);
}
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
}

/* ---------------- 计分 ---------------- */
function computeScores(answers) {
  // answers: 数组，下标对应 QUESTIONS，值为选项下标（0-3）
  const dimRaw = DIMENSIONS.map(() => 0);
  const dimMax = DIMENSIONS.map(() => 0);
  QUESTIONS.forEach((q, i) => {
    const v = answers[i];
    if (v == null) return;
    dimRaw[q.d] += v; dimMax[q.d] += 3;
  });
  const scores = dimRaw.map((r, i) => dimMax[i] ? Math.round(r / dimMax[i] * 100) : 0);
  const total = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  let rank = RANKS[0];
  for (const r of RANKS) if (total >= r.min) rank = r;
  return { scores, total, rank };
}

/* ---------------- 路由 ---------------- */
window.addEventListener("hashchange", route);

function route() {
  const h = location.hash || "#/";
  const [path, param] = h.slice(2).split("/");
  window.scrollTo(0, 0);
  if (path === "") renderHome();
  else if (path === "test") renderTest();
  else if (path === "result") renderResult(param);
  else if (path === "admin") renderAdmin();
  else renderHome();
}

/* ---------------- 首页 ---------------- */
function renderHome() {
  const modeBadge = SB.ok ? "" : `<span class="badge-demo">演示模式 · 数据仅存本机</span>`;
  $app.innerHTML = `
    <div class="header">
      <div class="logo">🀄</div>
      <h1>${esc(CONFIG.SITE_NAME)}</h1>
      <div class="tagline">${esc(CONFIG.SITE_TAGLINE)} · 48题 · 6维度 · 约8分钟</div>
      ${modeBadge}
    </div>

    <div class="card">
      <h2>🔑 输入测评密码开始</h2>
      <p class="muted">每个密码可用 ${CONFIG.DEFAULT_MAX_USES} 次，答题中途退出不消耗次数。</p>
      <div class="input-row">
        <input id="codeInput" placeholder="如：RQ-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters">
        <button class="btn" id="startBtn">开始</button>
      </div>
      ${CONFIG.GIFT_NOTE ? `<p class="tiny" style="margin-top:10px">🎁 ${esc(CONFIG.GIFT_NOTE)}</p>` : ""}
      <div class="msg" id="homeMsg"></div>
    </div>

    <div class="card">
      <h2>📋 六个维度，看见你的人际处理模式</h2>
      <div class="dim-grid">
        ${DIMENSIONS.map(d => `<div class="dim-item"><div class="ic">${d.icon}</div><div class="nm">${esc(d.name)}</div><div class="ds">${esc(d.desc)}</div></div>`).join("")}
      </div>
    </div>

    <div class="card">
      <h2>📝 测评说明</h2>
      <p class="muted">共 48 题：36 道情境判断题 + 12 道行为自述题，约需 8 分钟。情境题没有"标准答案"，选择<b>你真实的做法</b>而非"理想做法"，结果才准。结果支持生成卡片长图与分享链接。</p>
    </div>

    <div class="footer">本测评属趣味心理测试，结果供娱乐与自我觉察参考，不构成专业心理评估<br>${esc(CONFIG.SITE_URL.replace("https://", ""))}</div>
  `;
  $("#startBtn").onclick = startTest;
  $("#codeInput").addEventListener("keydown", e => { if (e.key === "Enter") startTest(); });
}

function homeMsg(text, type = "err") {
  const el = $("#homeMsg"); el.textContent = text; el.className = `msg show ${type}`;
}

async function startTest() {
  const code = $("#codeInput").value.trim();
  if (!code) { homeMsg("请输入测评密码"); return; }
  const btn = $("#startBtn"); btn.disabled = true; btn.textContent = "校验中…";
  const remaining = await Store.peek(code).catch(() => undefined);
  btn.disabled = false; btn.textContent = "开始";
  if (remaining === undefined || remaining === null) { homeMsg("云端连接异常，请检查网络后重试"); return; }
  if (remaining < 0) { homeMsg("密码无效或已停用，请检查后重试"); return; }
  if (remaining <= 0) { homeMsg("该密码使用次数已用完，可联系卖家购买新的密码"); return; }
  sessionStorage.setItem("rsr_session", JSON.stringify({ code, remaining, answers: {}, idx: 0, startedAt: Date.now() }));
  location.hash = "#/test";
}

/* ---------------- 答题页 ---------------- */
function getSession() {
  try { return JSON.parse(sessionStorage.getItem("rsr_session")); } catch { return null; }
}

function renderTest() {
  const s = getSession();
  if (!s) { location.hash = "#/"; return; }
  $app.innerHTML = `
    <div class="test-top">
      <button class="btn small ghost" id="quitBtn">退出</button>
      <span id="qPos"></span>
      <span class="timer" id="timer"></span>
    </div>
    <div class="progress"><i id="qBar"></i></div>
    <div id="qBody"></div>
  `;
  $("#quitBtn").onclick = () => {
    if (confirm("中途退出不会消耗密码次数，确定退出吗？")) { sessionStorage.removeItem("rsr_session"); location.hash = "#/"; }
  };
  drawQuestion();
  // 计时（软计时，仅提示节奏，不强制）
  clearInterval(window._tmr);
  const t0 = Date.now();
  window._tmr = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    const el = $("#timer"); if (!el) { clearInterval(window._tmr); return; }
    el.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  }, 1000);
}

function drawQuestion() {
  const s = getSession();
  const i = s.idx, q = QUESTIONS[i];
  $("#qPos").textContent = `${i + 1} / ${QUESTIONS.length}`;
  $("#qBar").style.width = `${(i / QUESTIONS.length) * 100}%`;
  const typeLabel = q.t === "judge" ? "情境判断 · 选择你真实的做法" : "行为自述 · 选择最接近你的频率";
  $("#qBody").innerHTML = `
    <div class="q-type">${typeLabel} · ${DIMENSIONS[q.d].icon} ${esc(DIMENSIONS[q.d].name)}</div>
    <div class="q-text">${esc(q.q)}</div>
    <div class="options">
      ${q.o.map((opt, oi) => `<button class="option ${s.answers[i] === oi ? "picked" : ""}" data-oi="${oi}"><span class="letter">${"ABCD"[oi]}</span>${esc(opt)}</button>`).join("")}
    </div>
    <div class="test-nav">
      <button class="btn ghost" id="prevBtn" ${i === 0 ? "disabled" : ""}>← 上一题</button>
      <button class="btn" id="nextBtn" ${s.answers[i] == null ? "disabled" : ""}>${i === QUESTIONS.length - 1 ? "提交并生成结果" : "下一题 →"}</button>
    </div>
  `;
  $("#qBody").querySelectorAll(".option").forEach(b => b.onclick = () => {
    s.answers[i] = +b.dataset.oi;
    sessionStorage.setItem("rsr_session", JSON.stringify(s));
    drawQuestion();
    if (i < QUESTIONS.length - 1) setTimeout(() => { s.idx = i + 1; sessionStorage.setItem("rsr_session", JSON.stringify(s)); drawQuestion(); }, 220);
  });
  $("#prevBtn").onclick = () => { if (s.idx > 0) { s.idx--; sessionStorage.setItem("rsr_session", JSON.stringify(s)); drawQuestion(); } };
  $("#nextBtn").onclick = () => {
    if (s.idx < QUESTIONS.length - 1) { s.idx++; sessionStorage.setItem("rsr_session", JSON.stringify(s)); drawQuestion(); }
    else finishTest();
  };
  window.scrollTo(0, 0);
}

async function finishTest() {
  const s = getSession();
  clearInterval(window._tmr);
  // 校验完整性
  const missing = QUESTIONS.findIndex((_, i) => s.answers[i] == null);
  if (missing >= 0) { toast(`第 ${missing + 1} 题还未作答`); s.idx = missing; drawQuestion(); return; }
  toast("正在生成结果…");
  const { scores, total, rank } = computeScores(QUESTIONS.map((_, i) => s.answers[i]));
  // 完成时才消耗次数；云端失败时结果仍可在本机查看
  const sub = {
    id: shortId(), code: s.code,
    answers: s.answers, scores, total, rank: rank.name,
    created_at: new Date().toISOString(),
  };
  try {
    await Store.redeem(s.code);
    await Store.saveSub(sub);
  } catch (e) {
    console.error("云端保存失败:", e);
    toast("云端保存失败，本次结果仅本机可见");
  }
  sessionStorage.removeItem("rsr_session");
  sessionStorage.setItem("rsr_last", JSON.stringify(sub));
  location.hash = `#/result/${sub.id}`;
}

/* ---------------- 结果页 ---------------- */
async function renderResult(id) {
  let sub = null;
  try { sub = JSON.parse(sessionStorage.getItem("rsr_last")); } catch {}
  if (!sub || sub.id !== id) sub = await Store.getSub(id);
  if (!sub) {
    $app.innerHTML = `<div class="card" style="margin-top:60px;text-align:center">
      <h2>结果不存在或加载失败</h2>
      <p class="muted">分享链接对应的记录未找到，或网络异常。</p>
      <br><button class="btn" onclick="location.reload()">重试</button>
      <a class="btn ghost" href="#/">回到首页</a></div>`;
    return;
  }
  const dimPairs = DIMENSIONS.map((d, i) => ({ ...d, v: sub.scores[i] }));
  const sorted = [...dimPairs].sort((a, b) => b.v - a.v);
  const rank = RANKS.find(r => r.name === sub.rank) || RANKS[0];

  $app.innerHTML = `
    <div class="result-hero">
      <div class="eyebrow">人情世故段位</div>
      <div class="rank-emoji">${rank.emoji}</div>
      <div class="rank-name">${esc(rank.name)}</div>
      <div class="score-line">综合得分 <b>${sub.total}</b><span style="color:var(--ink-3)"> / 100</span></div>
    </div>
    <div class="card">
      <div class="score-track"><i style="width:${sub.total}%"></i></div>
      <canvas class="chart" id="radar" width="640" height="440"></canvas>
      <div class="dim-bars">
        ${dimPairs.map(d => `
          <div class="dim-bar">
            <div class="row"><b>${d.icon} ${esc(d.name)}</b><span>${d.v}</span></div>
            <div class="track"><i style="width:${d.v}%"></i></div>
          </div>`).join("")}
      </div>
    </div>
    <div class="card">
      <h2>📖 段位解读</h2>
      <p class="rank-note">${esc(rank.note)}</p>
      <br>
      <p class="muted">优势维度：<b style="color:var(--green)">${sorted[0].name}</b>（${sorted[0].v} 分）；
      潜力维度：<b style="color:var(--gold)">${sorted[sorted.length - 1].name}</b>（${sorted[sorted.length - 1].v} 分）。
      人情世故是可练习的技能，从潜力维度入手提升最快。</p>
    </div>
    <div class="card">
      <h2>📤 保存与分享</h2>
      <div class="result-actions">
        <button class="btn" id="saveImgBtn">🖼️ 保存长图</button>
        <button class="btn ghost" id="copyLinkBtn">🔗 复制结果链接</button>
      </div>
      <button class="btn gold block" id="againBtn" style="margin-top:10px">再测一次（输入新密码）</button>
      ${CONFIG.GIFT_NOTE ? `<div class="gift-note">🎁 ${esc(CONFIG.GIFT_NOTE)}</div>` : ""}
    </div>
    <div class="footer">本结果为趣味测评，供自我觉察参考 · ${esc(CONFIG.SITE_NAME)}</div>
  `;
  drawRadar($("#radar"), dimPairs);
  $("#saveImgBtn").onclick = () => saveLongImage(sub, dimPairs, rank);
  $("#copyLinkBtn").onclick = async () => {
    const link = location.origin + location.pathname + "#/result/" + sub.id;
    try { await navigator.clipboard.writeText(link); toast("链接已复制，发给朋友看看TA的段位吧"); }
    catch { prompt("复制下方链接：", link); }
  };
  $("#againBtn").onclick = () => { location.hash = "#/"; };
}

/* 雷达图绘制 */
function drawRadar(canvas, dimPairs, opts = {}) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2 + 6, R = Math.min(W, H) / 2 - 56;
  const bg = opts.bg || "#ffffff", ink = opts.ink || "#2b2b28", ink2 = opts.ink2 || "#6b6a64";
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const n = dimPairs.length;
  const ang = (i) => -Math.PI / 2 + i * 2 * Math.PI / n;
  // 网格
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = ang(i % n), r = R * ring / 4;
      i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.strokeStyle = "#e8e2d6"; ctx.lineWidth = 1; ctx.stroke();
  }
  // 轴线与标签
  ctx.font = `${opts.labelSize || 15}px -apple-system, PingFang SC, sans-serif`;
  dimPairs.forEach((d, i) => {
    const a = ang(i);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.strokeStyle = "#e8e2d6"; ctx.stroke();
    const lx = cx + (R + 30) * Math.cos(a), ly = cy + (R + 26) * Math.sin(a);
    ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`${d.name}`, lx, ly);
    ctx.fillStyle = "#b98a2f";
    ctx.fillText(String(d.v), lx, ly + 17);
  });
  // 数据多边形
  ctx.beginPath();
  dimPairs.forEach((d, i) => {
    const a = ang(i), r = R * d.v / 100;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a)) : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(63,122,104,.22)"; ctx.fill();
  ctx.strokeStyle = "#3f7a68"; ctx.lineWidth = 2.5; ctx.stroke();
  dimPairs.forEach((d, i) => {
    const a = ang(i), r = R * d.v / 100;
    ctx.beginPath(); ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 4, 0, 7);
    ctx.fillStyle = "#2f5d50"; ctx.fill();
  });
}

/* 结果长图 */
function saveLongImage(sub, dimPairs, rank) {
  const W = 750, H = 1400;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  // 背景
  ctx.fillStyle = "#faf7f1"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2f5d50"; ctx.fillRect(0, 0, W, 8);
  // 标题
  ctx.textAlign = "center";
  ctx.fillStyle = "#a09e95"; ctx.font = "22px -apple-system, PingFang SC, sans-serif";
  ctx.fillText("人 情 世 故 段 位 测 评", W / 2, 78);
  // 段位
  ctx.font = "72px serif"; ctx.fillText(rank.emoji, W / 2, 170);
  ctx.fillStyle = "#2b2b28"; ctx.font = "bold 46px -apple-system, PingFang SC, sans-serif";
  ctx.fillText(rank.name, W / 2, 246);
  ctx.fillStyle = "#6b6a64"; ctx.font = "24px -apple-system, PingFang SC, sans-serif";
  ctx.fillText(`综合得分 ${sub.total} / 100`, W / 2, 296);
  // 雷达图（离屏）
  const radar = document.createElement("canvas"); radar.width = 560; radar.height = 400;
  drawRadar(radar, dimPairs, { bg: "#faf7f1", labelSize: 16 });
  ctx.drawImage(radar, (W - 560) / 2, 330);
  // 维度条
  let y = 770;
  dimPairs.forEach(d => {
    ctx.textAlign = "left"; ctx.fillStyle = "#2b2b28"; ctx.font = "22px -apple-system, PingFang SC, sans-serif";
    ctx.fillText(`${d.name}`, 70, y);
    ctx.textAlign = "right"; ctx.fillText(String(d.v), W - 70, y);
    ctx.fillStyle = "#e8e2d6"; roundRect(ctx, 70, y + 12, W - 140, 10, 5); ctx.fill();
    ctx.fillStyle = "#3f7a68"; roundRect(ctx, 70, y + 12, (W - 140) * d.v / 100, 10, 5); ctx.fill();
    y += 52;
  });
  // 说明
  y += 26;
  ctx.fillStyle = "#6b6a64"; ctx.font = "20px -apple-system, PingFang SC, sans-serif"; ctx.textAlign = "left";
  wrapText(ctx, rank.note, 70, y, W - 140, 32);
  // 底部
  ctx.textAlign = "center"; ctx.fillStyle = "#a09e95"; ctx.font = "18px -apple-system, PingFang SC, sans-serif";
  ctx.fillText("趣味测评 · 供自我觉察参考", W / 2, H - 66);
  ctx.fillText(CONFIG.SITE_URL.replace("https://", ""), W / 2, H - 38);

  const link = document.createElement("a");
  link.download = `人情世故段位测评-${sub.total}分.png`;
  link.href = c.toDataURL("image/png");
  link.click();
  toast("长图已生成，请查看下载（手机端将保存到下载目录）");
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, x, y, maxW, lh) {
  let line = "", yy = y;
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) { ctx.fillText(line, x, yy); line = ch; yy += lh; }
    else line += ch;
  }
  if (line) ctx.fillText(line, x, yy);
}

/* ---------------- 管理后台 ---------------- */
let adminPW = sessionStorage.getItem("rsr_admin_pw") || "";

async function renderAdmin() {
  if (!adminPW) { renderAdminLogin(); return; }
  const ok = await Store.adminVerify(adminPW);
  if (!ok) { adminPW = ""; sessionStorage.removeItem("rsr_admin_pw"); renderAdminLogin(); return; }
  renderAdminPanel();
}

function renderAdminLogin() {
  $app.innerHTML = `
    <div class="card admin-login">
      <h2>🔐 管理后台</h2>
      <p class="muted">${SB.ok ? esc(CONFIG.ADMIN_HINT) : "演示模式管理密码：admin888"}</p>
      <div class="input-row">
        <input id="pwInput" type="password" placeholder="管理密码">
      </div>
      <button class="btn block" id="loginBtn" style="margin-top:12px">登录</button>
      <div class="msg" id="adminMsg"></div>
      <br><a href="#/" class="tiny">← 回到首页</a>
    </div>`;
  const doLogin = async () => {
    const pw = $("#pwInput").value;
    if (await Store.adminVerify(pw)) {
      adminPW = pw; sessionStorage.setItem("rsr_admin_pw", pw);
      location.hash = "#/admin"; route();
    } else { const m = $("#adminMsg"); m.textContent = "密码错误"; m.className = "msg show err"; }
  };
  $("#loginBtn").onclick = doLogin;
  $("#pwInput").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
}

async function renderAdminPanel() {
  $app.innerHTML = `
    <div class="header" style="padding-top:24px">
      <h1 style="font-size:20px">🛠️ 密码管理后台</h1>
      <div class="tagline">${SB.ok ? "线上模式 · Supabase" : "演示模式 · 本地存储"}</div>
    </div>
    <div class="card">
      <div class="stat-grid" id="statGrid"><span class="muted">加载中…</span></div>
    </div>
    <div class="card">
      <h2>➕ 生成新密码批次</h2>
      <div class="input-row">
        <input id="genCount" type="number" value="10" min="1" max="500" title="数量">
        <input id="genUses" type="number" value="${CONFIG.DEFAULT_MAX_USES}" min="1" max="99" title="每码次数">
        <button class="btn" id="genBtn">生成</button>
      </div>
      <p class="tiny">左：数量（≤500）｜右：每码可用次数</p>
      <div class="msg" id="genMsg"></div>
    </div>
    <div class="card">
      <h2>📇 密码列表</h2>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn small ghost" id="refreshBtn">🔄 刷新</button>
        <button class="btn small ghost" id="csvBtn">⬇️ 导出CSV</button>
        <button class="btn small ghost" id="logoutBtn">退出登录</button>
      </div>
      <div class="table-wrap"><table class="code-table" id="codeTable"></table></div>
    </div>
    <div class="footer"><a href="#/" style="color:inherit">← 回到首页</a></div>
  `;
  $("#logoutBtn").onclick = () => { adminPW = ""; sessionStorage.removeItem("rsr_admin_pw"); location.hash = "#/"; };
  $("#refreshBtn").onclick = refreshAdmin;
  $("#csvBtn").onclick = exportCSV;
  $("#genBtn").onclick = generateCodes;
  refreshAdmin();
}

async function refreshAdmin() {
  try {
    const raw = await withTimeout(Store.adminStats(adminPW));
    // 线上返回 total_codes/active_codes/...；演示返回 total/active/...，统一归一
    const stats = {
      total: raw.total_codes ?? raw.total ?? 0,
      active: raw.active_codes ?? raw.active ?? 0,
      uses: raw.total_uses ?? raw.uses ?? 0,
      subs: raw.total_submissions ?? raw.subs ?? 0,
    };
  $("#statGrid").innerHTML = `
    <div class="stat-box"><div class="v">${stats.total}</div><div class="k">密码总数</div></div>
    <div class="stat-box"><div class="v">${stats.active}</div><div class="k">可用次数余量</div></div>
    <div class="stat-box"><div class="v">${stats.uses}</div><div class="k">累计使用</div></div>
    <div class="stat-box"><div class="v">${stats.subs}</div><div class="k">已生成结果</div></div>`;
  const rows = await withTimeout(Store.adminList(adminPW));
  const list = Array.isArray(rows) ? rows : (rows.data || []);
  $("#codeTable").innerHTML = `
    <tr><th>密码</th><th>已用/上限</th><th>状态</th><th>批次</th><th>操作</th></tr>
    ${list.map(c => `
      <tr>
        <td><b>${esc(c.code)}</b></td>
        <td>${c.used_count}/${c.max_uses}</td>
        <td>${c.status === "active"
          ? (c.used_count >= c.max_uses ? `<span class="tag used">已用完</span>` : `<span class="tag ok">可用</span>`)
          : `<span class="tag off">停用</span>`}</td>
        <td class="tiny">${esc(c.batch || "-")}</td>
        <td><button class="btn small ghost" data-code="${esc(c.code)}" data-st="${c.status === "active" ? "disabled" : "active"}">${c.status === "active" ? "停用" : "启用"}</button></td>
      </tr>`).join("")}`;
  $("#codeTable").querySelectorAll("button[data-code]").forEach(b => b.onclick = async () => {
    await Store.adminSetStatus(adminPW, b.dataset.code, b.dataset.st);
    refreshAdmin();
  });
  } catch (e) {
    const g = $("#statGrid"); if (g) g.innerHTML = `<span class="muted">加载失败：${esc(e.message || e)}</span>`;
    console.error("refreshAdmin error:", e);
  }
}

async function generateCodes() {
  const n = +$("#genCount").value || 10;
  const uses = +$("#genUses").value || CONFIG.DEFAULT_MAX_USES;
  const btn = $("#genBtn"); btn.disabled = true; btn.textContent = "生成中…";
  try {
    const res = await Store.adminCreate(adminPW, n, uses, null);
    const made = Array.isArray(res) ? res : (res.data || []);
    const m = $("#genMsg"); m.textContent = `已生成 ${made.length} 个密码（每码 ${uses} 次），可在下方列表导出CSV`; m.className = "msg show ok";
    refreshAdmin();
  } catch (e) {
    const m = $("#genMsg"); m.textContent = "生成失败：" + (e.message || "未知错误"); m.className = "msg show err";
  }
  btn.disabled = false; btn.textContent = "生成";
}

async function exportCSV() {
  const rows = await Store.adminList(adminPW);
  const list = Array.isArray(rows) ? rows : (rows.data || []);
  const head = "密码,已用次数,可用上限,状态,批次,生成时间";
  const body = list.map(c => [c.code, c.used_count, c.max_uses, c.status, c.batch || "", c.created_at].join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + head + "\n" + body], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `passwords-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  const mode = await initStore();
  $("#loadingMode").textContent = mode === "online" ? "已连接云端数据库" : "本地演示模式（未配置 Supabase）";
  setTimeout(() => { route(); }, 250);
})();
