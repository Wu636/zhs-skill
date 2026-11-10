async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 24; i++) {
    const q = new URLSearchParams(location.search);
    const onCreate = /skill-grading\/create/.test(location.pathname);
    if (onCreate && q.get('instanceNid') && q.get('isCreate') === '0') {
      const hasName = [...document.querySelectorAll('input')].some(x => x.offsetParent !== null && x.type === 'text');
      if (hasName) return { ok: true, instanceNid: q.get('instanceNid'), url: location.href };
    }
    await sleep(500);
  }
  return { ok: false, url: location.href, error: '等待创建页完成实例初始化超时（12s）' };
}
