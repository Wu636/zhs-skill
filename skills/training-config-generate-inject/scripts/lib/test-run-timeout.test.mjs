import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTrainingTest } from './test-run.mjs';

const config = { polymas: { cookie: 'test-only=fake' }, llm: {} };
function options(dir) { return { runDir: dir, appUrl: 'http://mock.invalid', target: { trainTaskId: 'fake' }, type: 'ability', student: 'good', timeoutSeconds: 0.04 }; }

test('timeout remains active after response headers during SSE body', async () => {
  const original = globalThis.fetch;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'training-timeout-test-'));
  let calls = 0;
  globalThis.fetch = async (_url, { signal }) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
    }}));
  };
  try {
    await assert.rejects(runTrainingTest(config, options(dir)), /包含流读取/);
    assert.equal(calls, 1);
    const record = JSON.parse(readFileSync(path.join(dir, 'test-good-interrupted.json'), 'utf8'));
    assert.equal(record.timedOut, true);
    assert.equal(JSON.stringify(record).includes('test-only'), false);
  } finally { globalThis.fetch = original; }
});

test('completed SSE retains parseable output and timing evidence', async () => {
  const original = globalThis.fetch;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'training-success-test-'));
  globalThis.fetch = async () => new Response('data: ' + JSON.stringify({type:'done', taskId:'fake', taskName:'mock', completed:true, totalRounds:0, messages:[], steps:[]}) + '\n\n');
  try {
    const docPath = path.join(dir, 'teacher.md');
    writeFileSync(docPath, 'mock teacher material');
    const result = await runTrainingTest(config, { ...options(dir), docPath, exportToDoc: false });
    assert.equal(result.completed, true);
    assert.deepEqual(result.exportedFiles, []);
    assert.equal(existsSync(path.join(dir, 'mock-test-good.txt')), false);
    const record = JSON.parse(readFileSync(path.join(dir, 'test-good.json'), 'utf8'));
    assert.equal(record.timingEvents[0].type, 'done');
    assert.ok(record.durationMs >= 0);
    assert.match(readFileSync(path.join(dir, 'test-good.txt'), 'utf8'), /task_id: fake/);
  } finally { globalThis.fetch = original; }
});
