import path from "node:path";
import crypto from "node:crypto";
import { CliError, normalizeName } from "./util.mjs";
import { request, uploadImage } from "./platform.mjs";

const ABILITY_TRAIN = "/teacher-course/abilityTrain";

export function isBasicType(type) {
  return type === "ability" || type === "oral";
}

function buildBasicExtConfig(type) {
  if (type === "oral") {
    return {
      dialogueLanguage: "en",
      dialogueDifficulty: "basic",
      translationAssistantEnabled: false,
      speechToTextEnabled: false,
      answerAssistantEnabled: false,
      keyVocabularyEnabled: false,
      trainScreen: false,
      trainScreenType: 1,
    };
  }
  return {
    trainScreen: false,
    trainScreenType: 1,
    speechTranscription: true,
    entranceVoiceLanguage: "zh",
    entranceVoiceSpeedMultiplier: 1,
  };
}

export function buildBasicTargetUrl(config, { courseId, trainTaskId, libraryId, type }) {
  const base = String(config.polymas.uiBaseUrl || "").replace(/\/+$/, "");
  const segment = type === "oral" ? "language-training" : "ability-training";
  const params = new URLSearchParams();
  if (libraryId) params.set("libraryId", libraryId);
  params.set("businessType", "course");
  params.set("businessId", courseId);
  if (trainTaskId) params.set("trainTaskId", trainTaskId);
  return `${base}/agent-course-full/${courseId}/${segment}/create?${params.toString()}`;
}

export async function createBasicTrainingTask(
  config,
  { name, description, type = "ability", coverPath },
) {
  if (!isBasicType(type)) throw new CliError(`不支持的基础训练类型: ${type}`);
  if (!String(name || "").trim()) throw new CliError("新建能力训练需要任务名称");
  const courseId = String(config.polymas.courseId || "").trim();
  if (!courseId) throw new CliError("新建基础版/口语训练需要 courseId");

  const cover = coverPath ? await uploadImage(config, coverPath) : { fileId: "", fileUrl: "" };
  const descriptionText = String(description || "").trim();
  const extConfig = buildBasicExtConfig(type);
  if (type === "ability") {
    extConfig.trainTaskName = name.trim();
    extConfig.description = descriptionText;
  }

  const payload = {
    trainTaskName: name.trim(),
    description: descriptionText,
    trainTaskCover: cover,
    trainSubType: type,
    courseId,
    ...(type === "ability" ? { trainType: "all", entranceVoiceNid: "", entranceVoiceSpeed: 0, entranceVoiceType: "" } : {}),
    extConfig,
  };
  const created = await request(config, "POST", `${ABILITY_TRAIN}/createConfiguration`, payload, { authStyle: "raw" });
  const trainTaskId = String(created?.trainTaskId || "").trim();
  if (!trainTaskId) {
    throw new CliError(
      `新建训练未返回 trainTaskId: ${JSON.stringify(created).slice(0, 200)}`,
    );
  }
  return {
    trainTaskId,
    courseId,
    type,
    targetUrl: buildBasicTargetUrl(config, {
      courseId,
      trainTaskId,
      libraryId: config.polymas.libraryId,
      type,
    }),
  };
}

/**
 * 等价于平台训练编辑页右上角“保存”：editConfiguration + publishAbilityTrain。
 * 只调 publishAbilityTrain 而不走这一步时，教师端课程资源库列表可能看不到该训练。
 * courseId / libraryFolderId 必须取自目标训练链接，不能用 config.polymas.courseId。
 */
