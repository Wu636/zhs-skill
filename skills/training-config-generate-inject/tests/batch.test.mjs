import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeBatch, validateManifest, redactLine } from '../scripts/batch.mjs';

// Fixtures contain no credentials. All execution tests inject an in-memory runner.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'training-batch-test-'));
let sequence = 0;
const output = () => path.join(root, `batch-${++sequence}`);
const job = (id, directory = id) => ({ id, args: ['validate', '--type', 'ability', '--run', path.join(root, directory)] });
const manifest = (jobs, extra = {}) => ({ version: 1, client: 'dsh', jobs, ...extra });
const url = (id) => `https://hike-teaching-center.polymas.com/agent-course-full/course/ability-training/create?trainTaskId=${id}`;
const platformJob = (id, target = id, command = 'verify') => ({ id, args: [command, '--type', 'ability', '--run', path.join(root, id), '--target-url', url(target)], grants: ['network'] });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('independent jobs overlap up to bound; failure independent, summary durable', async () => {
  let active = 0, peak = 0;
  const result = await executeBatch(manifest([job('a'), job('b'), job('c')], { concurrency: 2 }), {
    outputDir: output(), runner: async ({ args, stdoutPath, stderrPath }) => {
      active++; peak = Math.max(peak, active);
      fs.writeFileSync(stdoutPath, 'mock\n'); fs.writeFileSync(stderrPath, '');
      await tick(); active--;
      return { code: path.basename(args[args.indexOf('--run') + 1]) === 'b' ? 7 : 0 };
    },
  });
  assert.equal(peak, 2);
  assert.deepEqual(result.jobs.map((j) => j.status), ['succeeded', 'failed', 'succeeded']);
  const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(result.jobs[0].stdout), 'summary.json'), 'utf8'));
  assert.equal(saved.status, 'failed');
  assert.equal(saved.jobs[1].exitCode, 7);
  assert.equal(JSON.stringify(saved).includes('--run'), false);
});

test('same target, same directory and nested paths queue in manifest order', async () => {
  const a = platformJob('target-a', 'same'), b = platformJob('target-b', 'same');
  const jobs = [a, b, job('dir-a', 'shared'), job('dir-b', 'shared/nested')];
  const plan = validateManifest(manifest(jobs));
  assert.deepEqual(plan.jobs[1].dependencies, ['target-a']);
  assert.deepEqual(plan.jobs[3].dependencies, ['dir-a']);
  const running = new Set();
  await executeBatch(manifest(jobs, { concurrency: 4 }), { outputDir: output(), runner: async ({ args }) => {
    const directory = args[args.indexOf('--run') + 1];
    const key = args.includes(url('same')) ? 'target' : 'directory';
    assert.equal(running.has(key), false);
    running.add(key); await tick(); running.delete(key);
    assert.ok(directory); return { code: 0 };
  } });
});

