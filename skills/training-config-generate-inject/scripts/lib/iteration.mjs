import fs from "node:fs";
import path from "node:path";
import { consumeSSE, readErrorResponse } from "./sse.mjs";
import { CliError, exists, log, readJson, readText, writeJson, writeText } from "./util.mjs";

const STUDENT_PROFILES = ["good", "guided", "offtopic"];
const PROFILE_LABELS = {
  good: "优秀学生",
  guided: "需要引导的学生",
  offtopic: "答非所问的学生",
};

function appUrlOf(config) {
  const value = String(config.appBaseUrl || "").replace(/\/+$/, "");
  if (!value) throw new CliError("未配置 appBaseUrl，无法调用本地应用接口");
  return value;
}

function resolveDocPath(options, meta) {
  const docPath = options.docPath || meta.docPath;
  if (!docPath) throw new CliError("缺少教师文档路径：请在 run.json 记录 docPath，或加 --doc <文件>");
  if (!exists(docPath)) throw new CliError(`教师文档不存在: ${docPath}`);
  return docPath;
}

function fileBlob(filePath) {
  return new Blob([fs.readFileSync(filePath)]);
}

function appendLlm(form, config) {
  if (config.llm?.apiKey) form.append("api_key", config.llm.apiKey);
  if (config.llm?.apiUrl) form.append("api_url", config.llm.apiUrl);
  if (config.llm?.model) form.append("model", config.llm.model);
}

export function listEvaluationStudents(runDir, studentFlag = "good") {
  const flag = String(studentFlag || "good").toLowerCase();
  if (flag === "all") {
    const existing = STUDENT_PROFILES.filter((key) =>
      exists(path.join(runDir, `test-${key}.txt`)),
    );
    if (!existing.length) throw new CliError(`运行目录没有测试脚本: ${runDir}`);
    return existing;
  }
  if (!PROFILE_LABELS[flag]) {
    throw new CliError(`--student 仅支持 good、guided、offtopic、all，收到: ${flag}`);
  }
  return [flag];
}

export function buildFeedbackFromEvaluation(report, extraFeedback = "") {
  if (!report) return String(extraFeedback || "").trim();
  const lines = [];
  const score = Number(report.total_score);
  lines.push(`当前测评总分 ${Number.isFinite(score) ? score.toFixed(1) : "未知"}/100。`);

  const weak = [];
  for (const dim of report.dimensions || []) {
    for (const sub of dim.sub_scores || []) {
      const full = Number(sub.full_score);
      const got = Number(sub.score);
      if (Number.isFinite(full) && Number.isFinite(got) && got < full * 0.7) {
        const issue = sub.issues?.[0]?.description || sub.judgment_basis || "表现不足";
        weak.push(`- 【${dim.dimension} / ${sub.sub_dimension}】${String(issue).slice(0, 180)}`);
      }
    }
  }
  if (weak.length) {
    lines.push("优先修复以下失分点（来自测评）：");
    lines.push(...weak.slice(0, 12));
  }
  if (report.issues?.length) {
    lines.push("关键问题：");
    lines.push(...report.issues.slice(0, 10).map((item) => `- ${String(item).slice(0, 200)}`));
  }
  if (report.suggestions?.length) {
    lines.push("可执行改进方向：");
    lines.push(...report.suggestions.slice(0, 10).map((item) => `- ${String(item).slice(0, 200)}`));
  }
  const extra = String(extraFeedback || "").trim();
  if (extra) {
    lines.push("教师补充意见：");
    lines.push(extra);
  }
  return lines.join("\n");
}

