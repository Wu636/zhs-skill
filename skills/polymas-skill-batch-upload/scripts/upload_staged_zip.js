async () => {
  const input = document.getElementById('__skill_upload');
  if (!input || !input.files || !input.files.length) {
    return { ok: false, error: '没有已选择的 ZIP：先执行 upload_file' };
  }
  const file = input.files[0];
  if (!/\.zip$/i.test(file.name)) {
    return { ok: false, error: '不是 ZIP 文件：' + file.name };
  }

  const form = new FormData();
  form.append('zipFile', file, file.name);
  form.append('type', String(window.__skillType || 1));
  form.append('source', 'BUILTIN');

  if (window.__skillDryRun) {
    return {
      ok: false,
      dryRun: true,
      fileName: file.name,
      size: file.size,
      fields: { type: String(window.__skillType || 1), source: 'BUILTIN' }
    };
  }

  let response = null;
  let text = '';
  try {
    const r = await fetch('https://cloudapi.polymas.com/ai-biz/v1/skill/create/unify/agentSkill', {
      method: 'POST',
      credentials: 'include',
      body: form
    });
    text = await r.text();
    try { response = JSON.parse(text); } catch (e) {}
    if (r.status !== 200) {
      return { ok: false, httpStatus: r.status, fileName: file.name, error: text.slice(0, 300) };
    }
  } catch (e) {
    return { ok: false, fileName: file.name, error: '请求失败：' + String(e) };
  }

  const data = (response && response.data) || {};
  return {
    ok: !!response && response.code === 200 && !!data.skillNid,
    httpStatus: 200,
    fileName: file.name,
    code: response ? response.code : null,
    msg: response ? (response.msg || '') : text.slice(0, 300),
    skillNid: data.skillNid || null,
    skillVersionId: data.skillVersionId || null,
    name: data.name || data.skillName || null
  };
}
