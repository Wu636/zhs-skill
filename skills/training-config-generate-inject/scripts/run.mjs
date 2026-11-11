#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  CliError,
  argBool,
  argNumber,
  argString,
  exists,
  fail,
  fingerprint,
  log,
  nowStamp,
  ok,
  parseArgv,
  readJson,
  readText,
  slugify,
  toAbs,
  warn,
  writeJson,
  writeText,
} from "./lib/util.mjs";
import { describeCredentials, loadConfig, resolveRuntime } from "./lib/config.mjs";
import { consumeSSE, readErrorResponse } from "./lib/sse.mjs";
import {
  parseProConfig,
  summarizeConfig,
  validateProConfig,
} from "./lib/pro-config.mjs";
import {
  buildTargetUrl,
  collectSnapshot,
  compareSnapshot,
  createTrainingTask,
  inspectCookie,
  publishTrainingTask,
  sanitizeCookie,
} from "./lib/platform.mjs";
import {
  parseBasicScript,
  parseBasicRubric,
  serializeBasicRubric,
  serializeBasicScript,
  summarizeBasicConfig,
  validateBasicConfig,
} from "./lib/basic-config.mjs";
import {
  buildBasicTargetUrl,
  collectBasicSnapshot,
  compareBasicSnapshot,
  createBasicTrainingTask,
  ensureBasicBoundaryNodes,
  isBasicType,
  saveAndPublishBasicTrainingTask,
} from "./lib/platform-basic.mjs";
import { normalizeBasicMarkdown, normalizeProMarkdown } from "./lib/normalize.mjs";
import { runTrainingTest } from "./lib/test-run.mjs";
import { savePulledRubricSidecar, selectStructuredRubric, loadStructuredRubricHelpers } from "./lib/rubric-structured.mjs";
import { parsedIncrementalDocument, buildDesiredSnapshot, runIncremental } from "./lib/incremental.mjs";
import { prepareTrainingImages } from "./lib/prepare-images.mjs";
import {
  applyOptimizedScript,
  evaluateRun,
  optimizeScript,
} from "./lib/iteration.mjs";
import { attachStageAssets, setTrainingVoice, detachHtmlResources } from "./lib/assets.mjs";
import { attachImageResources } from "./lib/image-resources.mjs";
import { buildReviewPacket, parseReviewVerdict } from "./lib/review.mjs";

const HELP = `训练配置生成与注入流水线

用法:
  node scripts/run.mjs <命令> [选项]

命令:
  paths                         显示本端配置与运行目录，不读配置、不联网
  doctor                        检查本地应用、解析器、凭证与 LLM 配置
  plan --doc <文件>              为基础版/口语训练生成模块规划（阶段数校验）
  generate --doc <文件>          Pro 用 /api/training-generate-pro；基础版/口语用 /api/training-generate
  normalize --run <目录>         生成结果结构不规范时先做机械修正（词汇键名/围栏/Pro 标签），再校验
  validate [配置.md|run目录]     用项目自带解析器校验配置结构
  dialogue --run <目录>          调用 /api/training-generate-pro/dialogue 生成预设对话（仅 Pro）
  create-task --run <目录>       在 Polymas 新建能力训练任务
  pull --target-url <url>        从平台已有基础版/口语训练反向生成 script.md/rubric.md
  inject --run <目录>            注入配置（Pro 或基础版/口语）
  incremental --run <目录>       基础版/口语文本增量；--action snapshot|plan|preflight|apply，apply须--yes
  prepare-images --run <目录> --yes  基础版/口语仅准备图片，不写节点；--image-ids cover,background:1
  verify --run <目录>            回读平台并比对结构
  publish --run <目录> --yes     发布能力训练任务（对线上可见）
  test --run <目录>              发布后自动跑测试脚本：模拟学生走完整条训练并输出对话 TXT
  review --run <目录>            生成 agent 自审材料（教师文档 + 剧本 + 对话），不做 21 维评测
  finalize --run <目录>          只导出测试对话与剧本，并清理运行目录中间文件
  evaluate --run <目录>          系统 21 维评测（较慢，仅用户明确要求时加 --confirm-evaluate）
  optimize --run <目录>          按教师意见或自审结论调用闭环优化，修订剧本并校验
  loop --run <目录> --review <自审文件>  执行一轮“自审 → 优化 → 重注入 → 回读 → 重测”（耗时较长，必须加 --confirm-loop）
  run --doc <文件> ...           串联生成 → 规范化 → 校验 → 新建/复用 → 注入 → 回读 → 自动发布 → 测试输出脚本

训练类型:
  --type pro|ability|oral        默认 pro。ability=基础版能力训练，oral=口语训练

常用选项:
  --client <应用>                qoder-cn|qoder|dsh|hermes，选择本端数据
  --config <路径>                独立配置文件，默认所选端的 config/config.json
  --app-url <url>                本地应用地址，默认 http://localhost:3000
  --app-root <路径>              Agent_Evaluation/frontend 路径
  --name <名称>                  任务名称，默认取文档文件名
  --doc <文件>                   教师文档路径（test 也可用来指定脚本导出目录）
  --advice <文本>                用户对本次生成的补充建议
  --model <模型>                 生成模型
  --flow auto|linear|graph       基础版/口语规划流程偏好，默认 auto
  --no-plan                      基础版/口语跳过模块规划（不推荐，容易缺阶段）
  --target-url <url>             已有能力训练页面 URL（可从中解析 trainTaskId 与类型）
  --create                       新建能力训练任务
  --course-id <id>               课程 ID（新建任务必填）
  --cover <图片路径>             新建任务时上传的封面
  --mode fresh|append            注入模式，默认 fresh
  --confirm-fresh                确认清空目标任务的既有阶段与成员
  --publish / --no-publish        注入回读通过后自动发布，默认发布；--no-publish 关闭
  --test / --no-test              发布后自动跑测试脚本，默认开启；--no-test 关闭
  --student good|guided|offtopic|all  测试模拟的学生档位，默认 good；all 三档都跑
  --max-rounds <n>                测试时每个阶段最多模拟轮次，默认 10
  --image-concurrency <n>         注入时图片准备并发，默认3，范围1..8
  --image-cache reuse|refresh|off  注入时图片准备缓存策略，默认reuse
  --image-strategy preserve|missing|regenerate  保留原图/补缺/生成，默认regenerate
  --no-reference                  测试时不预生成参考对话（默认按剧本预生成并供模拟学生参考）
  --no-doc-export                 独立 test 只写运行目录，不额外复制教师目录（批量并发推荐）
  --pass-score <n>                系统评测通过线，默认 75（仅 evaluate）
  --confirm-evaluate              确认运行系统 21 维评测（较慢，仅用户明确要求时使用）
  --feedback <文本>               教师修改意见（optimize / loop）
  --feedback-file <文件>          从自审文件读取修改意见（optimize / loop）
  --review <文件>                 agent 自审结论文件（loop 必填，首行写“结论：通过/不通过”）
  --confirm-loop                  确认开启 loop（耗时较长，必须先得到用户明确许可）
  --max-actions <n>               单轮最多修订几个阶段，默认 3（optimize / loop）
  --max-iterations <n>            loop 总轮次上限，默认 3
  --force-optimize                loop 收到“通过”自审时仍先落地一轮教师意见
  --stages 1,2                   仅生成指定阶段的预设对话
  --rounds <n>                   预设对话目标轮次（2-12）
  --run <目录>                   复用已有运行目录
  --out <目录>                   指定新的运行目录
  --out-dir <目录>               交付文件输出目录，默认 <当前目录>/交付（finalize / 自动清理）
  --keep-evidence                保留运行目录，不清理中间文件（finalize / run / loop）
  --allow-missing-test           没有测试对话时也交付剧本并清理（finalize）
  --no-cleanup                   run / loop 结束时不做交付清理
  --allow-errors                 校验有 error 时仍继续注入（不推荐）
  --dry-run                      normalize 只报告不写盘
  --timeout <秒>                 单次请求超时，默认 1200 秒

环境变量:
  TRAINING_CLIENT, TRAINING_CONFIG
  TRAINING_APP_BASE_URL, TRAINING_APP_ROOT
  LLM_API_URL, LLM_API_KEY, LLM_MODEL
  POLYMAS_COOKIE, POLYMAS_AUTHORIZATION, POLYMAS_COURSE_ID
`;

function normalizeType(value, fallback = "pro") {
  const type = String(value || "").trim().toLowerCase();
  if (["pro", "ability", "oral"].includes(type)) return type;
  if (!type) return fallback;
  throw new CliError(`--type 仅支持 pro、ability、oral，收到: ${value}`);
}

function resolveType(flags, config, target = null) {
  const explicit = argString(flags, "type");
  if (explicit) return normalizeType(explicit);
  if (target?.type) return target.type;
  if (flags.run) {
    const meta = readJson(path.join(toAbs(argString(flags, "run")), "run.json"), {});
    if (meta.type) return normalizeType(meta.type);
  }
  return normalizeType(config.training?.type, "pro");
}

function inferTypeFromUrl(url) {
  if (!url) return "";
  if (url.includes("/language-training/")) return "oral";
  if (url.includes("/ability-training/")) return "ability";
  if (url.includes("/ability-training-pro/")) return "pro";
  return "";
}

