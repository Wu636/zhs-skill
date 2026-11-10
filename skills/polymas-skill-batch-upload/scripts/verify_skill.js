async () => {
  const name = window.__skillName;
  if (!name) return { ok: false, error: 'window.__skillName 未设置' };
  const type = Number(window.__skillType || 1);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let last = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = await fetch('https://cloudapi.polymas.com/ai-biz/v1/skill/cardList', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNum: 1, pageSize: 50, queryWord: name })
    });
    const body = await r.json().catch(() => null);
    if (r.status !== 200 || !body || body.code !== 200) {
      last = { ok: false, status: r.status, error: (body && body.msg) || '列表查询失败' };
      break;
    }
    const hit = (((body.data || {}).records) || [])
      .filter(x => x.name === name && Number(x.skillType) === type)
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (hit) {
      return {
        ok: true,
        found: true,
        attempts: attempt + 1,
        skillNid: hit.skillNid,
        name: hit.name,
        skillType: hit.skillType,
        status: hit.versionStatusDesc || hit.version || '',
        taskId: hit.taskId || null,
        failReason: hit.failReason || ''
      };
    }
    last = { ok: true, found: false, attempts: attempt + 1 };
    await sleep(1200);
  }
  return last;
}