export async function evaluateDialogue(config, options) {
  const { runDir, student, docPath } = options;
  const txtPath = path.join(runDir, `test-${student}.txt`);
  if (!exists(txtPath)) {
    throw new CliError(`缺少测试脚本: ${txtPath}，请先执行 test --run <目录>`);
  }
  const form = new FormData();
  form.append("teacher_doc", fileBlob(docPath), path.basename(docPath));
  form.append("dialogue_record", fileBlob(txtPath), path.basename(txtPath));
  appendLlm(form, config);

  const timeoutSeconds = Number(options.timeoutSeconds || 900);
  const startedAt = Date.now();
  log(`[evaluate] ${PROFILE_LABELS[student] || student}：上传教师文档与对话脚本，启动测评...`);

  let response;
  try {
    response = await fetch(`${appUrlOf(config)}/api/evaluate-stream`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
  } catch (error) {
    throw new CliError(
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? `测评请求超时（${timeoutSeconds} 秒）`
        : `无法连接本地测评接口：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new CliError(`测评接口失败：${await readErrorResponse(response)}`);
  }

  let report = null;
  let errorMessage = "";
  await consumeSSE(response, (event) => {
    if (event.type === "start") log(`[evaluate] 共 ${event.total} 个子维度`);
    if (event.type === "progress") {
      const index = event.completed ?? event.current;
      const total = event.total;
      if (index && total && (index === total || index % 5 === 0)) {
        log(`[evaluate] 进度 ${index}/${total}`);
      }
    }
    if (event.type === "dimension_complete" && event.dimension) {
      log(`[evaluate] ${event.dimension} 完成`);
    }
    if (event.type === "complete") report = event.report || null;
    if (event.type === "error") errorMessage = event.message || "测评失败";
  });

  if (!report) throw new CliError(errorMessage || "测评接口未返回完成事件");

  const totalScore = Number(report.total_score);
  const result = {
    student,
    profileLabel: PROFILE_LABELS[student] || student,
    totalScore,
    finalLevel: report.final_level,
    passCriteriaMet: report.pass_criteria_met,
    issues: report.issues || [],
    suggestions: report.suggestions || [],
    dimensions: report.dimensions || [],
    report,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    evaluatedAt: new Date().toISOString(),
    reportPath: path.join(runDir, `evaluate-${student}.json`),
  };
  writeJson(result.reportPath, result);
  return result;
}

export async function evaluateRun(config, options) {
  const meta = readJson(path.join(options.runDir, "run.json"), {});
  const docPath = resolveDocPath(options, meta);
  const students = listEvaluationStudents(options.runDir, options.student);
  const passScore = Number(options.passScore || 75);
  const results = [];
  for (const student of students) {
    const result = await evaluateDialogue(config, {
      runDir: options.runDir,
      student,
      docPath,
      timeoutSeconds: options.timeoutSeconds,
    });
    results.push(result);
    log(
      `[evaluate] ${result.profileLabel}: ${result.totalScore.toFixed(1)}/100（${result.totalScore >= passScore ? "通过" : "未通过"}，通过线 ${passScore}）`,
    );
  }
  const summary = {
    evaluatedAt: new Date().toISOString(),
    passScore,
    passed: results.every((item) => item.totalScore >= passScore),
    results: results.map(({ report, ...rest }) => rest),
  };
  writeJson(path.join(options.runDir, "evaluate.json"), summary);
  return summary;
}

export async function optimizeScript(config, options) {
  const { runDir, type } = options;
  if (type === "pro") {
    throw new CliError("Pro 训练暂不支持闭环优化；当前覆盖基础版与口语训练。");
  }
  const meta = readJson(path.join(runDir, "run.json"), {});
  const docPath = resolveDocPath(options, meta);
  const student = options.student || "good";
  const txtPath = path.join(runDir, `test-${student}.txt`);
  if (!exists(txtPath)) {
    throw new CliError(`缺少测试脚本: ${txtPath}，请先执行 test --run <目录>`);
  }
  const scriptPath = exists(path.join(runDir, "script.md"))
    ? path.join(runDir, "script.md")
    : path.join(runDir, "config.md");
  if (!exists(scriptPath)) {
    throw new CliError(`运行目录缺少 script.md / config.md: ${runDir}`);
  }
  const rubricPath = path.join(runDir, "rubric.md");
  const rubric = exists(rubricPath) ? readText(rubricPath) : "";
  const markdown = readText(scriptPath);

  const feedback = buildFeedbackFromEvaluation(options.evaluation, options.feedback);
  if (!feedback.trim()) {
    throw new CliError("缺少优化依据：请通过 --feedback / --feedback-file 提供自审结论或教师意见");
  }

  const form = new FormData();
  form.append("trainingType", type === "oral" ? "oral" : "ability");
  form.append("teacherDocFile", fileBlob(docPath), path.basename(docPath));
  form.append("teacherDocName", path.basename(docPath));
  form.append("dialogueFile", fileBlob(txtPath), path.basename(txtPath));
  form.append("dialogueRecordName", path.basename(txtPath));
  form.append("scriptMarkdown", markdown);
  if (rubric) form.append("rubricMarkdown", rubric);
  form.append("optimizationFeedback", feedback);
  form.append("maxActions", String(options.maxActions || 3));
  if (config.llm?.apiKey) form.append("apiKey", config.llm.apiKey);
  if (config.llm?.apiUrl) form.append("apiUrl", config.llm.apiUrl);
  if (config.llm?.model) form.append("model", config.llm.model);

  const timeoutSeconds = Number(options.timeoutSeconds || 1200);
  log("[optimize] 调用本地闭环优化接口，按自审结论与教师意见修订剧本...");
  let response;
  try {
    response = await fetch(`${appUrlOf(config)}/api/training-optimize`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
  } catch (error) {
    throw new CliError(
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? `优化请求超时（${timeoutSeconds} 秒）`
        : `无法连接本地优化接口：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new CliError(`优化接口失败：${await readErrorResponse(response)}`);
  }

  let loopResult = null;
  let errorMessage = "";
  await consumeSSE(response, (event) => {
    if (event.type === "progress") {
      log(`[optimize] ${event.message || event.stage || "处理中"}`);
    }
    if (event.type === "complete") loopResult = event.result || null;
    if (event.type === "error") errorMessage = event.message || "优化失败";
  });
  if (!loopResult) throw new CliError(errorMessage || "优化接口未返回完成事件");

  const optimized = String(loopResult.optimized_script_markdown || "").trim();
  if (!optimized) throw new CliError("优化结果为空，未写入剧本");
  if (optimized === markdown.trim()) {
    throw new CliError("优化结果与当前剧本完全一致，已停止，不重复注入");
  }

  return {
    scriptPath,
    markdown,
    optimized,
    feedback,
    loopResult,
    resultPath: path.join(runDir, `optimize-${Date.now()}.json`),
  };
}

export function applyOptimizedScript(runDir, optimization, { dryRun = false } = {}) {
  const backupPath = path.join(
    runDir,
    `${path.basename(optimization.scriptPath, ".md")}.before-optimize-${Date.now()}.md`,
  );
  if (!dryRun) {
    writeText(backupPath, optimization.markdown);
    writeText(optimization.scriptPath, `${optimization.optimized.trim()}\n`);
    writeJson(optimization.resultPath, {
      appliedAt: new Date().toISOString(),
      feedback: optimization.feedback,
      appliedActions: optimization.loopResult.applied_actions || [],
      skippedActions: optimization.loopResult.skipped_actions || [],
      warnings: optimization.loopResult.warnings || [],
      nextStep: optimization.loopResult.next_step,
      backupPath,
      scriptPath: optimization.scriptPath,
    });
  }
  return { backupPath, scriptPath: optimization.scriptPath };
}