function maskSecret(value) {
  if (!value) return "(未配置)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function createRunDir(config, taskName) {
  const dir = path.join(config.runsRoot, `${nowStamp()}-${slugify(taskName)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveRunDir(flags) {
  const explicit = argString(flags, "run", "out");
  if (!explicit) throw new CliError("请通过 --run <目录> 指定运行目录");
  const dir = toAbs(explicit);
  if (!exists(dir)) throw new CliError(`运行目录不存在: ${dir}`);
  return dir;
}

function loadRun(runDir) {
  const meta = readJson(path.join(runDir, "run.json"), {});
  return {
    meta,
    configPath: path.join(runDir, "config.md"),
  };
}

function saveRun(runDir, meta) {
  writeJson(path.join(runDir, "run.json"), { ...meta, updatedAt: new Date().toISOString() });
}

function safeFileBase(value, fallback = "训练") {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|\r\n\t]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return cleaned.slice(0, 80) || fallback;
}

function resolveRunTaskName(runDir, meta) {
  const pull = readJson(path.join(runDir, "pull.json"), {});
  return meta.taskName || pull.taskName || meta.target?.trainTaskId || path.basename(runDir);
}

function resolveDeliverBase(flags) {
  const out = argString(flags, "out-dir");
  return out ? toAbs(out) : path.join(process.cwd(), "交付");
}

function finalizeRun(runDir, flags, options = {}) {
  const meta = readJson(path.join(runDir, "run.json"), {});
  const student = options.student || argString(flags, "student") || "good";
  const scriptName = exists(path.join(runDir, "script.md")) ? "script.md" : "config.md";
  const scriptPath = path.join(runDir, scriptName);
  if (!exists(scriptPath)) {
    throw new CliError(`运行目录缺少 script.md / config.md: ${runDir}`);
  }
  const testPath = path.join(runDir, `test-${student}.txt`);
  if (!exists(testPath) && !options.allowMissingTest) {
    throw new CliError(
      `缺少 test-${student}.txt，暂不清理运行目录。\n先跑 test 生成测试对话，或加 --allow-missing-test 只交付剧本。`,
    );
  }

  const baseName = safeFileBase(options.taskName || resolveRunTaskName(runDir, meta));
  const outDir = path.join(resolveDeliverBase(flags), baseName);
  const resolvedRun = path.resolve(runDir);
  const resolvedOut = path.resolve(outDir);
  if (resolvedOut === resolvedRun || resolvedOut.startsWith(`${resolvedRun}${path.sep}`)) {
    throw new CliError("交付目录不能位于运行目录内部，否则会随清理一起删除");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const scriptTarget = path.join(outDir, `${baseName}-剧本.md`);
  fs.copyFileSync(scriptPath, scriptTarget);
  const deliverables = [scriptTarget];
  if (fs.statSync(scriptTarget).size !== fs.statSync(scriptPath).size) {
    throw new CliError(`剧本交付文件校验失败: ${scriptTarget}`);
  }
  if (exists(testPath)) {
    const testTarget = path.join(outDir, `${baseName}-测试对话-${student}.txt`);
    fs.copyFileSync(testPath, testTarget);
    if (fs.statSync(testTarget).size !== fs.statSync(testPath).size) {
      throw new CliError(`测试对话交付文件校验失败: ${testTarget}`);
    }
    deliverables.push(testTarget);
  }

  const keepEvidence = argBool(flags, "keep-evidence", false) || options.keepEvidence;
  if (!keepEvidence) {
    const cwd = path.resolve(process.cwd());
    if (resolvedRun === cwd || resolvedRun.startsWith(`${cwd}${path.sep}`)) {
      throw new CliError("运行目录包含当前工作目录，拒绝清理；请把交付目录指到别处后重试");
    }
    fs.rmSync(resolvedRun, { recursive: true, force: true });
  }
  return { outDir, deliverables, cleaned: !keepEvidence };
}

function reportFinalize(result) {
  ok(`交付文件已保存: ${result.outDir}`);
  for (const file of result.deliverables) log(`  - ${file}`);
  log(
    result.cleaned
      ? "[finalize] 运行目录已清理，只保留上述交付文件"
      : "[finalize] 已按 --keep-evidence 保留运行目录",
  );
}

function readRunConfig(runDir) {
  const configPath = path.join(runDir, "config.md");
  if (!exists(configPath)) {
    throw new CliError(`运行目录缺少 config.md: ${runDir}`);
  }
  return { markdown: readText(configPath), configPath };
}

function formatValidation(report, { verbose = true } = {}) {
  const lines = [];
  const parts = [`${report.stats.stages} 阶段`];
  if (report.stats.members !== undefined) parts.push(`${report.stats.members} 成员`);
  if (report.stats.skills !== undefined) parts.push(`${report.stats.skills} 技能`);
  if (report.stats.rubricItems !== undefined) parts.push(`${report.stats.rubricItems} 评分项`);
  if (report.stats.vocabulary !== undefined) parts.push(`${report.stats.vocabulary} 词汇`);
  parts.push(`${report.stats.characters} 字符`);
  lines.push(`结构: ${parts.join(" / ")}`);
  if (report.errors.length > 0) {
    lines.push(`错误 ${report.errors.length}:`);
    report.errors.slice(0, verbose ? 50 : 10).forEach((item) => lines.push(`  - ${item}`));
  }
  if (report.warnings.length > 0) {
    lines.push(`警告 ${report.warnings.length}:`);
    report.warnings.slice(0, verbose ? 30 : 8).forEach((item) => lines.push(`  - ${item}`));
  }
  if (report.errors.length === 0 && report.warnings.length === 0) {
    lines.push("校验通过，无错误或警告。");
  }
  return lines.join("\n");
}

async function generateConfig(config, options) {
  const {
    docPath,
    docName,
    advice,
    promptTemplate,
    runDir,
    timeoutSeconds,
  } = options;

  if (docPath && !exists(docPath)) {
    throw new CliError(`教师文档不存在: ${docPath}`);
  }
  const ext = docPath ? path.extname(docPath).toLowerCase() : "";
  const isBinary = [".doc", ".docx"].includes(ext);
  if (ext === ".pdf") {
    warn("PDF 不在生成接口的解析范围内，建议先转成 docx 或 md。");
  }

  const displayName = docName || (docPath ? path.basename(docPath, ext) : "未命名任务");
  const payload = {
    teacherDocName: displayName,
    apiKey: config.llm.apiKey,
    apiUrl: config.llm.apiUrl,
    model: config.llm.model,
    userGenerationAdvice: advice,
  };
  if (promptTemplate) payload.promptTemplate = promptTemplate;

  let body;
  let headers = {};
  if (isBinary) {
    const form = new FormData();
    Object.entries(payload).forEach(([key, value]) => form.append(key, value || ""));
    form.append(
      "file",
      new Blob([fs.readFileSync(docPath)]),
      path.basename(docPath),
    );
    body = form;
  } else {
    let text;
    if (docPath) {
      text = readText(docPath);
    } else {
      throw new CliError("请通过 --doc <文件> 提供教师任务文档");
    }
    payload.teacherDocContent = text;
    body = JSON.stringify(payload);
    headers = { "Content-Type": "application/json" };
  }

  log(`[gen] 调用生成接口: ${config.appBaseUrl}/api/training-generate-pro`);
  log(`[gen] 文档: ${docPath ? path.basename(docPath) : displayName}`);

  let response;
  try {
    response = await fetch(`${config.appBaseUrl}/api/training-generate-pro`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout((timeoutSeconds || 1200) * 1000),
    });
  } catch (error) {
    throw new CliError(
      `生成请求失败: ${error.message}\n请确认本地应用已启动（${config.appBaseUrl}）。`,
    );
  }
  if (!response.ok) {
    throw new CliError(`生成接口返回 HTTP ${response.status}: ${await readErrorResponse(response)}`);
  }

  const startedAt = Date.now();
  let lastReport = 0;
  let chunks = 0;
  let content = "";
  let taskName = displayName;
  let streamError = "";

  const events = await consumeSSE(response, (event) => {
    if (event.type === "chunk" && typeof event.content === "string") {
      content += event.content;
      chunks += 1;
      if (Date.now() - lastReport > 4000) {
        lastReport = Date.now();
        log(`[gen] 已生成 ${content.length} 字符...`);
      }
    } else if (event.type === "start") {
      log(`[gen] ${event.message || "开始生成"}`);
    } else if (event.type === "complete") {
      if (event.fullContent) content = event.fullContent;
      if (event.taskName) taskName = event.taskName;
    } else if (event.type === "error") {
      streamError = event.message || "生成失败";
    }
  });

  const logLines = events
    .filter((event) => event.type !== "chunk")
    .map((event) => JSON.stringify(event));
  writeText(
    path.join(runDir, "generate.events.jsonl"),
    `${logLines.join("\n")}${logLines.length ? "\n" : ""}`,
  );

  if (streamError) {
    if (content.trim()) {
      writeText(path.join(runDir, "config.partial.md"), content);
      throw new CliError(
        `${streamError}\n已保存部分内容: ${path.join(runDir, "config.partial.md")}`,
      );
    }
    throw new CliError(streamError);
  }
  if (!content.trim()) {
    throw new CliError("生成结束但未返回配置内容");
  }

  const configPath = writeText(path.join(runDir, "config.md"), content);
  writeJson(path.join(runDir, "config.meta.json"), {
    taskName,
    docPath: docPath || "",
    docName: displayName,
    advice,
    model: config.llm.model || "(服务端默认)",
    characters: content.length,
    chunks,
    fingerprint: fingerprint(content),
    generatedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  });

  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, {
    ...meta,
    taskName,
    docPath: docPath || meta.docPath || "",
    docName: displayName,
    advice,
    configPath,
    configFingerprint: fingerprint(content),
  });

  log(`[ok] 生成完成: ${content.length} 字符，耗时 ${Math.round((Date.now() - startedAt) / 1000)} 秒`);
  log(`[ok] 配置已保存: ${configPath}`);
  return { content, taskName, configPath, runDir };
}

function buildBasicDocBody(docPath, fields) {
  const ext = docPath ? path.extname(docPath).toLowerCase() : "";
  const isBinary = [".doc", ".docx"].includes(ext);
  if (isBinary) {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    });
    form.append("file", new Blob([fs.readFileSync(docPath)]), path.basename(docPath));
    return { body: form, headers: {} };
  }
  const payload = {
    ...fields,
    teacherDocContent: readText(docPath),
  };
  return {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  };
}

async function planBasicConfig(config, options) {
  const { docPath, docName, type, advice, flow, timeoutSeconds } = options;
  const { body, headers } = buildBasicDocBody(docPath, {
    trainingType: type,
    teacherDocName: docName,
    planningFeedback: advice || "",
    flowPreference: flow || "auto",
    teacherDocSource: "original",
    apiKey: config.llm.apiKey,
    apiUrl: config.llm.apiUrl,
    model: config.llm.model,
  });
  log(`[plan] 调用模块规划接口: ${config.appBaseUrl}/api/training-generate/plan`);
  let response;
  try {
    response = await fetch(`${config.appBaseUrl}/api/training-generate/plan`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout((timeoutSeconds || 600) * 1000),
    });
  } catch (error) {
    throw new CliError(`模块规划请求失败: ${error.message}`);
  }
  if (!response.ok) {
    throw new CliError(`模块规划接口返回 HTTP ${response.status}: ${await readErrorResponse(response)}`);
  }
  const data = await response.json();
  const planErrors = (data.validation || [])
    .filter((item) => item.level === "error")
    .map((item) => item.message);
  if (planErrors.length > 0) {
    throw new CliError(`模块规划存在错误: ${planErrors.join("；")}`);
  }
  return data.plan;
}

async function generateBasicConfig(config, options) {
  const {
    docPath,
    docName,
    advice,
    runDir,
    timeoutSeconds,
    type,
    plan,
  } = options;
  if (docPath && !exists(docPath)) {
    throw new CliError(`教师文档不存在: ${docPath}`);
  }
  const ext = docPath ? path.extname(docPath).toLowerCase() : "";
  if (ext === ".pdf") {
    warn("PDF 不在生成接口的解析范围内，建议先转成 docx 或 md。");
  }
  const displayName = docName || plan?.taskName || (docPath ? path.basename(docPath, ext) : "未命名任务");
  const { body, headers } = buildBasicDocBody(docPath, {
    trainingType: type,
    teacherDocName: displayName,
    generateScript: true,
    generateRubric: type === "ability",
    scriptMode: "general",
    skipRubricSections: true,
    modulePlan: plan || undefined,
    userSuggestions: advice || undefined,
    apiKey: config.llm.apiKey,
    apiUrl: config.llm.apiUrl,
    model: config.llm.model,
  });

  log(`[gen] 调用生成接口: ${config.appBaseUrl}/api/training-generate`);
  log(`[gen] 类型: ${type === "oral" ? "口语训练" : "基础版能力训练"}`);
  log(`[gen] 文档: ${docPath ? path.basename(docPath) : displayName}`);

  let response;
  try {
    response = await fetch(`${config.appBaseUrl}/api/training-generate`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout((timeoutSeconds || 1200) * 1000),
    });
  } catch (error) {
    throw new CliError(
      `生成请求失败: ${error.message}\n请确认本地应用已启动（${config.appBaseUrl}）。`,
    );
  }
  if (!response.ok) {
    throw new CliError(`生成接口返回 HTTP ${response.status}: ${await readErrorResponse(response)}`);
  }

  const startedAt = Date.now();
  let lastReport = 0;
  let chunks = 0;
  const phaseContent = { script: "", rubric: "" };
  let phase = "script";
  let complete = null;
  let streamError = "";

  const events = await consumeSSE(response, (event) => {
    if (event.type === "chunk" && typeof event.content === "string") {
      const target = event.phase === "rubric" ? "rubric" : "script";
      phase = target;
      phaseContent[target] += event.content;
      chunks += 1;
      if (Date.now() - lastReport > 4000) {
        lastReport = Date.now();
        log(`[gen] ${target === "script" ? "剧本" : "评价标准"}已生成 ${phaseContent[target].length} 字符...`);
      }
    } else if (event.type === "phase_complete" && typeof event.fullContent === "string") {
      phaseContent[event.phase === "rubric" ? "rubric" : "script"] = event.fullContent;
    } else if (event.type === "start") {
      log(`[gen] ${event.message || "开始生成"}`);
    } else if (event.type === "progress") {
      log(`[gen] ${event.message || ""}`);
    } else if (event.type === "complete") {
      complete = event;
    } else if (event.type === "error") {
      streamError = event.message || "生成失败";
    }
  });

  const logLines = events
    .filter((event) => event.type !== "chunk")
    .map((event) => JSON.stringify(event));
  writeText(
    path.join(runDir, "generate.events.jsonl"),
    `${logLines.join("\n")}${logLines.length ? "\n" : ""}`,
  );

  let script = complete?.script || phaseContent.script || "";
  let rubric = complete?.rubric || phaseContent.rubric || "";
  if (streamError) {
    if (script.trim() || rubric.trim()) {
      writeText(path.join(runDir, "config.partial.md"), [script, rubric].filter(Boolean).join("\n\n"));
      throw new CliError(
        `${streamError}\n已保存部分内容: ${path.join(runDir, "config.partial.md")}`,
      );
    }
    throw new CliError(streamError);
  }
  if (!script.trim()) {
    throw new CliError("生成结束但未返回训练剧本内容");
  }

  const taskName = complete?.taskName || plan?.taskName || displayName;
  const scriptPath = writeText(path.join(runDir, "script.md"), script);
  const rubricPath = writeText(path.join(runDir, "rubric.md"), rubric || "");
  const configPath = writeText(
    path.join(runDir, "config.md"),
    [script.trim(), rubric.trim()].filter(Boolean).join("\n\n"),
  );
  if (plan) writeJson(path.join(runDir, "plan.json"), plan);
  writeJson(path.join(runDir, "config.meta.json"), {
    type,
    taskName,
    docPath: docPath || "",
    docName: displayName,
    advice,
    model: config.llm.model || "(服务端默认)",
    characters: script.length + rubric.length,
    chunks,
    scriptChars: script.length,
    rubricChars: rubric.length,
    resolvedScriptMode: complete?.resolvedScriptMode || "",
    fingerprint: fingerprint(`${script}\n${rubric}`),
    generatedAt: new Date().toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
  });

  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, {
    ...meta,
    type,
    taskName,
    docPath: docPath || meta.docPath || "",
    docName: displayName,
    advice,
    scriptPath,
    rubricPath,
    configPath,
    configFingerprint: fingerprint(`${script}\n${rubric}`),
  });

  log(`[ok] 生成完成: 剧本 ${script.length} 字符 / 评价标准 ${rubric.length} 字符，耗时 ${Math.round((Date.now() - startedAt) / 1000)} 秒`);
  log(`[ok] 剧本已保存: ${scriptPath}`);
  return { content: script, script, rubric, taskName, configPath, runDir };
}



function validateAndReport(config, markdown, { saveTo, type = "pro", rubric = "" } = {}) {
  const report = isBasicType(type)
    ? validateBasicConfig(config.appRoot, { script: markdown, rubric, type })
    : validateProConfig(config.appRoot, markdown);
  if (saveTo) writeJson(path.join(saveTo, "validate.json"), report);
  return report;
}

async function commandDoctor(config) {
  const checks = [];
  let hardFailure = false;

  const parserPath = path.join(config.appRoot || "", "lib/training-injector-pro/parser.ts");
  if (config.appRoot && exists(parserPath)) {
    checks.push(`[ok] 应用目录: ${config.appRoot}`);
  } else {
    hardFailure = true;
    checks.push(`[error] 未找到应用目录或 Pro 解析器（appRoot=${config.appRoot || "空"}）`);
  }

  try {
    const response = await fetch(config.appBaseUrl, {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    checks.push(`[ok] 本地应用可达: ${config.appBaseUrl} (HTTP ${response.status})`);
  } catch (error) {
    hardFailure = true;
    checks.push(
      `[error] 本地应用不可达: ${config.appBaseUrl} (${error.message})，请先启动 frontend`,
    );
  }

  const cred = describeCredentials(config);
  if (cred.hasCookie) {
    const info = inspectCookie(config.polymas.cookie);
    if (info.expired === true) {
      checks.push(`[warn] Cookie 中的 ai-poly 已过期（${info.expiresAt}），请重新登录`);
    } else if (info.expiresAt) {
      checks.push(`[ok] Polymas Cookie 已配置，ai-poly 有效期至 ${info.expiresAt}`);
    } else {
      checks.push("[ok] Polymas Cookie 已配置（未识别到 ai-poly JWT）");
    }
  } else {
    checks.push("[warn] 未配置 Polymas Cookie，生成与校验可用，注入/发布不可用");
  }
  checks.push(
    cred.hasAuthorization
      ? "[ok] Authorization 已显式配置"
      : "[info] 未显式配置 Authorization，仅使用 Cookie 鉴权",
  );

  checks.push(
    config.polymas.courseId
      ? `[ok] courseId: ${config.polymas.courseId}`
      : "[warn] 未配置 courseId，页面链接与发布不可用（新建/注入仍可用）",
  );

  checks.push(
    config.llm.apiKey
      ? `[ok] LLM 凭证: ${maskSecret(config.llm.apiKey)} ${config.llm.model || "(默认模型)"}`
      : "[warn] 未读取到 LLM 凭证，将依赖本地应用自身的 .env 配置",
  );

  checks.push(
    `[info] 配置来源: ${exists(config.configPath) ? config.configPath : "未创建 config/config.json"}`,
  );
  checks.push(`[info] 运行产物目录: ${config.runsRoot}`);

  log(checks.join("\n"));
  return hardFailure ? 1 : 0;
}

const ORAL_OUTPUT_REQUIREMENT =
  "口语训练必须逐阶段输出「**重点词汇**:」字段和紧随其后的 JSON 代码块（位于开场白之前），结构为 [{\"vocabulary\":\"词汇或短语\",\"explanation\":\"文档中的释义（没有则留空）\",\"exampleSentence\":\"例句\",\"source\":\"教师文档中的对应原文短句\"}]；文档没有明确依据时输出 []。不得遗漏该字段，不得凭空编造词汇。";

function withTypeAdvice(type, advice) {
  if (type !== "oral") return advice;
  if (String(advice || "").includes("重点词汇")) return advice;
  return [advice, ORAL_OUTPUT_REQUIREMENT].filter(Boolean).join("\n");
}

function readRunScript(runDir) {
  const scriptPath = path.join(runDir, "script.md");
  if (exists(scriptPath)) return { markdown: readText(scriptPath), path: scriptPath };
  return readRunConfig(runDir);
}

function readRunRubric(runDir) {
  const rubricPath = path.join(runDir, "rubric.md");
  return exists(rubricPath) ? readText(rubricPath) : "";
}

async function commandGenerate(config, flags) {
  const docPath = toAbs(argString(flags, "doc"));
  if (!docPath) throw new CliError("请通过 --doc <教师任务文档> 指定输入");
  const type = resolveType(flags, config);
  const name = argString(flags, "name");
  const advice = withTypeAdvice(type, argString(flags, "advice"));
  const promptTemplatePath = argString(flags, "prompt-template");
  const promptTemplate = promptTemplatePath ? readText(toAbs(promptTemplatePath)) : "";
  const runDir = argString(flags, "out")
    ? (() => {
        const dir = toAbs(argString(flags, "out"));
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      })()
    : createRunDir(config, name || path.basename(docPath));

  let result;
  let rubric = "";
  if (isBasicType(type)) {
    let plan = null;
    if (!argBool(flags, "no-plan", false)) {
      plan = await planBasicConfig(config, {
        docPath,
        docName: name || path.basename(docPath),
        type,
        advice,
        flow: argString(flags, "flow") || "auto",
        timeoutSeconds: argNumber(flags, "timeout", 600),
      });
      writeJson(path.join(runDir, "plan.json"), plan);
      log(`[plan] 规划完成: ${plan.modules?.length || 0} 个阶段`);
    }
    result = await generateBasicConfig(config, {
      docPath,
      docName: name,
      advice,
      runDir,
      type,
      plan,
      timeoutSeconds: argNumber(flags, "timeout", 1200),
    });
    rubric = result.rubric;
  } else {
    result = await generateConfig(config, {
      docPath,
      docName: name,
      advice,
      promptTemplate,
      runDir,
      timeoutSeconds: argNumber(flags, "timeout", 1200),
    });
  }

  saveRun(runDir, { ...readJson(path.join(runDir, "run.json"), {}), type });
  const report = validateAndReport(config, result.script || result.content, {
    saveTo: runDir,
    type,
    rubric,
  });
  log("");
  log(formatValidation(report));
  log("");
  log(`运行目录: ${runDir}`);
  if (report.errors.length > 0) {
    log("提示: 先修正校验错误（可直接编辑 config.md / script.md）再注入，或用 --advice 重新生成。");
  }
  return 0;
}

async function commandPlan(config, flags) {
  const docPath = toAbs(argString(flags, "doc"));
  if (!docPath) throw new CliError("请通过 --doc <教师任务文档> 指定输入");
  const type = resolveType(flags, config);
  if (!isBasicType(type)) {
    throw new CliError("模块规划仅用于基础版/口语训练，请加 --type ability 或 --type oral");
  }
  const name = argString(flags, "name") || path.basename(docPath);
  const runDir = argString(flags, "out")
    ? (() => {
        const dir = toAbs(argString(flags, "out"));
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      })()
    : createRunDir(config, name);
  const plan = await planBasicConfig(config, {
    docPath,
    docName: name,
    type,
    advice: withTypeAdvice(type, argString(flags, "advice")),
    flow: argString(flags, "flow") || "auto",
    timeoutSeconds: argNumber(flags, "timeout", 600),
  });
  writeJson(path.join(runDir, "plan.json"), plan);
  saveRun(runDir, { createdAt: new Date().toISOString(), type, docPath, taskName: plan.taskName });
  log(`[plan] 任务: ${plan.taskName || name}`);
  log(`[plan] 流程: ${plan.flowType || "linear"} / ${plan.modules?.length || 0} 个阶段`);
  (plan.modules || []).forEach((module, index) => {
    log(`  ${index + 1}. ${module.title}（${module.moduleType}）`);
  });
  log(`保存: ${path.join(runDir, "plan.json")}`);
  return 0;
}

function normalizeRunFile(runDir, type, { dryRun = false } = {}) {
  const scriptPath = path.join(runDir, "script.md");
  const targetPath = exists(scriptPath) ? scriptPath : path.join(runDir, "config.md");
  if (!exists(targetPath)) {
    throw new CliError(`运行目录缺少 script.md / config.md: ${runDir}`);
  }
  const original = readText(targetPath);
  const result = isBasicType(type)
    ? normalizeBasicMarkdown(original, { type })
    : normalizeProMarkdown(original);
  const changed = result.changes.length > 0 && result.text !== original;

  if (result.changes.length > 0) {
    log(`[normalize] 修正 ${result.changes.length} 处：`);
    result.changes.forEach((item) => log(`  - ${item}`));
  } else {
    log("[normalize] 未发现可机械修正的结构问题");
  }
  if (result.pending.length > 0) {
    warn(`[normalize] 仍需补充或确认 ${result.pending.length} 项：`);
    result.pending.forEach((item) => log(`  - ${item}`));
  }

  if (changed && !dryRun) {
    const backupPath = path.join(runDir, `${path.basename(targetPath, ".md")}.orig.md`);
    if (!exists(backupPath)) writeText(backupPath, original);
    writeText(targetPath, result.text);
    log(`[normalize] 已写回 ${path.basename(targetPath)}（原始版本 ${path.basename(backupPath)}）`);
  } else if (changed && dryRun) {
    log("[normalize] --dry-run：未写盘");
  }

  return { ...result, changed, path: targetPath, original };
}

async function commandNormalize(config, flags) {
  const runDir = resolveRunDir(flags);
  const type = resolveType(flags, config, {
    type: readJson(path.join(runDir, "run.json"), {}).type,
  });
  const dryRun = argBool(flags, "dry-run");
  const result = normalizeRunFile(runDir, type, { dryRun });

  const rubric = readRunRubric(runDir);
  const report = validateAndReport(config, result.text, { saveTo: dryRun ? "" : runDir, type, rubric });
  log("");
  log(formatValidation(report));
  writeJson(path.join(runDir, "normalize.json"), {
    type,
    updatedAt: new Date().toISOString(),
    dryRun,
    changes: result.changes,
    pending: result.pending,
    ok: report.ok,
    errors: report.errors,
    warnings: report.warnings,
    stats: report.stats,
  });
  if (!report.ok) {
    warn("[normalize] 仍有 error：按上面 pending 清单补内容后重跑 validate；不要直接注入。");
  }
  return report.ok ? 0 : 1;
}

async function commandValidate(config, flags, positional) {
  let markdown;
  let rubric = "";
  let saveTo = "";
  let type = resolveType(flags, config);
  const target = positional[0] || argString(flags, "run");
  if (!target) throw new CliError("请提供配置路径或 --run <目录>");
  const absolute = toAbs(target);
  if (exists(absolute) && fs.statSync(absolute).isDirectory()) {
    markdown = readRunScript(absolute).markdown;
    rubric = readRunRubric(absolute);
    saveTo = absolute;
    if (!argString(flags, "type")) {
      type = resolveType(flags, config, { type: readJson(path.join(absolute, "run.json"), {}).type });
    }
  } else if (exists(absolute)) {
    markdown = readText(absolute);
  } else {
    throw new CliError(`文件不存在: ${absolute}`);
  }

  const report = validateAndReport(config, markdown, { saveTo, type, rubric });
  log(formatValidation(report));
  if (report.config) {
    if (isBasicType(type)) {
      const summary = summarizeBasicConfig(report.config, parseBasicRubric(config.appRoot, rubric));
      log("");
      log(`能力名称: ${summary.abilityName}`);
      log(`阶段: ${summary.stages.map((stage) => `${stage.index}.${stage.name}`).join(" → ")}`);
      log(`评分项: ${summary.rubric.items} 项 / 总分 ${summary.rubric.total}`);
    } else {
      const summary = summarizeConfig(report.config);
      log("");
      log(`能力名称: ${summary.abilityName}`);
      log(`阶段: ${summary.stages.map((stage) => `${stage.index}.${stage.name}`).join(" → ")}`);
      log(`成员: ${summary.members.map((member) => member.name).join("、") || "无"}`);
    }
  }
  return report.ok ? 0 : 1;
}

async function commandDialogue(config, flags) {
  const runDir = resolveRunDir(flags);
  const { markdown } = readRunConfig(runDir);
  const stages = argString(flags, "stages")
    ? argString(flags, "stages")
        .split(",")
        .map((value) => Number(value.trim()) - 1)
        .filter((value) => Number.isInteger(value) && value >= 0)
    : undefined;
  const performance = argString(flags, "performance") || "competent";
  const targetRounds = flags.rounds ? argNumber(flags, "rounds", 4) : undefined;
  const extraRequirements = argString(flags, "extra");

  log("[dialogue] 调用预设对话生成接口...");
  const response = await fetch(
    `${config.appBaseUrl}/api/training-generate-pro/dialogue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown,
        stageIndexes: stages,
        performance,
        targetRounds,
        extraRequirements,
        apiKey: config.llm.apiKey,
        apiUrl: config.llm.apiUrl,
        model: config.llm.model,
      }),
      signal: AbortSignal.timeout(argNumber(flags, "timeout", 1200) * 1000),
    },
  );
  if (!response.ok) {
    throw new CliError(`预设对话生成失败: ${await readErrorResponse(response)}`);
  }

  let result = null;
  let errorMessage = "";
  const events = await consumeSSE(response, (event) => {
    if (event.type === "progress") {
      log(`[dialogue] ${event.message || `${event.current}/${event.total}`}`);
    } else if (event.type === "complete") {
      result = event;
    } else if (event.type === "error") {
      errorMessage = event.error || "生成失败";
      if (event.partialStages) result = { stages: event.partialStages };
    }
  });

  writeText(
    path.join(runDir, "dialogue.events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  if (result?.stages) {
    writeJson(path.join(runDir, "dialogue.json"), result);
  }
  if (errorMessage) {
    throw new CliError(
      `${errorMessage}${result?.stages ? `\n已保留部分结果: ${path.join(runDir, "dialogue.json")}` : ""}`,
    );
  }
  const totalMessages = (result?.stages || []).reduce(
    (sum, stage) => sum + (stage.messages?.length || 0),
    0,
  );
  ok(`预设对话生成完成: ${result?.stages?.length || 0} 个阶段 / ${totalMessages} 条消息`);
  log(`保存: ${path.join(runDir, "dialogue.json")}`);
}

