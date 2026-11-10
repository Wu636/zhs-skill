async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CFG = (() => { try { return JSON.parse(sessionStorage.getItem('__agent') || '{}'); } catch (e) { return {}; } })();
  const name = window.__agentName || CFG.name;
  const desc = window.__agentDesc || CFG.desc;
  if (!name || !desc) return { ok: false, error: 'window.__agentName / window.__agentDesc 未设置' };
  if (document.visibilityState === 'hidden') {
    return { ok: false, error: '页面不在前台（内置浏览器面板未打开）：Tiptap 不会同步内容，先打开内置浏览器面板再执行' };
  }

  const tab = [...document.querySelectorAll('.comfig-tab-item')].find(t => t.innerText.trim() === '基础配置');
  if (tab) tab.click();
  await sleep(400);

  const input = [...document.querySelectorAll('input')].find(i => i.offsetParent !== null && i.type === 'text');
  if (!input) return { ok: false, error: '找不到“批阅名称”输入框' };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, name);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);

  const ed = [...document.querySelectorAll('.tiptap')].find(e => e.offsetParent !== null);
  if (!ed) return { ok: false, error: '找不到“批阅描述”编辑器' };
  ed.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, desc);
  await sleep(800);

  const counter = document.querySelector('.editor-wrap .limit-wrap .current, .limit-wrap .current');
  const count = counter ? Number(counter.innerText) : null;
  const text = ed.innerText.trim();
  return {
    ok: input.value === name && text.length > 0,
    name: input.value,
    descCount: count,
    descChars: text.length,
    counterStale: count === 0,
    descHead: text.slice(0, 40)
  };
}
