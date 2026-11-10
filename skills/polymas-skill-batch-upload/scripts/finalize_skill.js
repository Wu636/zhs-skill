async () => {
  const nid = window.__skillNid;
  const vid = window.__skillVersionId;
  if (!nid) return { ok: false, error: 'window.__skillNid 未设置' };
  if (!vid) return { ok: false, error: 'window.__skillVersionId 未设置' };

  const api = 'https://cloudapi.polymas.com';
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const uRes = await fetch(api + '/console/v1/get-current-user-detail', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const uBody = await uRes.json().catch(() => null);
  if (uRes.status !== 200 || !uBody || uBody.code !== 200 || !uBody.data) {
    return { ok: false, step: 'currentUser', status: uRes.status, error: (uBody && uBody.msg) || '获取当前用户失败' };
  }
  const user = uBody.data;
  const userName = user.nickName || user.userName || user.realName || '';

  // 上传接口只落了一个未保存的草稿；不先保存，定稿会返回 10006。
  const sRes = await fetch(api + '/ai-biz/v1/skill/draft/save', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skillNid: nid, skillVersionId: vid, userName, fileTree: '' })
  });
  const sBody = await sRes.json().catch(() => null);
  if (sRes.status !== 200 || !sBody || sBody.code !== 200) {
    return { ok: false, step: 'draftSave', status: sRes.status, error: (sBody && sBody.msg) || '保存草稿失败' };
  }

  const vRes = await fetch(api + '/ai-biz/v1/skill/publishVersionNo/' + encodeURIComponent(nid), {
    credentials: 'include'
  });
  const vBody = await vRes.json().catch(() => null);
  if (vRes.status !== 200 || !vBody || vBody.code !== 200) {
    return { ok: false, step: 'publishVersionNo', status: vRes.status, error: (vBody && vBody.msg) || '获取发布版本号失败' };
  }
  const publishVersion = String(vBody.data || '').replace(/^V/i, '');
  if (!publishVersion) return { ok: false, step: 'publishVersionNo', error: '发布版本号为空', raw: vBody.data };

  const versionDesc = window.__versionDesc || ('首次定稿：生成 ' + publishVersion + ' 版本');
  const payload = {
    userId: user.userNid,
    userName,
    skillVersionId: vid,
    skillNid: nid,
    publishVersion,
    versionDesc
  };
  if (window.__skillDryRun) return { ok: false, dryRun: true, payload };

  // 保存后后台还要落库，立即发布会拿到 10006，需要重试几次。
  let last = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const pRes = await fetch(api + '/ai-biz/v1/skill/publish', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const pBody = await pRes.json().catch(() => null);
    if (pRes.status === 200 && pBody && pBody.code === 200) {
      return { ok: true, attempts: attempt, skillNid: nid, skillVersionId: vid, publishVersion, versionDesc, userName };
    }
    last = {
      status: pRes.status,
      code: pBody && pBody.code,
      error: (pBody && (pBody.msg || pBody.message)) || '定稿失败'
    };
    if (!pBody || pBody.code !== 10006) break;
    await sleep(3000);
  }
  return { ok: false, step: 'publish', ...last, payload };
}
