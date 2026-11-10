import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  CliError,
  decodeJwtPayload,
  formatDate,
  normalizeName,
} from "./util.mjs";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export function sanitizeCookie(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const headerMatch = value.match(/^cookie\s*:\s*([\s\S]+)$/i);
  return (headerMatch ? headerMatch[1] : value).trim();
}

export function extractCookieValue(cookie, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const pair of sanitizeCookie(cookie).split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    if (!wanted.has(pair.slice(0, index).trim().toLowerCase())) continue;
    const value = pair.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

export function resolveAuthorization(cookie, explicit) {
  const raw = String(explicit || "").trim();
  if (!raw) return "";
  const headerMatch = raw.match(/^authorization\s*:\s*([\s\S]+)$/i);
  const token = (headerMatch ? headerMatch[1] : raw).trim();
  if (/^Bearer\s+/i.test(token)) return token;
  return `Bearer ${token}`;
}

export function inspectCookie(cookie) {
  const token = extractCookieValue(cookie, ["ai-poly"]);
  if (!token) return { hasToken: false, expired: null, expiresAt: "", subject: "" };
  const payload = decodeJwtPayload(token);
  if (!payload) return { hasToken: true, expired: null, expiresAt: "", subject: "" };
  const exp = Number(payload.exp || 0);
  return {
    hasToken: true,
    expired: exp ? exp * 1000 < Date.now() : null,
    expiresAt: exp ? formatDate(exp) : "",
    subject: String(payload.userNid || payload.sub || payload.userId || ""),
  };
}

function platformContext(config) {
  const cookie = sanitizeCookie(config.polymas.cookie);
  if (!cookie) {
    throw new CliError(
      "缺少 Polymas Cookie。请先登录平台，把 Cookie 写入配置或 POLYMAS_COOKIE 环境变量。",
    );
  }
  return {
    baseUrl: config.polymas.apiBaseUrl.replace(/\/+$/, ""),
    cookie,
    authorization: resolveAuthorization(cookie, config.polymas.authorization),
  };
}

export function rawToken(cookie, explicit) {
  const raw = String(explicit || "").trim();
  const headerMatch = raw.match(/^authorization\s*:\s*([\s\S]+)$/i);
  const token = (headerMatch ? headerMatch[1] : raw).trim();
  if (token) return token.replace(/^Bearer\s+/i, "").trim();
  for (const name of ["zhs-jt-cas", "ai-poly"]) {
    const value = extractCookieValue(cookie, [name]);
    if (value) return value;
  }
  return "";
}

export async function request(config, method, apiPath, body, options = {}) {
  const ctx = platformContext(config);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: ctx.cookie,
    "User-Agent": USER_AGENT,
  };
  const authorization =
    options.authStyle === "raw"
      ? rawToken(ctx.cookie, config.polymas.authorization)
      : ctx.authorization;
  if (authorization) headers.Authorization = authorization;
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  let response;
  try {
    response = await fetch(`${ctx.baseUrl}${apiPath}`, {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs || 60000),
    });
  } catch (error) {
    throw new CliError(`请求平台失败 (${apiPath}): ${error.message}`);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new CliError(
      `平台返回非 JSON (${response.status} ${apiPath}): ${text.slice(0, 200)}`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new CliError(
      `平台鉴权失败 (HTTP ${response.status})，Cookie 或 Authorization 可能已过期，请重新登录后更新配置。`,
    );
  }
  if (!response.ok) {
    throw new CliError(
      `平台请求失败 HTTP ${response.status} (${apiPath}): ${data.msg || data.message || data.error || text.slice(0, 200)}`,
    );
  }
  if (typeof data === "object" && data !== null && ("code" in data || "success" in data)) {
    const success =
      data.success === true || String(data.code) === "200" || String(data.code) === "0";
    if (!success) {
      throw new CliError(
        `平台返回错误 (${apiPath}): ${data.msg || data.message || data.error || "unknown"} (code: ${data.code ?? "?"})`,
      );
    }
    return data.data;
  }
  return data;
}

