async () => {
  // 查技能库：技能名(slug) → skillVersionId。绑定时用的是 skillVersionId
  const C = window.__apiCtx;
  if (!C) return { ok: false, error: '先跑 api_ctx.js' };
  const r = await fetch(`${C.api}/agents/v1/custom/grading/skill/pageList?courseId=${C.courseId}&term=${C.term}&pageNum=1&pageSize=100`, { credentials: 'include' });
  const j = await r.json();
  if (j.code !== 200) return { ok: false, code: j.code, msg: j.msg };

  const d = j.data || {};
  const list = d.records || d.list || [];
  const map = {};
  for (const x of list) map[x.name] = { skillNid: x.skillNid, skillVersionId: x.skillVersionId, cnName: x.cnName, inCourse: x.inCourse };
  window.__skillMap = map;

  return {
    ok: true,
    total: d.total || list.length,
    missing: (window.__agentItems || []).map(i => i.skillName).filter(n => n && !map[n]),
    map
  };
}
