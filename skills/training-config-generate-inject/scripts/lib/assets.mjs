import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {request,uploadImage} from './platform.mjs';
import {collectBasicSnapshot} from './platform-basic.mjs';
export function validateAssetsManifest(manifest,names){
 const rows=manifest?.stages||[];
 if(rows.length!==names.length||new Set(rows.map(x=>x.stepName)).size!==names.length||rows.some(x=>!names.includes(x.stepName))) throw Error('阶段资源必须与目标阶段一一匹配');
 for(const r of rows) for(const p of [r.backgroundPath,...(r.resources||[]).map(x=>x.path)]) if(!p||!path.isAbsolute(p)) throw Error('资源文件必须为绝对路径');
 return rows;
}
export async function detachHtmlResources(config,{runDir}){
 const target=JSON.parse(fs.readFileSync(path.join(runDir,'target.json'),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(runDir,'assets-manifest.json'),'utf8'));
 const names=new Set(manifest.stages.flatMap(s=>(s.resources||[]).map(r=>path.basename(r.path))));
 const snap=await collectBasicSnapshot(config,target.trainTaskId,'ability');
 let removed=0;
 for(const s of snap.steps){
  const d=structuredClone(s.stepDetailDTO);const direct=d.scriptStepResourceList||[];const groups=d.stepExtProperty?.resources||[];
  const belongs=r=>names.has(r.fileName);
  const n=direct.filter(belongs).length+groups.flatMap(g=>g.list||[]).filter(belongs).length;
  if(!n)continue;
  d.trainSubType='ability';d.scriptStepResourceList=direct.filter(r=>!belongs(r));
  d.stepExtProperty={...d.stepExtProperty,resources:groups.map(g=>({...g,list:(g.list||[]).filter(r=>!belongs(r))}))};
  await request(config,'POST','/teacher-course/abilityTrain/editScriptStep',{trainTaskId:target.trainTaskId,stepId:s.stepId,stepDetailDTO:d,positionDTO:s.positionDTO,courseId:target.courseId},{authStyle:'raw'});removed++;
 }
 const after=await collectBasicSnapshot(config,target.trainTaskId,'ability');
 for(const s of after.steps){const d=s.stepDetailDTO;const r=[...(d.scriptStepResourceList||[]),...(d.stepExtProperty?.resources||[]).flatMap(g=>g.list||[])];if(r.some(r=>names.has(r.fileName)))throw Error('HTML附件仍存在');}
 fs.writeFileSync(path.join(runDir,'html-detached.json'),JSON.stringify({taskId:target.trainTaskId,updatedStages:removed,verifiedNoTaskHtml:true},null,2));
 console.log(`[resources] ${removed}阶段已撤下本次HTML；全部${after.steps.length}阶段回读确认无本次HTML附件`);
}
export async function setTrainingVoice(config,{runDir,voiceNid}){
 const target=JSON.parse(fs.readFileSync(path.join(runDir,'target.json'),'utf8'));
 const voices=await request(config,'POST','/ai-profile/ai_voice_training/list',{voiceTemplateType:'ONLINE_DOUBAO'},{authStyle:'raw'});
 const voice=voices.find(v=>v.nid===voiceNid);if(!voice)throw Error('未找到指定音色');
 const before=await collectBasicSnapshot(config,target.trainTaskId,'ability');
 for(const s of before.steps){
  const d={...s.stepDetailDTO,agentId:voice.nid,agentVoiceId:voice.bigModelVoiceParam,customDigitalHumanSpeechRate:0.9};
  await request(config,'POST','/teacher-course/abilityTrain/editScriptStep',{trainTaskId:target.trainTaskId,stepId:s.stepId,stepDetailDTO:d,positionDTO:s.positionDTO,courseId:target.courseId},{authStyle:'raw'});
 }
 const c=before.configuration;
 await request(config,'POST','/teacher-course/abilityTrain/editConfiguration',{...c,courseId:target.courseId,entranceVoiceNid:voice.nid,entranceVoiceType:voice.bigModelVoiceParam,entranceVoiceSpeed:0,extConfig:{...c.extConfig,trainScreen:false,speechTranscription:true,entranceVoiceLanguage:'zh',entranceVoiceSpeedMultiplier:0.9}},{authStyle:'raw'});
 const after=await collectBasicSnapshot(config,target.trainTaskId,'ability');
 if(after.steps.some(s=>s.stepDetailDTO.agentVoiceId!==voice.bigModelVoiceParam)||after.configuration.entranceVoiceNid!==voice.nid)throw Error('音色回读失败');
 console.log(`[voice] ${voice.voiceTone}；${after.steps.length}阶段及入场音色回读通过`);
}
export async function attachStageAssets(config,{runDir,manifestPath,dryRun=false}){
 const target=JSON.parse(fs.readFileSync(path.join(runDir,'target.json'),'utf8'));
 if(target.type!=='ability') throw Error('当前资源绑定仅支持基础版ability');
 const snap=await collectBasicSnapshot(config,target.trainTaskId,'ability');
 if(snap.configuration.trainTaskId!==target.trainTaskId) throw Error('目标任务不可读');
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 const rows=validateAssetsManifest(manifest,snap.steps.map(s=>s.stepDetailDTO.stepName));
 for(const r of rows) for(const p of [r.backgroundPath,...(r.resources||[]).map(x=>x.path)]) if(!fs.statSync(p).isFile()) throw Error('非文件:'+p);
 if(dryRun){console.log(JSON.stringify({dryRun:true,taskId:target.trainTaskId,stages:rows.length}));return;}
 const evidence={taskId:target.trainTaskId,stages:[]};
 const out=path.join(runDir,'assets-result.json');
 const save=()=>fs.writeFileSync(out,JSON.stringify(evidence,null,2));
 for(const row of rows){
  const s=snap.steps.find(x=>x.stepDetailDTO.stepName===row.stepName);
  const d=structuredClone(s.stepDetailDTO);
  // Read DTOs may report null here; writes need an explicit subtype.
  d.trainSubType='ability';
  const bg=await uploadImage(config,row.backgroundPath);
  const downloaded=await fetch(bg.fileUrl); if(!downloaded.ok)throw Error('背景资源回读失败');
  if(!Buffer.from(await downloaded.arrayBuffer()).equals(fs.readFileSync(row.backgroundPath)))throw Error('背景资源字节校验失败');
  const resources=[];
  for(const r of row.resources||[]){
   const f=await uploadImage(config,r.path);
   const rr=await fetch(f.fileUrl);if(!rr.ok)throw Error('资源回读失败');
   if(!Buffer.from(await rr.arrayBuffer()).equals(fs.readFileSync(r.path)))throw Error('资源文件字节校验失败');
   resources.push({...f,type:'resource',fileName:path.basename(r.path),isRequired:0,contentType:'text/html',category:'学习辅助资源',resourceTypeNid:'',thumbnail:'',description:r.description||'',trainTaskId:target.trainTaskId,scriptStepId:s.stepId,sort:resources.length,scriptStepResourceId:crypto.randomUUID().replaceAll('-','').slice(0,20)});
  }
  d.scriptStepCover={...bg,fileName:path.basename(row.backgroundPath)};d.backgroundTheme=bg.fileId;d.scriptBackgroundType='image';
  const ext=d.stepExtProperty||{};
  const existing=Array.isArray(ext.resources)?ext.resources:[];
  d.stepExtProperty={...ext,bgMediaType:1,resources:[...existing,{nid:'',category:'学习辅助资源',list:resources}],flowAsideContent:row.subtitle||ext.flowAsideContent||''};
  d.scriptStepResourceList=[...(d.scriptStepResourceList||[]),...resources];
  await request(config,'POST','/teacher-course/abilityTrain/editScriptStep',{trainTaskId:target.trainTaskId,stepId:s.stepId,stepDetailDTO:d,positionDTO:s.positionDTO,courseId:target.courseId},{authStyle:'raw'});
  const after=await collectBasicSnapshot(config,target.trainTaskId,'ability');
  const actual=after.steps.find(x=>x.stepId===s.stepId)?.stepDetailDTO;
  if(actual?.scriptStepCover?.fileId!==bg.fileId)throw Error('阶段背景绑定回读失败');
  const ids=new Set([...(actual.scriptStepResourceList||[]),...(actual.stepExtProperty?.resources||[]).flatMap(g=>g.list||[])].map(r=>r.fileId));
  if(resources.some(r=>!ids.has(r.fileId)))throw Error('阶段资源绑定回读失败');
  evidence.stages.push({stepId:s.stepId,stepName:row.stepName,background:bg,resources,verified:true});save();
  console.log(`[assets] ${row.stepName}: 背景及${resources.length}项资源回读通过`);
 }
 console.log(`[assets] ${evidence.stages.length}个阶段完成；${out}`);
}