export async function saveAndPublishBasicTrainingTask(
  config,
  { trainTaskId, type = "ability", courseId, libraryFolderId },
) {
  const resolvedCourseId = String(courseId ?? config.polymas.courseId ?? "").trim();
  if (!resolvedCourseId) throw new CliError("保存基础配置需要 courseId");
  const resolvedLibraryId = String(libraryFolderId ?? config.polymas.libraryId ?? "").trim();
  const query = () =>
    request(
      config,
      "POST",
      `${ABILITY_TRAIN}/queryConfiguration`,
      { trainTaskId, trainSubType: type, courseId: resolvedCourseId },
      { authStyle: "raw" },
    );
  const current = (await query()) || {};
  if (!current.trainTaskId) throw new CliError(`未读到训练配置: ${trainTaskId}`);
  const extConfig =
    current.extConfig && typeof current.extConfig === "object" ? current.extConfig : {};
  await request(
    config,
    "POST",
    `${ABILITY_TRAIN}/editConfiguration`,
    {
      ...current,
      trainTaskId,
      courseId: resolvedCourseId,
      trainSubType: type,
      trainType: current.trainType || "all",
      extConfig: {
        ...extConfig,
        trainSubType: type,
        trainTaskName: current.trainTaskName,
        description: current.description,
      },
    },
    { authStyle: "raw" },
  );
  await request(
    config,
    "POST",
    `${ABILITY_TRAIN}/publishAbilityTrain`,
    {
      trainTaskId,
      courseId: resolvedCourseId,
      trainSubType: type,
      ...(resolvedLibraryId ? { libraryFolderId: resolvedLibraryId } : {}),
    },
    { authStyle: "raw" },
  );
  const after = (await query()) || {};
  if (Number(after.unpublishedChanges ?? 0) !== 0) {
    throw new CliError(
      `保存后仍有未发布改动（unpublishedChanges=${after.unpublishedChanges}），教师端可能看不到最新版本`,
    );
  }
  return {
    trainTaskId,
    courseId: resolvedCourseId,
    libraryFolderId: resolvedLibraryId,
    type,
    unpublishedChanges: after.unpublishedChanges ?? 0,
  };
}

function boundaryNodeType(step) {
  const detail = step?.stepDetailDTO || {};
  return String(detail.nodeType || "").toUpperCase();
}

function generateNodeId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  return Array.from(crypto.randomBytes(21), (byte) => chars[byte % chars.length]).join("");
}

async function queryBasicSteps(config, trainTaskId, type) {
  const steps = await request(
    config,
    "POST",
    `${ABILITY_TRAIN}/queryScriptStepList`,
    { trainTaskId, trainSubType: type },
    { authStyle: "raw" },
  );
  return Array.isArray(steps) ? steps : [];
}

function boundaryNodePayload(nodeType, type) {
  return {
    stepName: "defaultStepName",
    prologue: "",
    interactiveRounds: null,
    description: "",
    modelId: "",
    historyRecordNum: 0,
    llmPrompt: "",
    trainerName: "",
    agentId: null,
    avatarNid: "",
    digitalHumanType: null,
    projectId: "",
    agentVoiceId: null,
    customDigitalHumanSpeechRate: 1.0,
    scriptStepCover: {
      learnResourceId: null,
      fileId: null,
      contentType: null,
      fileUrl: null,
      coverUrl: null,
      fileName: null,
      originFileName: null,
      suffix: null,
      createTime: null,
    },
    nodeType,
    scriptStepResourceList: [],
    knowledgeBaseSwitch: 1,
    knowledgeBaseId: "",
    searchEngineSwitch: 1,
    whiteBoardSwitch: 0,
    videoSwitch: 0,
    stepExtProperty: {
      trainSubType: type,
      backgroundTheme: "white",
      backgroundMusic: { fileId: null, fileName: null, fileUrl: null },
      transitionDescription: "",
      useTransitionDescriptionAsAudio: false,
      transitionVideo: { fileId: null, fileName: null, fileUrl: null },
      useVideoOriginalSoundAsAudio: false,
      ...(type === "oral" ? { keyVocabularies: [] } : {}),
    },
    trainTime: -1,
    backgroundTheme: null,
    trainSubType: null,
    transitionDescriptionUrl: null,
    prologueUrl: null,
    customDigitalHuman: "",
    isSkipStep: "1",
    endStrategy: 2,
    refResourceDesc: 0,
    isTransition: 0,
    knowledgeResourceList: [],
  };
}

