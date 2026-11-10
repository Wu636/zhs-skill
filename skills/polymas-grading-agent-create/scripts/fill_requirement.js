async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CFG = (() => { try { return JSON.parse(sessionStorage.getItem('__agent') || '{}'); } catch (e) { return {}; } })();
  const text = window.__agentRequirement || CFG.requirement;
  if (!text) return { ok: false, error: 'window.__agentRequirement 未设置' };
  if (document.visibilityState === 'hidden') {
    return { ok: false, error: '页面不在前台（内置浏览器面板未打开）：Tiptap 不会同步内容，先打开内置浏览器面板再执行' };
  }

  const tab = [...document.querySelectorAll('.comfig-tab-item')].find(t => t.innerText.trim() === '全局信息');
  if (!tab) return { ok: false, error: '找不到“全局信息”页签' };
  tab.click();
  await sleep(500);

  const fixed = [...document.querySelectorAll('.select-item')].find(e => e.innerText.trim() === '手动填写固定要求');
  if (!fixed) return { ok: false, error: '找不到“手动填写固定要求”' };
  if (!fixed.className.includes('primary')) {
    fixed.click();
    await sleep(400);
  }

  const ed = [...document.querySelectorAll('.tiptap')].find(e => e.offsetParent !== null);
  if (!ed) return { ok: false, error: '找不到“作业要求”编辑器' };
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);
  await sleep(800);

  const limits = [...document.querySelectorAll('.limit-wrap')].map(l => l.innerText.trim());
  const m = (limits.join(' ').match(/(\d+)\s*\/\s*5000/) || [])[1];
  const count = m ? Number(m) : null;
  const written = ed.innerText.trim();
  return {
    ok: written.length > 0,
    count,
    chars: written.length,
    counterStale: count === 0,
    textHead: written.slice(0, 40)
  };
}
