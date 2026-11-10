async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const CFG = (() => { try { return JSON.parse(sessionStorage.getItem('__agent') || '{}'); } catch (e) { return {}; } })();
  const skillName = window.__agentSkillName || CFG.skillName;
  if (!skillName) return { ok: false, error: 'window.__agentSkillName 未设置' };

  const tab = [...document.querySelectorAll('.comfig-tab-item')].find(t => t.innerText.trim() === '批阅配置');
  if (!tab) return { ok: false, error: '找不到“批阅配置”页签' };
  tab.click();
  await sleep(500);

  const add = document.querySelector('.add-skill-btn');
  if (!add) return { ok: false, error: '找不到“添加技能”' };
  add.click();

  let dlg = null;
  for (let i = 0; i < 15; i++) {
    await sleep(300);
    dlg = [...document.querySelectorAll('.el-dialog')].filter(x => x.offsetParent !== null).pop();
    if (dlg && dlg.querySelector('.skill-option-card')) break;
  }
  if (!dlg || !dlg.querySelector('.skill-option-card')) return { ok: false, error: '技能选择弹窗没有出现或列表为空' };

  const pick = () => [...dlg.querySelectorAll('.skill-option-card')]
    .find(c => ((c.querySelector('.skill-name') || {}).innerText || '').trim() === skillName);

  let card = pick();
  if (!card) {
    const search = [...dlg.querySelectorAll('input')].find(i => i.placeholder === '请输入关键词');
    if (search) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(search, skillName);
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1500);
      card = pick();
    }
  }
  if (!card) {
    return {
      ok: false,
      error: '弹窗里没有技能：' + skillName,
      available: [...dlg.querySelectorAll('.skill-name')].map(n => n.innerText.trim())
    };
  }

  const box = card.querySelector('input[type=checkbox]');
  if (box && !box.checked) {
    const label = card.querySelector('.el-checkbox');
    (label || card).click();
    await sleep(500);
  }

  const confirm = [...dlg.querySelectorAll('button')].find(b => b.innerText.trim() === '确定');
  if (!confirm || confirm.disabled) return { ok: false, error: '“确定”按钮不可用（勾选没生效？）' };
  confirm.click();
  await sleep(900);

  const added = [...document.querySelectorAll('.skill-module-card .name')].map(n => n.innerText.trim());
  return { ok: added.includes(skillName), cards: added };
}
