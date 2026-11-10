import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  CliError,
  SKILL_ROOT,
  exists,
  firstNonEmpty,
  parseEnvFile,
  readJson,
  toAbs,
} from "./util.mjs";

function detectAppRoot(explicit) {
  const candidates = [
    explicit,
    process.env.TRAINING_APP_ROOT,
    path.resolve(process.cwd(), "frontend"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const root = path.resolve(candidate);
    if (exists(path.join(root, "lib/training-injector-pro/parser.ts"))) {
      return root;
    }
  }
  return explicit ? path.resolve(explicit) : "";
}

export function resolveRuntime(flags = {}) {
  const home = os.homedir();
  const roots = {
    "qoder-cn": path.join(home, ".qoder-cn/skills"),
    qoder: path.join(home, ".qoder/skills"),
    dsh: path.join(home, ".dsh/skills"),
    hermes: path.join(home, ".hermes/skills/polymas"),
  };
  const contains = (root, candidate) =>
    candidate === root || candidate.startsWith(root + path.sep);
  const identify = (candidate) => {
    if (!candidate) return "";
    const absolute = path.resolve(candidate);
    return Object.keys(roots).find((client) =>
      ["training-config-generate-inject", "training-optimize-inject"].some((name) =>
        contains(path.join(roots[client], name), absolute),
      ),
    ) || "";
  };
  for (const option of ["client", "config"]) {
    if (flags[option] !== undefined &&
        (typeof flags[option] !== "string" || !flags[option].trim())) {
      throw new CliError(`--${option} 需要一个非空值`);
    }
  }
  const requestedClient = firstNonEmpty(flags.client, process.env.TRAINING_CLIENT);
  if (requestedClient && !Object.hasOwn(roots, requestedClient)) {
    throw new CliError("--client / TRAINING_CLIENT 仅支持 qoder-cn、qoder、dsh、hermes");
  }
  const explicitConfig = firstNonEmpty(flags.config, process.env.TRAINING_CONFIG);
  const configPath = explicitConfig
    ? toAbs(explicitConfig.startsWith("~/") ? path.join(home, explicitConfig.slice(2)) : explicitConfig)
    : "";
  const configClient = identify(configPath);
  if (requestedClient && configClient && requestedClient !== configClient) {
    throw new CliError("--client 与配置文件所属应用不一致，已停止以避免串用凭据");
  }
  const client = requestedClient || configClient ||
    (explicitConfig ? "" : identify(process.argv[1]) || identify(process.cwd()));
  if (!client && !explicitConfig) {
    throw new CliError("无法确定本端配置；请指定 --client qoder-cn|qoder|dsh|hermes 或 --config <独立配置文件>");
  }
  const configDir = configPath ? path.dirname(configPath) : "";
  const dataRoot = client
    ? path.join(roots[client], "training-config-generate-inject")
    : path.basename(configDir) === "config" ? path.dirname(configDir) : configDir;
  const resolvedConfig = configPath || path.join(dataRoot, "config/config.json");
  const runsRoot = path.join(dataRoot, "runs");
  const realLocation = (candidate) => {
    const missing = [];
    let existing = candidate;
    while (!fs.existsSync(existing)) {
      missing.unshift(path.basename(existing));
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    return path.join(fs.realpathSync(existing), ...missing);
  };
  const sharedRoots = [path.join(home, ".agents/skills"), path.dirname(SKILL_ROOT)].map(realLocation);
  for (const candidate of [resolvedConfig, runsRoot]) {
    const real = realLocation(candidate);
    if (sharedRoots.some((root) => contains(root, real))) {
      throw new CliError("配置和运行产物必须位于共享技能代码目录之外");
    }
    const realClient = identify(real);
    if (client && realClient && realClient !== client) {
      throw new CliError("配置或运行目录链接到了其他应用，已停止以避免串用数据");
    }
  }
  return { client: client || "custom", dataRoot, configPath: resolvedConfig, runsRoot };
}

export function loadConfig(flags = {}) {
  const runtime = resolveRuntime(flags);
  const { configPath } = runtime;
  const fileConfig = readJson(configPath, {}) || {};

  const appRoot = detectAppRoot(
    firstNonEmpty(flags["app-root"], fileConfig.appRoot),
  );
  const appEnvPath = appRoot ? path.join(appRoot, ".env.local") : "";
  const appEnv = appEnvPath ? parseEnvFile(appEnvPath) : {};
  const fallbackEnv = appRoot ? parseEnvFile(path.join(appRoot, ".env")) : {};

  const llm = {
    apiUrl: firstNonEmpty(
      flags["llm-url"],
      fileConfig.llm?.apiUrl,
      process.env.LLM_API_URL,
      appEnv.LLM_API_URL,
      appEnv.LLM_BASE_URL,
      fallbackEnv.LLM_API_URL,
      fallbackEnv.LLM_BASE_URL,
    ),
    apiKey: firstNonEmpty(
      flags["llm-key"],
      fileConfig.llm?.apiKey,
      process.env.LLM_API_KEY,
      appEnv.LLM_API_KEY,
      fallbackEnv.LLM_API_KEY,
    ),
    model: firstNonEmpty(
      flags.model,
      fileConfig.llm?.model,
      process.env.LLM_MODEL,
      appEnv.LLM_MODEL,
      fallbackEnv.LLM_MODEL,
    ),
  };

  const polymas = {
    cookie: firstNonEmpty(
      flags.cookie,
      fileConfig.polymas?.cookie,
      process.env.POLYMAS_COOKIE,
    ),
    authorization: firstNonEmpty(
      flags.authorization,
      fileConfig.polymas?.authorization,
      process.env.POLYMAS_AUTHORIZATION,
    ),
    courseId: firstNonEmpty(
      flags["course-id"],
      fileConfig.polymas?.courseId,
      process.env.POLYMAS_COURSE_ID,
    ),
    libraryId: firstNonEmpty(
      flags["library-id"],
      fileConfig.polymas?.libraryId,
      process.env.POLYMAS_LIBRARY_ID,
    ),
    userNid: firstNonEmpty(
      flags["user-nid"],
      fileConfig.polymas?.userNid,
      process.env.POLYMAS_USER_NID,
    ),
    apiBaseUrl:
      firstNonEmpty(
        flags["api-base"],
        process.env.POLYMAS_API_BASE_URL,
        fileConfig.polymas?.apiBaseUrl,
      ) || "https://cloudapi.polymas.com",
    uiBaseUrl:
      firstNonEmpty(
        flags["ui-base"],
        process.env.POLYMAS_UI_BASE_URL,
        fileConfig.polymas?.uiBaseUrl,
      ) || "https://hike-teaching-center.polymas.com",
  };

  const imageProviderMode =
    firstNonEmpty(
      flags["image-provider"],
      fileConfig.inject?.imageProviderMode,
      process.env.TRAINING_IMAGE_PROVIDER,
    ) || "openai";
  const imageProviderPriority =
    firstNonEmpty(
      flags["image-priority"],
      fileConfig.inject?.imageProviderPriority,
      process.env.TRAINING_IMAGE_PROVIDER_PRIORITY,
    ) || (imageProviderMode === "cloudapi" ? "cloudapi,openai" : "openai,cloudapi");

  const inject = {
    mode:
      firstNonEmpty(
        flags.mode,
        fileConfig.inject?.mode,
        process.env.TRAINING_INJECT_MODE,
      ) || "fresh",
    injectCoverImage:
      flags["no-cover"] === true
        ? false
        : fileConfig.inject?.injectCoverImage !== false,
    injectBackgroundImage:
      flags["no-background"] === true
        ? false
        : fileConfig.inject?.injectBackgroundImage !== false,
    digitalHumanAvatarMode:
      firstNonEmpty(
        flags["avatar-mode"],
        fileConfig.inject?.digitalHumanAvatarMode,
      ) || "existing",
    imageProviderMode,
    imageProviderPriority,
    imageModel:
      firstNonEmpty(flags["image-model"], fileConfig.inject?.imageModel) ||
      "gpt-image-2",
    coverStylePrompt: firstNonEmpty(
      flags["cover-style"],
      fileConfig.inject?.coverStylePrompt,
    ),
    backgroundStylePrompt: firstNonEmpty(
      flags["background-style"],
      fileConfig.inject?.backgroundStylePrompt,
    ),
  };

  const training = {
    type:
      firstNonEmpty(
        flags.type,
        fileConfig.training?.type,
        process.env.TRAINING_TYPE,
      ) || "pro",
  };

  return {
    skillRoot: SKILL_ROOT,
    ...runtime,
    appRoot,
    appEnvPath,
    appBaseUrl:
      firstNonEmpty(
        flags["app-url"],
        fileConfig.appBaseUrl,
        process.env.TRAINING_APP_BASE_URL,
      ) || "http://localhost:3000",
    llm,
    polymas,
    inject,
    training,
    raw: fileConfig,
  };
}

function extractCookieValue(cookie, name) {
  const raw = String(cookie || "").trim().replace(/^cookie\s*:\s*/i, "");
  for (const pair of raw.split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    if (pair.slice(0, index).trim().toLowerCase() !== name) continue;
    const value = pair.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

export function describeCredentials(config) {
  const aiPoly = extractCookieValue(config.polymas.cookie, "ai-poly");
  return {
    hasCookie: Boolean(config.polymas.cookie),
    hasAuthorization: Boolean(config.polymas.authorization),
    hasAiPoly: Boolean(aiPoly),
    aiPoly,
  };
}