/**
 * 新任务的工作流只有在编辑页首次打开时才由前端初始化 START/END。
 * 直接调用同一 createScriptStep 接口补齐，避免注入前必须打开浏览器。
 */
export async function ensureBasicBoundaryNodes(config, trainTaskId, type = "ability") {
  const existing = await queryBasicSteps(config, trainTaskId, type);
  const hasStart = existing.some((step) => boundaryNodeType(step) === "SCRIPT_START");
  const hasEnd = existing.some((step) => boundaryNodeType(step) === "SCRIPT_END");
  if (hasStart && hasEnd) return { created: [], steps: existing };

  const created = [];
  const nodes = [
    { nodeType: "SCRIPT_START", position: { x: "132", y: "462" }, missing: !hasStart },
    { nodeType: "SCRIPT_END", position: { x: "132", y: "462" }, missing: !hasEnd },
  ];
  for (const node of nodes) {
    if (!node.missing) continue;
    await request(
      config,
      "POST",
      `${ABILITY_TRAIN}/createScriptStep`,
      {
        trainTaskId,
        stepId: generateNodeId(),
        positionDTO: node.position,
        stepDetailDTO: boundaryNodePayload(node.nodeType, type),
        courseId: String(config.polymas.courseId || ""),
        libraryFolderId: String(config.polymas.libraryId || ""),
      },
      { authStyle: "raw" },
    );
    created.push(node.nodeType);
  }
  return { created, steps: created.length ? await queryBasicSteps(config, trainTaskId, type) : existing };
}

function stepDetail(step) {
  return step?.stepDetailDTO || step || {};
}

function stepName(step) {
  return String(stepDetail(step)?.stepName || step?.stepName || "").trim();
}

function isBoundaryStep(step) {
  const detail = stepDetail(step);
  const nodeType = String(detail?.nodeType || "").toLowerCase();
  if (["start", "end", "script_start", "script_end"].includes(nodeType)) return true;
  return /^(开始|结束|start|end)$/i.test(stepName(step));
}

export async function collectBasicSnapshot(config, trainTaskId, type = "ability") {
  const [configuration, steps, scoreItems] = await Promise.all([
    request(config, "POST", `${ABILITY_TRAIN}/queryConfiguration`, {
      trainTaskId,
      trainSubType: type,
    }, { authStyle: "raw" }).catch(() => null),
    request(config, "POST", `${ABILITY_TRAIN}/queryScriptStepList`, {
      trainTaskId,
      trainSubType: type,
    }, { authStyle: "raw" }).catch(() => []),
    request(config, "POST", `${ABILITY_TRAIN}/queryScoreItemList`, {
      trainTaskId,
      trainSubType: type,
    }, { authStyle: "raw" }).catch(() => []),
  ]);
  const stepList = (Array.isArray(steps) ? steps : []).filter(
    (step) => !isBoundaryStep(step),
  );
  return {
    configuration: configuration || {},
    steps: stepList,
    scoreItems: Array.isArray(scoreItems) ? scoreItems : [],
    trainSubType: configuration?.trainSubType || type,
  };
}

