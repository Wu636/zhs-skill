async () => {
  const nid = window.__skillNid;
  const vid = window.__skillVersionId;
  const courseId = window.__courseId;
  const folderId = window.__courseFolderId;
  if (!nid) return { ok: false, error: 'window.__skillNid 未设置' };
  if (!vid) return { ok: false, error: 'window.__skillVersionId 未设置' };
  if (!courseId || !folderId) return { ok: false, error: 'window.__courseId / window.__courseFolderId 未设置' };

  const api = 'https://cloudapi.polymas.com';
  const payload = {
    resourceItems: [{ folderId, courseId }],
    skillVersions: [{ skillNid: nid, fileId: vid }]
  };
  if (window.__skillDryRun) return { ok: false, dryRun: true, payload };

  const bRes = await fetch(api + '/course-deliver/course-skill/batchBindSkill', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const bBody = await bRes.json().catch(() => null);
  if (bRes.status !== 200 || !bBody || bBody.code !== 200) {
    return {
      ok: false,
      step: 'batchBindSkill',
      status: bRes.status,
      code: bBody && bBody.code,
      error: (bBody && (bBody.msg || bBody.message)) || '发布到课程失败',
      payload
    };
  }

  const cRes = await fetch(
    api + '/ai-biz/v1/skill/version/checkBindCoursesByNid?skillNid=' + encodeURIComponent(nid),
    { credentials: 'include' }
  );
  const cBody = await cRes.json().catch(() => null);
  const boundCount = cBody && cBody.code === 200 ? Number(cBody.data || 0) : null;

  return {
    ok: true,
    skillNid: nid,
    skillVersionId: vid,
    courseId,
    folderId,
    boundCount,
    verified: boundCount !== null && boundCount > 0
  };
}
