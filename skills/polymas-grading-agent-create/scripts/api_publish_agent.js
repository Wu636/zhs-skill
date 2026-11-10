async () => {
  // 上线：window.__publishList = [{ name, instanceNid }]，逐条 publish，返回每条结果
  const C = window.__apiCtx;
  const list = window.__publishList || [];
  if (!C) return { ok: false, error: '先跑 api_ctx.js' };
  if (!list.length) return { ok: false, error: 'window.__publishList 为空' };

  const post = async (path, body) => {
    const r = await fetch(C.api + path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { status: r.status, code: j && j.code, msg: j && j.msg, data: j && j.data };
  };

  const results = [];
  for (const it of list) {
    const r = await post('/basic-course/courseAgent/publish', {
      courseAgentId: it.instanceNid, courseId: C.courseId, agentInstanceId: it.instanceNid,
      libraryFolderId: C.folderId, isPublish: 1,
      businessType: 'course', businessId: C.courseId, agentType: 'agent_mark', term: C.term
    });
    results.push({ name: it.name, instanceNid: it.instanceNid, ok: r.code === 200 && r.data === true, code: r.code, msg: r.msg });
  }
  return { ok: results.every(x => x.ok), results };
}
