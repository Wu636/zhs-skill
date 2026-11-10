async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const findCreate = () => [...document.querySelectorAll('.search-section .base-button-component')]
    .find(e => (e.textContent || '').trim() === '创建批阅智能体');

  let btn = findCreate();
  if (!btn) {
    const tab = [...document.querySelectorAll('*')]
      .find(e => e.children.length === 0 && (e.textContent || '').trim() === '批阅智能体');
    if (tab) {
      tab.click();
      for (let i = 0; i < 10; i++) {
        await sleep(300);
        btn = findCreate();
        if (btn) break;
      }
    }
  }
  if (!btn) {
    const candidates = [...document.querySelectorAll('.search-section .base-button-component')]
      .map(e => (e.textContent || '').trim());
    return { ok: false, error: '没找到“创建批阅智能体”入口：先切到“批阅智能体”页签', candidates };
  }
  btn.click();

  let titles = [];
  for (let i = 0; i < 15; i++) {
    await sleep(200);
    titles = [...document.querySelectorAll('.el-dialog .content-item .title')].map(t => (t.textContent || '').trim());
    if (titles.length) break;
  }
  return { ok: titles.includes('自定义批阅'), titles };
}
