async () => {
  const q = window.__agentQuery || {};
  if (!q.courseId || !q.folderId) return { ok: false, error: 'window.__agentQuery 未设置（需要 courseId / folderId / term）' };
  const api = 'https://cloudapi.polymas.com';
  const page = async (state, keyword) => {
    const body = {
      courseId: q.courseId,
      libraryFolderId: q.folderId,
      state,
      keyword: keyword || '',
      pageNum: 1,
      pageSize: 100,
      sTag: 'agent_mark',
      term: Number(q.term) || 20271
    };
    const r = await fetch(api + '/teacher-course/course/library/courseAgent/page', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const b = await r.json().catch(() => null);
    if (r.status !== 200 || !b || b.code !== 200) {
      return { ok: false, status: r.status, error: (b && b.msg) || '列表查询失败' };
    }
    const d = b.data || {};
    const recs = d.list || d.records || [];
    return {
      ok: true,
      total: d.total || recs.length,
      items: recs.map(x => {
        let skills = [], reqType = '';
        try {
          const c = JSON.parse(x.businessConfig || '{}');
          skills = ((c.gradingConfiguration || {}).skills) || [];
          reqType = ((c.compositionRequirement || {}).writingRequirementType) || '';
        } catch (e) {}
        return {
          instanceNid: x.instanceNid,
          name: x.instanceName,
          desc: x.desc,
          state: state === 0 ? 'building' : 'online',
          isPublish: x.isPublish,
          skillVersionIds: skills,
          requirementType: reqType
        };
      })
    };
  };

  const building = await page(0, q.keyword);
  if (!building.ok) return building;
  const online = await page(1, q.keyword);
  if (!online.ok) return online;

  const items = [...building.items, ...online.items];
  const target = (q.name || '').trim();
  return {
    ok: true,
    total: building.total + online.total,
    buildingTotal: building.total,
    onlineTotal: online.total,
    items,
    hit: target ? items.filter(x => x.name === target) : []
  };
}