export async function getTaskDetail(config, trainTaskId) {
  return request(
    config,
    "GET",
    `/ai-platform/ability-train/tasks/detail?taskId=${encodeURIComponent(trainTaskId)}`,
  );
}

export async function listSteps(config, trainTaskId) {
  return request(
    config,
    "GET",
    `/ai-platform/ability-train/steps/list?taskId=${encodeURIComponent(trainTaskId)}`,
  );
}

export async function listGlobalRoles(config, trainTaskId) {
  return request(
    config,
    "GET",
    `/ai-platform/ability-train/global-roles/list?trainTaskId=${encodeURIComponent(trainTaskId)}&needSystemRole=true`,
  );
}

export async function listSkills(config, trainTaskId) {
  return request(
    config,
    "GET",
    `/ai-platform/ability-train/skills/list?taskId=${encodeURIComponent(trainTaskId)}`,
  );
}

export async function uploadImage(config, filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new CliError(`封面文件不存在: ${absolute}`);
  }
  const buffer = fs.readFileSync(absolute);
  const fileName = path.basename(absolute);
  const mimeType =
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
    }[path.extname(absolute).toLowerCase()] || "application/octet-stream";
  const ctx = platformContext(config);
  const headers = {
    Accept: "application/json, text/plain, */*",
    Cookie: ctx.cookie,
    "User-Agent": USER_AGENT,
  };
  if (ctx.authorization) headers.Authorization = ctx.authorization;

  const form = new FormData();
  form.append("identifyCode", crypto.randomUUID());
  form.append("name", fileName);
  form.append("chunk", "0");
  form.append("chunks", "1");
  form.append("size", String(buffer.length));
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);

  const response = await fetch(`${ctx.baseUrl}/basic-resource/file/upload`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CliError(`封面上传返回非 JSON: ${text.slice(0, 200)}`);
  }
  if (!response.ok || !(data.success === true || String(data.code) === "200")) {
    throw new CliError(
      `封面上传失败: ${data.msg || data.message || data.error || "unknown"}`,
    );
  }
  const payload = data.data || {};
  const fileUrl = payload.ossUrl || payload.fileUrl || payload.url || "";
  const fileId = payload.fileId || "";
  if (!fileUrl) throw new CliError("封面上传成功但未返回文件地址");
  return { fileId, fileUrl };
}

export function buildTargetUrl(config, { courseId, trainTaskId, libraryId }) {
  const base = String(config.polymas.uiBaseUrl || "").replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (libraryId) params.set("libraryId", libraryId);
  params.set("businessType", "course");
  params.set("businessId", courseId);
  params.set("trainTaskId", trainTaskId);
  return `${base}/agent-course-full/${courseId}/ability-training-pro/create?${params.toString()}`;
}

export async function createTrainingTask(config, { name, description, coverPath }) {
  if (!String(name || "").trim()) {
    throw new CliError("新建能力训练需要任务名称");
  }

  const cover = coverPath ? await uploadImage(config, coverPath) : null;
  const payload = {
    trainTaskName: name.trim(),
    description: String(description || "").trim(),
    trainTaskCover: cover,
    trainTime: null,
    firstStepId: null,
    publishStatus: null,
    voiceUrl: null,
    openSubtitle: null,
    openVideo: null,
    communicateMethod: 3,
    entranceVoiceType: null,
    entranceVoiceSpeed: null,
    entranceVoiceNid: null,
    extText: { trainScreen: false, trainScreenType: 1 },
  };

  const createdId = await request(
    config,
    "POST",
    "/ai-platform/ability-train/tasks/create",
    payload,
  );
  if (typeof createdId !== "string" || !createdId.trim()) {
    throw new CliError(
      `新建能力训练未返回 trainTaskId: ${JSON.stringify(createdId).slice(0, 200)}`,
    );
  }
  const trainTaskId = createdId.trim();
  const courseId = String(config.polymas.courseId || "").trim();

  return {
    trainTaskId,
    courseId,
    targetUrl: buildTargetUrl(config, {
      courseId,
      trainTaskId,
      libraryId: config.polymas.libraryId,
    }),
  };
}

