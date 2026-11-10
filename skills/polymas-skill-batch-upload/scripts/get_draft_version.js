async () => {
  const nid = window.__skillNid;
  if (!nid) return { ok: false, error: 'window.__skillNid 未设置' };
  const r = await fetch('https://cloudapi.polymas.com/ai-biz/v1/skill/' + encodeURIComponent(nid), {
    credentials: 'include'
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 200 || !body || body.code !== 200) {
    return { ok: false, status: r.status, error: (body && body.msg) || '技能详情查询失败' };
  }
  const list = Array.isArray(body.data) ? body.data : [body.data].filter(Boolean);
  if (!list.length) return { ok: false, error: '技能详情为空' };
  const draft = list.find(x => x && (x.version === '草稿' || Number(x.versionStatus) === 0));
  const current = draft || list[0];
  if (!current || !current.skillVersionId) {
    return { ok: false, error: '未取到 skillVersionId', versions: list.map(x => x.version) };
  }
  return {
    ok: true,
    isDraft: !!draft,
    skillNid: nid,
    skillVersionId: current.skillVersionId,
    fileId: current.fileId || current.skillVersionId,
    version: current.version || '',
    versionStatus: current.versionStatus,
    bindCourseCnt: current.bindCourseCnt || 0,
    versions: list.map(x => x.version)
  };
}