test('symlink aliases resolve to the same resource; failed predecessor blocks', async () => {
  const actual = path.join(root, 'actual'); fs.mkdirSync(actual);
  const alias = path.join(root, 'alias'); fs.symlinkSync(actual, alias, 'dir');
  const plan = validateManifest(manifest([job('one', 'actual'), job('two', 'alias')]));
  assert.deepEqual(plan.jobs[1].dependencies, ['one']);
  let calls = 0;
  const result = await executeBatch(manifest([job('one', 'actual'), job('two', 'alias'), job('three')]), {
    outputDir: output(), runner: async () => ({ code: ++calls === 1 ? 1 : 0 }),
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.jobs.map((j) => j.status), ['failed', 'blocked', 'succeeded']);
});

test('dry-run never calls runner and does not create business directories', async () => {
  const item = job('dry-only');
  const result = await executeBatch(manifest([item]), { outputDir: output(), dryRun: true, runner: () => assert.fail('spawned') });
  assert.equal(result.status, 'planned');
  assert.equal(fs.existsSync(path.join(root, 'dry-only')), false);
  assert.equal(fs.existsSync(result.jobs[0].stdout), false);
});

test('strict command/flag/schema allowlist rejects credential and bypass inputs', () => {
  for (const command of ['run', 'loop', 'publish', 'create-task', 'evaluate', 'finalize', 'doctor']) {
    assert.throws(() => validateManifest(manifest([{ id: 'x', args: [command] }])));
  }
  for (const flag of ['--cookie', '--authorization', '--config', '--llm-key', '--app-url', '--api-base', '--allow-errors', '--publish', '--client']) {
    const item = job('x'); item.args.push(flag, 'SECRET');
    assert.throws(() => validateManifest(manifest([item])), (error) => !error.message.includes('SECRET'));
  }
  assert.throws(() => validateManifest(manifest([{ ...job('x'), cookie: 'SECRET' }])));
  assert.throws(() => validateManifest(manifest([job('x')], { env: {} })));
  assert.throws(() => validateManifest(manifest([job('x')], { client: undefined })));
  assert.throws(() => validateManifest(manifest([job('x')], { concurrency: 0 })));
  assert.throws(() => validateManifest(manifest([job('x'), job('x')])));
  const relative = job('x'); relative.args[4] = './relative';
  assert.throws(() => validateManifest(manifest([relative])));
});

test('platform calls require target and grants; fresh needs two explicit gates', () => {
  const item = platformJob('write', 'target', 'inject');
  assert.throws(() => validateManifest(manifest([item])));
  item.grants.push('inject');
  assert.throws(() => validateManifest(manifest([item])), /explicit --mode/);
  item.args.push('--mode', 'append');
  let plan = validateManifest(manifest([item]));
  assert.equal(plan.jobs[0].args.at(-1), 'append');
  item.args[item.args.indexOf('--mode') + 1] = 'fresh';
  assert.throws(() => validateManifest(manifest([item])));
  item.grants.push('fresh');
  assert.throws(() => validateManifest(manifest([item])));
  item.args.push('--confirm-fresh');
  plan = validateManifest(manifest([item]));
  assert.ok(plan.jobs[0].args.includes('--confirm-fresh'));
  item.args[item.args.indexOf('--target-url') + 1] += '&token=SECRET';
  assert.throws(() => validateManifest(manifest([item])));
});

test('incremental actions enforce grants and explicit apply confirmation', async () => {
  const make = (action, grants = []) => ({
    ...platformJob('inc', 'inc', 'incremental'), grants,
    args: [...platformJob('inc', 'inc', 'incremental').args, ...(action ? ['--action', action] : [])],
  });
  assert.equal(validateManifest(manifest([make()])).jobs[0].args.at(-1), 'plan');
  assert.doesNotThrow(() => validateManifest(manifest([make('plan')])));
  for (const action of ['snapshot', 'preflight']) {
    assert.throws(() => validateManifest(manifest([make(action)])), /network/);
    assert.doesNotThrow(() => validateManifest(manifest([make(action, ['network'])])));
    const invalidYes = make(action, ['network']); invalidYes.args.push('--yes');
    assert.throws(() => validateManifest(manifest([invalidYes])));
  }
  const apply = make('apply', ['network']); apply.args.push('--yes');
  assert.throws(() => validateManifest(manifest([apply])), /inject/);
  apply.grants.push('inject');
  assert.doesNotThrow(() => validateManifest(manifest([apply])));
  const noYes = make('apply', ['network', 'inject']);
  assert.throws(() => validateManifest(manifest([noYes])), /--yes/);
  for (const action of ['capture', 'publish', 'fresh', '']) {
    if (action) assert.throws(() => validateManifest(manifest([make(action, ['network', 'inject'])])));
  }
  const wrongType = make('plan'); wrongType.args[wrongType.args.indexOf('--type') + 1] = 'pro';
  assert.throws(() => validateManifest(manifest([wrongType])));
  const fresh = make('apply', ['network', 'inject', 'fresh']); fresh.args.push('--yes', '--confirm-fresh');
  assert.throws(() => validateManifest(manifest([fresh])));
  const before = platformJob('before', 'inc');
  assert.deepEqual(validateManifest(manifest([before, apply])).jobs[1].dependencies, ['before']);
  await executeBatch(manifest([apply]), { outputDir: output(), runner: async ({ args }) => {
    assert.equal(args[0], 'incremental'); assert.ok(args.includes('--yes'));
    assert.equal(args[args.indexOf('--action') + 1], 'apply'); return { code: 0 };
  } });
});

test('prepare-images requires network/images grants, yes and valid image selectors', async () => {
  const make = () => ({
    ...platformJob('assets', 'assets', 'prepare-images'), grants: ['network', 'images'],
    args: [...platformJob('assets', 'assets', 'prepare-images').args, '--yes', '--image-concurrency', '2', '--image-cache', 'reuse', '--image-ids', 'cover,background:1,background:12'],
  });
  assert.doesNotThrow(() => validateManifest(manifest([make()])));
  for (const missing of ['network', 'images']) {
    const item = make(); item.grants = item.grants.filter((g) => g !== missing);
    assert.throws(() => validateManifest(manifest([item])));
  }
  const noYes = make(); noYes.args = noYes.args.filter((a) => a !== '--yes');
  assert.throws(() => validateManifest(manifest([noYes])), /--yes/);
  for (const ids of ['background:0', 'background:-1', 'cover,cover', 'cover,', 'background:01', 'cover, background:1', 'arbitrary']) {
    const item = make(); item.args[item.args.indexOf('--image-ids') + 1] = ids;
    assert.throws(() => validateManifest(manifest([item])));
  }
  for (const flag of ['--dry-run', '--confirm-fresh', '--no-cover']) {
    const item = make(); item.args.push(flag); assert.throws(() => validateManifest(manifest([item])));
  }
  const pro = make(); pro.args[pro.args.indexOf('--type') + 1] = 'pro';
  assert.throws(() => validateManifest(manifest([pro])));
  const same = platformJob('check-assets', 'assets');
  assert.deepEqual(validateManifest(manifest([make(), same])).jobs[1].dependencies, ['assets']);
  const dry = await executeBatch(manifest([make()]), { outputDir: output(), dryRun: true, runner: () => assert.fail('spawned images') });
  assert.equal(dry.status, 'planned');
  await executeBatch(manifest([make()]), { outputDir: output(), runner: async ({ args }) => {
    assert.equal(args[0], 'prepare-images'); assert.ok(args.includes('--yes'));
    assert.equal(args[args.indexOf('--image-ids') + 1], 'cover,background:1,background:12');
    return { code: 0 };
  } });
});

test('inject image flags have bounded concurrency and exact cache modes', async () => {
  const make = (count = '2', cache = 'reuse') => ({
    ...platformJob('images', 'images', 'inject'), grants: ['network', 'inject'],
    args: [...platformJob('images', 'images', 'inject').args, '--mode', 'append', '--image-concurrency', count, '--image-cache', cache],
  });
  for (const count of ['1', '8']) for (const cache of ['reuse', 'refresh', 'off']) {
    assert.doesNotThrow(() => validateManifest(manifest([make(count, cache)])));
  }
  for (const count of ['0', '9', '-1', '1.5', 'NaN']) assert.throws(() => validateManifest(manifest([make(count)])));
  for (const cache of ['yes', 'REUSE', '']) assert.throws(() => validateManifest(manifest([make('2', cache)])));
  const unrelated = job('validate-image'); unrelated.args.push('--image-concurrency', '2');
  assert.throws(() => validateManifest(manifest([unrelated])));
  await executeBatch(manifest([make('3', 'refresh')]), { outputDir: output(), runner: async ({ args }) => {
    assert.equal(args[args.indexOf('--image-concurrency') + 1], '3');
    assert.equal(args[args.indexOf('--image-cache') + 1], 'refresh');
    return { code: 0 };
  } });
});

test('image strategy is exact and restricted to image-capable commands', async () => {
  for (const command of ['inject', 'prepare-images']) {
    for (const strategy of ['preserve', 'missing', 'regenerate']) {
      const base = platformJob(`strategy-${command}`, 'target', command);
      const item = { ...base, grants: ['network', command === 'inject' ? 'inject' : 'images'], args: [...base.args, ...(command === 'inject' ? ['--mode', 'append'] : ['--yes']), '--image-strategy', strategy] };
      const plan = validateManifest(manifest([item]));
      assert.equal(plan.jobs[0].args.at(-1), strategy);
      item.args[item.args.length - 1] = 'reuse';
      assert.throws(() => validateManifest(manifest([item])), /image-strategy/);
    }
  }
  const unrelated = job('no-strategy'); unrelated.args.push('--image-strategy', 'preserve');
  assert.throws(() => validateManifest(manifest([unrelated])));
});

test('test grants/profile and export-directory conflict', () => {
  const make = (id) => ({ ...platformJob(id, id, 'test'), grants: ['network', 'test'], args: [...platformJob(id, id, 'test').args, '--doc', path.join(root, 'docs', `${id}.md`)] });
  const a = make('test-a'), b = make('test-b');
  assert.deepEqual(validateManifest(manifest([a, b])).jobs[1].dependencies, ['test-a']);
  a.args.push('--student', 'all');
  assert.throws(() => validateManifest(manifest([a])));
  a.grants.push('student:all');
  assert.doesNotThrow(() => validateManifest(manifest([a])));
});

test('no-doc-export permits independent tests sharing one teacher document', async () => {
  const make = (id) => ({
    ...platformJob(id, id, 'test'), grants: ['network', 'test'],
    args: [...platformJob(id, id, 'test').args, '--doc', path.join(root, 'shared-docs', 'teacher.md'), '--no-doc-export'],
  });
  const jobs = [make('export-a'), make('export-b')];
  const plan = validateManifest(manifest(jobs));
  assert.deepEqual(plan.jobs[1].dependencies, []);
  let active = 0, peak = 0;
  const result = await executeBatch(manifest(jobs, { concurrency: 2 }), {
    outputDir: output(), runner: async ({ args }) => {
      assert.ok(args.includes('--no-doc-export'));
      active++; peak = Math.max(peak, active); await tick(); active--; return { code: 0 };
    },
  });
  assert.equal(peak, 2);
  assert.equal(result.status, 'succeeded');
  const sharedTarget = make('export-c');
  sharedTarget.args[sharedTarget.args.indexOf('--target-url') + 1] = url('export-a');
  assert.deepEqual(validateManifest(manifest([jobs[0], sharedTarget])).jobs[1].dependencies, ['export-a']);
});

test('spawn rejection does not expose exception data; no retries', async () => {
  let count = 0;
  const result = await executeBatch(manifest([job('error')]), { outputDir: output(), runner: async () => { count++; throw new Error('cookie=SECRET'); } });
  assert.equal(count, 1); assert.equal(result.jobs[0].status, 'failed');
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(redactLine('Authorization: Bearer SECRET'), '[redacted sensitive output]');
  assert.equal(redactLine('normal progress'), 'normal progress');
});

test('pre-aborted batch launches nothing; explicit dependencies block', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await executeBatch(manifest([job('cancel')]), { outputDir: output(), signal: controller.signal, runner: () => assert.fail('spawned') });
  assert.equal(result.jobs[0].status, 'cancelled');
  assert.throws(() => validateManifest(manifest([{ ...job('bad'), dependsOn: ['later'] }, job('later')])));
});

