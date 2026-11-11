import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureJumpOutputBlocks, normalizeBasicMarkdown } from '../scripts/lib/normalize.mjs';

const stage = (n, name, extra = '', prompt = 'x') =>
  `### 阶段${n}: ${name}\n${extra}**提示词**:\n\`\`\`markdown\n# Role\n${prompt}\n\`\`\`\n`;

const linear = [
  stage(1, '甲', '**flowCondition**: "接下来我们将进入下一阶段"\n'),
  stage(2, '乙', '**flowCondition**: "TASK_COMPLETE"\n', '本次实训到此结束'),
].join('');

test('linear script gains standalone jump and end blocks', () => {
  const result = ensureJumpOutputBlocks(linear);
  assert.equal((result.text.match(/# 跳转输出/g) || []).length, 1);
  assert.equal((result.text.match(/# 结束输出/g) || []).length, 1);
  assert.match(result.text, /这 12 个汉字/);
  assert.match(result.text, /这 8 个汉字/);
  assert.deepEqual(result.pending, []);
});

test('normalize is idempotent for jump blocks', () => {
  const once = normalizeBasicMarkdown(linear, { type: 'ability' });
  const twice = normalizeBasicMarkdown(once.text, { type: 'ability' });
  assert.equal(twice.changes.filter((item) => item.includes('输出')).length, 0);
  assert.equal((twice.text.match(/# 跳转输出/g) || []).length, 1);
});

test('graph scripts are left untouched', () => {
  const graph = `${stage(1, '甲', '**flowCondition**: "去乙"\n', '仅输出 去乙')}\n## 🔀 非线性跳转关系\n`;
  const result = ensureJumpOutputBlocks(graph);
  assert.equal(result.changes.length, 0);
  assert.equal(result.text, graph);
});

test('custom end phrase without literal end word asks for manual confirmation', () => {
  const custom = [
    stage(1, '甲', '**flowCondition**: "接下来我们将进入下一阶段"\n'),
    stage(2, '乙', '**flowCondition**: "实训结束"\n', '只说 实训结束'),
  ].join('');
  const result = ensureJumpOutputBlocks(custom);
  assert.equal((result.text.match(/# 结束输出/g) || []).length, 0);
  assert.ok(result.pending.some((item) => item.includes('结束语')));
});

test('non-last stage without flowCondition is skipped when the phrase is absent', () => {
  const script = [
    stage(1, '甲', '', '请继续追问'),
    stage(2, '乙', '**flowCondition**: "TASK_COMPLETE"\n', '本次实训到此结束'),
  ].join('');
  const result = ensureJumpOutputBlocks(script);
  assert.equal((result.text.match(/# 跳转输出/g) || []).length, 0);
  assert.ok(result.pending.some((item) => item.includes('跳转词')));
});