async function commandCreateTask(config, flags) {
  const runDir = resolveRunDir(flags);
  const type = resolveType(flags, config);
  const coverPath = argString(flags, "cover");
  let name;
  let description;

  if (isBasicType(type)) {
    const { markdown } = readRunScript(runDir);
    const parsed = parseBasicScript(config.appRoot, markdown);
    const summary = summarizeBasicConfig(parsed);
    name = argString(flags, "name") || summary.abilityName;
    description =
      argString(flags, "description") ||
      summary.description ||
      (name ? `能力训练：${name}` : "");
    if (!name) throw new CliError("配置中没有任务名称，请通过 --name 指定");
    log(`[create] 新建${type === "oral" ? "口语训练" : "基础版能力训练"}: ${name}`);
    const target = await createBasicTrainingTask(config, {
      name,
      description,
      type,
      coverPath: coverPath ? toAbs(coverPath) : "",
    });
    writeJson(path.join(runDir, "target.json"), {
      ...target,
      createdAt: new Date().toISOString(),
    });
    try {
      const init = await ensureBasicBoundaryNodes(config, target.trainTaskId, type);
      if (init.created.length > 0) {
        log(`[create] 已初始化流程节点: ${init.created.join("、")}`);
      }
    } catch (error) {
      warn(`流程节点初始化失败（注入时会重试）: ${error.message}`);
    }
    const meta = readJson(path.join(runDir, "run.json"), {});
    saveRun(runDir, { ...meta, type, target });
    ok(`任务创建成功: trainTaskId=${target.trainTaskId}`);
    log(`页面链接: ${target.targetUrl}`);
    log("下一步: node scripts/run.mjs inject --run " + runDir);
    return;
  }

  const { markdown } = readRunConfig(runDir);
  const parsed = parseProConfig(config.appRoot, markdown);
  const summary = summarizeConfig(parsed);
  name = argString(flags, "name") || summary.abilityName;
  description =
    argString(flags, "description") ||
    summary.description ||
    (name ? `能力训练：${name}` : "");

  if (!name) throw new CliError("配置中没有能力名称，请通过 --name 指定");
  log(`[create] 新建能力训练 Pro: ${name}`);
  const target = await createTrainingTask(config, {
    name,
    description,
    coverPath: coverPath ? toAbs(coverPath) : "",
  });
  writeJson(path.join(runDir, "target.json"), {
    ...target,
    type: "pro",
    createdAt: new Date().toISOString(),
  });
  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, { ...meta, type: "pro", target });
  ok(`任务创建成功: trainTaskId=${target.trainTaskId}`);
  log(`页面链接: ${target.targetUrl}`);
  log("下一步: node scripts/run.mjs inject --run " + runDir);
}

