import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { savePulledRubricSidecar, selectStructuredRubric, loadStructuredRubricHelpers } from '../scripts/lib/rubric-structured.mjs';
import { compareBasicSnapshot } from '../scripts/lib/platform-basic.mjs';
const appRoot=process.env.TRAINING_APP_ROOT;
const requiresApp = { skip: !appRoot ? 'Set TRAINING_APP_ROOT to the compatible Agent_Evaluation frontend' : false };
const raw=[{itemId:'a',trainTaskId:'task',itemName:'表达',score:100,description:'原始描述',requireDetail:'原始完整规则'}];
const md='# 评价标准\n## 总分：100 分\n## 表达（100 分）\n**评价描述：** 原始描述\n**评分区间：** 原始完整规则';
test('pull sidecar round-trip exact and malformed sidecar blocks',requiresApp,async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rubric-sidecar-'));
 const file=await savePulledRubricSidecar(appRoot,dir,md,raw,'task');
 assert.deepEqual(JSON.parse(fs.readFileSync(file)).rawScoreItems,raw);
 const selected=await selectStructuredRubric(appRoot,dir,md);
 assert.equal(selected.ok,true); assert.equal(selected.payload.sourceTaskId,'task');
 fs.writeFileSync(file,'broken');
 assert.equal((await selectStructuredRubric(appRoot,dir,md)).blocked,true);
});
test('snapshot verification refuses equal-count content changes; legacy warns',requiresApp,async()=>{
 const {compareScoreItemsExact}=await loadStructuredRubricHelpers(appRoot);
 const dto=raw.map(({itemId,trainTaskId,...item})=>item);
 const changed=[{...raw[0],requireDetail:'changed'}];
 const report=compareBasicSnapshot({}, {configuration:{},steps:[],scoreItems:changed},{rubric:dto,rubricComparison:compareScoreItemsExact(dto,changed)});
 assert.equal(report.ok,false);
 const legacy=compareBasicSnapshot({}, {configuration:{},steps:[],scoreItems:changed},{rubric:dto});
 assert.equal(legacy.checks.find(x=>x.name==='评价标准').status,'warn');
});
