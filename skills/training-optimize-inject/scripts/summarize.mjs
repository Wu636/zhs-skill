#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readText(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

function parseRunDir(argv) {
  const args = argv.slice(2);
  const runIndex = args.findIndex((item) => item === "--run" || item === "-r");
  const outIndex = args.findIndex((item) => item === "--out" || item === "-o");
  const run = runIndex >= 0 ? args[runIndex + 1] : args.find((item) => !item.startsWith("-"));
  const out = outIndex >= 0 ? args[outIndex + 1] : "";
  if (!run) {
    console.error("用法: node summarize.mjs --run <运行目录> [--out 报告路径]");
    process.exit(1);
  }
  return { run: path.resolve(run), out };
}

function splitStages(markdown) {
  const sections = String(markdown || "").split(/^###\s*阶段/m).slice(1);
  return sections.map((section) => {
    const [firstLine, ...rest] = section.split("\n");
    const name = firstLine.replace(/^\s*\d+\s*[:：]\s*/, "").trim();
    return { name, body: rest.join("\n").trim() };
  });
}

function latestBackup(runDir) {
  const files = fs
    .readdirSync(runDir)
    .filter((name) => /^script\.before-(optimize|review)-.*\.md$/.test(name))
    .sort();
  return files.length ? path.join(runDir, files[files.length - 1]) : "";
}

function latestReview(runDir) {
  const files = fs
    .readdirSync(runDir)
    .map((name) => ({ name, match: /^review-(\d+)\.md$/.exec(name) }))
    .filter((item) => item.match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));
  if (!files.length) return null;
  const file = files[files.length - 1];
  const text = readText(path.join(runDir, file.name));
  const match =
    text.match(/^(?:结论|结果|verdict)\s*[:：]\s*(通过|不通过|PASS|FAIL)/im) ||
    text.match(/^\s*(通过|不通过|PASS|FAIL)\s*$/im);
  const raw = match ? match[1].toLowerCase() : "";
  const passed = raw === "通过" || raw === "pass";
  const issueSection = text.match(/##\s*问题清单[\s\S]*?(?=\n##\s|$)/i);
  const issues = issueSection
    ? issueSection[0]
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter((line) => line && !/^（.*）$/.test(line))
    : [];
  return {
    name: file.name,
    round: Number(file.match[1]),
    verdict: match ? (passed ? "通过" : "不通过") : "未填写",
    passed,
    issues,
  };
}

function main() {
  const { run, out } = parseRunDir(process.argv);
  const pull = readJson(path.join(run, "pull.json"), {});
  const meta = readJson(path.join(run, "run.json"), {});
  const loop = meta.loop || null;
  const script = readText(path.join(run, "script.md"));
  const backupPath = latestBackup(run);
  const before = backupPath ? splitStages(readText(backupPath)) : [];

  const changedStages = [];
  if (before.length) {
    const after = splitStages(script);
    before.forEach((stage, index) => {
      const next = after[index];
      if (!next) {
        changedStages.push(`${stage.name}（结构变化）`);
      } else if (next.name !== stage.name) {
        changedStages.push(`${stage.name} → ${next.name}`);
      } else if (next.body !== stage.body) {
        changedStages.push(stage.name);
      }
    });
  }

  const review = latestReview(run);
  const loopRounds = loop?.rounds || [];
  const reviewSummary = review
    ? `${review.name}（${review.verdict}）`
    : "";
  const verdicts = loopRounds.length
    ? loopRounds
        .map((round) => `第 ${round.iteration} 轮 ${round.verdict || "-"}`)
        .join(" → ")
    : reviewSummary || "-";

  const hasReview = Boolean(loopRounds.length || review);
  const passed = Boolean(loop?.passed ?? review?.passed ?? false);
  const published = Boolean(loop?.published ?? meta.published ?? false);
  const issues = review?.issues?.length
    ? review.issues
    : loopRounds
        .filter((round) => round.verdict !== "通过" && round.note)
        .map((round) => `第 ${round.iteration} 轮：${round.note}`);
  const teacherFeedback = meta.optimize?.feedback || "";
  const warnings = pull?.warnings || [];

  const lines = [
    `# 能力训练优化报告：${pull.taskName || meta.target?.trainTaskId || "训练"}`,
    "",
    "## 交付结论",
    "",
    `- 结果：${!hasReview ? "未自审（尚无自审结论）" : passed ? "自审通过" : "自审未通过，需继续优化"}`,
    `- 平台状态：${published ? "已发布" : "未发布（草稿/未提交）"}`,
    `- 自审结论：${verdicts}`,
    `- 训练链接：${meta.target?.targetUrl || pull.target?.targetUrl || "-"}`,
    "",
    "## 基本信息",
    "",
    `- 训练类型：${pull.type === "oral" ? "口语训练" : pull.type === "ability" ? "基础版能力训练" : pull.type || "-"}`,
    `- trainTaskId：${pull.target?.trainTaskId || meta.target?.trainTaskId || "-"}`,
    `- 阶段数：${pull.stepCount ?? "-"}`,
    `- 评分项：${pull.scoreItemCount ?? "-"}　重点词汇：${pull.vocabCount ?? "-"}`,
    `- 运行目录：${run}`,
    "",
    "## 教师修改意见",
    "",
    teacherFeedback ? String(teacherFeedback) : "（未记录，可能仅按自审问题清单优化）",
    "",
    "## 本轮剧本改动",
    "",
    changedStages.length
      ? changedStages.map((name) => `- ${name}`).join("\n")
      : "- 未检测到阶段级改动（可能是首轮注入或优化结果为空）",
    "",
    "## 剩余问题",
    "",
    issues.length
      ? issues.slice(0, 8).map((issue) => `- ${issue}`).join("\n")
      : "- 无",
    "",
    "## 风险提示",
    "",
    warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- 无",
    "",
    "## 交付物",
    "",
    "- script.md：已落地的优化剧本",
    "- rubric.md：评价标准（口语训练为空）",
    "- test-<档位>.txt：模拟学生完整对话脚本",
    "- review-input-<n>.md / review-<n>.md：自审材料与结论",
    "- loop-report.md：迭代记录（如执行了 loop）",
    "",
  ];

  const target = out || path.join(run, "优化报告.md");
  fs.writeFileSync(target, lines.join("\n"), "utf8");
  console.log(`[report] ${target}`);
}

main();
