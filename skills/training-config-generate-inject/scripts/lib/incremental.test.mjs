import test from 'node:test';import assert from 'node:assert/strict';
import {buildDesiredSnapshot,runIncremental,parsedIncrementalDocument} from './incremental.mjs';
import {loadBasicParser} from './basic-config.mjs';
const base={trainTaskId:'t',type:'ability',steps:[{stepId:'s',positionDTO:{x:0,y:0},stepDetailDTO:{nodeType:'SCRIPT_NODE',stepName:'A',llmPrompt:'old',prologue:'',description:'',avatar:'keep'}}],flows:[{flowId:'f',scriptStepStartId:'s',scriptStepEndId:'s'}]};
const parsed={steps:[{stepName:'A',llmPrompt:'old',prologue:'',description:'',trainerName:'keep'}],taskConfig:{name:'t'},flowConfig:{}};
test('parsed mapping preserves raw DTO and rejects unsupported parsed changes',()=>{
 const next=structuredClone(parsed);next.steps[0].llmPrompt='new';const result=buildDesiredSnapshot({baseSnapshot:base,baseParsed:parsed,desiredParsed:next});assert.equal(result.steps[0].stepDetailDTO.avatar,'keep');assert.equal(result.steps[0].stepDetailDTO.llmPrompt,'new');
 next.steps[0].trainerName='other';assert.throws(()=>buildDesiredSnapshot({baseSnapshot:base,baseParsed:parsed,desiredParsed:next}),/未支持/);
});
test('real parser serializer roundtrip produces applicable text-only mapping',{skip: !process.env.TRAINING_APP_ROOT ? 'Set TRAINING_APP_ROOT to the compatible Agent_Evaluation frontend' : false},()=>{
 const appRoot=process.env.TRAINING_APP_ROOT;
 const parser=loadBasicParser(appRoot);
 const raw=structuredClone(base);
 Object.assign(raw.steps[0].stepDetailDTO,{llmPrompt:'# Role\n请问一个问题。',prologue:'你好\n请介绍自己。',description:'阶段描述'});
 const mapped={...raw.steps[0].stepDetailDTO,trainerName:'教师',trainerGender:'',trainerAgeGroup:'',modelId:'',agentId:'',avatarNid:'',backgroundImage:'',interactiveRounds:0,flowCondition:'',transitionPrompt:''};
 const markdown=parser.serializeTrainingScriptMarkdown({steps:[mapped],taskConfig:{trainTaskName:'训练',description:'测试'}});
 const original=parsedIncrementalDocument(appRoot,markdown);
 const next=parsedIncrementalDocument(appRoot,markdown.replace('请问一个问题。','只问一个问题。'));
 const desired=buildDesiredSnapshot({baseSnapshot:raw,baseParsed:original,desiredParsed:next});
 assert.equal(desired.steps[0].stepDetailDTO.llmPrompt,'# Role\n只问一个问题。');
 assert.equal(desired.steps[0].stepDetailDTO.avatar,'keep');
});
test('local dry plan never accesses config or network',async()=>{
 const poison=new Proxy({}, {get(){throw Error('must not read config');}});
 const result=await runIncremental(poison,{dryRun:true,baseSnapshot:base,desiredSnapshot:base},()=>{throw Error('network forbidden');});assert.equal(result.changes.length,0);
});