export function compareBasicSnapshot(parsed, snapshot, { type = "ability", mode = "fresh", rubric = [], rubricComparison = null } = {}) {
  const checks = [];
  const push = (status, name, detail) => checks.push({ status, name, detail });
  const expected = parsed || {};
  const expectedName = String(expected.taskConfig?.trainTaskName || "").trim();
  const expectedStages = expected.steps || [];
  const actualName = String(snapshot.configuration?.trainTaskName || "").trim();
  const actualSteps = snapshot.steps || [];
  const actualNames = actualSteps.map(stepName);

  if (!expectedName) {
    push("warn", "任务名称", "配置中没有任务名称，跳过比对");
  } else if (normalizeName(actualName) === normalizeName(expectedName)) {
    push("pass", "任务名称", actualName);
  } else {
    push("fail", "任务名称", `平台为「${actualName || "空"}」，期望「${expectedName}」`);
  }

  if (actualNames.length !== expectedStages.length) {
    push("fail", "阶段数量", `平台 ${actualNames.length} 个，配置 ${expectedStages.length} 个`);
  } else {
    push("pass", "阶段数量", `${actualNames.length} 个`);
  }

  const missing = expectedStages
    .map((step) => step.stepName)
    .filter(
      (name) =>
        !actualNames.some((actual) => normalizeName(actual) === normalizeName(name)),
    );
  if (missing.length > 0) {
    push("fail", "阶段名称", `平台缺少: ${missing.join("、")}`);
  } else if (expectedStages.length > 0) {
    const ordered = expectedStages.every(
      (step, index) =>
        actualNames[index] && normalizeName(actualNames[index]) === normalizeName(step.stepName),
    );
    push(
      ordered ? "pass" : "warn",
      "阶段顺序",
      ordered
        ? expectedStages.map((step) => step.stepName).join(" → ")
        : `平台顺序: ${actualNames.join(" → ")}`,
    );
  }

  const emptyPrompts = actualSteps.filter(
    (step) => !String(stepDetail(step)?.llmPrompt || "").trim(),
  );
  if (emptyPrompts.length > 0) {
    push("fail", "阶段提示词", `${emptyPrompts.length} 个阶段 llmPrompt 为空`);
  } else if (actualSteps.length > 0) {
    push("pass", "阶段提示词", `${actualSteps.length} 个阶段已写入`);
  }

  if (type === "oral") {
    const expectedVocab = expectedStages.reduce(
      (sum, step) => sum + (step.keyVocabularies?.length || 0),
      0,
    );
    const actualVocab = actualSteps.reduce(
      (sum, step) =>
        sum + (Array.isArray(stepDetail(step)?.stepExtProperty?.keyVocabularies)
          ? stepDetail(step).stepExtProperty.keyVocabularies.length
          : 0),
      0,
    );
    if (expectedVocab > 0 && actualVocab === 0) {
      push("fail", "重点词汇", `配置 ${expectedVocab} 条，平台 0 条`);
    } else if (expectedVocab > 0) {
      push("pass", "重点词汇", `平台 ${actualVocab} 条`);
    } else {
      push("warn", "重点词汇", "配置未包含重点词汇");
    }
    if (snapshot.configuration?.trainSubType !== "oral") {
      push("fail", "训练类型", `平台返回 ${snapshot.configuration?.trainSubType || "空"}，期望 oral`);
    } else {
      push("pass", "训练类型", "oral");
    }
  } else if (mode === "fresh") {
    const expectedRubric = Array.isArray(rubric) ? rubric : [];
    const actualRubric = snapshot.scoreItems || [];
    if (rubricComparison) {
      push(rubricComparison.ok ? "pass" : "fail", "评价标准精确比对",
        rubricComparison.ok ? "名称、分值、描述、详细要求逐字段一致" :
          (rubricComparison.reason || rubricComparison.differences.map(item => `${item.itemName}:${item.field}:${item.kind}`).join("；")));
    } else if (expectedRubric.length > 0 && actualRubric.length === 0) {
      push("fail", "评价标准", `配置 ${expectedRubric.length} 项，平台 0 项`);
    } else if (expectedRubric.length > 0) {
      push("warn", "评价标准", `平台 ${actualRubric.length} 项；无确定性结构化依据，未核实名称/分值/描述/详细要求一致性，不以数量判通过`);
    } else {
      push("warn", "评价标准", "配置未包含评价标准");
    }
  }

  return {
    ok: !checks.some((check) => check.status === "fail"),
    checks,
    summary: {
      taskName: actualName,
      stages: actualNames,
      styles: snapshot.configuration?.trainSubType || type,
    },
  };
}
