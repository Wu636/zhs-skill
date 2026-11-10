import fs from "node:fs";
import path from "node:path";
import { CliError, exists, readJson, readText, writeText } from "./util.mjs";

const STUDENT_LABELS = {
  good: "优秀学生",
  guided: "需要引导的学生",
  offtopic: "答非所问的学生",
};

const CHECKLIST = `1. 每个阶段的目标是否与教师文档一致，是否存在缺阶段、多阶段或阶段目标偏移。
2. 模拟学生是否完成了该阶段的关键动作；没完成时，是剧本没引导到位还是学生行为不匹配。
3. AI 是否直接给出答案或剧透后续阶段；是否在学生答错/卡住时给出可执行的引导。
4. 阶段切换是否自然，是否出现跳阶段、回退、重复循环或无法结束。
5. 阶段提示词是否包含角色、场景、任务边界、引导方式和结束条件，是否有互相矛盾的指令。
6. 口语训练：重点词汇是否覆盖并在对话中自然出现，表达是否地道、难度是否匹配。
7. 评价标准要求的行为，能否在对话中被观察到；不能观察到的行为要在剧本里补足触发场景。
8. 对话是否存在机械重复、答非所问、长时间空转、未收尾等问题。
9. 只调整剧本阶段内容，不改评分标准，不引入教师文档之外的新任务。`;

function latestReviewRound(runDir) {
  const rounds = fs
    .readdirSync(runDir)
    .map((name) => /^review-(\d+)\.md$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return rounds.length ? Math.max(...rounds) : 0;
}

function stageSummary(testJson) {
  const steps = Array.isArray(testJson?.steps) ? testJson.steps : [];
  const messages = Array.isArray(testJson?.messages) ? testJson.messages : [];
  return steps.map((step) => {
    const rounds = messages.filter((item) => item.stepId === step.stepId).length;
    return `- 阶段${step.index}：${step.stepName}（stepId ${step.stepId}，${rounds} 条消息）`;
  });
}

function reviewTemplate(round, student) {
  return `# 第 ${round} 轮对话自审（${STUDENT_LABELS[student] || student}）

结论：待填写（通过 / 不通过）

## 问题清单

（按阶段列出：阶段名 / 对话中的证据 / 为什么是问题）

## 修改建议

（按阶段列出：改哪一段提示词或流程，改成什么；只改剧本，不改评分标准）

## 已直接调整

（如果已经直接改了 script.md，写清改了哪些阶段；没有就写“无”）
`;
}

export function buildReviewPacket(runDir, student = "good") {
  if (!STUDENT_LABELS[student]) {
    throw new CliError(`--student 仅支持 good、guided、offtopic，收到: ${student}`);
  }
  const meta = readJson(path.join(runDir, "run.json"), {});
  const scriptPath = exists(path.join(runDir, "script.md"))
    ? path.join(runDir, "script.md")
    : path.join(runDir, "config.md");
  if (!exists(scriptPath)) {
    throw new CliError(`运行目录缺少 script.md / config.md: ${runDir}`);
  }
  const testPath = path.join(runDir, `test-${student}.txt`);
  if (!exists(testPath)) {
    throw new CliError(`缺少测试脚本: ${testPath}，请先执行 test --run <目录>`);
  }
  const rubricPath = path.join(runDir, "rubric.md");
  const reportPath = path.join(runDir, "test-report.md");
  const docPath = meta.docPath || "";
  const teacherDoc = docPath && exists(docPath)
    ? readText(docPath)
    : "（run.json 未记录教师文档，或文件已不存在；按当前剧本与对话自审）";
  const rubric = exists(rubricPath) ? readText(rubricPath) : "（无评价标准文件）";
  const script = readText(scriptPath);
  const dialogue = readText(testPath);
  const testJson = readJson(path.join(runDir, `test-${student}.json`), null);
  const coverage = stageSummary(testJson);
  const round = latestReviewRound(runDir) + 1;
  const packetPath = path.join(runDir, `review-input-${round}.md`);
  const reviewPath = path.join(runDir, `review-${round}.md`);

  const lines = [
    `# 第 ${round} 轮自审材料：${meta.taskName || path.basename(runDir)}`,
    "",
    "## 执行方式",
    "",
    "不使用系统 21 维评测接口，不做数字打分。请直接阅读下面的教师文档、剧本、模拟对话与阶段覆盖，",
    "逐条核对自审清单，然后把结论写到",
    `\`${reviewPath}\``,
    "（首行必须是 `结论：通过` 或 `结论：不通过`，并写清问题与修改建议）。",
    "问题明确时可以直接修改 `script.md`（先复制一份 `script.before-review-<时间戳>.md`），",
    "改完依次执行 normalize → validate → inject → verify → test，再生成下一轮自审材料。",
    "",
    "## 自审清单",
    "",
    CHECKLIST,
    "",
    "## 测试概况",
    "",
    `- 学生档位：${STUDENT_LABELS[student]}`,
    `- 完成状态：${testJson ? (testJson.completed ? "已走完全部阶段" : "未走完全部阶段") : "未知"}`,
    `- 总轮次：${testJson?.totalRounds ?? "未知"}`,
    `- 阶段覆盖：${testJson?.steps?.length ?? "未知"} 个阶段`,
    "",
    ...(coverage.length ? [...coverage, ""] : []),
    `- 完整对话：${testPath}`,
    `- 测试报告：${exists(reportPath) ? reportPath : "（无）"}`,
    "",
    "## 教师任务文档",
    "",
    docPath && exists(docPath) ? `来源：${docPath}` : "来源：未记录",
    "",
    "```markdown",
    teacherDoc.trim(),
    "```",
    "",
    "## 评价标准（平台原样，不得修改）",
    "",
    rubric.trim(),
    "",
    "## 当前剧本",
    "",
    `来源：${scriptPath}`,
    "",
    "```markdown",
    script.trim(),
    "```",
    "",
    `## 模拟学生对话（${STUDENT_LABELS[student]}）`,
    "",
    `来源：${testPath}`,
    "",
    "```text",
    dialogue.trim(),
    "```",
    "",
  ];

  writeText(packetPath, lines.join("\n"));
  if (!exists(reviewPath)) {
    writeText(reviewPath, reviewTemplate(round, student));
  }
  return {
    round,
    packetPath,
    reviewPath,
    scriptPath,
    testPath,
    docPath,
    rubricPath: exists(rubricPath) ? rubricPath : "",
  };
}

export function parseReviewVerdict(reviewPath) {
  if (!exists(reviewPath)) {
    throw new CliError(`review 文件不存在: ${reviewPath}`);
  }
  const text = readText(reviewPath, "");
  const match =
    text.match(/^(?:结论|结果|verdict)\s*[:：]\s*(通过|不通过|PASS|FAIL)(?=\s|$)/im) ||
    text.match(/^\s*(通过|不通过|PASS|FAIL)\s*$/im);
  if (!match) {
    throw new CliError(
      `review 文件缺少结论行：请在 ${reviewPath} 首部写“结论：通过”或“结论：不通过”`,
    );
  }
  const raw = match[1].toLowerCase();
  const passed = raw === "通过" || raw === "pass";

  const section = text.match(
    /##\s*(?:修改建议|问题清单)[\s\S]*?(?=\n##\s|$)/i,
  );
  const feedback = (section ? section[0] : text).trim();
  return { passed, feedback, text };
}