function resolveTarget(config, flags) {
  const explicitUrl = argString(flags, "target-url");
  if (explicitUrl) {
    const url = new URL(explicitUrl);
    const trainTaskId = url.searchParams.get("trainTaskId") || "";
    if (!trainTaskId) throw new CliError("targetUrl 中缺少 trainTaskId 参数");
    return {
      targetUrl: explicitUrl,
      trainTaskId,
      courseId: url.pathname.split("/").filter(Boolean)[1] || "",
      type: inferTypeFromUrl(explicitUrl) || resolveType(flags, config),
    };
  }
  const runDir = argString(flags, "run");
  if (runDir) {
    const target = readJson(path.join(toAbs(runDir), "target.json"), null);
    if (target?.trainTaskId) {
      return {
        targetUrl:
          target.targetUrl ||
          buildTargetUrl(config, {
            courseId: target.courseId,
            trainTaskId: target.trainTaskId,
            libraryId: config.polymas.libraryId,
          }),
        trainTaskId: target.trainTaskId,
        courseId: target.courseId || "",
        type: target.type || inferTypeFromUrl(target.targetUrl) || resolveType(flags, config),
      };
    }
  }
  const trainTaskId = argString(flags, "train-task-id");
  if (trainTaskId) {
    const courseId = config.polymas.courseId;
    const type = resolveType(flags, config);
    return {
      targetUrl: isBasicType(type)
        ? buildBasicTargetUrl(config, {
            courseId,
            trainTaskId,
            libraryId: config.polymas.libraryId,
            type,
          })
        : buildTargetUrl(config, {
            courseId,
            trainTaskId,
            libraryId: config.polymas.libraryId,
          }),
      trainTaskId,
      courseId,
      type,
    };
  }
  throw new CliError("请通过 --target-url 或 --run（含 target.json）指定目标能力训练");
}

async function preflightTarget(config, target, mode) {
  if (isBasicType(target.type)) {
    const init = await ensureBasicBoundaryNodes(config, target.trainTaskId, target.type);
    if (init.created.length > 0) {
      log(`[inject] 已通过接口初始化流程节点: ${init.created.join("、")}`);
    }
    const snapshot = await collectBasicSnapshot(config, target.trainTaskId, target.type).catch(
      (error) => {
        throw new CliError(`读取目标任务失败: ${error.message}`);
      },
    );
    return {
      taskName: snapshot.configuration?.trainTaskName || "",
      steps: (snapshot.steps || []).length,
      roles: 0,
      skills: 0,
      hasExisting: (snapshot.steps || []).length > 0,
      mode,
    };
  }
  const snapshot = await collectSnapshot(config, target.trainTaskId).catch((error) => {
    throw new CliError(`读取目标任务失败: ${error.message}`);
  });
  const realRoles = (snapshot.roles || []).filter(
    (role) =>
      !(role.nid === "system" || role.roleType === "system" || role.systemRole === true),
  );
  return {
    taskName: snapshot.detail?.trainTaskName || "",
    steps: (snapshot.steps || []).length,
    roles: realRoles.length,
    skills: (snapshot.skills || []).length,
    hasExisting: (snapshot.steps || []).length > 0 || realRoles.length > 0,
    mode,
  };
}

function rawAuthorization(cookie, explicit) {
  const raw = String(explicit || "").trim();
  if (raw) return raw.replace(/^authorization\s*:\s*/i, "").replace(/^Bearer\s+/i, "").trim();
  const match = String(cookie || "").match(/(?:^|;\s*)(zhs-jt-cas|ai-poly)=([^;]+)/i);
  return match ? decodeURIComponent(match[2]) : "";
}

