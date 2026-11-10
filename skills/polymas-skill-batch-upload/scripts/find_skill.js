async () => {
  const name = window.__skillName;
  if (!name) return { ok: false, error: 'window.__skillName 未设置' };
  const type = Number(window.__skillType || 1);

  const r = await fetch('https://cloudapi.polymas.com/ai-biz/v1/skill/cardList', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageNum: 1, pageSize: 50, queryWord: name })
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  if (r.status !== 200 || !body || body.code !== 200) {
    return { ok: false, status: r.status, error: body ? body.msg : text.slice(0, 200) };
  }

  const records = ((body.data || {}).records) || [];
  const sameName = records.filter(x => x.name === name);
  const sameType = sameName.filter(x => Number(x.skillType) === type);
  return {
    ok: true,
    name: name,
    type: type,
    exists: sameType.length > 0,
    matches: sameType.map(x => ({
      skillNid: x.skillNid,
      name: x.name,
      skillType: x.skillType,
      status: x.versionStatusDesc || x.version || '',
      failReason: x.failReason || ''
    })),
    otherTypes: sameName
      .filter(x => Number(x.skillType) !== type)
      .map(x => ({ skillNid: x.skillNid, skillType: x.skillType }))
  };
}
