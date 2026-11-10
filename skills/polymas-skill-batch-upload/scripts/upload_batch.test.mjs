import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
const sources = Object.fromEntries(['setup', 'start', 'poll'].map(n => [n, readFileSync(new URL(`upload_batch_${n}.js`, import.meta.url), 'utf8')]));
const hash = text => createHash('sha256').update(text).digest('hex');
function harness(fetchImpl) {
  const elements = new Map();
  const document = { getElementById: id => elements.get(id), createElement: () => ({ setAttribute() {}, files: [] }), body: { appendChild(el) { elements.set(el.id, el); } } };
  class FormData { constructor() { this.fields = []; } append(...v) { this.fields.push(v); } }
  const c = vm.createContext({ window: {}, document, crypto: webcrypto, FormData, fetch: fetchImpl, AbortController, setTimeout, clearTimeout, console });
  const call = n => vm.runInContext(`(${sources[n]})()`, c);
  const setup = (runId, n = 5, extra = {}) => {
    const items = Array.from({ length: n }, (_, i) => ({ id: `${runId}-${i}`, name: `${runId}-name-${i}`, fileName: `${runId}-${i}.zip`, sha256: hash(`${runId}-${i}`), type: 1 }));
    c.window.__skillUploadBatchConfig = { runId, authorized: true, dedupeConfirmed: true, items, ...extra };
    const result = call('setup');
    if (result.ok) elements.get(result.inputId).files = items.map(i => ({ name: i.fileName, size: i.id.length, arrayBuffer: async () => Buffer.from(i.id) }));
    c.window.__skillUploadBatchRunId = runId;
    return result;
  };
  return { c, elements, call, setup, done: async id => { await c.window.__skillUploadBatches.runs.get(id).promise; c.window.__skillUploadBatchRunId = id; return call('poll'); } };
}
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
const success = id => response(200, { code: 200, data: { skillNid: id } });
let calls = 0, active = 0, peak = 0;
const h = harness(async (url, options) => {
  assert.equal(url, 'https://cloudapi.polymas.com/ai-biz/v1/skill/create/unify/agentSkill');
  assert.equal(options.credentials, 'include');
  assert.equal(options.body.fields[0][0], 'zipFile');
  assert.deepEqual(options.body.fields.slice(1).map(a => [...a]), [['type', '1'], ['source', 'BUILTIN']]);
  const id = ++calls; peak = Math.max(peak, ++active);
  await new Promise(resolve => setTimeout(resolve, 5)); active--; return success(`skill-${id}`);
});
assert.equal(h.setup('parallel').concurrency, 3);
assert.equal(h.call('start').accepted, true);
assert.equal(h.call('start').ok, false, 'double start blocked synchronously');
// The live input can change without changing snapshotted File references.
h.elements.get('__skill_upload_batch_parallel').files = [];
const result = await h.done('parallel');
assert.equal(peak, 3); assert.equal(calls, 5); assert.equal(result.counts.uploaded, 5);
assert.equal(h.setup('parallel').ok, false, 'run ID cannot be overwritten');
const original = h.c.window.__skillUploadBatches.runs.get('parallel').items[0];
h.setup('duplicate', 1, { items: [{ ...original, id: 'different', fileName: 'duplicate-0.zip' }] });
assert.equal(h.call('start').ok, false, 'same name/hash locked across batches');
assert.equal(calls, 5);
h.setup('hashdup', 1, { items: [{ ...original, id: 'hashdup-0', name: 'new-name', fileName: 'hashdup-0.zip' }] });
assert.equal(h.call('start').ok, false, 'SHA alone locks across batches');
h.setup('namedup', 1, { items: [{ ...original, id: 'namedup-0', sha256: hash('namedup-0'), fileName: 'namedup-0.zip' }] });
assert.equal(h.call('start').ok, false, 'name alone locks across batches');

let dryFetches = 0;
const dry = harness(() => { dryFetches++; throw Error('dry-run fetched'); });
assert.equal(dry.setup('dry', 4, { dryRun: true }).ok, true);
dry.call('start'); const dryResult = await dry.done('dry');
assert.equal(dryResult.counts.dry_run, 4); assert.equal(dryFetches, 0);
assert.equal(dry.c.window.__skillUploadBatches.locks.size, 0);
assert.equal(dry.setup('unauthorized', 1, { authorized: false }).ok, false);
assert.equal(dry.setup('unchecked', 1, { dedupeConfirmed: false }).ok, false);
assert.equal(dry.setup('overlimit', 1, { concurrency: 9 }).ok, false);
assert.equal(dry.setup('maxlimit', 1, { concurrency: 8 }).ok, true);

for (const [label, fn] of [
  ['network', async () => { throw Error('network lost after POST'); }],
  ['malformed', async () => response(200, '<html>oops</html>')],
  ['missingid', async () => response(200, { code: 200, data: {} })],
  ['servererror', async () => response(503, { code: 503, msg: 'busy' })]
]) {
  let count = 0;
  const u = harness(async (...args) => { count++; return fn(...args); });
  u.setup(label, 1); u.call('start'); const r = await u.done(label);
  assert.equal(r.items[0].status, 'unknown', label);
  assert.equal(r.reconciliationRequired, true);
  assert.equal(r.resubmitAllowed, false);
  assert.equal(u.call('start').ok, false); assert.equal(count, 1);
}
let authCalls = 0;
const auth = harness(async () => {
  const n = ++authCalls;
  await new Promise(resolve => setTimeout(resolve, n === 1 ? 2 : 10));
  return n === 1 ? response(401, { code: 401, msg: 'expired' }) : success(`started-${n}`);
});
auth.setup('auth', 7); auth.call('start'); const authResult = await auth.done('auth');
assert.equal(authCalls, 3);
assert.equal(authResult.counts.auth_failed, 1);
assert.equal(authResult.counts.uploaded, 2, 'in-flight results preserved');
assert.equal(authResult.counts.blocked_auth, 4);
let mismatchCalls = 0;
const bad = harness(() => { mismatchCalls++; return success('bad'); });
bad.setup('mismatch', 1);
bad.elements.get('__skill_upload_batch_mismatch').files[0].arrayBuffer = async () => Buffer.from('wrong');
bad.call('start'); const badResult = await bad.done('mismatch');
assert.equal(badResult.counts.invalid_file, 1); assert.equal(mismatchCalls, 0);
console.log('PASS: concurrency=3, max=8 validation, snapshot isolation, duplicate locks/reentry, dryRun, authorization/dedupe gates, ambiguous responses, auth stop with in-flight preservation, SHA mismatch');