async function commandInject(config, flags) {
  const runDir = resolveRunDir(flags);
  const target = resolveTarget(config, flags);
  const type = target.type || resolveType(flags, config);
  const basic = isBasicType(type);
  const markdown = basic ? readRunScript(runDir).markdown : readRunConfig(runDir).markdown;
  const rubric = basic ? readRunRubric(runDir) : "";
  const mode = argString(flags, "mode") || config.inject.mode;
  if (!["fresh", "append"].includes(mode)) {
    throw new CliError("--mode 只支持 fresh 或 append");
  }
  const cookie = sanitizeCookie(config.polymas.cookie);
  if (!cookie) throw new CliError("缺少 Polymas Cookie，无法注入");

  const report = validateAndReport(config, markdown, { type, rubric });
  writeJson(path.join(runDir, "validate.json"), report);
  if (!report.ok && !argBool(flags, "allow-errors", false)) {
    log(formatValidation(report));
    throw new CliError("配置存在校验错误，已停止注入。修正后重试，或加 --allow-errors 强制继续。");
  }

  const structuredRubric = basic && type !== "oral"
    ? await selectStructuredRubric(config.appRoot, runDir, rubric) : null;
  if (structuredRubric?.blocked) throw new CliError("原始评分结构无法无损复用，请先核实 rubric.source.json；未执行注入");
  if (structuredRubric && !structuredRubric.ok) warn(`[rubric] 严格解析未命中：${structuredRubric.reason}；服务端可能使用AI提取`);
  const preflight = await preflightTarget(config, target, mode);
  log(
    `[inject] 目标: ${preflight.taskName || target.trainTaskId}（阶段 ${preflight.steps}${basic ? "" : ` / 成员 ${preflight.roles} / 技能 ${preflight.skills}`}）`,
  );
  if (mode === "fresh" && preflight.hasExisting && !argBool(flags, "confirm-fresh", false)) {
    throw new CliError(
      `目标已有内容，fresh 模式会删除现有阶段${basic ? "" : "和非系统成员"}。\n确认清空请加 --confirm-fresh，或改用 --mode append。`,
    );
  }

  const endpoint = basic ? "/api/training-inject" : "/api/training-inject-pro";
  const payload = basic
    ? {
        trainTaskId: target.trainTaskId,
        courseId: target.courseId || config.polymas.courseId || "",
        libraryFolderId: config.polymas.libraryId || "",
        credentials: {
          authorization: rawAuthorization(cookie, config.polymas.authorization),
          cookie,
          userNid: config.polymas.userNid || undefined,
          apiOrigin: config.polymas.apiBaseUrl || undefined,
          trainSubType: type,
        },
        llmSettings:
          config.llm.apiKey || config.llm.apiUrl || config.llm.model
            ? {
                apiKey: config.llm.apiKey,
                apiUrl: config.llm.apiUrl,
                model: config.llm.model,
              }
            : undefined,
        extractionMode: argString(flags, "extraction") || "hybrid",
        scriptMarkdown: markdown,
        rubricMarkdown: rubric || undefined,
        structuredRubric: structuredRubric?.payload,
        injectMode: mode === "append" ? "append" : "replace",
        coverStylePrompt: config.inject.coverStylePrompt || undefined,
        backgroundStylePrompt: config.inject.backgroundStylePrompt || undefined,
        digitalHumanAvatarMode: config.inject.digitalHumanAvatarMode,
        imageProviderMode: config.inject.imageProviderMode,
        imageProviderPriority: config.inject.imageProviderPriority,
        imageModel: config.inject.imageModel || undefined,
        injectCoverImage: config.inject.injectCoverImage,
        injectBackgroundImage: config.inject.injectBackgroundImage,
        ...(type === "oral" ? { injectKeyVocabularies: true } : {}),
      }
    : {
        markdown,
        targetUrl: target.targetUrl,
        authorization: config.polymas.authorization,
        cookie,
        authMode: config.polymas.authorization ? "auto" : "cookie",
        credentials: {
          authorization: config.polymas.authorization,
          cookie,
          userNid: config.polymas.userNid || undefined,
        },
        mode,
        coverStylePrompt: config.inject.coverStylePrompt || undefined,
        backgroundStylePrompt: config.inject.backgroundStylePrompt || undefined,
        digitalHumanAvatarMode: config.inject.digitalHumanAvatarMode,
        imageProviderMode: config.inject.imageProviderMode,
        imageModel: config.inject.imageModel || undefined,
        injectCoverImage: config.inject.injectCoverImage,
        injectBackgroundImage: config.inject.injectBackgroundImage,
      };

  const imageConcurrency = argNumber(flags, "image-concurrency", 3);
  if (!Number.isInteger(imageConcurrency) || imageConcurrency < 1 || imageConcurrency > 8) {
    throw new CliError("--image-concurrency 必须为 1..8 整数");
  }
  const imageCacheMode = argString(flags, "image-cache") || "reuse";
  if (!["reuse", "refresh", "off"].includes(imageCacheMode)) {
    throw new CliError("--image-cache 仅支持 reuse|refresh|off");
  }
  const imageStrategy = argString(flags, "image-strategy") || "regenerate";
  if (!["preserve", "missing", "regenerate"].includes(imageStrategy)) throw new CliError("--image-strategy 仅支持 preserve|missing|regenerate");
  payload.imageConcurrency = imageConcurrency;
  payload.imageCacheMode = imageCacheMode;
  payload.imageStrategy = imageStrategy;

  log(`[inject] 调用本地注入接口 ${endpoint}，模式 ${mode}...`);
  const startedAt = Date.now();
  const response = await fetch(`${config.appBaseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(argNumber(flags, "timeout", 1200) * 1000),
  });
  if (!response.ok) {
    const message = await readErrorResponse(response);
    writeJson(path.join(runDir, "inject.result.json"), {
      success: false,
      error: message,
      at: new Date().toISOString(),
    });
    throw new CliError(`注入接口返回 HTTP ${response.status}: ${message}`);
  }

  const events = [];
  let errorMessage = "";
  let completed = false;
  const warnings = [];

  await consumeSSE(response, (event) => {
    events.push(event);
    if (event.type === "start") log(`[inject] ${event.message || "开始"}`);
    if (event.type === "progress") {
      const prefix = event.phase ? `[${event.phase}]` : "";
      log(`[inject] ${prefix} ${event.message || ""}`);
      if (/跳过|异常|失败/.test(event.message || "")) warnings.push(event.message);
    }
    if (event.type === "complete") {
      completed = true;
      ok(event.message || "注入完成");
    }
    if (event.type === "error") errorMessage = event.message || "注入失败";
  });

  const result = {
    success: completed && !errorMessage,
    error: errorMessage,
    warnings,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    target,
    mode,
    at: new Date().toISOString(),
  };
  writeText(
    path.join(runDir, "inject.events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writeJson(path.join(runDir, "inject.result.json"), result);
  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, { ...meta, target, mode, inject: result });
  writeJson(path.join(runDir, "target.json"), {
    ...target,
    updatedAt: new Date().toISOString(),
  });

  if (!result.success) {
    throw new CliError(errorMessage || "注入未完成，请查看 inject.events.jsonl");
  }
  if (warnings.length > 0) {
    warn(`注入完成但有 ${warnings.length} 条跳过/异常，请查看 inject.events.jsonl`);
  }
  log(`下一步: node scripts/run.mjs verify --run ${runDir}`);
  return result;
}

async function commandVerify(config, flags) {
  const runDir = resolveRunDir(flags);
  const target = resolveTarget(config, flags);
  const type = target.type || resolveType(flags, config);
  const basic = isBasicType(type);
  const markdown = basic ? readRunScript(runDir).markdown : readRunConfig(runDir).markdown;
  const rubric = basic ? readRunRubric(runDir) : "";
  const mode =
    argString(flags, "mode") ||
    readJson(path.join(runDir, "inject.result.json"), {})?.mode ||
    config.inject.mode;

  let snapshot;
  let report;
  log(`[verify] 回读任务 ${target.trainTaskId}（${type}） ...`);
  if (basic) {
    const parsed = parseBasicScript(config.appRoot, markdown);
    snapshot = await collectBasicSnapshot(config, target.trainTaskId, type);
    let rubricComparison = null;
    if (type !== "oral" && rubric) {
      const selected = await selectStructuredRubric(config.appRoot, runDir, rubric);
      const { compareScoreItemsExact } = await loadStructuredRubricHelpers(config.appRoot);
      rubricComparison = selected.ok ? compareScoreItemsExact(selected.items, snapshot.scoreItems)
        : selected.blocked ? { ok: false, reason: selected.reason, differences: [] } : null;
    }
    report = compareBasicSnapshot(parsed, snapshot, {
      type,
      mode,
      rubricComparison,
      rubric: rubric ? parseBasicRubric(config.appRoot, rubric) : [],
    });
  } else {
    const parsed = parseProConfig(config.appRoot, markdown);
    snapshot = await collectSnapshot(config, target.trainTaskId);
    report = compareSnapshot(config, parsed, snapshot, mode);
  }

  writeJson(path.join(runDir, "verify.json"), {
    at: new Date().toISOString(),
    target,
    report,
    snapshot,
  });

  const lines = report.checks.map((check) => {
    const icon = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    return `${icon}  ${check.name}: ${check.detail}`;
  });
  log(lines.join("\n"));
  if (report.ok) {
    ok("回读校验通过");
  } else {
    fail("回读校验存在失败项");
  }
  return report.ok ? 0 : 1;
}

async function commandPublish(config, flags) {
  const runDir = resolveRunDir(flags);
  if (!argBool(flags, "yes", false)) {
    throw new CliError("发布是对学生可见的线上操作，请确认后加 --yes 再执行。");
  }
  const target = resolveTarget(config, flags);
  const targetLibraryId = (() => {
    try {
      return new URL(target.targetUrl).searchParams.get("libraryId") || "";
    } catch {
      return "";
    }
  })();
  const result = isBasicType(target.type)
    ? await saveAndPublishBasicTrainingTask(config, {
        trainTaskId: target.trainTaskId,
        type: target.type,
        courseId: target.courseId,
        libraryFolderId: targetLibraryId,
      })
    : await publishTrainingTask(config, {
        trainTaskId: target.trainTaskId,
      });
  writeJson(path.join(runDir, "publish.json"), {
    ...result,
    courseId: result.courseId || config.polymas.courseId,
    at: new Date().toISOString(),
  });
  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, { ...meta, published: true });
  ok(`发布完成: trainTaskId=${target.trainTaskId}`);
}

function platformStepToParsed(step, type) {
  const detail = step?.stepDetailDTO || step || {};
  const ext = detail.stepExtProperty || {};
  const mapped = {
    stepName: String(detail.stepName || "").trim(),
    trainerName: String(detail.trainerName || "").trim(),
    trainerGender: String(detail.trainerGender || "").trim(),
    trainerAgeGroup: String(detail.trainerAgeGroup || "").trim(),
    modelId: String(detail.modelId || "").trim(),
    agentId: String(detail.agentId || "").trim(),
    avatarNid: String(detail.avatarNid || "").trim(),
    description: String(detail.description || "").trim(),
    prologue: String(detail.prologue || "").trim(),
    llmPrompt: String(detail.llmPrompt || "").trim(),
    interactiveRounds: Number(detail.interactiveRounds) || 0,
    backgroundImage: "",
    flowCondition: "",
    transitionPrompt: "",
  };
  if (type === "oral") {
    const raw = Array.isArray(ext.keyVocabularies) ? ext.keyVocabularies : [];
    mapped.keyVocabularies = raw
      .map((item) => ({
        term: String(item?.vocabulary ?? item?.term ?? "").trim(),
        meaning: String(item?.explanation ?? item?.meaning ?? "").trim(),
        source: String(item?.source || "").trim(),
        ...(item?.exampleSentence
          ? { exampleSentence: String(item.exampleSentence).trim() }
          : {}),
      }))
      .filter((item) => item.term);
  }
  return mapped;
}

async function commandPull(config, flags) {
  const target = resolveTarget(config, flags);
  const type = target.type || resolveType(flags, config);
  if (!isBasicType(type)) {
    throw new CliError(
      "pull 只支持基础版/口语训练。Pro 训练请直接在平台编辑页修改，或使用 training-optimize-inject 技能的 Pro 分支。",
    );
  }
  const runDir =
    argString(flags, "out", "run") ||
    path.join(config.runsRoot, `pull-${slugify(target.trainTaskId)}`);
  const runDirAbs = toAbs(runDir);
  log(`[pull] 读取训练 ${target.trainTaskId}（${type}）...`);
  let snapshot = await collectBasicSnapshot(config, target.trainTaskId, type);
  let sourceSteps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  if (sourceSteps.length === 0) {
    warn("首次读取未返回阶段节点，5 秒后重试一次...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    snapshot = await collectBasicSnapshot(config, target.trainTaskId, type);
    sourceSteps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  }
  if (sourceSteps.length === 0) {
    throw new CliError(
      "平台上没有可拉取的阶段节点。请先在平台打开该训练的工作流编辑页，确认 START/END 与阶段节点已初始化。",
    );
  }
  const configuration = snapshot.configuration || {};
  const taskName =
    String(configuration.trainTaskName || "").trim() ||
    `训练-${target.trainTaskId}`;
  const description = String(configuration.description || "").trim();
  const steps = sourceSteps.map((step) => platformStepToParsed(step, type));
  const markdown = serializeBasicScript(config.appRoot, {
    steps,
    taskConfig: { trainTaskName: taskName, description },
  });
  const rubricMarkdown =
    type === "oral" ? "" : serializeBasicRubric(snapshot.scoreItems);

  const resourceCount = sourceSteps.reduce((sum, step) => {
    const detail = step?.stepDetailDTO || step || {};
    const list = Array.isArray(detail.scriptStepResourceList)
      ? detail.scriptStepResourceList
      : [];
    return (
      sum +
      list.filter((item) =>
        Boolean(item?.fileUrl || item?.fileName || item?.resourceId),
      ).length
    );
  }, 0);
  const coverCount = sourceSteps.filter((step) => {
    const cover = (step?.stepDetailDTO || step || {}).scriptStepCover;
    return Boolean(cover?.fileUrl || cover?.coverUrl);
  }).length;
  const vocabCount = steps.reduce(
    (sum, step) => sum + (step.keyVocabularies?.length || 0),
    0,
  );
  const warnings = [];
  if (resourceCount > 0) {
    warnings.push(
      `原训练含 ${resourceCount} 个阶段附件资源。fresh 重新注入会重建阶段节点，附件不会随剧本迁移；请确认后再注入，或先在平台复制训练后走副本优化。`,
    );
  }
  if (coverCount > 0) {
    warnings.push(
      `${coverCount} 个阶段已有封面/背景素材，fresh 重新注入会按配置重新生成或替换，请在注入后回看确认。`,
    );
  }
  warnings.push(
    "pull 只还原阶段剧本与评价标准；流程图分支连线需在注入前另行确认，自定义数字人形象需在注入后人工核对。",
  );

  const generatedDoc = [
    `# ${taskName}`,
    "",
    "## 任务背景与目标",
    description || "（平台未填写任务描述）",
    "",
    "## 阶段要求",
    ...steps.flatMap((step, index) => {
      const lines = [
        `### ${index + 1}. ${step.stepName}`,
        step.description || "（该阶段未填写描述）",
      ];
      if (step.keyVocabularies?.length) {
        lines.push(
          `重点词汇：${step.keyVocabularies
            .map((item) => `${item.term}${item.meaning ? `（${item.meaning}）` : ""}`)
            .join("、")}`,
        );
      }
      lines.push("");
      return lines;
    }),
    "> 本文件由平台训练配置自动合成，仅在教师未提供原始任务文档时用于评测参考。",
    "",
  ].join("\n");

  writeText(path.join(runDirAbs, "script.md"), markdown);
  writeText(path.join(runDirAbs, "rubric.md"), rubricMarkdown);
  if (type !== "oral") {
    await savePulledRubricSidecar(config.appRoot, runDirAbs, rubricMarkdown, snapshot.scoreItems, target.trainTaskId);
  }
  writeText(path.join(runDirAbs, "teacher-doc.generated.md"), generatedDoc);
  writeJson(path.join(runDirAbs, "target.json"), {
    ...target,
    type,
    updatedAt: new Date().toISOString(),
  });
  const summary = {
    at: new Date().toISOString(),
    source: "platform-pull",
    type,
    target,
    taskName,
    description,
    stepCount: steps.length,
    scoreItemCount: Array.isArray(snapshot.scoreItems)
      ? snapshot.scoreItems.length
      : 0,
    vocabCount,
    resourceCount,
    coverCount,
    generatedDocPath: path.join(runDirAbs, "teacher-doc.generated.md"),
    warnings,
  };
  writeJson(path.join(runDirAbs, "pull.json"), summary);
  const meta = readJson(path.join(runDirAbs, "run.json"), {});
  saveRun(runDirAbs, {
    ...meta,
    type,
    target,
    mode: meta.mode || "fresh",
    createdFrom: "pull",
    docPath: meta.docPath || path.join(runDirAbs, "teacher-doc.generated.md"),
  });

  log(
    `[pull] 阶段 ${steps.length} 个${type === "oral" ? `，重点词汇 ${vocabCount} 条` : `，评分项 ${summary.scoreItemCount} 个`}`,
  );
  ok(`已生成 ${path.join(runDirAbs, "script.md")}`);
  for (const message of warnings) warn(message);
  log(`下一步: node scripts/run.mjs optimize --run ${runDirAbs} --feedback "..."`);
  return 0;
}

