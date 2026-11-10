async () => {
  const r = await fetch('https://cloudapi.polymas.com/ai-biz/v1/skill/cardList', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageNum: 1, pageSize: 1 })
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) {}
  return {
    ok: r.status === 200 && !!body && body.code === 200,
    status: r.status,
    code: body ? body.code : null,
    msg: body ? (body.msg || '') : text.slice(0, 200),
    pageUrl: location.href
  };
}
