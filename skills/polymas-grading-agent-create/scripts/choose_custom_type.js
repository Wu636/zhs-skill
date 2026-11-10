async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const card = [...document.querySelectorAll('.el-dialog .content-item')]
    .find(c => ((c.querySelector('.title') || {}).innerText || '').trim() === '自定义批阅');
  if (!card) {
    const titles = [...document.querySelectorAll('.el-dialog .content-item .title')].map(t => t.innerText.trim());
    return { ok: false, error: '对话框里没有“自定义批阅”卡片', titles };
  }
  card.click();
  await sleep(500);
  return { ok: true, url: location.href };
}