async function commandIncremental(config, flags) {
  const runDir = resolveRunDir(flags);
  const action = argBool(flags, "dry-run", false) ? "plan" : argString(flags, "action") || "plan";
  if (!["snapshot", "plan", "preflight", "apply"].includes(action)) throw new CliError("--action 仅支持 snapshot|plan|preflight|apply");
  if (action === "apply" && !argBool(flags, "yes", false)) throw new CliError("增量写入须当前明确授权并传 --yes");
  const baselinePath = path.join(runDir, "incremental.baseline.json");
  const markdown = readRunScript(runDir).markdown;
  if (action === "snapshot") {
    if (exists(baselinePath)) throw new CliError("增量基线已存在；禁止覆盖，请使用新的独立运行目录");
    const target = resolveTarget(config, flags);
    const type = target.type || resolveType(flags, config);
    if (target.targetUrl) target.libraryId = new URL(target.targetUrl).searchParams.get("libraryId") || undefined;
    const result = await runIncremental(config, { action, target, type });
    if (!result.snapshot) throw new CliError("未取得完整增量快照");
    const parsed = parsedIncrementalDocument(config.appRoot, markdown);
    buildDesiredSnapshot({ baseSnapshot: result.snapshot, baseParsed: parsed, desiredParsed: parsed });
    writeJson(baselinePath, { snapshot: result.snapshot, parsed, markdown, rubric: readRunRubric(runDir), target, type });
    ok("增量基线已保存，请在此后修订剧本");
    return 0;
  }
  const baseline = readJson(baselinePath, null);
  if (!baseline?.snapshot) throw new CliError("先 pull 后 incremental --action snapshot，再修改剧本");
  if (readRunRubric(runDir) !== baseline.rubric) throw new CliError("评分标准发生变化，增量文本更新拒绝执行");
  const target = resolveTarget(config, flags);
  if (target.trainTaskId !== baseline.target.trainTaskId) throw new CliError("目标与增量基线不一致");
  if (target.targetUrl) target.libraryId = new URL(target.targetUrl).searchParams.get("libraryId") || undefined;
  const desiredSnapshot = buildDesiredSnapshot({ baseSnapshot: baseline.snapshot, baseParsed: baseline.parsed,
    desiredParsed: parsedIncrementalDocument(config.appRoot, markdown) });
  const result = await runIncremental(config, { action, baseSnapshot: baseline.snapshot, desiredSnapshot,
    target, type: baseline.type, confirmApply: argBool(flags, "yes", false), timeoutSeconds: argNumber(flags, "timeout", 1200) });
  writeJson(path.join(runDir, `incremental.${action}.json`), result);
  log(JSON.stringify({ success: result.success, action, changes: result.changes, applied: result.applied, error: result.error, reason: result.reason, reconciliationRequired: result.reconciliationRequired }, null, 2));
  return result.success === false ? 1 : 0;
}

async function commandTest(config, flags) {
  const runDir = resolveRunDir(flags);
  const target = resolveTarget(config, flags);
  const type = target.type || resolveType(flags, config);
  if (type === "pro") {
    throw new CliError(
      "Pro 训练的测试走页面内 WebSocket，暂不支持 HTTP 自动测试；当前 test 命令覆盖基础版与口语训练。",
    );
  }
  const meta = readJson(path.join(runDir, "run.json"), {});
  const docFlag = argString(flags, "doc");
  const result = await runTrainingTest(config, {
    appUrl: config.appBaseUrl,
    target,
    type,
    runDir,
    docPath: docFlag ? toAbs(docFlag) : meta.docPath,
    exportToDoc: argBool(flags, "doc-export", true),
    student: argString(flags, "student") || "good",
    maxRoundsPerStage: argNumber(flags, "max-rounds", 10),
    useReference: argBool(flags, "reference", true),
    timeoutSeconds: argNumber(flags, "timeout", 1800),
  });
  saveRun(runDir, { ...meta, test: result });
  ok(
    `测试脚本已输出: ${path.join(runDir, `test-${result.studentProfiles[0]}.txt`)}`,
  );
  if (result.exportedFiles?.length) {
    log(`已导出到教师文档目录: ${result.exportedFiles.join("、")}`);
  }
  log(`测试报告: ${result.reportPath}`);
  return 0;
}

async function commandReview(config, flags) {
  const runDir = resolveRunDir(flags);
  const student = argString(flags, "student") || "good";
  const packet = buildReviewPacket(runDir, student);
  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, {
    ...meta,
    review: {
      round: packet.round,
      student,
      packetPath: packet.packetPath,
      reviewPath: packet.reviewPath,
      at: new Date().toISOString(),
    },
  });
  ok(`自审材料已生成: ${packet.packetPath}`);
  log(`请把结论写入: ${packet.reviewPath}`);
  log("通过后运行 publish --yes；不通过时先改剧本，再 normalize → validate → inject → verify → test。");
  return 0;
}

async function commandFinalize(config, flags) {
  const runDir = resolveRunDir(flags);
  const result = finalizeRun(runDir, flags, {
    allowMissingTest: argBool(flags, "allow-missing-test", false),
  });
  reportFinalize(result);
  return 0;
}

async function commandEvaluate(config, flags) {
  if (!argBool(flags, "confirm-evaluate", false)) {
    throw new CliError(
      "系统 21 维评测较慢，默认改由 agent 自审对话脚本（run.mjs review）。\n如确需运行系统评测，请先确认用户同意，再加 --confirm-evaluate。",
    );
  }
  const runDir = resolveRunDir(flags);
  const passScore = argNumber(flags, "pass-score", 75);
  const summary = await evaluateRun(config, {
    runDir,
    docPath: argString(flags, "doc") ? toAbs(argString(flags, "doc")) : "",
    student: argString(flags, "student") || "good",
    passScore,
    timeoutSeconds: argNumber(flags, "timeout", 900),
  });
  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, { ...meta, evaluation: summary });
  log("");
  log("=== 测评结果 ===");
  for (const item of summary.results) {
    log(
      `${item.profileLabel}: ${item.totalScore.toFixed(1)}/100（${item.totalScore >= passScore ? "通过" : "未通过"}）`,
    );
    if (item.issues?.length) log(`  主要问题: ${item.issues.slice(0, 3).join("；")}`);
  }
  log(`汇总: ${summary.passed ? "全部通过" : "存在未通过脚本"}（通过线 ${passScore}）`);
  log(`结果: ${path.join(runDir, "evaluate.json")}`);
  return summary.passed ? 0 : 2;
}

function readFeedback(flags) {
  const feedbackFile = argString(flags, "feedback-file");
  if (feedbackFile) {
    const abs = toAbs(feedbackFile);
    if (!exists(abs)) throw new CliError(`反馈文件不存在: ${abs}`);
    return readText(abs, "").trim();
  }
  return argString(flags, "feedback") || argString(flags, "advice");
}

async function commandOptimize(config, flags) {
  const runDir = resolveRunDir(flags);
  const target = resolveTarget(config, flags);
  const type = target.type || resolveType(flags, config);
  const student = argString(flags, "student") || "good";
  if (student === "all") throw new CliError("optimize 一次只支持一个学生档位");
  const optimization = await optimizeScript(config, {
    runDir,
    type,
    student,
    feedback: readFeedback(flags),
    maxActions: argNumber(flags, "max-actions", 3),
    timeoutSeconds: argNumber(flags, "timeout", 1200),
  });
  const dryRun = argBool(flags, "dry-run", false);
  const applied = applyOptimizedScript(runDir, optimization, { dryRun });
  if (dryRun) {
    log(`[optimize] 已生成修订结果但未写盘；预览: ${optimization.resultPath}`);
    writeJson(optimization.resultPath, {
      generatedAt: new Date().toISOString(),
      feedback: optimization.feedback,
      appliedActions: optimization.loopResult.applied_actions || [],
      skippedActions: optimization.loopResult.skipped_actions || [],
      warnings: optimization.loopResult.warnings || [],
      optimized: optimization.optimized,
    });
    return 0;
  }

  const normalizeResult = normalizeRunFile(runDir, type);
  const report = validateAndReport(config, normalizeResult.text, {
    saveTo: runDir,
    type,
    rubric: isBasicType(type) ? readRunRubric(runDir) : "",
  });
  log("");
  log(formatValidation(report));
  const meta = readJson(path.join(runDir, "run.json"), {});
  saveRun(runDir, {
    ...meta,
    optimize: {
      updatedAt: new Date().toISOString(),
      feedback: optimization.feedback,
      backupPath: applied.backupPath,
      appliedActions: optimization.loopResult.applied_actions || [],
      skippedActions: optimization.loopResult.skipped_actions || [],
      warnings: optimization.loopResult.warnings || [],
      valid: report.ok,
    },
  });
  ok(`剧本已更新: ${applied.scriptPath}`);
  log(`备份: ${applied.backupPath}`);
  log("下一步: inject --run <目录> 重新注入，然后 test / evaluate 复查。");
  if (!report.ok && !argBool(flags, "allow-errors", false)) return 1;
  return 0;
}

