import fs from 'node:fs';import path from 'node:path';
import {request,uploadImage} from './platform.mjs';import {collectBasicSnapshot} from './platform-basic.mjs';
export function buildImageDetail(before,resources){
 const d=structuredClone(before);d.trainSubType='ability';
 const additions=resources.map((r,i)=>({...r,type:'resource',isRequired:0,contentType:'image/png',category:'学习图卡',resourceTypeNid:'',thumbnail:r.fileUrl,sort:i+1}));
 d.scriptStepResourceList=[...(d.scriptStepResourceList||[]),...additions];
 d.stepExtProperty={...d.stepExtProperty,trainSubType:'ability',resources:[...(d.stepExtProperty?.resources||[]),{nid:'',category:'学习图卡',list:additions}]};
 return d;
}
export async function attachImageResources(config,{runDir,manifestPath}){
 const target=JSON.parse(fs.readFileSync(path.join(runDir,'target.json'),'utf8'));
 if(target.type!=='ability')throw Error('只支持ability');
 const rows=JSON.parse(fs.readFileSync(manifestPath,'utf8')).resources;
 const snap=await collectBasicSnapshot(config,target.trainTaskId,'ability');
 if(snap.configuration.trainTaskId!==target.trainTaskId)throw Error('目标不可读');
 for(const r of rows){if(!path.isAbsolute(r.path)||!r.path.endsWith('.png')||!fs.existsSync(r.path)||!snap.steps.some(s=>s.stepDetailDTO.stepName===r.stepName))throw Error('图片清单不合法');}
 const results=[];const evidence=path.join(runDir,'image-resources-result.json');
 for(const s of snap.steps){
  const rs=rows.filter(r=>r.stepName===s.stepDetailDTO.stepName);if(!rs.length)continue;
  const resources=[];
  for(const r of rs){const f=await uploadImage(config,r.path);const response=await fetch(f.fileUrl);if(!response.ok||!Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(r.path)))throw Error('图片上传回读字节不符');resources.push({...f,fileName:path.basename(r.path),description:r.description,trainTaskId:target.trainTaskId,scriptStepId:s.stepId});}
  const detail=buildImageDetail(s.stepDetailDTO,resources);
  await request(config,'POST','/teacher-course/abilityTrain/editScriptStep',{trainTaskId:target.trainTaskId,stepId:s.stepId,stepDetailDTO:detail,positionDTO:s.positionDTO,courseId:target.courseId},{authStyle:'raw'});
  const after=await collectBasicSnapshot(config,target.trainTaskId,'ability');const d=after.steps.find(x=>x.stepId===s.stepId).stepDetailDTO;
  const ids=new Set([...(d.scriptStepResourceList||[]),...(d.stepExtProperty?.resources||[]).flatMap(g=>g.list||[])].map(r=>r.fileId));
  if(resources.some(r=>!ids.has(r.fileId)))throw Error('图片阶段绑定回读失败');
  if(d.scriptStepCover.fileId!==s.stepDetailDTO.scriptStepCover.fileId||d.agentVoiceId!==s.stepDetailDTO.agentVoiceId)throw Error('背景或音色发生变化');
  results.push({stepId:s.stepId,stepName:s.stepDetailDTO.stepName,resources,verified:true});fs.writeFileSync(evidence,JSON.stringify({trainTaskId:target.trainTaskId,results},null,2));console.log(`[images] ${s.stepDetailDTO.stepName}: ${resources.length}张绑定及回读通过`);
 }
 const final=await collectBasicSnapshot(config,target.trainTaskId,'ability');
 for(const r of results){const d=final.steps.find(s=>s.stepId===r.stepId).stepDetailDTO;const ids=new Set([...(d.scriptStepResourceList||[]),...(d.stepExtProperty?.resources||[]).flatMap(g=>g.list||[])].map(r=>r.fileId));if(r.resources.some(x=>!ids.has(x.fileId)))throw Error('最终回读缺失');}
 console.log(`[images] 最终${results.reduce((n,r)=>n+r.resources.length,0)}张图片校验通过，未发布`);
}
