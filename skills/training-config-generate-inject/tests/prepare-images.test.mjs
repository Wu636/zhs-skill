import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareTrainingImages } from '../scripts/lib/prepare-images.mjs';

test('image preparation requests only prepare-only endpoint and keeps injection evidence intact',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'images-test-'));
 fs.writeFileSync(path.join(dir,'script.md'),'mock');fs.writeFileSync(path.join(dir,'inject.result.json'),'original');
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{
 calls++;assert.equal(url,'http://mock.invalid/api/training-inject');const p=JSON.parse(options.body);
 assert.equal(p.imagePrepareOnly,true);assert.equal(p.injectDigitalHuman,false);assert.deepEqual(p.imagePrepareIds,['background:1']);assert.equal(p.libraryFolderId,'lib');assert.equal(p.courseId,'course');assert.equal(p.credentials.authorization,'fake-token');
 return new Response('data: '+JSON.stringify({type:'progress',message:'[image] background:1 准备完成; cache=hit; durationMs=1; queueMs=0'})+'\n\ndata: {"type":"complete"}\n\n');
 };
 try {
 const result=await prepareTrainingImages({appBaseUrl:'http://mock.invalid',polymas:{cookie:'ai-poly=fake-token'},llm:{},inject:{}},{runDir:dir,type:'ability',ids:['background:1'],target:{trainTaskId:'task',targetUrl:'https://mock.invalid/agent-course-full/course/ability-training/create?trainTaskId=task&libraryId=lib'}});
 assert.equal(result.success,true);assert.equal(calls,1);assert.equal(fs.readFileSync(path.join(dir,'inject.result.json'),'utf8'),'original');
 const saved=fs.readFileSync(path.join(dir,'images.prepare.json'),'utf8');assert.equal(saved.includes('fake-token'),false);assert.equal(JSON.parse(saved).diagnostics[0].cache,'hit');
 } finally {globalThis.fetch=old;}
});
test('one image failure persists failed ID and rejects without a success claim',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'images-failure-test-'));fs.writeFileSync(path.join(dir,'script.md'),'mock');
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('data: '+JSON.stringify({type:'progress',message:'[image] background:2 失败/待补图; cache=miss; durationMs=4; queueMs=0'})+'\n\ndata: {"type":"error","message":"failed"}\n\n');
 try {await assert.rejects(prepareTrainingImages({appBaseUrl:'http://mock.invalid',polymas:{cookie:'ai-poly=fake-token'},llm:{}},{runDir:dir,type:'oral',strategy:'missing',target:{trainTaskId:'t',targetUrl:'https://mock.invalid/agent-course-full/c/language-training/create?libraryId=l'}}));const result=JSON.parse(fs.readFileSync(path.join(dir,'images.prepare.json'),'utf8'));assert.equal(result.success,false);assert.deepEqual(result.failedIds,['background:2']);}finally{globalThis.fetch=old;}
});
test('Pro and invalid arguments are rejected before fetch',async()=>{
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('must not fetch');};
 try {await assert.rejects(prepareTrainingImages({}, {type:'pro'}), /ability\/oral/);await assert.rejects(prepareTrainingImages({}, {type:'oral',concurrency:9}),/1..8/);}finally{globalThis.fetch=old;}
});