function writeLoopReport(runDir, { type, maxIterations, student, rounds, passed, reason }) {
  const lines = [
    "# 训练剧本迭代优化报告（agent 自审）",
    "",
    `- 训练类型: ${type === "oral" ? "口语训练" : "基础版能力训练"}`,
    `- 学生档位: ${student}`,
    `- 轮次上限: ${maxIterations}`,
    `- 结果: ${passed ? "自审通过" : "自审未通过"}`,
    `- 结束原因: ${reason}`,
    "- 说明: 未使用系统 21 维评测，结论来自 agent 对对话脚本的逐阶段自审。",
    "",
    "## 迭代记录",
    "",
    "| 轮次 | 自审结论 | 优化阶段 | 备注 |",
    "| --- | --- | --- | --- |",
  ];
  for (const round of rounds) {
    lines.push(
      `| ${round.iteration} | ${round.verdict || "-"} | ${round.appliedActions ?? "-"} | ${round.note || ""} |`,
    );
  }
  lines.push("", `生成时间: ${new Date().toISOString()}`, "");
  writeText(path.join(runDir, "loop-report.md"), lines.join("\n"));
}

async function commandLoop(config, flags) {
  const runDir = resolveRunDir(flags);
  const target = resolveTarget(config, flags);
  const type = target.type || resolveType(flags, config);
  if (type === "pro") {
    throw new CliError("Pro 训练暂不支持 HTTP 自动测试与闭环迭代；当前覆盖基础版与口语训练。");
  }
  if (!argBool(flags, "confirm-loop", false)) {
    throw new CliError(
      "loop 会重新注入并重跑整条训练，耗时较长。\n开启前必须先向用户说明并取得明确许可，再加 --confirm-loop。\n默认请使用 agent 自审流程：test → review → 修改剧本 → normalize / validate / inject / verify / test。",
    );
  }
  const reviewFlag = argString(flags, "review");
  if (!reviewFlag) {
    throw new CliError(
      "loop 已改为 agent 自审驱动，不再调用系统 21 维评测。\n请先执行 review --run <目录>，把结论写入 review-<n>.md，再用 --review <文件> 传入。",
    );
  }
  const reviewPath = toAbs(reviewFlag);
  const review = parseReviewVerdict(reviewPath);

  const student = argString(flags, "student") || "good";
  if (student === "all") throw new CliError("loop 一次只支持一个学生档位（good / guided / offtopic）");
  const maxIterations = Math.max(1, argNumber(flags, "max-iterations", 3));
  const forceFirstOptimize = argBool(flags, "force-optimize", false);
  const teacherFeedback = readFeedback(flags);

  const meta = readJson(path.join(runDir, "run.json"), {});
  const previousRounds = Array.isArray(meta.loop?.rounds) ? meta.loop.rounds : [];
  if (previousRounds.length >= maxIterations) {
    throw new CliError(
      `已达到轮次上限 ${maxIterations}，自审仍未通过。\n确需继续请先与用户确认，再提高 --max-iterations。`,
    );
  }
  const iteration = previousRounds.length + 1;
  const docPath = argString(flags, "doc") ? toAbs(argString(flags, "doc")) : meta.docPath;
  const timeoutSeconds = argNumber(flags, "timeout", 1800);

  const testPath = path.join(runDir, `test-${student}.txt`);
  if (!exists(testPath)) {
    throw new CliError(`缺少测试脚本: ${testPath}，请先执行 test --run <目录>`);
  }
  const testMeta = readJson(path.join(runDir, `test-${student}.json`), null);
  const rounds = [...previousRounds];
  const reviewInfo = {
    round: iteration,
    path: reviewPath,
    passed: review.passed,
    at: new Date().toISOString(),
  };

  if (review.passed && !(forceFirstOptimize && teacherFeedback)) {
    log(`[loop] 第 ${iteration} 轮自审结论：通过`);
    const injectFlags = { ...flags, run: runDir, type, "target-url": target.targetUrl };
    const verifyCode = await commandVerify(config, injectFlags);
    let published = false;
    if (verifyCode === 0 && argBool(flags, "publish", true)) {
      await commandPublish(config, { ...injectFlags, yes: true });
      published = true;
    } else if (verifyCode !== 0) {
      warn("[loop] 回读存在 FAIL，已跳过发布；修复后重跑 publish --yes。");
    }
    rounds.push({
      iteration,
      verdict: "通过",
      appliedActions: 0,
      note: "自审通过",
      reviewPath,
      at: new Date().toISOString(),
    });
    const reason = `第 ${iteration} 轮自审通过`;
    const loopSummary = {
      completedAt: new Date().toISOString(),
      mode: "agent-review",
      type,
      student,
      maxIterations,
      passed: true,
      published,
      reason,
      rounds,
      review: reviewInfo,
      test: testMeta
        ? {
            completed: testMeta.completed,
            totalRounds: testMeta.totalRounds,
          }
        : null,
    };
    saveRun(runDir, { ...readJson(path.join(runDir, "run.json"), {}), loop: loopSummary });
    writeLoopReport(runDir, { type, maxIterations, student, rounds, passed: true, reason });
    log("");
    log("=== 迭代结果 ===");
    log(`结论: 自审通过，${reason}`);
    log(`发布: ${published ? "已发布" : "未发布"}`);
    log(`报告: ${path.join(runDir, "loop-report.md")}`);
    const shouldCleanup =
      verifyCode === 0 &&
      argBool(flags, "cleanup", true) &&
      !argBool(flags, "keep-evidence", false);
    if (shouldCleanup) {
      try {
        const finalized = finalizeRun(runDir, flags, {
          student,
          taskName: resolveRunTaskName(runDir, readJson(path.join(runDir, "run.json"), {})),
        });
        reportFinalize(finalized);
      } catch (error) {
        warn(
          `[finalize] 未清理运行目录：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return 0;
  }
  if (review.passed) {
    log("[loop] 自审已通过，但提供了教师意见并指定 --force-optimize，先落地一轮修订。");
  }

  const mode = argString(flags, "mode") || "fresh";
  if (mode === "fresh" && !argBool(flags, "confirm-fresh", false)) {
    throw new CliError(
      "loop 会用修订后的剧本重新注入并替换目标现有阶段。\n确认继续请加 --confirm-fresh，或改用 --mode append。",
    );
  }
  const injectFlags = {
    ...flags,
    run: runDir,
    type,
    "target-url": target.targetUrl,
    mode,
  };

  log(`[loop] ===== 第 ${iteration}/${maxIterations} 轮：自审不通过，按自审建议修订剧本 =====`);
  const feedback = [
    review.feedback,
    teacherFeedback ? `教师补充意见：\n${teacherFeedback}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let appliedActions = 0;
  let reason = "";
  let testResult = null;
  try {
    const optimization = await optimizeScript(config, {
      runDir,
      type,
      student,
      feedback,
      maxActions: argNumber(flags, "max-actions", 3),
      timeoutSeconds: argNumber(flags, "timeout", 1200),
    });
    const applied = applyOptimizedScript(runDir, optimization);
    appliedActions = (optimization.loopResult.applied_actions || []).length;
    log(`[loop] 剧本已更新（备份 ${path.basename(applied.backupPath)}）`);

    normalizeRunFile(runDir, type);
    const report = validateAndReport(config, readRunScript(runDir).markdown, {
      saveTo: runDir,
      type,
      rubric: isBasicType(type) ? readRunRubric(runDir) : "",
    });
    if (!report.ok && !argBool(flags, "allow-errors", false)) {
      log(formatValidation(report));
      reason = "优化后的剧本校验未通过，已停止";
    } else {
      log(`[loop] ===== 第 ${iteration} 轮：重新注入 =====`);
      await commandInject(config, {
        ...injectFlags,
        "confirm-fresh": true,
        "allow-errors": argBool(flags, "allow-errors", false),
      });
      const verifyCode = await commandVerify(config, injectFlags);
      if (verifyCode !== 0) {
        reason = "重新注入后的回读校验未通过，已停止";
      } else {
        log(`[loop] ===== 第 ${iteration} 轮：重新测试 =====`);
        testResult = await runTrainingTest(config, {
          appUrl: config.appBaseUrl,
          target,
          type,
          runDir,
          docPath,
          student,
          maxRoundsPerStage: argNumber(flags, "max-rounds", 10),
          useReference: argBool(flags, "reference", true),
          timeoutSeconds,
        });
        saveRun(runDir, { ...readJson(path.join(runDir, "run.json"), {}), test: testResult });
        reason = "剧本已更新并重测，请对新对话再生成一轮自审";
      }
    }
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }

  rounds.push({
    iteration,
    verdict: "不通过",
    appliedActions,
    note: String(reason).slice(0, 120),
    reviewPath,
    at: new Date().toISOString(),
  });
  if (rounds.length >= maxIterations) {
    reason = `${reason}；已达到轮次上限 ${maxIterations}，自审仍未通过`;
  }

  const loopSummary = {
    completedAt: new Date().toISOString(),
    mode: "agent-review",
    type,
    student,
    maxIterations,
    passed: false,
    published: false,
    reason,
    rounds,
    review: reviewInfo,
    test: testResult
      ? {
          completed: testResult.completed,
          totalRounds: testResult.totalRounds,
          stageCoverage: testResult.stageCoverage,
        }
      : testMeta
        ? { completed: testMeta.completed, totalRounds: testMeta.totalRounds }
        : null,
  };
  saveRun(runDir, { ...readJson(path.join(runDir, "run.json"), {}), loop: loopSummary });
  writeLoopReport(runDir, { type, maxIterations, student, rounds, passed: false, reason });

  log("");
  log("=== 迭代结果 ===");
  log(`轮次: ${rounds.length}`);
  for (const round of rounds) {
    log(`  第 ${round.iteration} 轮: 自审${round.verdict}${round.appliedActions ? `（修订 ${round.appliedActions} 个阶段）` : ""}`);
  }
  log(`结论: 未通过，${reason}`);
  log(`发布: 未发布`);
  log(`报告: ${path.join(runDir, "loop-report.md")}`);
  if (testResult) {
    log(`下一步: node scripts/run.mjs review --run ${runDir} --student ${student}`);
  }
  return 2;
}

function writeReport(runDir, { meta, report, injectResult, verifyReport, target, testResult }) {
  const type = meta.type || target?.type || "pro";
  const typeLabel =
    type === "oral" ? "口语训练" : type === "ability" ? "基础版能力训练" : "能力训练 Pro";
  const lines = [
    `# ${typeLabel}生成与注入报告`,
    "",
    `- 训练类型: ${typeLabel}`,
    `- 生成时间: ${meta.generatedAt || new Date().toISOString()}`,
    `- 任务名称: ${meta.taskName || ""}`,
    `- 教师文档: ${meta.docPath || ""}`,
    `- 用户建议: ${meta.advice || "（无）"}`,
    `- 配置指纹: ${meta.configFingerprint || ""}`,
    "",
    "## 配置结构",
    "",
    `- 阶段: ${report.stats.stages}`,
    ...(isBasicType(type)
      ? [
          `- 评分项: ${report.stats.rubricItems ?? 0} 项`,
          `- 重点词汇: ${report.stats.vocabulary ?? 0} 条`,
        ]
      : [`- 全局成员: ${report.stats.members}`, `- 技能: ${report.stats.skills}`]),
    `- 字符数: ${report.stats.characters}`,
    "",
    "## 校验",
    "",
    report.errors.length ? `- 错误: ${report.errors.join("；")}` : "- 错误: 无",
    report.warnings.length ? `- 警告: ${report.warnings.join("；")}` : "- 警告: 无",
    "",
  ];

  if (target) {
    lines.push(
      "## 目标任务",
      "",
      `- trainTaskId: ${target.trainTaskId}`,
      `- 页面: ${target.targetUrl}`,
      "",
    );
  }
  if (injectResult) {
    lines.push(
      "## 注入",
      "",
      `- 模式: ${injectResult.mode}`,
      `- 结果: ${injectResult.success ? "成功" : "失败"}`,
      `- 耗时: ${injectResult.durationSeconds} 秒`,
      injectResult.warnings?.length
        ? `- 跳过/异常: ${injectResult.warnings.join("；")}`
        : "- 跳过/异常: 无",
      "",
    );
  }
  if (verifyReport) {
    lines.push("## 平台回读", "", "| 检查 | 结果 | 说明 |", "| --- | --- | --- |");
    verifyReport.checks.forEach((check) => {
      lines.push(
        `| ${check.name} | ${check.status} | ${String(check.detail).replace(/\|/g, "/")} |`,
      );
    });
    lines.push("");
  }
  if (testResult) {
    lines.push(
      "## 测试跑脚本",
      "",
      `- 学生档位: ${testResult.studentProfiles.join("、")}`,
      `- 完成状态: ${testResult.completed ? "已走完全部阶段" : "未走完全部阶段"}`,
      `- 总轮次: ${testResult.totalRounds}`,
      ...testResult.stageCoverage.map(
        (item) =>
          `- ${item.profile}: ${item.reached}/${item.total} 阶段${item.missed.length ? `（未访问: ${item.missed.join("、")}）` : ""}`,
      ),
      `- 对话脚本: ${path.basename(testResult.reportPath).replace("test-report.md", "test-*.txt")}`,
      ...(testResult.exportedFiles?.length
        ? [`- 已导出到教师文档目录: ${testResult.exportedFiles.join("、")}`]
        : []),
      `- 测试报告: ${testResult.reportPath}`,
      "",
    );
  }

  lines.push(
    "## 产物",
    "",
    "- config.md: 最终配置",
    "- validate.json: 结构校验",
    "- inject.events.jsonl: 注入过程事件",
    "- verify.json: 平台回读快照与比对",
    "- test-<student>.txt: 平台的测试对话脚本（评测可直接解析）",
    "- test-report.md: 测试覆盖与轮次报告",
    "",
  );
  writeText(path.join(runDir, "report.md"), lines.join("\n"));
}

async function commandRun(config, flags) {
  const docPath = toAbs(argString(flags, "doc"));
  if (!docPath) throw new CliError("请通过 --doc <教师任务文档> 指定输入");
  const type = resolveType(flags, config);
  const basic = isBasicType(type);
  const name = argString(flags, "name");
  const advice = withTypeAdvice(type, argString(flags, "advice"));
  const runDir = argString(flags, "out")
    ? (() => {
        const dir = toAbs(argString(flags, "out"));
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      })()
    : createRunDir(config, name || path.basename(docPath));
  saveRun(runDir, { createdAt: new Date().toISOString(), type, docPath, advice });

  let generated;
  let rubric = "";
  if (basic) {
    let plan = null;
    if (!argBool(flags, "no-plan", false)) {
      plan = await planBasicConfig(config, {
        docPath,
        docName: name || path.basename(docPath),
        type,
        advice,
        flow: argString(flags, "flow") || "auto",
        timeoutSeconds: argNumber(flags, "timeout", 600),
      });
      writeJson(path.join(runDir, "plan.json"), plan);
      log(`[plan] 规划完成: ${plan.modules?.length || 0} 个阶段`);
    }
    generated = await generateBasicConfig(config, {
      docPath,
      docName: name,
      advice,
      runDir,
      type,
      plan,
      timeoutSeconds: argNumber(flags, "timeout", 1200),
    });
    rubric = generated.rubric;
  } else {
    generated = await generateConfig(config, {
      docPath,
      docName: name,
      advice,
      runDir,
      timeoutSeconds: argNumber(flags, "timeout", 1200),
    });
  }

  const normalizeResult = normalizeRunFile(runDir, type);
  const report = validateAndReport(config, normalizeResult.text, {
    saveTo: runDir,
    type,
    rubric,
  });
  log("");
  log(formatValidation(report));
  if (!report.ok && !argBool(flags, "allow-errors", false)) {
    throw new CliError(
      `配置校验未通过，已停止。请按 normalize 的 pending 清单补全 ${path.join(runDir, basic ? "script.md" : "config.md")} 后重新执行，或加 --allow-errors。`,
    );
  }

  let target;
  if (argString(flags, "target-url") || argString(flags, "train-task-id")) {
    target = resolveTarget(config, { ...flags, run: runDir });
  } else if (argBool(flags, "create", false)) {
    const summary = basic
      ? summarizeBasicConfig(parseBasicScript(config.appRoot, generated.script))
      : summarizeConfig(parseProConfig(config.appRoot, generated.content));
    const createOptions = {
      name: name || summary.abilityName,
      description:
        summary.description || `能力训练：${name || summary.abilityName || "未命名"}`,
      coverPath: argString(flags, "cover") ? toAbs(argString(flags, "cover")) : "",
    };
    const created = basic
      ? await createBasicTrainingTask(config, { ...createOptions, type })
      : await createTrainingTask(config, createOptions);
    target = { ...created, type: created.type || type };
    writeJson(path.join(runDir, "target.json"), {
      ...target,
      createdAt: new Date().toISOString(),
    });
    ok(`任务创建成功: trainTaskId=${created.trainTaskId}`);
    log(`页面链接: ${created.targetUrl}`);
  } else {
    throw new CliError(
      "未指定目标：加 --target-url 注入已有任务，或加 --create --course-id 新建任务。",
    );
  }

  const injectFlags = { ...flags, run: runDir, type, "target-url": target.targetUrl };
  if (argString(flags, "target-url")) {
    injectFlags["target-url"] = argString(flags, "target-url");
  }
  const injectResult = await commandInject(config, injectFlags);
  const verifyCode = await commandVerify(config, injectFlags);

  let published = false;
  const shouldPublish = argBool(flags, "publish", true);
  if (shouldPublish) {
    if (verifyCode !== 0) {
      warn("[publish] 回读存在 FAIL，已跳过自动发布；修复后重跑 publish --yes。");
    } else {
      await commandPublish(config, { ...injectFlags, yes: true });
      published = true;
    }
  } else {
    log("[publish] 已按 --no-publish 跳过发布");
  }

  let testResult = null;
  const shouldTest = argBool(flags, "test", true);
  if (shouldTest) {
    if (type === "pro") {
      warn("[test] Pro 训练的测试走页面内 WebSocket，暂不支持 HTTP 自动测试，已跳过。");
    } else if (verifyCode !== 0) {
      warn("[test] 回读存在 FAIL，已跳过测试；修复后重跑 test --run <目录>。");
    } else {
      try {
        testResult = await runTrainingTest(config, {
          appUrl: config.appBaseUrl,
          target,
          type,
          runDir,
          docPath: docPath || readJson(path.join(runDir, "run.json"), {}).docPath,
          student: argString(flags, "student") || "good",
          maxRoundsPerStage: argNumber(flags, "max-rounds", 10),
          useReference: argBool(flags, "reference", true),
          timeoutSeconds: argNumber(flags, "timeout", 1800),
        });
        saveRun(runDir, { ...readJson(path.join(runDir, "run.json"), {}), test: testResult });
      } catch (error) {
        warn(`[test] 测试失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } else {
    log("[test] 已按 --no-test 跳过测试");
  }

  const verify = readJson(path.join(runDir, "verify.json"), {});
  writeReport(runDir, {
    meta: readJson(path.join(runDir, "run.json"), {}),
    report,
    injectResult,
    verifyReport: verify.report,
    target,
    testResult,
  });

  log("");
  log("=== 结果 ===");
  log(`类型: ${type}`);
  log(`任务: ${generated.taskName}`);
  log(`页面: ${target.targetUrl}`);
  log(`校验: ${report.ok ? "通过" : "有错误"}`);
  log(`注入: ${injectResult.success ? "成功" : "失败"}`);
  log(`回读: ${verifyCode === 0 ? "通过" : "存在失败项"}`);
  log(`发布: ${published ? "已发布" : "未发布"}`);
  log(
    `测试: ${
      testResult
        ? `${testResult.completed ? "已走完全部阶段" : "未走完"}（轮次 ${testResult.totalRounds}）`
        : type === "pro"
          ? "Pro 暂不支持自动测试"
          : "未执行"
    }`,
  );
  if (testResult) {
    log(`测试脚本: ${path.join(runDir, `test-${testResult.studentProfiles[0]}.txt`)}`);
    if (testResult.exportedFiles?.length) {
      log(`测试脚本已导出到教师文档目录: ${testResult.exportedFiles.join("、")}`);
    }
  }
  log(`报告: ${path.join(runDir, "report.md")}`);

  const shouldCleanup = argBool(flags, "cleanup", true) && !argBool(flags, "keep-evidence", false);
  if (shouldCleanup) {
    try {
      const finalized = finalizeRun(runDir, flags, {
        taskName: generated.taskName,
        student: testResult?.studentProfiles?.[0] || argString(flags, "student") || "good",
        allowMissingTest: !shouldTest || type === "pro",
      });
      reportFinalize(finalized);
    } catch (error) {
      warn(
        `[finalize] 未清理运行目录：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return verifyCode;
}

async function main() {
  const { command, flags, positional } = parseArgv(process.argv.slice(2));
  if (!command || command === "help" || flags.help || flags.h) {
    log(HELP);
    return 0;
  }

  if (command === "paths") {
    log(JSON.stringify(resolveRuntime(flags), null, 2));
    return 0;
  }
  const config = loadConfig(flags);

  switch (command) {
    case "doctor":
      return commandDoctor(config);
    case "generate":
      return commandGenerate(config, flags);
    case "plan":
      return commandPlan(config, flags);
    case "normalize":
      return commandNormalize(config, flags);
    case "validate":
      return commandValidate(config, flags, positional);
    case "dialogue":
      return commandDialogue(config, flags);
    case "create-task":
      return commandCreateTask(config, flags);
    case "pull":
      return commandPull(config, flags);
    case "inject":
      return commandInject(config, flags);
    case "incremental":
      return commandIncremental(config, flags);
    case "prepare-images": {
      if (argBool(flags, "dry-run", false)) throw new CliError("prepare-images不支持dry-run；批次dry-run仅检查计划不生成");
      if (!argBool(flags, "yes", false)) throw new CliError("图片生成/上传须当前明确授权并传 --yes");
      const target = resolveTarget(config, flags);
      const result = await prepareTrainingImages(config, {
        runDir: resolveRunDir(flags), target, type: target.type || resolveType(flags, config),
        concurrency: argNumber(flags, "image-concurrency", 3), cacheMode: argString(flags, "image-cache") || "reuse",
        strategy: argString(flags, "image-strategy") || "regenerate",
        ids: argString(flags, "image-ids") ? argString(flags, "image-ids").split(",").map(x => x.trim()) : undefined,
        timeoutSeconds: argNumber(flags, "timeout", 1200),
      });
      log(JSON.stringify(result, null, 2));
      return result.success === false ? 1 : 0;
    }
    case "attach-images":
      return attachImageResources(config, {runDir: resolveRunDir(flags), manifestPath: toAbs(argString(flags, "manifest"))});
    case "detach-html":
      return detachHtmlResources(config, {runDir: resolveRunDir(flags)});
    case "set-voice":
      return setTrainingVoice(config, {runDir: resolveRunDir(flags), voiceNid: argString(flags, "voice-nid")});
    case "attach-assets":
      return attachStageAssets(config, {runDir: resolveRunDir(flags), manifestPath: toAbs(argString(flags, "manifest")), dryRun: argBool(flags, "dry-run", false)});
    case "verify":
      return commandVerify(config, flags);
    case "publish":
      return commandPublish(config, flags);
    case "test":
      return commandTest(config, flags);
    case "review":
      return commandReview(config, flags);
    case "finalize":
      return commandFinalize(config, flags);
    case "evaluate":
      return commandEvaluate(config, flags);
    case "optimize":
      return commandOptimize(config, flags);
    case "loop":
      return commandLoop(config, flags);
    case "run":
      return commandRun(config, flags);
    default:
      throw new CliError(`未知命令: ${command}\n\n${HELP}`);
  }
}

main()
  .then((code) => {
    process.exitCode = typeof code === "number" ? code : 0;
  })
  .catch((error) => {
    if (error instanceof CliError) {
      fail(error.message);
      process.exitCode = error.exitCode || 1;
    } else {
      fail(error?.stack || String(error));
      process.exitCode = 1;
    }
  });
