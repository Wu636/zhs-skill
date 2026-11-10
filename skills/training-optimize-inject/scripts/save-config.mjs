#!/usr/bin/env node
import fs from "node:fs";
import { saveAndPublishBasicTrainingTask } from "../../training-config-generate-inject/scripts/lib/platform-basic.mjs";
import { loadConfig, resolveRuntime } from "../../training-config-generate-inject/scripts/lib/config.mjs";
import { argBool, argString, CliError, parseArgv } from "../../training-config-generate-inject/scripts/lib/util.mjs";

async function main() {
  const { flags } = parseArgv(["save", ...process.argv.slice(2)]);
  if (flags.help || flags.h) {
    console.log('用法: node save-config.mjs --target-url "<目标训练链接>" [--client qoder-cn|qoder|dsh|hermes] [--config <独立配置>] [--dry-run | --yes]');
    return;
  }
  const targetUrl = argString(flags, "target-url");
  if (!targetUrl) throw new CliError("缺少 --target-url");
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new CliError("--target-url 必须是有效的训练编辑页 URL");
  }
  const [prefix, courseId, segment] = url.pathname.split("/").filter(Boolean);
  if (prefix !== "agent-course-full" || !courseId ||
      !["ability-training", "language-training"].includes(segment)) {
    throw new CliError("目标链接必须是 /agent-course-full/<courseId>/ 下的基础版或口语训练编辑页");
  }
  const trainTaskId = url.searchParams.get("trainTaskId") || "";
  if (!trainTaskId) throw new CliError("目标训练链接缺少 trainTaskId");
  const libraryFolderId = url.searchParams.get("libraryId") || "";
  const type = segment === "language-training" ? "oral" : "ability";
  const runtime = resolveRuntime(flags);
  if (argBool(flags, "dry-run", false)) {
    console.log(JSON.stringify({ dryRun: true, trainTaskId, type, courseId, libraryFolderId, ...runtime }, null, 2));
    return;
  }
  if (!argBool(flags, "yes", false)) {
    throw new CliError("保存会发布到课程；取得当前任务授权后加 --yes，检查路径请用 --dry-run");
  }
  if (!fs.existsSync(runtime.configPath)) {
    throw new CliError(`找不到本端配置文件：${runtime.configPath}`);
  }
  const config = loadConfig(flags);
  const result = await saveAndPublishBasicTrainingTask(config, {
    trainTaskId,
    type,
    courseId,
    libraryFolderId,
  });
  console.log(`[ok] 已保存并发布：trainTaskId=${result.trainTaskId}`);
  console.log(`[ok] courseId=${result.courseId} libraryId=${result.libraryFolderId || "(空)"} unpublishedChanges=${result.unpublishedChanges}`);
}

main().catch((error) => {
  console.error(`[error] ${error?.message || error}`);
  process.exitCode = 1;
});
