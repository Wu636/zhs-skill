async () => {
  // 回查：按名称比对名称/描述/要求/技能/上线状态；window.__agentQuery = {names:[...]} 可选
  const C = window.__apiCtx;
  if (!C) return { ok: false, error: '先跑 api_ctx.js' };
  const q = window.__agentQuery || {};

  const page = async (state) => {
    const r = await fetch(C.api + '/teacher-course/course/library/courseAgent/page', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: C.courseId, libraryFolderId: C.folderId, state, keyword: q.keyword || '',
        pageNum: 1, pageSize: 100, sTag: 'agent_mark', term: C.term
      })
    });
    const j = await r.json();
    const d = j.data || {};
    return { total: d.total || 0, list: d.list || d.records || [] };
  };

  const norm = s => (s || '').replace(/\s+/g, '');
  const shape = (x, state) => {
    let c = {};
    try { c = JSON.parse(x.businessConfig || '{}'); } catch (e) {}
    return {
      instanceNid: x.instanceNid,
      name: x.instanceName,
      state,
      isPublish: x.isPublish,
      descChars: (x.desc || '').length,
      descOk: norm(x.desc),
      reqChars: ((c.compositionRequirement || {}).writingRequirement || '').length,
      reqOk: norm((c.compositionRequirement || {}).writingRequirement),
      requirementType: (c.compositionRequirement || {}).writingRequirementType || '',
      skills: (c.gradingConfiguration || {}).skills || [],
      fullMark: (c.gradingConfiguration || {}).fullMark || null
    };
  };

  const b = await page(0);
  const o = await page(1);
  const items = [...b.list.map(x => shape(x, 'building')), ...o.list.map(x => shape(x, 'online'))];

  const names = q.names || (window.__agentItems || []).map(i => i.name);
  const check = names.filter(Boolean).map(n => {
    const hit = items.find(x => x.name === n);
    if (!hit) return { name: n, found: false };
    return { name: n, found: true, instanceNid: hit.instanceNid, state: hit.state, isPublish: hit.isPublish, skills: hit.skills, requirementType: hit.requirementType, descChars: hit.descChars, reqChars: hit.reqChars };
  });

  return {
    ok: check.every(x => x.found),
    buildingTotal: b.total,
    onlineTotal: o.total,
    check,
    onlineNames: o.list.map(x => x.instanceName),
    buildingNames: b.list.map(x => x.instanceName),
    raw: items
  };
}