export async function publishTrainingTask(config, { trainTaskId }) {
  const courseId = String(config.polymas.courseId || "").trim();
  if (!courseId) throw new CliError("发布能力训练需要 courseId");
  await request(config, "POST", "/ai-platform/ability-train/tasks/publish", {
    courseId,
    taskId: trainTaskId,
    libraryFolderId: String(config.polymas.libraryId || ""),
  });
  return { trainTaskId, courseId };
}

export async function collectSnapshot(config, trainTaskId) {
  const [detail, steps, roles, skills] = await Promise.all([
    getTaskDetail(config, trainTaskId),
    listSteps(config, trainTaskId).catch(() => []),
    listGlobalRoles(config, trainTaskId).catch(() => []),
    listSkills(config, trainTaskId).catch(() => []),
  ]);
  return {
    detail: detail || {},
    steps: Array.isArray(steps) ? steps : [],
    roles: Array.isArray(roles) ? roles : [],
    skills: Array.isArray(skills) ? skills : [],
  };
}

function isSystemRole(role) {
  return (
    role?.nid === "system" ||
    role?.roleType === "system" ||
    role?.systemRole === true
  );
}

function roleName(role) {
  return String(role?.roleName || role?.nickname || "").trim();
}

function skillName(skill) {
  return String(skill?.name || skill?.skillName || skill?.packageName || "").trim();
}

function boundSkillIds(role) {
  const ids = new Set();
  for (const item of Array.isArray(role?.skillList) ? role.skillList : []) {
    if (item?.nid) ids.add(String(item.nid));
  }
  const raw = role?.skills;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = typeof item === "string" ? item : item?.nid;
      if (id) ids.add(String(id));
    }
  } else if (typeof raw === "string") {
    raw.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .forEach((value) => ids.add(value));
  }
  return ids;
}

