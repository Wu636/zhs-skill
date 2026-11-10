async () => {
  // 建立接口上下文：课程/库/模板 Agent 参数 + 可复用的模型、全局指令、头像
  // 只在页面里跑，fetch 带 credentials:'include'，不碰 Cookie / localStorage / Authorization
  const API = 'https://cloudapi.polymas.com';
  const segs = location.pathname.split('/').filter(Boolean);
  const q = new URLSearchParams(location.search);

  let courseId = null, folderId = null;
  const hubIdx = segs.indexOf('resource-hub');
  if (hubIdx >= 0) courseId = segs[hubIdx + 1];
  if (!courseId) {
    const fullIdx = segs.indexOf('agent-course-full');
    if (fullIdx >= 0) courseId = segs[fullIdx + 1];
  }
  const libIdx = segs.indexOf('agent-course-library');
  if (libIdx >= 0) folderId = segs[libIdx + 1];
  if (!folderId) folderId = q.get('libraryId');

  const agentId = q.get('agentId');
  // term 不一定在 URL 里（创建页就没有）。先看 __agentQuery，再从页面已发生的请求 URL 里找
  const termFromQuery = Number(q.get('term')) || Number((window.__agentQuery || {}).term) || null;

  if (window.__agentQuery) {
    courseId = window.__agentQuery.courseId || courseId;
    folderId = window.__agentQuery.folderId || folderId;
  }

  let term = termFromQuery;
  if (!term) {
    for (const e of performance.getEntriesByType('resource')) {
      const m = /[?&]term=(\d{4,6})/.exec(e.name);
      if (m) { term = Number(m[1]); break; }
    }
  }
  if (!term) {
    return { ok: false, error: 'term 缺失：请教师打开带 ?term= 的资源库列表页，或先设 window.__agentQuery = { courseId, folderId, term }' };
  }

  const u = (window.__MAIN_APP_USER_DATA__ || {}).polyUserInfo || {};
  const userId = u.userNid;
  const schoolId = (u.schoolInfo || {}).schoolId;

  if (!courseId || !folderId) return { ok: false, error: 'URL 里读不到 courseId / folderId', segs, query: Object.fromEntries(q) };
  if (!userId || !schoolId) return { ok: false, error: '页面未登录或读不到 polyUserInfo（userNid / schoolId）' };

  const post = async (path, body) => {
    const r = await fetch(API + path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { status: r.status, code: j && j.code, msg: j && j.msg, data: j && j.data };
  };

  const page = async (state) => {
    const j = await post('/teacher-course/course/library/courseAgent/page', {
      courseId, libraryFolderId: folderId, state, keyword: '', pageNum: 1, pageSize: 100,
      sTag: 'agent_mark', term
    });
    const d = j.data || {};
    return { ok: j.code === 200, total: d.total || 0, list: d.list || d.records || [], msg: j.msg };
  };

  const online = await page(1);
  if (!online.ok) return { ok: false, error: '已上线列表查询失败', msg: online.msg };

  // 模板：任取一条已保存且带 businessConfig 的智能体，复用其模型、全局指令、头像
  const tpl = online.list.find(x => {
    try { const c = JSON.parse(x.businessConfig || '{}'); return !!(c.globalConfiguration || {}).globalInstruction; } catch (e) { return false; }
  });
  if (!tpl) return { ok: false, error: '课程里没有可作模板的已上线智能体（拿不到 globalInstruction）' };

  const ctx = {
    api: API, courseId, folderId, agentId, term, userId, schoolId,
    avatar: tpl.avatar,
    model: JSON.parse(tpl.businessConfig).globalConfiguration.selectedModel,
    globalInstruction: JSON.parse(tpl.businessConfig).globalConfiguration.globalInstruction,
    templateName: tpl.instanceName
  };
  window.__apiCtx = ctx;
  return { ok: true, ...ctx, globalInstruction: ctx.globalInstruction.slice(0, 40) + '…' };
}
