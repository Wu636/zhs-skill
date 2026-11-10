import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('./api_create_agents.js', import.meta.url), 'utf8');
const pollCode = readFileSync(new URL('./api_poll_create_agents.js', import.meta.url), 'utf8');
const delay = ms => new Promise(r => setTimeout(r, ms));
function setup(n = 7, handler) {
  let active = 0, peak = 0, serial = 0;
  const calls = [];
  const window = { __apiCtx: { api: 'https://mock.invalid', courseId: 'course', agentId: 'template', userId: 'u', schoolId: 's', term: '1', model: 'snapshot-model', globalInstruction: 'g', avatar: 'a', folderId: 'f' },
    __agentItems: Array.from({ length: n }, (_, i) => ({ name: `name-${i}`, desc: 'description', requirement: 'requirement', skillName: 'skill' })), __skillMap: { skill: { skillVersionId: 'version-1' } } };
  const context = vm.createContext({ window, setTimeout, clearTimeout, AbortController, fetch: async (url, opts) => {
    const endpoint = new URL(url).pathname, body = JSON.parse(opts.body);
    calls.push({ endpoint, body }); active++; peak = Math.max(peak, active);
    try {
      await delay(3);
      const override = await handler?.(endpoint, body);
      if (override) return override;
      return { status: 200, json: async () => ({ code: 200, data: endpoint.endsWith('/create/agent') ? `nid-${++serial}` : 'v1' }) };
    } finally { active--; }
  } });
  return { window, calls, start: vm.runInContext(`(${code})`, context), poll: vm.runInContext(`(${pollCode})`, context), peak: () => peak };
}
{
  const t = setup(); const result = await t.start();
  assert.equal(result.ok, true); assert.equal(t.peak(), 3); assert.equal(t.calls.length, 28);
  for (const r of result.results) {
    const steps = t.calls.filter(c => c.body.instanceName === r.name || c.body.agentInstanceId === r.instanceNid || c.body.agentInstanceNid === r.instanceNid).map(c => c.endpoint);
    assert.deepEqual(steps, ['/agents/v1/create/agent', '/basic-course/courseAgent/createRef', '/agents/v1/update/agent', '/basic-course/courseAgent/updateRef']);
  }
  await t.start(); assert.equal(t.calls.length, 28, 'completed same-name rerun must not write');
}
{
  const t = setup(5); t.window.__agentCreateOptions = { fireAndPoll: true, batchId: 'batch', concurrency: 2 };
  const start = await t.start(); assert.equal(start.phase, 'running');
  const duplicate = await t.start(); assert.equal(duplicate.duplicate, true);
  t.window.__apiCtx.model = 'changed'; t.window.__skillMap.skill.skillVersionId = 'changed'; t.window.__agentItems[0].desc = 'changed';
  for (let n = 0; t.poll().phase !== 'done' && n < 100; n++) await delay(5);
  assert.equal(t.poll().ok, true); assert.equal(t.peak(), 2); assert.equal(t.calls.length, 20);
  for (const c of t.calls.filter(c => c.body.businessConfig)) {
    const b = JSON.parse(c.body.businessConfig); assert.equal(b.globalConfiguration.selectedModel, 'snapshot-model'); assert.equal(b.gradingConfiguration.skills[0], 'version-1'); assert.equal(c.body.desc, 'description');
  }
}
{
  let fail = true;
  const t = setup(1, endpoint => { if (fail && endpoint === '/agents/v1/update/agent') return { status: 200, json: async () => ({ code: 500, msg: 'mock failure' }) }; });
  const first = await t.start(); assert.equal(first.results[0].status, 'failed'); assert.equal(first.results[0].instanceNid, 'nid-1');
  fail = false; const second = await t.start(); assert.equal(second.ok, true);
  assert.equal(t.calls.filter(c => c.endpoint.endsWith('/create/agent')).length, 1);
  assert.equal(t.calls.filter(c => c.endpoint.endsWith('/createRef')).length, 1);
}
{
  const t = setup(1, endpoint => { if (endpoint.endsWith('/create/agent')) throw new Error('response lost'); });
  const first = await t.start(); assert.equal(first.results[0].status, 'unknown');
  const second = await t.start(); assert.equal(second.duplicate, true); assert.equal(t.calls.length, 1);
  t.window.__agentItems[0].desc = 'different'; await t.start(); assert.equal(t.calls.length, 1, 'unknown name must block changed batch');
}
{
  const t = setup(2); t.window.__agentItems[1].name = t.window.__agentItems[0].name;
  assert.equal((await t.start()).ok, false); assert.equal(t.calls.length, 0);
  t.window.__agentItems[1].name = 'other'; t.window.__agentItems.forEach(it => it.instanceNid = 'same');
  assert.equal((await t.start()).ok, false); assert.equal(t.calls.length, 0);
}
{
  const t = setup(1); t.window.__agentItems[0].instanceNid = 'existing'; t.window.__agentCreateOptions = { fireAndPoll: true };
  await t.start(); t.window.__agentItems = [{ name: 'different-name', desc: 'd', requirement: 'r', skillVersionId: 'v', instanceNid: 'existing' }];
  assert.match((await t.start()).error, /实例正在处理/);
  for (let n = 0; t.poll().phase !== 'done' && n < 100; n++) await delay(5);
  assert.equal(t.calls.length, 3); assert.equal(t.poll().ok, true);
}
{
  const t = setup(1, endpoint => { if (endpoint.endsWith('/create/agent')) return new Promise(() => {}); });
  t.window.__agentCreateOptions = { timeoutMs: 10 };
  const result = await t.start(); assert.equal(result.results[0].status, 'unknown');
  await t.start(); assert.equal(t.calls.length, 1, 'timeout must never automatically create again');
}
{
  const t = setup(1); await t.start();
  t.window.__agentCreateOptions = { resume: true };
  assert.equal((await t.start()).ok, true);
  assert.equal((await t.start()).ok, true);
  assert.equal(t.calls.filter(c => c.endpoint.endsWith('/create/agent')).length, 1);
}
console.log('PASS: 8 mock scenarios — concurrency/order, fire-and-poll/duplicate/snapshot, partial recovery, unknown create, duplicate names/instances, cross-batch instance lock. No network.');
