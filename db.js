// ================================================================
// db.js — 資料層：Supabase 連線、題庫快取、作答進度（含離線佇列）
// ================================================================
(function () {
  const LS_QUESTIONS = "osh_questions_v1";
  const LS_PROGRESS = "osh_progress_v1";
  const LS_PENDING = "osh_pending_v1";
  const LS_STREAK = "osh_streak_v1";
  const LS_SEQ = "osh_seq_pointer_v1";
  const LS_MOLE_BEST = "osh_mole_best_v1";

  let client = null;
  let questions = [];
  let byId = new Map();
  let progress = new Map();
  let flushing = false;

  const lsGet = (k, fallback) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  };
  const lsSet = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  };

  function isConfigured() {
    const c = window.SUPABASE_CONFIG;
    return !!(c && c.url && c.anonKey && !c.url.includes("YOUR-PROJECT") && !c.anonKey.includes("YOUR-ANON"));
  }

  function getClient() {
    if (!client) client = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return client;
  }

  function index() {
    byId = new Map(questions.map((q) => [q.id, q]));
  }

  // Supabase 單次最多回 1000 筆，用 range 分頁讀完
  async function fetchAll(table, orderCol) {
    const PAGE = 1000;
    const all = [];
    for (let from = 0, guard = 0; guard < 100; from += PAGE, guard++) { // guard：避免伺服器異常時無限迴圈
      const { data, error } = await getClient()
        .from(table)
        .select("*")
        .order(orderCol)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < PAGE) break;
    }
    return all;
  }

  async function refreshFromSupabase() {
    const q = await fetchAll("questions", "id");
    if (q.length === 0) throw new Error("Supabase 的 questions 表是空的，請先執行匯入腳本。");
    questions = q;
    index();
    lsSet(LS_QUESTIONS, questions);

    // 伺服器進度為準，但保留尚未送出的本機變動（pending 會在 flush 時覆蓋回去）
    const p = await fetchAll("user_progress", "question_id");
    progress = new Map(p.map((r) => [r.question_id, r]));
    savePending_applyToProgress();
    saveProgress();
    return questions.length;
  }

  function saveProgress() {
    lsSet(LS_PROGRESS, Object.fromEntries(progress));
  }

  // 把還沒送出的離線變動疊回 progress，避免重新整理後畫面倒退
  function savePending_applyToProgress() {
    for (const item of lsGet(LS_PENDING, [])) {
      const prev = progress.get(item.question_id) || blank(item.question_id);
      progress.set(item.question_id, { ...prev, ...item.patch });
    }
  }

  function blank(id) {
    return {
      question_id: id,
      wrong_count: 0,
      correct_count: 0,
      is_tested: false,
      last_result: null,
      last_practiced_at: null,
      bookmarked: false,
    };
  }

  async function init() {
    const cachedQ = lsGet(LS_QUESTIONS, null);
    if (cachedQ && cachedQ.length) {
      questions = cachedQ;
      index();
    }
    const cachedP = lsGet(LS_PROGRESS, {});
    progress = new Map(Object.entries(cachedP).map(([k, v]) => [Number(k), v]));

    let online = false;
    let error = null;
    if (isConfigured() && navigator.onLine) {
      try {
        await refreshFromSupabase();
        online = true;
      } catch (e) {
        error = e;
        console.warn("Supabase 連線失敗", e);
      }
    }
    if (!questions.length) {
      if (!isConfigured()) throw new Error("尚未設定 Supabase：請編輯 config.js，填入 url 與 anon key。");
      throw new Error("讀不到題庫：" + (error ? error.message : "沒有網路連線，第一次使用需要連網。"));
    }
    flushPending();
    return { online, count: questions.length };
  }

  // ---------------- 查詢 ----------------
  const all = () => questions;
  const get = (id) => byId.get(id);
  const prog = (id) => progress.get(id) || blank(id);
  const categories = () => [...new Set(questions.map((q) => q.category).filter(Boolean))];
  const untestedIds = () => questions.filter((q) => !prog(q.id).is_tested).map((q) => q.id);
  const wrongIds = () =>
    questions
      .filter((q) => prog(q.id).wrong_count > 0)
      .sort((a, b) => prog(b.id).wrong_count - prog(a.id).wrong_count)
      .map((q) => q.id);
  const bookmarkedIds = () => questions.filter((q) => prog(q.id).bookmarked).map((q) => q.id);

  function search(kw) {
    kw = kw.trim();
    if (!kw) return [];
    return questions.filter((q) =>
      [q.question, q.option_a, q.option_b, q.option_c, q.option_d].some((t) => t && t.includes(kw))
    );
  }

  // ---------------- 寫入（樂觀更新 + 離線佇列） ----------------
  function recordAnswer(id, isCorrect) {
    const prev = prog(id);
    const patch = {
      wrong_count: prev.wrong_count + (isCorrect ? 0 : 1),
      correct_count: prev.correct_count + (isCorrect ? 1 : 0),
      is_tested: true,
      last_result: isCorrect ? "correct" : "wrong",
      last_practiced_at: new Date().toISOString(),
    };
    progress.set(id, { ...prev, ...patch });
    saveProgress();
    enqueue(id, patch);
    bumpStreak();
  }

  function toggleBookmark(id) {
    const patch = { bookmarked: !prog(id).bookmarked };
    progress.set(id, { ...prog(id), ...patch });
    saveProgress();
    enqueue(id, patch);
    return patch.bookmarked;
  }

  function enqueue(id, patch) {
    const pending = lsGet(LS_PENDING, []);
    pending.push({ question_id: id, patch });
    lsSet(LS_PENDING, pending);
    flushPending();
  }

  async function flushPending() {
    if (flushing || !isConfigured() || !navigator.onLine) return;
    flushing = true;
    try {
      // 同一題的多筆變動合併成最終狀態再送出，減少請求數
      const pending = lsGet(LS_PENDING, []);
      if (!pending.length) return;
      const merged = new Map();
      for (const it of pending) merged.set(it.question_id, { ...(merged.get(it.question_id) || {}), ...it.patch });
      const rows = [...merged].map(([question_id, patch]) => {
        const cur = prog(question_id);
        // 計數類欄位直接送「目前總值」，這樣即使中途失敗重送也不會重複累加
        return {
          question_id,
          wrong_count: cur.wrong_count,
          correct_count: cur.correct_count,
          is_tested: cur.is_tested,
          last_result: cur.last_result,
          last_practiced_at: cur.last_practiced_at,
          bookmarked: cur.bookmarked,
        };
      });
      const { error } = await getClient().from("user_progress").upsert(rows, { onConflict: "question_id" });
      if (!error) {
        // 只清掉這次送出的那幾筆；送出期間新增的留著
        const sent = pending.length;
        lsSet(LS_PENDING, lsGet(LS_PENDING, []).slice(sent));
      }
    } catch (e) {
      console.warn("同步失敗，稍後重試", e);
    } finally {
      flushing = false;
    }
  }

  // ---------------- 統計 ----------------
  function stats() {
    let tested = 0, correct = 0, wrong = 0;
    for (const q of questions) {
      const p = prog(q.id);
      if (p.is_tested) tested++;
      correct += p.correct_count;
      wrong += p.wrong_count;
    }
    const attempts = correct + wrong;
    return {
      total: questions.length,
      tested,
      accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
      pending: lsGet(LS_PENDING, []).length,
    };
  }

  const topWrong = (n = 10) => wrongIds().slice(0, n).map((id) => ({ q: get(id), p: prog(id) }));

  // ---------------- 連續天數（用本地日期，台灣時區不會跨日算錯） ----------------
  function dateStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function bumpStreak() {
    const s = lsGet(LS_STREAK, { lastDate: null, count: 0 });
    const today = dateStr();
    if (s.lastDate === today) return;
    s.count = s.lastDate === dateStr(-1) ? s.count + 1 : 1;
    s.lastDate = today;
    lsSet(LS_STREAK, s);
  }

  function streak() {
    const s = lsGet(LS_STREAK, { lastDate: null, count: 0 });
    return s.lastDate === dateStr() || s.lastDate === dateStr(-1) ? s.count : 0;
  }

  // ---------------- 其他 ----------------
  const seqPointer = () => lsGet(LS_SEQ, 0);
  const setSeqPointer = (n) => lsSet(LS_SEQ, n);
  const moleBest = () => lsGet(LS_MOLE_BEST, 0);
  const setMoleBest = (n) => lsSet(LS_MOLE_BEST, n);

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const pickRandom = (ids, n) => shuffle(ids).slice(0, n);

  // 錯越多次越容易被抽到（權重 = 1 + 錯誤次數×3），且不重複
  function pickWeightedByWrong(n) {
    const wrong = wrongIds();
    if (!wrong.length) return [];
    const pool = [];
    for (const q of questions) {
      const w = 1 + prog(q.id).wrong_count * 3;
      for (let i = 0; i < w; i++) pool.push(q.id);
    }
    // 只從「有錯過」的題目抽，不夠 n 題就用全部錯題
    const wrongSet = new Set(wrong);
    const picked = [];
    for (const id of shuffle(pool.filter((id) => wrongSet.has(id)))) {
      if (!picked.includes(id)) picked.push(id);
      if (picked.length >= n) break;
    }
    return picked;
  }

  window.DB = {
    init, isConfigured, refreshFromSupabase, flushPending,
    all, get, prog, categories, untestedIds, wrongIds, bookmarkedIds, search,
    recordAnswer, toggleBookmark, stats, topWrong, streak,
    seqPointer, setSeqPointer, moleBest, setMoleBest,
    shuffle, pickRandom, pickWeightedByWrong,
  };
})();
