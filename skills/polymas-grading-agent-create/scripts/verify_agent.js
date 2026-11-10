async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CFG = (() => { try { return JSON.parse(sessionStorage.getItem('__agent') || '{}'); } catch (e) { return {}; } })();
  const name = window.__agentName || CFG.name;
  const desc = window.__agentDesc || CFG.desc;
  const req = window.__agentRequirement || CFG.requirement;
  if (!name || !desc) return { ok: false, error: 'window.__agentName / window.__agentDesc 未设置' };

  // 编辑器把 **粗体**、- 列表、1. 有序列表渲染成富文本，innerText 里没有这些标记
  const norm = s => (s || '').replace(/[\s*•\-]/g, '').replace(/\d+\./g, '').trim();
  const readEditor = () => {
    const ed = [...document.querySelectorAll('.tiptap')].find(e => e.offsetParent !== null);
    return ed ? ed.innerText.trim() : '';
  };
  const goTab = async label => {
    const t = [...document.querySelectorAll('.comfig-tab-item')].find(x => x.innerText.trim() === label);
    if (t) t.click();
    await sleep(600);
  };

  await goTab('基础配置');
  const input = [...document.querySelectorAll('input')].find(i => i.offsetParent !== null && i.type === 'text');
  const nameOk = !!input && input.value.trim() === name.trim();
  const descText = readEditor();

  let reqText = null;
  if (req) {
    await goTab('全局信息');
    reqText = readEditor();
  }

  const same = (a, b) => norm(a) === norm(b);
  return {
    ok: nameOk && same(descText, desc) && (reqText === null || same(reqText, req)),
    name: input ? input.value : null,
    nameOk,
    descChars: descText.length,
    descOk: same(descText, desc),
    descHead: descText.slice(0, 30),
    reqChars: reqText === null ? null : reqText.length,
    reqOk: reqText === null ? null : same(reqText, req),
    reqHead: reqText === null ? null : reqText.slice(0, 30)
  };
}
