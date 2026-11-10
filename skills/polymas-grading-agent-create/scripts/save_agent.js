async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = document.querySelector('.save-btn');
  if (!btn) return { ok: false, error: '找不到“保存”按钮' };
  btn.click();

  let message = '';
  for (let i = 0; i < 28; i++) {
    await sleep(400);
    const msgs = [...document.querySelectorAll('.el-message__content')].map(m => m.innerText.trim()).filter(Boolean);
    if (msgs.length) message = msgs.join(' ');
    if (/保存成功|失败|错误|必填|请/.test(message)) break;
  }

  const online = [...document.querySelectorAll('button')].find(b => b.innerText.includes('上线'));
  return {
    ok: /保存成功/.test(message) || (message === '' && !!online && !online.disabled),
    message,
    onlineEnabled: online ? !online.disabled : null,
    url: location.href
  };
}