export function compareSnapshot(config, parsed, snapshot, mode = "fresh") {
  const checks = [];
  const push = (status, name, detail) => checks.push({ status, name, detail });
  const { detail = {}, steps = [], roles = [], skills = [] } = snapshot;
  const expected = parsed || {};
  const expectedName = String(expected.globalConfig?.abilityName || "").trim();
  const expectedStages = (expected.stages || []).filter((item) => item.cardName);
  const expectedMembers = Array.isArray(expected.members) ? expected.members : [];

  const actualName = String(detail.trainTaskName || "").trim();
  if (!expectedName) {
    push("warn", "任务名称", "配置中没有能力名称，跳过比对");
  } else if (normalizeName(actualName) === normalizeName(expectedName)) {
    push("pass", "任务名称", actualName);
  } else {
    push("fail", "任务名称", `平台为「${actualName || "空"}」，期望「${expectedName}」`);
  }

  const actualStepNames = steps.map((step) => String(step.stepName || "").trim());
  if (actualStepNames.length !== expectedStages.length) {
    push(
      "fail",
      "阶段数量",
      `平台 ${actualStepNames.length} 个，配置 ${expectedStages.length} 个`,
    );
  } else {
    push("pass", "阶段数量", `${actualStepNames.length} 个`);
  }

  const missingStages = expectedStages
    .map((stage) => stage.cardName)
    .filter(
      (name) =>
        !actualStepNames.some((actual) => normalizeName(actual) === normalizeName(name)),
    );
  if (missingStages.length > 0) {
    push("fail", "阶段名称", `平台缺少: ${missingStages.join("、")}`);
  } else if (expectedStages.length > 0) {
    const ordered = expectedStages.every(
      (stage, index) =>
        actualStepNames[index] &&
        normalizeName(actualStepNames[index]) === normalizeName(stage.cardName),
    );
    push(
      ordered ? "pass" : "warn",
      "阶段顺序",
      ordered
        ? expectedStages.map((stage) => stage.cardName).join(" → ")
        : `平台顺序: ${actualStepNames.join(" → ")}`,
    );
  }

  const firstStepId = String(
    detail.firstStepId ||
      detail.firstStepNid ||
      detail.extConfig?.firstStepId ||
      "",
  );
  const firstActual = String(steps[0]?.nid || steps[0]?.stepId || "");
  if (!firstStepId) {
    push("warn", "初始阶段", "平台未返回 firstStepId");
  } else if (!firstActual || firstStepId === firstActual) {
    push("pass", "初始阶段", `firstStepId=${firstStepId}`);
  } else {
    push("warn", "初始阶段", `firstStepId=${firstStepId}，列表首个=${firstActual}`);
  }

  const realRoles = roles.filter((role) => !isSystemRole(role));
  const actualRoleNames = realRoles.map(roleName).filter(Boolean);
  const missingMembers = expectedMembers
    .map((member) => member.memberName)
    .filter(
      (name) =>
        !actualRoleNames.some((actual) => normalizeName(actual) === normalizeName(name)),
    );
  if (missingMembers.length > 0) {
    push("fail", "全局成员", `平台缺少: ${missingMembers.join("、")}`);
  } else {
    push("pass", "全局成员", actualRoleNames.join("、") || "无");
  }
  if (mode === "fresh") {
    const extras = actualRoleNames.filter(
      (name) =>
        !expectedMembers.some(
          (member) => normalizeName(member.memberName) === normalizeName(name),
        ),
    );
    if (extras.length > 0) {
      push("warn", "多余成员", `平台仍有: ${extras.join("、")}`);
    }
  }

  const emptyPrompts = realRoles.filter(
    (role) => !String(role.prompt || "").trim(),
  );
  if (emptyPrompts.length > 0) {
    push("warn", "成员描述", `角色 prompt 为空: ${emptyPrompts.map(roleName).join("、")}`);
  }

  const expectedSkills = expectedMembers.flatMap((member) =>
    (member.skills || []).map((skill) => ({
      name: skill.skillName,
      member: member.memberName,
    })),
  );
  const actualSkills = skills.map(skillName).filter(Boolean);
  const missingSkills = expectedSkills.filter(
    (skill) =>
      !actualSkills.some((actual) => normalizeName(actual) === normalizeName(skill.name)),
  );
  if (missingSkills.length > 0) {
    push(
      "fail",
      "技能",
      `平台缺少: ${missingSkills.map((skill) => skill.name).join("、")}`,
    );
  } else if (expectedSkills.length > 0) {
    push("pass", "技能", `${expectedSkills.length} 个`);
  }

  const unbound = expectedSkills.filter((skill) => {
    const item = skills.find(
      (candidate) => normalizeName(skillName(candidate)) === normalizeName(skill.name),
    );
    if (!item) return false;
    if (item.globalRoleNid) return false;
    const role = realRoles.find(
      (candidate) => normalizeName(roleName(candidate)) === normalizeName(skill.member),
    );
    return !item.nid || !boundSkillIds(role).has(String(item.nid));
  });
  if (unbound.length > 0) {
    push("warn", "技能绑定", `未确认绑定到成员: ${unbound.map((s) => s.name).join("、")}`);
  } else if (expectedSkills.length > 0) {
    push("pass", "技能绑定", "技能均已绑定");
  }

  const emptyStepPrompts = steps.filter(
    (step) => !String(step.llmPrompt || "").trim(),
  );
  if (emptyStepPrompts.length > 0) {
    push("fail", "阶段提示词", `${emptyStepPrompts.length} 个阶段 llmPrompt 为空`);
  } else if (steps.length > 0) {
    const withRoleTags = steps.filter((step) =>
      /<\s*role\s*>/i.test(String(step.llmPrompt || "")),
    ).length;
    if (expectedMembers.length > 0 && withRoleTags === 0) {
      push("warn", "成员标签", "阶段提示词中没有检测到 <role> 标签，成员引用可能未转换");
    } else {
      push("pass", "阶段提示词", `${steps.length} 个阶段已写入`);
    }
  }

  return {
    ok: !checks.some((check) => check.status === "fail"),
    checks,
    summary: {
      taskName: actualName,
      firstStepId,
      stages: actualStepNames,
      members: actualRoleNames,
      skills: actualSkills,
    },
  };
}
