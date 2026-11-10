import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { File } from 'node:buffer';
import fs from 'node:fs';
const base = new URL('../scripts/browser/', import.meta.url);
const scripts = Object.fromEntries(['setup','start','poll','compact','cleanup'].map(k => [k, fs.readFileSync(new URL(`correction_test_${k}.js`,base),'utf8')]));
const delay = ms => new Promise(r => setTimeout(r,ms));
function harness(fetcher) {
  const nodes = new Map(), timers = [];
  const window = { crypto: { randomUUID: () => 'uuid' } };
  const ctx = vm.createContext({ window, crypto: window.crypto, AbortController, FormData,
    document: { getElementById: id => nodes.get(id), createElement: () => ({style:{},files:[],setAttribute(){},remove(){nodes.delete(this.id);}}), body:{appendChild: n=>nodes.set(n.id,n)} },
    fetch: fetcher,
    setTimeout: (fn,ms) => { if(ms===0) { timers.push(fn); return 0; } return setTimeout(fn,ms); }, clearTimeout });
  return {window,nodes, call:k=>vm.runInContext(scripts[k],ctx), flush:async()=>{await Promise.all(timers.splice(0).map(fn=>fn()));} };
}
const response = data => ({ok:true,status:200,text:async()=>JSON.stringify(data),json:async()=>data});
const config = (runId, extra={}) => ({ ...(runId ? {runId}:{}),skillVersionId:`version-${runId||'legacy'}`,submissionRequirement:'required', samples:Array.from({length:5},(_,i)=>({id:`s${i}`,text:`text${i}`})),...extra });
test('setup rejects duplicate IDs and ambiguous file maps before creating inputs',async()=>{
 const h=harness(()=>{throw Error('unexpected fetch');});
 for(const samples of [[{id:'x',text:'a'},{id:'x',text:'b'}],[{id:'a',file:'X.pdf'},{id:'b',file:'x.pdf'}],[{id:'empty'}]]) {
 h.window.__ctConfig=config('',{samples});assert.equal((await h.call('setup')).ok,false);assert.equal(h.nodes.size,0);
 }
 h.window.__ctConfig=config('',{samples:[{file:'x.pdf'}]});await h.call('setup');
 h.nodes.get('__ct_file_input').files=[new File(['a'],'x.pdf'),new File(['b'],'X.pdf')];
 assert.equal((await h.call('start')).ok,false);assert.equal(h.window.__ctState.phase,'setup');
});
test('cleanup requires explicit persisted selection and never removes another run or named legacy alias',async()=>{
 const h=harness(()=>{throw Error('unexpected fetch');});
 h.window.__ctConfig=config('A');const a=await h.call('setup');
 h.window.__ctConfig=config('B');const b=await h.call('setup');
 assert.equal((await h.call('cleanup')).ok,false);
 h.window.__ctCleanup={runId:'',resultsPersisted:true};assert.equal((await h.call('cleanup')).ok,false);
 h.window.__ctCleanup={runId:'A',resultsPersisted:false};assert.equal((await h.call('cleanup')).ok,false);
 const state=h.window.__ctRuns.A;
 for(const phase of ['running','submitted','polling','unknown']){state.phase=phase;h.window.__ctCleanup={runId:'A',resultsPersisted:true};assert.equal((await h.call('cleanup')).ok,false);}
 state.phase='done';assert.equal((await h.call('cleanup')).ok,false); // READY samples are not terminal
 state.phase='setup';assert.equal((await h.call('cleanup')).ok,true);
 assert.equal(h.window.__ctRuns.A,undefined);assert.ok(h.window.__ctRuns.B);assert.ok(h.window.__ctState===h.window.__ctRuns.B);
 assert.equal(h.nodes.has(a.inputId),false);assert.equal(h.nodes.has(b.inputId),true);assert.equal(h.window.__ctCleanup,undefined);
 h.window.__ctRunId='';h.window.__ctConfig={};delete h.window.__ctState;
 h.window.__ctConfig=config('');await h.call('setup');h.window.__ctCleanup={runId:'',resultsPersisted:true};
 assert.equal((await h.call('cleanup')).ok,true);assert.equal(h.nodes.has('__ct_file_input'),false);assert.ok(h.window.__ctRuns.B);
});
test('legacy compatibility, bounded submission and synchronous duplicate-start lock',async()=>{
 let active=0,max=0,calls=0;
 const h=harness(async()=>{calls++; max=Math.max(max,++active); await delay(5); active--;return response({code:200});});
 h.window.__ctConfig=config('',{submitConcurrency:2});
 const setup=await h.call('setup'); assert.equal(setup.inputId,'__ct_file_input');
 assert.equal((await h.call('start')).ok,true);
 assert.equal((await h.call('start')).ok,false);
 await h.flush(); assert.equal(calls,5);assert.equal(max,2);assert.equal(h.window.__ctState.phase,'submitted');
 assert.equal((await h.call('setup')).ok,false);
});
test('named runs isolate frozen payloads, inputs and compact output',async()=>{
 const payloads=[];
 const h=harness(async(url,options)=>{payloads.push(JSON.parse(options.body));return response({code:200});});
 h.window.__ctConfig=config('A');const a=await h.call('setup');await h.call('start');
 h.window.__ctConfig=config('B',{submissionRequirement:'B requirement'});const b=await h.call('setup');await h.call('start');
 await h.flush();assert.notEqual(a.inputId,b.inputId);
 assert.equal(payloads.filter(p=>p.skillVersionId==='version-A'&&p.submissionRequirement==='required').length,5);
 assert.equal(payloads.filter(p=>p.skillVersionId==='version-B'&&p.submissionRequirement==='B requirement').length,5);
 h.window.__ctRunId='A';assert.equal(JSON.parse(await h.call('compact')).runId,'A');
 h.window.__ctRunId='missing';assert.equal((await h.call('poll')).ok,false);
});
test('file uploads preserve payload and use run-specific input',async()=>{
 const requests=[];
 const h=harness(async(url,opts)=>{requests.push({url,body:opts.body});return response(url.includes('/file/upload')?{code:200,data:{ossUrl:'https://mock.invalid/file',fileId:'f1',suffix:'pdf',originFileName:'work.pdf'}}:{code:200});});
 h.window.__ctConfig=config('files',{samples:[{file:'work.pdf'}],requirementAttachments:[{type:'txt',url:'https://mock.invalid/req'}]});
 const setup=await h.call('setup');h.nodes.get(setup.inputId).files=[new File(['mock'],'work.pdf')];
 await h.call('start');await h.flush();assert.equal(requests.length,2);
 const body=JSON.parse(requests[1].body);assert.deepEqual(body.studentAttachments,[{type:'pdf',url:'https://mock.invalid/file'}]);
 assert.deepEqual(body.requirementAttachments,[{type:'txt',url:'https://mock.invalid/req'}]);assert.equal(body.isTestRun,true);
 assert.equal(requests[0].body.get('file').name,'work.pdf');
});
test('uncertain execute never resubmits, queries original task and completes',async()=>{
 let executes=0;const queried=[];
 const h=harness(async(url)=>{if(url.includes('/execute')){executes++;throw Error('response lost');}queried.push(url);return response({code:200,data:{skill:{reportStatus:'SUCCESS'},scoring:{scoreData:{totalScore:90,fullMark:100}}}});});
 h.window.__ctConfig=config('',{samples:[{id:'one',text:'answer'}]});await h.call('setup');await h.call('start');await h.flush();
 const state=h.window.__ctState;assert.equal(state.samples[0].status,'UNKNOWN');const id=state.samples[0].taskId;
 assert.equal((await h.call('start')).ok,false);await h.call('poll');
 assert.equal(executes,1);assert.ok(queried[0].includes(encodeURIComponent(id)));assert.equal(state.phase,'done');assert.equal(state.samples[0].status,'SUCCESS');
});
test('poll bounded concurrency, in-flight lock and fifteen-minute checkpoint',async()=>{
 let active=0,max=0,calls=0;
 const h=harness(async()=>{calls++;max=Math.max(max,++active);await delay(10);active--;return response({code:200,data:{skill:{reportStatus:'PENDING'}}});});
 h.window.__ctConfig=config('A',{pollConcurrency:2});await h.call('setup');const s=h.window.__ctState;s.phase='submitted';
 for(const [i,x] of s.samples.entries()){x.status='PENDING';x.taskId=`task${i}`;x.startedAt=Date.now()-16*60000;}
 const first=h.call('poll');assert.equal((await h.call('poll')).inFlight,true);await first;
 assert.equal(calls,5);assert.equal(max,2);assert.equal(s.pollInFlight,false);
 assert.ok(s.samples.every(x=>x.status==='PENDING'&&x.checkpointExceeded));assert.notEqual(s.phase,'done');
});
test('query timeout stays pending and clears poll lock; server failure is terminal',async()=>{
 let mode='hang';
 const h=harness(async(url,{signal})=>{
 if(mode==='hang') return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
 return response({code:200,data:{skill:{reportStatus:'FAILED',message:'server failed'}}});
 });
 h.window.__ctConfig=config('',{queryTimeoutMs:5,samples:[{text:'x'}]});await h.call('setup');const s=h.window.__ctState;s.phase='submitted';Object.assign(s.samples[0],{status:'PENDING',taskId:'task',startedAt:Date.now()});
 await h.call('poll');assert.equal(s.samples[0].status,'PENDING');assert.equal(s.pollInFlight,false);assert.match(s.samples[0].error,/aborted/);
 mode='failed';await h.call('poll');assert.equal(s.samples[0].status,'FAILED');assert.equal(s.phase,'done');
});
