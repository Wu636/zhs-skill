import { createHash } from 'node:crypto';
import { loadBasicParser } from './basic-config.mjs';
import { sanitizeCookie } from './platform.mjs';
function rawAuthorization(cookie, explicit) {
  const raw = String(explicit || '').trim();
  if (raw) return raw.replace(/^authorization\s*:\s*/i, '').replace(/^Bearer\s+/i, '').trim();
  const match = String(cookie || '').match(/(?:^|;\s*)(zhs-jt-cas|ai-poly)=([^;]+)/i);
  return match ? decodeURIComponent(match[2]) : '';
}

const FIELDS = ['prologue', 'description', 'llmPrompt'];
const clone = value => structuredClone(value);
export function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
}
export function incrementalFingerprint(snapshot) { return createHash('sha256').update(stableJson(snapshot)).digest('hex'); }

/** Parse both baseline and edited markdown identically: reject all non-supported parsed changes. */
export function parsedIncrementalDocument(appRoot, markdown) {
  const parser = loadBasicParser(appRoot);
  return { steps: parser.parseTrainingScript(markdown), taskConfig: parser.parseTaskConfig(markdown), flowConfig: parser.parseTrainingScriptFlowConfig(markdown) };
}
export function buildDesiredSnapshot({ baseSnapshot, baseParsed, desiredParsed }) {
  if (!baseSnapshot?.steps?.length || !baseSnapshot.flows?.length) throw new Error('增量更新需要完整节点及连线快照');
  const before = clone(baseParsed), after = clone(desiredParsed);
  if (!Array.isArray(before?.steps) || !Array.isArray(after?.steps) || before.steps.length !== after.steps.length) throw new Error('阶段数量变化不支持增量');
  const stages = baseSnapshot.steps.filter(s => s.stepDetailDTO?.nodeType === 'SCRIPT_NODE');
  if (stages.length !== before.steps.length || new Set(stages.map(s=>s.stepDetailDTO.stepName)).size !== stages.length) throw new Error('阶段映射数量不一致或名称重复');
  const desired = clone(baseSnapshot);
  for (let i=0; i<stages.length; i++) {
    const old = before.steps[i], next = after.steps[i], source = stages[i];
    if (old.stepName !== source.stepDetailDTO.stepName || next.stepName !== old.stepName) throw new Error('阶段名称/顺序变化不支持增量');
    const target = desired.steps.find(s=>s.stepId === source.stepId);
    for (const key of FIELDS) {
      if (typeof (old[key] ?? '') !== 'string' || typeof (next[key] ?? '') !== 'string') throw new Error('仅支持字符串文本更新');
      if ((old[key] ?? '') !== (source.stepDetailDTO[key] ?? '')) throw new Error('基线剧本与平台快照文本不一致，重新拉取后再修改');
      if ((old[key] ?? '') !== (next[key] ?? '')) target.stepDetailDTO[key] = next[key];
      delete old[key]; delete next[key];
    }
  }
  if (stableJson(before) !== stableJson(after)) throw new Error('检测到未支持的字段/任务配置/词汇/连线变化，拒绝增量且不自动fresh');
  return desired;
}

/** No network; checks raw snapshot diff independently before invoking the endpoint. */
export function planIncrementalLocal(baseSnapshot, desiredSnapshot) {
  const before = clone(baseSnapshot), after = clone(desiredSnapshot);
  if (!before?.steps?.length || !before.flows?.length || before.steps.length !== after?.steps?.length) throw new Error('需要完整且同结构的快照');
  const changes = [];
  for (let i=0; i<before.steps.length; i++) {
    const a=before.steps[i], b=after.steps[i];
    if (!a.stepDetailDTO || !b.stepDetailDTO) throw new Error('缺原始阶段DTO');
    const fields = FIELDS.filter(k => (a.stepDetailDTO[k] ?? '') !== (b.stepDetailDTO[k] ?? ''));
    if (fields.length && a.stepDetailDTO.nodeType !== 'SCRIPT_NODE') throw new Error('不能修改边界节点');
    if (fields.some(k => typeof b.stepDetailDTO[k] !== 'string')) throw new Error('修改文本必须显式提供字符串');
    for (const k of FIELDS) {
      if (k in b.stepDetailDTO && typeof b.stepDetailDTO[k] !== 'string') throw new Error('文本类型错误');
      delete a.stepDetailDTO[k]; delete b.stepDetailDTO[k];
    }
    if (fields.length) changes.push({stepId:a.stepId,stepName:a.stepDetailDTO.stepName,fields});
  }
  if (stableJson(before) !== stableJson(after)) throw new Error('不支持阶段结构、拓扑或非文本变化');
  return { success:true, mode:'plan', atomic:false, changes, baseFingerprint:incrementalFingerprint(baseSnapshot), desiredFingerprint:incrementalFingerprint(desiredSnapshot) };
}

/** Caller persists baseline markdown+snapshot before editing. dryRun is entirely local. */
export async function runIncremental(config, options, fetchImpl = fetch) {
  const { action = 'plan', baseSnapshot, desiredSnapshot, target, type } = options;
  if (options.dryRun || action === 'plan') return planIncrementalLocal(baseSnapshot, desiredSnapshot);
  if (!['snapshot','preflight','apply'].includes(action)) throw new Error('未知增量action');
  if (action === 'apply' && options.confirmApply !== true) throw new Error('增量写入需要当前明确授权');
  if (action !== 'snapshot') planIncrementalLocal(baseSnapshot, desiredSnapshot);
  if (!target?.trainTaskId || !['ability','oral'].includes(type)) throw new Error('明确目标与基础版/口语类型必填');
  const cookie = sanitizeCookie(config.polymas.cookie);
  const credentials = { cookie, authorization:rawAuthorization(cookie,config.polymas.authorization), userNid:config.polymas.userNid || undefined, trainSubType:type };
  const response = await fetchImpl(`${config.appBaseUrl.replace(/\/+$/, '')}/api/training-inject/incremental`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,baseSnapshot,desiredSnapshot,trainTaskId:target.trainTaskId,type,courseId:target.courseId,libraryFolderId:target.libraryId || target.libraryFolderId,credentials,confirmApply:options.confirmApply === true}),
    signal:AbortSignal.timeout((options.timeoutSeconds || 1200)*1000),
  });
  const result = await response.json();
  // Return partial result to caller for persistence, never auto-retry/fallback.
  if (!response.ok && !result.applied) throw new Error(result.error || '增量接口失败，不自动重试');
  return result;
}
