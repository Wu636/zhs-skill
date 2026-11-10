async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes('上线'));
  if (!btn) return { ok: false, error: '找不到“上线”按钮' };
  if (btn.disabled) return { ok: false, error: '“上线”按钮不可用：先保存并让校验通过' };
  btn.click();

  let message = '';
  for (let i = 0; i < 28; i++) {
    await sleep(400);
    const msgs = [...document.querySelectorAll('.el-message__content')].map(m => m.innerText.trim()).filter(Boolean);
    if (msgs.length) message = msgs.join(' ');
    if (/上线成功|失败|错误|请补|至少/.test(message)) break;
  }

  const after = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes('上线'));
  return { ok: /上线成功/.test(message), message, buttonDisabled: after ? after.disabled : null };
}
