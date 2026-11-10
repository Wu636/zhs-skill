import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildDesiredSnapshot, runIncremental as actualRunIncremental } from '../scripts/lib/incremental.mjs';

// Evaluate only the actual command function. Do not import CLI main, load config,
// resolve user credentials, spawn a child or call a real HTTP endpoint.
const source = fs.readFileSync(fileURLToPath(new URL('../scripts/run.mjs', import.meta.url)), 'utf8');
const start = source.indexOf('async function commandIncremental(');
const end = source.indexOf('\nasync function commandTest(', start);
assert.ok(start >= 0 && end > start, 'actual command boundaries must exist');
const commandSource = source.slice(start, end);
const RUN = '/mock/independent-run';
const baselineKey = path.join(RUN, 'incremental.baseline.json');
const baseSnapshot = { trainTaskId:'task', type:'ability', steps:[{stepId:'s',positionDTO:{x:0,y:0},stepDetailDTO:{nodeType:'SCRIPT_NODE',stepName:'A',llmPrompt:'old',prologue:'',description:'',avatar:'preserve'}}],flows:[{flowId:'f',scriptStepStartId:'s',scriptStepEndId:'s'}] };
const parse = (_appRoot, markdown) => ({steps:[{stepName:'A',llmPrompt:markdown,prologue:'',description:'',trainerName:'teacher'}],taskConfig:{trainTaskName:'T'},flowConfig:{}});
function harness() {
  const files = new Map(), calls = [], logs = [];
  const state = { markdown:'old', rubric:'original rubric', remoteResult:null, remoteCalls:0 };
  const config = { appRoot:'/mock/app', appBaseUrl:'https://mock.invalid', polymas:{cookie:'zhs-jt-cas=mock-only',authorization:'mock-only'} };
  const context = {
    path, URL, CliError:Error, resolveRunDir:()=>RUN,
    argString:(flags,...names)=>names.map(n=>flags[n]).find(v=>typeof v==='string') || '',
    argBool:(flags,name,fallback)=>flags[name] === undefined ? fallback : Boolean(flags[name]),
    argNumber:(flags,name,fallback)=>flags[name] === undefined ? fallback : Number(flags[name]),
    readRunScript:()=>({markdown:state.markdown}), readRunRubric:()=>state.rubric,
    resolveTarget:()=>({trainTaskId:'task',type:'ability',courseId:'course',targetUrl:'https://hike-teaching-center.polymas.com/agent-course-full/course/ability-training/create?trainTaskId=task&libraryId=library'}),
    resolveType:()=> 'ability', exists:key=>files.has(key),
    readJson:(key,fallback)=>files.has(key)?structuredClone(files.get(key)):fallback,
    writeJson:(key,value)=>files.set(key,structuredClone(value)),
    parsedIncrementalDocument:parse, buildDesiredSnapshot,
    ok:message=>logs.push(message),log:message=>logs.push(message),
    runIncremental:async (cfg,options)=>{
      calls.push(structuredClone(options));
      if(options.action==='snapshot') { state.remoteCalls++; return {success:true,snapshot:structuredClone(baseSnapshot)}; }
      if(options.action==='plan') return actualRunIncremental(cfg,options,()=>{throw new Error('Local plan must never fetch');});
      state.remoteCalls++;
      return state.remoteResult || {success:true,mode:options.action,applied:['s'],verified:true};
    },
  };
  vm.createContext(context);
  const command = vm.runInContext(commandSource+'\ncommandIncremental',context);
  return { files,calls,logs,state, run:flags=>command(config,flags) };
}

test('snapshot captures immutable baseline and explicit target library; refuses overwrite',async()=>{
  const h=harness();assert.equal(await h.run({action:'snapshot'}),0);
  const saved=h.files.get(baselineKey);
  assert.equal(saved.markdown,'old');assert.equal(saved.rubric,'original rubric');assert.equal(saved.target.libraryId,'library');assert.deepEqual(saved.snapshot,baseSnapshot);
  await assert.rejects(h.run({action:'snapshot'}),/禁止覆盖/);assert.equal(h.state.remoteCalls,1);
});
test('plan computes changes locally without remote writes or baseline mutation',async()=>{
  const h=harness();await h.run({action:'snapshot'});const saved=structuredClone(h.files.get(baselineKey));h.state.markdown='new';
  assert.equal(await h.run({action:'plan'}),0);assert.equal(h.state.remoteCalls,1);
  assert.deepEqual(h.files.get(baselineKey),saved);
  const result=h.files.get(path.join(RUN,'incremental.plan.json'));
  assert.equal(result.changes.length,1);assert.deepEqual(result.changes[0].fields,['llmPrompt']);
});
test('apply --yes --dry-run forces local plan and never invokes remote apply',async()=>{
  const h=harness();await h.run({action:'snapshot'});h.state.markdown='new';
  assert.equal(await h.run({action:'apply',yes:true,'dry-run':true}),0);
  assert.equal(h.state.remoteCalls,1);assert.deepEqual(h.calls.map(c=>c.action),['snapshot','plan']);assert.equal(h.files.has(path.join(RUN,'incremental.apply.json')),false);
});
test('rubric changes reject before any remote call or desired snapshot write',async()=>{
  const h=harness();await h.run({action:'snapshot'});h.state.rubric='changed';
  await assert.rejects(h.run({action:'apply',yes:true}),/评分标准发生变化/);assert.equal(h.state.remoteCalls,1);assert.equal(h.calls.length,1);
});
test('partial failure returns exit 1 and preserves reconciliation evidence and reason',async()=>{
  const h=harness();await h.run({action:'snapshot'});h.state.markdown='new';
  h.state.remoteResult={success:false,mode:'apply',applied:['s'],failedStepId:'other',reason:'write-outcome-unknown',reconciliationRequired:true,atomic:false};
  assert.equal(await h.run({action:'apply',yes:true}),1);
  assert.deepEqual(h.files.get(path.join(RUN,'incremental.apply.json')),h.state.remoteResult);
  assert.match(h.logs.at(-1),/write-outcome-unknown/);assert.match(h.logs.at(-1),/reconciliationRequired/);assert.equal(h.state.remoteCalls,2);
});
test('apply without yes refuses before any remote call',async()=>{
  const h=harness();await assert.rejects(h.run({action:'apply'}),/明确授权/);assert.equal(h.state.remoteCalls,0);
});
