import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { consumeSSE, readErrorResponse } from "./sse.mjs";
import { CliError, log, nowStamp, warn, writeJson, writeText } from "./util.mjs";
import { sanitizeCookie } from "./platform.mjs";

const PROFILE_LABELS = {
  good: "优秀学生",
  guided: "需要引导的学生",
  offtopic: "答非所问的学生",
};

function profileLabel(key) {
  return PROFILE_LABELS[key] || key;
}

function formatStepRound(source, round) {
  const parts = [`来源: ${source}`];
  if (round > 0) parts.splice(0, 0, `第 ${round} 轮`);
  return parts.join(" | ");
}

function exportToDocDir(docPath, taskName, studentProfile, txtPath) {
  if (!docPath) return null;
  const source = path.resolve(docPath);
  if (!existsSync(source)) return null;
  const fallback = path.basename(source, path.extname(source));
  const base = String(taskName || "").trim().replace(/[\\/:*?"<>|]/g, "_") || fallback;
  const exported = path.join(path.dirname(source), `${base}-test-${studentProfile}.txt`);
  copyFileSync(txtPath, exported);
  return exported;
}

/**
 * 输出平台评测可直接解析的 TXT（Step 格式，见 lib/txt-converter.ts）。
 */
export function buildTestScriptTxt({ taskId, taskName, profile, createdAt, messages }) {
  const lines = [
    "对话记录",
    `日志创建时间: ${createdAt}`,
    `任务名称: ${taskName || taskId}`,
    `task_id: ${taskId}`,
    `学生档位: ${profile}`,
    "=".repeat(60),
  ];
  for (const message of messages) {
    lines.push(
      `Step: ${message.stepName} | step_id: ${message.stepId} | ${formatStepRound(message.source, message.round)}`,
    );
    if (message.role === "user") {
      lines.push(`用户: ${message.content}`);
    } else {
      lines.push(`AI: ${message.content}`);
    }
    lines.push("-".repeat(40));
  }
  return `${lines.join("\n")}\n`;
}

function summarizeStages(messages, allSteps) {
  const counts = new Map();
  for (const message of messages) {
    const current = counts.get(message.stepId) || { stepName: message.stepName, rounds: 0 };
    if (message.role === "user") current.rounds += 1;
    counts.set(message.stepId, current);
  }
  const reached = allSteps.filter((step) => counts.has(step.stepId));
  const missed = allSteps.filter((step) => !counts.has(step.stepId));
  return {
    stageCount: allSteps.length,
    reachedCount: reached.length,
    missed,
    stages: allSteps.map((step) => {
      const info = counts.get(step.stepId);
      return {
        stepId: step.stepId,
        stepName: step.stepName,
        reached: Boolean(info),
        rounds: info?.rounds || 0,
      };
    }),
  };
}

function buildTestReport({ result, stageSummary, profile, runDir, files, exported }) {
  const lines = [
    "# 训练测试跑脚本报告",
    "",
    `- 任务: ${result.taskName || result.taskId}`,
    `- trainTaskId: ${result.taskId}`,
    `- 学生档位: ${profile}`,
    `- 模拟模型: ${result.model || "（未知）"}`,
    `- 完成状态: ${result.completed ? "整条训练已完成" : "未走完全部阶段"}`,
    `- 总轮次: ${result.totalRounds}`,
    "",
    "## 阶段覆盖",
    "",
    "| 阶段 | 是否进入 | 学生轮次 |",
    "| --- | --- | --- |",
  ];
  for (const stage of stageSummary.stages) {
    lines.push(`| ${stage.stepName} | ${stage.reached ? "是" : "否"} | ${stage.rounds} |`);
  }
  lines.push(
    "",
    "## 产物",
    "",
    ...files.map((file) => `- ${path.basename(file)}`),
    "",
  );
  if (exported.length) {
    lines.push("## 已导出到教师文档目录", "", ...exported.map((file) => `- ${file}`), "");
  }
  lines.push(`生成时间: ${nowStamp()}`, "");
  return lines.join("\n");
}

async function runOnce(config, options, studentProfile) {
  const {
    appUrl,
    target,
    type,
    runDir,
    maxRoundsPerStage,
    timeoutSeconds,
  } = options;
  const cookie = sanitizeCookie(config.polymas.cookie);
  if (!cookie) throw new CliError("缺少 Polymas Cookie，无法测试");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const startedAt = Date.now();
  const timingEvents = [];
  let response;
  try {
  try {
    response = await fetch(`${appUrl.replace(/\/+$/, "")}/api/training-test-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: target.trainTaskId,
        type,
        credentials: {
          cookie,
          authorization: config.polymas.authorization,
          userNid: config.polymas.userNid || undefined,
          apiOrigin: config.polymas.apiBaseUrl || undefined,
        },
        uiBaseUrl: config.polymas.uiBaseUrl || undefined,
        studentProfile,
        maxRoundsPerStage,
        useReferenceDialogue: options.useReference !== false,
        apiKey: config.llm.apiKey || undefined,
        apiUrl: config.llm.apiUrl || undefined,
        model: config.llm.model || undefined,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new CliError(
      error?.name === "AbortError"
        ? `测试运行超时（${timeoutSeconds} 秒）`
        : `无法连接本地应用：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new CliError(`测试接口失败：${await readErrorResponse(response)}`);
  }

  let doneEvent = null;
  let errorEvent = null;
  let lastStage = "";
  const events = await consumeSSE(response, (event) => {
    timingEvents.push({ type: event.type, elapsedMs: Date.now() - startedAt });
    if (event.type === "error") errorEvent = event;
    if (event.type === "done") doneEvent = event;
    if (event.type === "stage_start") {
      lastStage = event.stepName;
      log(`[test] 阶段 ${event.index}/${event.total}: ${event.stepName}`);
    }
    if (event.type === "message" && event.role === "user") {
      log(`[test]   学生第 ${event.round} 轮: ${String(event.text || "").slice(0, 60)}`);
    }
    if (event.type === "status") {
      log(`[test] ${event.message}`);
    }
    if (event.type === "reference") {
      log(`[test]   参考对话已生成（${event.stepName}，${String(event.content || "").length} 字符）`);
    }
  });

  if (!doneEvent) {
    throw new CliError(
      errorEvent?.message ||
        (lastStage ? `测试在阶段「${lastStage}」中断` : "测试接口未返回完成事件"),
    );
  }

  const createdAt = new Date().toISOString();
  const result = doneEvent;
  const stageSummary = summarizeStages(result.messages || [], result.steps || []);
  const txt = buildTestScriptTxt({
    taskId: result.taskId,
    taskName: result.taskName,
    profile: result.studentProfileLabel || profileLabel(studentProfile),
    createdAt,
    messages: result.messages || [],
  });
  const jsonPath = path.join(runDir, `test-${studentProfile}.json`);
  const txtPath = path.join(runDir, `test-${studentProfile}.txt`);
  writeJson(jsonPath, { ...result, createdAt, events: events.length,
    durationMs: Date.now() - startedAt, timingEvents });
  writeText(txtPath, txt);
  const exportedPath = exportToDocDir(
    options.exportToDoc === false ? null : options.docPath,
    result.taskName,
    studentProfile,
    txtPath,
  );

  return {
    profile: studentProfile,
    profileLabel: result.studentProfileLabel || profileLabel(studentProfile),
    result,
    stageSummary,
    files: [jsonPath, txtPath],
    exportedPath,
  };
  } catch (error) {
    writeJson(path.join(runDir, `test-${studentProfile}-interrupted.json`), {
      interrupted: true, profile: studentProfile, durationMs: Date.now() - startedAt,
      timedOut: controller.signal.aborted, timingEvents,
    });
    if (controller.signal.aborted) {
      throw new CliError(`测试运行超时（${timeoutSeconds} 秒，包含流读取）；未自动重试，请先核实原任务状态`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function runTrainingTest(config, options) {
  const runDir = options.runDir;
  const studentFlag = String(options.student || "good").toLowerCase();
  const students =
    studentFlag === "all" ? ["good", "guided", "offtopic"] : [studentFlag];
  for (const key of students) {
    if (!PROFILE_LABELS[key]) {
      throw new CliError(`--student 仅支持 good、guided、offtopic、all，收到: ${key}`);
    }
  }

  const results = [];
  const files = [];
  for (const student of students) {
    log("");
    log(`[test] 开始模拟学生：${profileLabel(student)}`);
    const item = await runOnce(config, options, student);
    results.push(item);
    files.push(...item.files);
    log(
      `[test] 完成：阶段 ${item.stageSummary.reachedCount}/${item.stageSummary.stageCount}，轮次 ${item.result.totalRounds}，状态 ${item.result.completed ? "已完成" : "未走完"}`,
    );
  }

  const primary = results[0];
  const reportPath = path.join(runDir, "test-report.md");
  const reportFiles = results.flatMap((item) => item.files).concat(reportPath);
  const exportedFiles = results.map((item) => item.exportedPath).filter(Boolean);
  writeText(
    reportPath,
    buildTestReport({
      result: primary.result,
      stageSummary: primary.stageSummary,
      profile: primary.profileLabel,
      runDir,
      files: reportFiles,
      exported: exportedFiles,
    }),
  );

  const summary = {
    completedAt: new Date().toISOString(),
    studentProfiles: results.map((item) => item.profile),
    completed: results.every((item) => item.result.completed),
    totalRounds: results.reduce((sum, item) => sum + (item.result.totalRounds || 0), 0),
    stageCoverage: results.map((item) => ({
      profile: item.profile,
      reached: item.stageSummary.reachedCount,
      total: item.stageSummary.stageCount,
      missed: item.stageSummary.missed.map((stage) => stage.stepName),
    })),
    reportPath,
    files,
    exportedFiles,
  };

  if (exportedFiles.length) {
    for (const file of exportedFiles) log(`[test] 已导出到教师文档目录: ${file}`);
  } else if (!options.docPath) {
    warn("[test] run.json 没有记录教师文档路径，测试脚本只保存在运行目录");
  }

  if (summary.stageCoverage.some((item) => item.missed.length > 0)) {
    warn(
      `[test] 有阶段未访问到：${summary.stageCoverage
        .flatMap((item) => item.missed)
        .join("、")}`,
    );
  }
  if (!summary.completed) {
    warn("[test] 训练未走完全部阶段，请查看 test-report.md");
  }

  return summary;
}
