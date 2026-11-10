import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const script = readFileSync(new URL('./release_batch.js', import.meta.url), 'utf8');
const item = n => ({ id:n, skillNid:n, skillVersionId:'v-'+n, courseId:'course', folderId:'folder', term:'20271', uploadApproved:true, test:{status:'passed', skillVersionId:'v-'+n} });
function harness(mode={}) {
 const rows = {}, bound = new Set(), calls=[]; let active=0,peak=0,publish=0;
 const window={};
 const ctx=vm.createContext({window,AbortController,Date,JSON,Number,Object,Array,Set,String,Promise,encodeURIComponent, Error, setTimeout:(f,ms)=>setTimeout(f,ms===3000?0:ms),clearTimeout,fetch:async(url,opts={})=>{
  calls.push({url,body:opts.body&&JSON.parse(opts.body)}); active++;peak=Math.max(peak,active);
  await new Promise(r=>setTimeout(r,2)); active--;
  let data,code=200,status=200;
  const body=opts.body&&JSON.parse(opts.body);
  if(url.includes('/get-current-user-detail')) data={userNid:'user',nickName:'name'};
  else if(url.includes('/draft/save')) { rows[body.skillNid] = {...rows[body.skillNid],fileId:body.skillVersionId,filePath:'saved/file'}; if(mode.changedSave) rows[body.skillNid].skillVersionId='new-id'; }
  else if(url.includes('/publishVersionNo/')) data='1.0.0';
  else if(url.endsWith('/skill/publish')) {
   publish++;
   if(mode.auth) status=401;
   else if(mode.retries && publish<=mode.retries) code=10006;
   else {const r=rows[body.skillNid]; if(!mode.staleFinal){r.version='1.0.0';r.versionStatus=1;}if(mode.changedFinal) r.skillVersionId='new-id';if(mode.lost) throw new Error('lost response');}
  }
  else if(url.includes('/batchBindSkill')) {bound.add(body.skillVersions[0].skillNid);if(mode.lostBind)throw new Error('lost bind');}
  else if(url.includes('/grading/skill/pageList')) data={total:bound.size,records:[...bound].map(n=>({skillNid:n,skillVersionId:mode.wrongCourse?'other':'v-'+n,inCourse:true}))};
  else {const n=url.split('/').at(-1); rows[n] ||= {skillNid:n,skillVersionId:'v-'+n,version:'草稿',versionStatus:0};data=[rows[n]];}
  return {ok:status===200,status,json:async()=>({code,data})};
 }});
 const run=cfg=>{window.__skillReleaseConfig=cfg;return vm.runInContext('('+script+')()',ctx);};
 const wait=async id=>{await window.__skillReleaseRuns.runs[id].promise;return run({runId:id,action:'poll'});};
 return {run,wait,window,calls,bound,get peak(){return peak;},get publish(){return publish;}};
}
{
 const h=harness(); await h.run({runId:'a',items:['a','b','c','d'].map(item)}); const result=await h.wait('a');
 assert.equal(h.peak,3);assert.ok(result.items.every(x=>x.status==='done'));assert.equal(h.publish,4);
 await h.run({runId:'a',items:[item('a')]});assert.equal(h.publish,4);
 assert.equal((await h.run({runId:'b',items:[item('a')]})).ok,false);
 for(const n of ['a','b','c','d']) {const writes=h.calls.filter(x=>x.body?.skillNid===n);assert.ok(writes[0].url.endsWith('draft/save'));assert.ok(writes[1].url.endsWith('skill/publish'));}
}
{
 const h=harness();assert.equal((await h.run({runId:'a',items:[{...item('a'),test:{status:'failed',skillVersionId:'v-a'}}]})).ok,false);
 assert.equal((await h.run({runId:'a',dryRun:true,items:[item('a')]})).dryRun,true);assert.equal(h.calls.length,0);
 const ex={...item('b'),test:{status:'skipped',skillVersionId:'v-b'},testApproved:true,testApprovalReason:'teacher explicitly skipped'};
 await h.run({runId:'b',items:[ex]}); assert.equal((await h.wait('b')).items[0].status,'done');
}
{
 const h=harness({lost:true});await h.run({runId:'a',items:[item('a')]});assert.equal((await h.wait('a')).items[0].status,'ready_resume');assert.equal(h.publish,1);
 await h.run({runId:'a',action:'resume',resumeApproved:true});assert.equal((await h.wait('a')).items[0].status,'done');assert.equal(h.publish,1);
}
for(const mode of [{changedSave:true},{changedFinal:true}]) {
 const h=harness(mode);await h.run({runId:'a',items:[item('a')]});assert.equal((await h.wait('a')).items[0].status,'blocked');assert.equal(h.bound.size,0);
}
{
 const h=harness({retries:99});await h.run({runId:'a',items:[item('a')]});assert.equal((await h.wait('a')).items[0].status,'failed');assert.equal(h.publish,6);
 await h.run({runId:'a',action:'resume',resumeApproved:true});await h.wait('a');assert.equal(h.publish,6);
}
{
 const h=harness({retries:2});await h.run({runId:'a',items:[item('a')]});assert.equal((await h.wait('a')).items[0].status,'done');assert.equal(h.publish,3);
}
{
 const h=harness({auth:true});await h.run({runId:'a',concurrency:1,items:[item('a'),item('b')]});const r=await h.wait('a');assert.equal(r.items[1].status,'blocked_auth');assert.equal(h.calls.some(x=>x.url.endsWith('/skill/b')),false);
}
{
 const h=harness({wrongCourse:true});h.bound.add('a');await h.run({runId:'a',items:[item('a')]});assert.equal((await h.wait('a')).items[0].status,'blocked');assert.equal(h.calls.some(x=>x.url.endsWith('batchBindSkill')),false);
}
{
 const h=harness({lostBind:true});await h.run({runId:'a',items:[item('a')]});assert.equal((await h.wait('a')).items[0].status,'ready_resume');await h.run({runId:'a',action:'resume',resumeApproved:true});assert.equal((await h.wait('a')).items[0].status,'done');assert.equal(h.calls.filter(x=>x.url.endsWith('batchBindSkill')).length,1);
}
{
 const h=harness({staleFinal:true});await h.run({runId:'a',items:[item('a')]});assert.equal((await h.wait('a')).items[0].status,'unknown');
 await h.run({runId:'a',action:'resume',resumeApproved:true});assert.equal((await h.wait('a')).items[0].status,'unknown');assert.equal(h.publish,1);assert.equal(h.bound.size,0);
}
console.log('PASS: concurrent release, per-object order, gates, dry-run, duplicate locks, unknown reconciliation, version identity stops, bounded 10006 retries, auth queue stop, exact course verification; mock only');