test('explicit DAG dependencies wait for success without a cross-task barrier', async () => {
  const events = [];
  const jobs = [job('first'), { ...job('dependent'), dependsOn: ['first'] }, job('independent')];
  await executeBatch(manifest(jobs, { concurrency: 2 }), { outputDir: output(), runner: async ({ args }) => {
    const id = path.basename(args[args.indexOf('--run') + 1]);
    events.push(`start:${id}`); await tick(); events.push(`end:${id}`); return { code: 0 };
  } });
  assert.ok(events.indexOf('start:independent') < events.indexOf('end:first'));
  assert.ok(events.indexOf('start:dependent') > events.indexOf('end:first'));
  const result = await executeBatch(manifest(jobs), { outputDir: output(), runner: async ({ args }) => ({ code: args.some((a) => a.endsWith('/first')) ? 1 : 0 }) });
  assert.deepEqual(result.jobs.map((j) => j.status), ['failed', 'blocked', 'succeeded']);
});

test('job timeout aborts once and does not retry or release dependency early', async () => {
  let calls = 0;
  const result = await executeBatch(manifest([job('slow'), { ...job('after'), dependsOn: ['slow'] }]), {
    outputDir: output(), jobTimeoutSeconds: 1,
    runner: ({ signal }) => new Promise((resolve) => { calls++; signal.addEventListener('abort', () => resolve({ code: null, signal: 'SIGTERM' }), { once: true }); }),
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.jobs.map((j) => j.status), ['timed_out', 'blocked']);
});

test('existing output, skill-tree output and overlapping summary are rejected', async () => {
  const existing = output(); fs.mkdirSync(existing);
  await assert.rejects(executeBatch(manifest([job('x')]), { outputDir: existing, dryRun: true }));
  await assert.rejects(executeBatch(manifest([job('x')]), { outputDir: path.join(root, 'x', 'batch'), dryRun: true }));
  const item = job('bad'); item.args[4] = path.join(os.homedir(), '.agents/skills/training-config-generate-inject/runs/no');
  assert.throws(() => validateManifest(manifest([item])));
});
