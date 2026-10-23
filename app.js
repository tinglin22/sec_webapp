// ================================================================
// app.js — 畫面、答題引擎、模擬考、打地鼠
// ================================================================
(function () {
  const DB = window.DB;
  const DAILY_COUNT = 20;
  const MOCK_COUNT = 80;
  const MOCK_SECONDS = 100 * 60;
  const PASS_SCORE = 60;
  const DAILY_HEARTS = 5;
  const MOLE_HEARTS = 3;
  const HOLES = 9;
  const LETTERS = ["A", "B", "C", "D"];

  const view = document.getElementById("view");
  const streakEl = document.getElementById("streakBadge");

  let S = null; // 目前進行中的 session
  let dailyStyle = "normal";

  // ---------------- 小工具 ----------------
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const opt = (q, L) => q["option_" + L.toLowerCase()];
  const short = (t, n = 38) => (t.length > n ? t.slice(0, n) + "…" : t);
  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  function toast(msg) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  function refreshStreak() {
    streakEl.textContent = "🔥 " + DB.streak();
  }

  function stopSession() {
    if (S) {
      if (S.timer) clearInterval(S.timer);
      if (S.cleanup) S.cleanup();
    }
    S = null;
    document.body.classList.remove("in-session");
  }

  function startSession(s) {
    stopSession();
    S = s;
    document.body.classList.add("in-session");
  }

  function leaveSession() {
    const msg = S && S.kind === "mock" ? "離開會放棄這次模擬考，確定嗎？" : "確定要結束這一輪嗎？已作答的紀錄會保留。";
    if (confirm(msg)) go("home");
  }

  // ---------------- 路由 ----------------
  const routes = {
    home: renderHome,
    daily: renderDaily,
    mock: renderMockIntro,
    mole: renderMoleIntro,
    stats: renderStats,
    search: renderSearch,
    bookmarks: renderBookmarks,
    detail: renderDetail,
  };

  function go(name, params = {}) {
    stopSession();
    document.querySelectorAll("#bottomNav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    (routes[name] || renderHome)(params);
    window.scrollTo(0, 0);
  }
  window.go = go;

  document.querySelectorAll("#bottomNav button").forEach((b) => (b.onclick = () => go(b.dataset.view)));
  document.getElementById("searchBtn").onclick = () => go("search");

  // ================================================================
  // 首頁
  // ================================================================
  function renderHome() {
    const st = DB.stats();
    const pct = st.total ? Math.round((st.tested / st.total) * 100) : 0;
    view.innerHTML = `
      <div class="section-title">開始練習</div>
      ${tapCard("每日 20 題", "依序・隨機未考・錯題加強", "go('daily')")}
      ${tapCard("模擬考 80 題", "100 分鐘倒數・60 分及格", "go('mock')")}
      ${tapCard("打地鼠", "眼力訓練・限時搶答", "go('mole')")}

      <div class="section-title">總進度</div>
      <div class="stat-grid">
        <div class="stat-box"><div class="num">${st.tested}/${st.total}</div><div class="label">已練習 ${pct}%</div></div>
        <div class="stat-box"><div class="num">${st.accuracy}%</div><div class="label">正確率</div></div>
        <div class="stat-box"><div class="num">${DB.wrongIds().length}</div><div class="label">錯題數</div></div>
      </div>

      <div class="section-title">複習</div>
      ${tapCard("全部錯題複習", "錯越多次越先出現", "startReview('wrong')")}
      ${tapCard("收藏題目", DB.bookmarkedIds().length + " 題", "go('bookmarks')")}
    `;
  }

  function tapCard(title, meta, onclick) {
    return `<div class="card card-tap" onclick="${onclick}"><div><div class="title">${title}</div><div class="meta">${meta}</div></div><div class="chev">›</div></div>`;
  }

  // ================================================================
  // 每日 20 題
  // ================================================================
  function renderDaily() {
    view.innerHTML = `
      <div class="section-title">答題方式</div>
      <div class="segmented">
        <button data-style="normal" class="${dailyStyle === "normal" ? "active" : ""}">一般作答</button>
        <button data-style="mole" class="${dailyStyle === "mole" ? "active" : ""}">打地鼠作答</button>
      </div>
      <div class="section-title">選擇出題範圍</div>
      ${tapCard("依序作答", "從上次進度接續", "startDaily('seq')")}
      ${tapCard("隨機・從未考過", "還有 " + DB.untestedIds().length + " 題沒練習過", "startDaily('untested')")}
      ${tapCard("隨機・從錯題加強", "錯越多次越常出現", "startDaily('wrong')")}
    `;
    view.querySelectorAll(".segmented button").forEach((b) => {
      b.onclick = () => {
        dailyStyle = b.dataset.style;
        view.querySelectorAll(".segmented button").forEach((x) => x.classList.toggle("active", x === b));
      };
    });
  }

  window.startDaily = function (kind) {
    const all = DB.all().map((q) => q.id).sort((a, b) => a - b);
    let ids = [];
    if (kind === "seq") {
      let p = DB.seqPointer();
      if (p >= all.length) p = 0;
      ids = all.slice(p, p + DAILY_COUNT);
      DB.setSeqPointer(p + DAILY_COUNT >= all.length ? 0 : p + DAILY_COUNT);
    } else if (kind === "untested") {
      const u = DB.untestedIds();
      if (!u.length) return toast("每一題都練習過了，改試試「錯題加強」吧");
      ids = DB.pickRandom(u, DAILY_COUNT);
    } else {
      ids = DB.pickWeightedByWrong(DAILY_COUNT);
      if (!ids.length) return toast("目前還沒有錯題紀錄");
    }
    beginPractice(ids, "每日練習", dailyStyle);
  };

  window.startReview = function () {
    const ids = DB.wrongIds();
    if (!ids.length) return toast("目前還沒有錯題紀錄");
    beginPractice(ids, "錯題複習", "normal", true);
  };

  function beginPractice(ids, title, style, noHearts) {
    const hearts = noHearts ? null : style === "mole" ? MOLE_HEARTS : DAILY_HEARTS;
    startSession({ kind: "practice", style, ids, i: 0, hearts, maxHearts: hearts, correct: 0, wrong: 0, title });
    style === "mole" ? moleQuestion() : normalQuestion();
  }

  // ================================================================
  // 一般作答
  // ================================================================
  function heartsHTML() {
    if (S.maxHearts == null) return "";
    return `<div class="hearts" id="hearts">${Array.from({ length: S.maxHearts }, (_, i) => `<span class="heart ${i < S.hearts ? "" : "lost"}">❤️</span>`).join("")}</div>`;
  }

  function normalQuestion() {
    const q = DB.get(S.ids[S.i]);
    const bm = DB.prog(q.id).bookmarked;
    view.innerHTML = `
      <button class="exit-link" id="exitBtn">‹ 結束</button>
      <div class="hud"><span>${esc(S.title)}　${S.i + 1} / ${S.ids.length}</span>${heartsHTML()}</div>
      <div class="bar q"><div style="width:${(S.i / S.ids.length) * 100}%"></div></div>
      <div class="q-meta"><span>第 ${q.id} 題${q.category ? "・" + esc(q.category) : ""}</span><button class="star ${bm ? "on" : ""}" id="star">${bm ? "★" : "☆"}</button></div>
      <div class="q-text">${esc(q.question)}</div>
      <div class="options" id="opts">${LETTERS.map((L) => optionBtn(L, opt(q, L))).join("")}</div>
      <div id="after"></div>`;
    document.getElementById("exitBtn").onclick = leaveSession;
    bindStar(q.id);
    view.querySelectorAll("#opts .option").forEach((b) => (b.onclick = () => answerNormal(q, b.dataset.l)));
  }

  const optionBtn = (L, text, cls = "") => `<button class="option ${cls}" data-l="${L}"><span class="letter">${L}</span><span>${esc(text)}</span></button>`;

  function bindStar(id) {
    const el = document.getElementById("star");
    if (!el) return;
    el.onclick = () => {
      const on = DB.toggleBookmark(id);
      el.textContent = on ? "★" : "☆";
      el.classList.toggle("on", on);
    };
  }

  function answerNormal(q, L) {
    const ok = L === q.answer;
    DB.recordAnswer(q.id, ok);
    refreshStreak();
    ok ? S.correct++ : S.wrong++;
    if (!ok && S.hearts != null) S.hearts--;

    view.querySelectorAll("#opts .option").forEach((b) => {
      b.onclick = null;
      if (b.dataset.l === q.answer) b.classList.add("correct");
      else if (b.dataset.l === L) b.classList.add("wrong");
    });
    const heartsEl = document.getElementById("hearts");
    if (heartsEl) heartsEl.outerHTML = heartsHTML();

    const dead = S.hearts != null && S.hearts <= 0;
    const last = S.i + 1 >= S.ids.length;
    document.getElementById("after").innerHTML = `
      ${q.explanation ? `<div class="explain">${esc(q.explanation)}</div>` : ""}
      <div style="margin-top:16px"><button class="btn primary" id="nextBtn">${dead || last ? "看結果" : "下一題"}</button></div>`;
    document.getElementById("nextBtn").onclick = () => {
      if (dead || last) return practiceResult(dead);
      S.i++;
      normalQuestion();
    };
    document.getElementById("nextBtn").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function practiceResult(dead) {
    const s = S;
    stopSession();
    const n = s.correct + s.wrong;
    view.innerHTML = `
      <div class="result">
        <div class="score">${s.correct}<span style="font-size:26px;color:var(--muted)"> / ${n}</span></div>
        <div class="verdict ${dead ? "fail" : "pass"}">${dead ? "愛心用完了" : "這一輪完成！"}</div>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="num">${s.correct}</div><div class="label">答對</div></div>
        <div class="stat-box"><div class="num">${s.wrong}</div><div class="label">答錯</div></div>
        <div class="stat-box"><div class="num">${n ? Math.round((s.correct / n) * 100) : 0}%</div><div class="label">正確率</div></div>
      </div>
      <div style="margin-top:20px">
        <button class="btn primary" onclick="go('home')">回首頁</button>
        <button class="btn ghost" onclick="go('daily')">再來一輪</button>
      </div>`;
  }

  // ================================================================
  // 模擬考
  // ================================================================
  function renderMockIntro() {
    const n = Math.min(MOCK_COUNT, DB.all().length);
    view.innerHTML = `
      <div class="card">
        <div class="title" style="font-size:16px;font-weight:800;margin-bottom:10px">模擬考規則</div>
        <div class="meta" style="line-height:1.9;font-size:14px">
          隨機抽 <b style="color:var(--text)">${n} 題</b>，滿分 100 分，答錯不倒扣。<br>
          作答時間 <b style="color:var(--text)">100 分鐘</b>，時間到自動交卷。<br>
          <b style="color:var(--text)">${PASS_SCORE} 分</b>及格（官方結訓電腦測驗規格）。<br>
          作答中不顯示對錯，交卷後才統一結算並記入錯題。
        </div>
        ${n < MOCK_COUNT ? `<div class="meta" style="color:var(--accent);margin-top:8px">目前題庫只有 ${n} 題，題數不足 80。</div>` : ""}
        <div style="margin-top:16px"><button class="btn primary" onclick="startMock()">開始模擬考</button></div>
      </div>`;
  }

  window.startMock = function () {
    const ids = DB.pickRandom(DB.all().map((q) => q.id), MOCK_COUNT);
    startSession({
      kind: "mock", ids, i: 0, title: "模擬考",
      answers: new Array(ids.length).fill(null),
      timeLeft: MOCK_SECONDS,
    });
    S.timer = setInterval(() => {
      if (!S || S.kind !== "mock") return;
      S.timeLeft--;
      const el = document.getElementById("timer");
      if (el) {
        el.textContent = fmt(S.timeLeft);
        el.classList.toggle("warn", S.timeLeft <= 300);
      }
      if (S.timeLeft <= 0) {
        toast("時間到，自動交卷");
        submitMock();
      }
    }, 1000);
    mockQuestion();
  };

  function mockQuestion() {
    const q = DB.get(S.ids[S.i]);
    const done = S.answers.filter(Boolean).length;
    view.innerHTML = `
      <button class="exit-link" id="exitBtn">‹ 放棄考試</button>
      <div class="hud"><span>${S.i + 1} / ${S.ids.length}　已答 ${done}</span><span class="timer mono ${S.timeLeft <= 300 ? "warn" : ""}" id="timer">${fmt(S.timeLeft)}</span></div>
      <div class="bar q"><div style="width:${(done / S.ids.length) * 100}%"></div></div>
      <div class="q-text">${esc(q.question)}</div>
      <div class="options" id="opts">${LETTERS.map((L) => optionBtn(L, opt(q, L), S.answers[S.i] === L ? "chosen" : "")).join("")}</div>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn ghost" id="prev" ${S.i === 0 ? "disabled" : ""}>上一題</button>
        <button class="btn ghost" id="next" ${S.i === S.ids.length - 1 ? "disabled" : ""} style="margin-top:0">下一題</button>
      </div>
      <button class="btn ghost" id="overview">題目總覽</button>
      <button class="btn primary" id="submit">交卷</button>`;
    document.getElementById("exitBtn").onclick = leaveSession;
    view.querySelectorAll("#opts .option").forEach((b) => {
      b.onclick = () => {
        S.answers[S.i] = b.dataset.l;
        if (S.i + 1 < S.ids.length) S.i++;
        mockQuestion();
        window.scrollTo(0, 0);
      };
    });
    document.getElementById("prev").onclick = () => { S.i--; mockQuestion(); };
    document.getElementById("next").onclick = () => { S.i++; mockQuestion(); };
    document.getElementById("overview").onclick = mockOverview;
    document.getElementById("submit").onclick = confirmSubmit;
  }

  function mockOverview() {
    view.innerHTML = `
      <div class="hud"><span>題目總覽（藍底＝已作答）</span><span class="timer mono ${S.timeLeft <= 300 ? "warn" : ""}" id="timer">${fmt(S.timeLeft)}</span></div>
      <div class="grid-nums">${S.ids.map((_, i) => `<button class="${S.answers[i] ? "done" : ""} ${i === S.i ? "here" : ""}" data-i="${i}">${i + 1}</button>`).join("")}</div>
      <div style="margin-top:18px"><button class="btn ghost" id="back">回到作答</button><button class="btn primary" id="submit">交卷</button></div>`;
    view.querySelectorAll(".grid-nums button").forEach((b) => (b.onclick = () => { S.i = Number(b.dataset.i); mockQuestion(); }));
    document.getElementById("back").onclick = mockQuestion;
    document.getElementById("submit").onclick = confirmSubmit;
  }

  function confirmSubmit() {
    const left = S.answers.filter((a) => !a).length;
    if (confirm(left ? `還有 ${left} 題沒作答，確定要交卷嗎？` : "確定要交卷嗎？")) submitMock();
  }

  function submitMock() {
    if (!S || S.kind !== "mock") return;
    const s = S;
    stopSession();
    let correct = 0;
    const wrongIds = [];
    s.ids.forEach((id, i) => {
      if (!s.answers[i]) return; // 沒作答的不計入錯題，避免灌水
      const ok = s.answers[i] === DB.get(id).answer;
      DB.recordAnswer(id, ok);
      ok ? correct++ : wrongIds.push(id);
    });
    refreshStreak();
    const unanswered = s.answers.filter((a) => !a).length;
    const exact = (correct * 100) / s.ids.length;
    const score = String(Math.round(exact * 100) / 100);
    const pass = exact >= PASS_SCORE;
    view.innerHTML = `
      <div class="result">
        <div class="score">${score}</div>
        <div class="verdict ${pass ? "pass" : "fail"}">${pass ? "及格！" : "未達 60 分"}</div>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="num">${correct}</div><div class="label">答對</div></div>
        <div class="stat-box"><div class="num">${wrongIds.length}</div><div class="label">答錯</div></div>
        <div class="stat-box"><div class="num">${unanswered}</div><div class="label">未作答</div></div>
      </div>
      ${wrongIds.length ? `<div class="section-title">這次答錯的題目（已加入錯題）</div>` + wrongIds.map((id) => listCard(DB.get(id), "home")).join("") : ""}
      <div style="margin-top:20px"><button class="btn primary" onclick="go('home')">回首頁</button><button class="btn ghost" onclick="go('mock')">再考一次</button></div>`;
  }

  // ================================================================
  // 打地鼠
  // ================================================================
  function renderMoleIntro() {
    view.innerHTML = `
      <div class="card">
        <div class="title" style="font-size:16px;font-weight:800;margin-bottom:10px">打地鼠玩法</div>
        <div class="meta" style="line-height:1.9;font-size:14px">
          題目固定顯示在上方，4 個選項會輪流從隨機的洞冒出來。<br>
          看到<b style="color:var(--text)">正確答案</b>冒出來就點它。點到錯的選項扣一顆心。<br>
          答對越多題，地鼠冒出的速度越快。
        </div>
        <div class="meta" style="margin-top:10px">最佳紀錄：<b style="color:var(--accent)">${DB.moleBest()}</b> 題</div>
        <div style="margin-top:16px"><button class="btn primary" onclick="startMole()">開始挑戰</button></div>
      </div>`;
  }

  window.startMole = function () {
    startSession({
      kind: "practice", style: "mole", standalone: true,
      ids: DB.shuffle(DB.all().map((q) => q.id)), i: 0,
      hearts: MOLE_HEARTS, maxHearts: MOLE_HEARTS, correct: 0, wrong: 0, title: "打地鼠",
    });
    moleQuestion();
  };

  function moleQuestion() {
    const q = DB.get(S.ids[S.i % S.ids.length]);
    const level = Math.min(S.correct, 10);
    const popMs = Math.max(1400 - level * 75, 650);
    const gapMs = Math.max(650 - level * 35, 330);

    view.innerHTML = `
      <button class="exit-link" id="exitBtn">‹ 結束</button>
      <div class="hud"><span>${S.standalone ? "答對 " + S.correct + " 題" : S.title + "　" + (S.i + 1) + " / " + S.ids.length}</span>${heartsHTML()}</div>
      <div class="mole-q">${esc(q.question)}</div>
      <div class="mole-grid">${Array.from({ length: HOLES }, () => `<div class="hole"></div>`).join("")}</div>
      <div class="mole-hint">看到正確答案就點它</div>`;
    document.getElementById("exitBtn").onclick = leaveSession;

    const holes = [...view.querySelectorAll(".hole")];
    let queue = DB.shuffle(LETTERS);
    let alive = true;
    let missed = false; // 這題是否已經點錯過（只記一次錯）
    const timeouts = [];

    function spawn() {
      if (!alive) return;
      const free = holes.filter((h) => !h.firstChild);
      if (!free.length) return;
      if (!queue.length) queue = DB.shuffle(LETTERS);
      const L = queue.pop();
      const hole = free[Math.floor(Math.random() * free.length)];
      const pop = document.createElement("button");
      pop.className = "pop";
      pop.textContent = opt(q, L);
      hole.appendChild(pop);
      timeouts.push(setTimeout(() => pop.parentNode && pop.remove(), popMs));
      pop.onclick = () => hit(L, pop);
    }

    function hit(L, pop) {
      if (!alive) return;
      if (L === q.answer) {
        alive = false;
        clearInterval(spawner);
        pop.classList.add("hit-ok");
        if (!missed) { DB.recordAnswer(q.id, true); S.correct++; }
        refreshStreak();
        timeouts.push(setTimeout(() => {
          S.i++;
          if (!S.standalone && S.i >= S.ids.length) return practiceResult(false);
          moleQuestion();
        }, 420));
      } else {
        pop.classList.add("hit-bad");
        pop.onclick = null;
        timeouts.push(setTimeout(() => pop.parentNode && pop.remove(), 260));
        S.hearts--;
        if (!missed) { missed = true; DB.recordAnswer(q.id, false); S.wrong++; refreshStreak(); }
        const h = document.getElementById("hearts");
        if (h) h.outerHTML = heartsHTML();
        if (S.hearts <= 0) {
          alive = false;
          clearInterval(spawner);
          timeouts.push(setTimeout(moleOver, 450));
        }
      }
    }

    const spawner = setInterval(spawn, gapMs);
    spawn();
    S.cleanup = () => { alive = false; clearInterval(spawner); timeouts.forEach(clearTimeout); };
  }

  function moleOver() {
    const s = S;
    if (!s.standalone) return practiceResult(true);
    stopSession();
    const best = DB.moleBest();
    const record = s.correct > best;
    if (record) DB.setMoleBest(s.correct);
    view.innerHTML = `
      <div class="result">
        <div class="score">${s.correct}</div>
        <div class="verdict ${record ? "pass" : ""}">${record ? "新紀錄！" : "挑戰結束"}</div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(2,1fr)">
        <div class="stat-box"><div class="num">${s.correct}</div><div class="label">本次答對</div></div>
        <div class="stat-box"><div class="num">${Math.max(best, s.correct)}</div><div class="label">最佳紀錄</div></div>
      </div>
      <div style="margin-top:20px"><button class="btn primary" onclick="startMole()">再玩一次</button><button class="btn ghost" onclick="go('home')">回首頁</button></div>`;
  }

  // ================================================================
  // 統計
  // ================================================================
  function renderStats() {
    const st = DB.stats();
    const top = DB.topWrong(10);
    const cats = DB.categories();
    view.innerHTML = `
      <div class="stat-grid">
        <div class="stat-box"><div class="num">${st.tested}/${st.total}</div><div class="label">總進度</div></div>
        <div class="stat-box"><div class="num">${st.accuracy}%</div><div class="label">正確率</div></div>
        <div class="stat-box"><div class="num">${DB.streak()}</div><div class="label">連續天數</div></div>
      </div>

      <div class="section-title">最常錯的題目</div>
      ${top.length ? top.map(({ q, p }) => listCard(q, "stats", `錯 ${p.wrong_count} 次`)).join("") : `<div class="empty">還沒有錯題紀錄</div>`}

      ${cats.length ? `<div class="section-title">分類進度</div>` + cats.map((c) => {
        const qs = DB.all().filter((q) => q.category === c);
        const t = qs.filter((q) => DB.prog(q.id).is_tested).length;
        return `<div class="card"><div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;margin-bottom:8px"><span>${esc(c)}</span><span style="color:var(--muted)">${t}/${qs.length}</span></div><div class="bar"><div style="width:${(t / qs.length) * 100}%"></div></div></div>`;
      }).join("") : ""}

      <div class="section-title">資料同步</div>
      <div class="card">
        <div class="meta" style="margin-bottom:12px">題庫 ${st.total} 題${st.pending ? `・${st.pending} 筆紀錄等待上傳` : "・紀錄已同步"}<br>新匯入題目後，按下面按鈕更新手機上的題庫。</div>
        <button class="btn ghost" id="syncBtn">重新同步題庫與進度</button>
      </div>`;
    document.getElementById("syncBtn").onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = "同步中…";
      try {
        await DB.flushPending();
        const n = await DB.refreshFromSupabase();
        toast(`已同步，共 ${n} 題`);
        renderStats();
      } catch (err) {
        toast("同步失敗：" + err.message);
        e.target.disabled = false;
        e.target.textContent = "重新同步題庫與進度";
      }
    };
  }

  // ================================================================
  // 搜尋 / 收藏 / 單題
  // ================================================================
  function listCard(q, from, meta) {
    return `<div class="card card-tap" onclick="go('detail',{id:${q.id},from:'${from}'})"><div style="flex:1;min-width:0"><div style="font-size:14px">${esc(short(q.question))}</div><div class="meta">第 ${q.id} 題${meta ? "・" + meta : q.category ? "・" + esc(q.category) : ""}</div></div><div class="chev">›</div></div>`;
  }

  function renderSearch() {
    view.innerHTML = `<input type="search" id="kw" placeholder="輸入關鍵字，搜尋題目與選項" autocomplete="off"><div id="res"></div>`;
    const input = document.getElementById("kw");
    input.focus();
    input.oninput = () => {
      const kw = input.value.trim();
      const hits = DB.search(kw);
      document.getElementById("res").innerHTML = !kw ? "" : !hits.length ? `<div class="empty">找不到符合的題目</div>`
        : `<div class="meta" style="margin-bottom:10px">${hits.length} 題符合${hits.length > 50 ? "，只顯示前 50 題" : ""}</div>` + hits.slice(0, 50).map((q) => listCard(q, "search")).join("");
    };
  }

  function renderBookmarks() {
    const ids = DB.bookmarkedIds();
    view.innerHTML = ids.length ? ids.map((id) => listCard(DB.get(id), "bookmarks")).join("") : `<div class="empty">還沒有收藏的題目<br>作答時點題目旁的 ☆ 就能收藏</div>`;
  }

  function renderDetail({ id, from = "home" }) {
    const q = DB.get(id);
    if (!q) return go("home");
    const p = DB.prog(id);
    view.innerHTML = `
      <button class="exit-link" id="backBtn">‹ 返回</button>
      <div class="q-meta"><span>第 ${q.id} 題${q.category ? "・" + esc(q.category) : ""}</span><button class="star ${p.bookmarked ? "on" : ""}" id="star">${p.bookmarked ? "★" : "☆"}</button></div>
      <div class="q-text">${esc(q.question)}</div>
      <div class="options">${LETTERS.map((L) => `<div class="option ${L === q.answer ? "correct" : ""}"><span class="letter">${L}</span><span>${esc(opt(q, L))}</span></div>`).join("")}</div>
      ${q.explanation ? `<div class="explain">${esc(q.explanation)}</div>` : ""}
      <div class="meta" style="margin-top:14px">答對 ${p.correct_count} 次・答錯 ${p.wrong_count} 次</div>`;
    document.getElementById("backBtn").onclick = () => go(from);
    bindStar(id);
  }

  // ================================================================
  // 啟動
  // ================================================================
  async function boot() {
    view.innerHTML = `<div class="empty">載入題庫中…</div>`;
    try {
      const r = await DB.init();
      refreshStreak();
      go("home");
      if (!r.online) toast("離線模式：使用手機上儲存的題庫");
    } catch (e) {
      view.innerHTML = `<div class="empty">${esc(e.message)}</div><button class="btn ghost" onclick="location.reload()">重新載入</button>`;
    }
  }

  window.addEventListener("online", () => DB.flushPending());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) DB.flushPending(); });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
  }

  boot();
})();
