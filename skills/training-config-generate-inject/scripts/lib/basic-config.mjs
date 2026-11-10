import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CliError, normalizeName } from "./util.mjs";

const parserCache = new Map();

function loadTsModule(appRoot, filePath, requireFromApp, seen = new Set()) {
  if (seen.has(filePath)) return {};
  seen.add(filePath);
  const ts = requireFromApp("typescript");
  const output = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module_ = { exports: {} };
  const customRequire = (spec) => {
    if (spec.startsWith(".")) {
      let resolved = path.resolve(path.dirname(filePath), spec);
      if (!fs.existsSync(resolved) && fs.existsSync(`${resolved}.ts`)) {
        resolved = `${resolved}.ts`;
      }
      if (!fs.existsSync(resolved)) return {};
      return loadTsModule(appRoot, resolved, requireFromApp, seen);
    }
    return requireFromApp(spec);
  };
  new Function("require", "module", "exports", output)(
    customRequire,
    module_,
    module_.exports,
  );
  return module_.exports;
}

/** Load the app's own basic parser so validation matches injection exactly. */
export function loadBasicParser(appRoot) {
  const cached = parserCache.get(appRoot);
  if (cached) return cached;
  if (!appRoot) throw new CliError("未配置应用目录 appRoot，无法加载基础版解析器");
  const requireFromApp = createRequire(path.join(appRoot, "package.json"));
  const parserPath = path.join(appRoot, "lib/training-injector/parser.ts");
  if (!fs.existsSync(parserPath)) {
    throw new CliError(`未找到基础版解析器: ${parserPath}`);
  }
  const module_ = loadTsModule(appRoot, parserPath, requireFromApp);
  for (const name of [
    "parseTaskConfig",
    "parseTrainingScript",
    "parseTrainingScriptFlowConfig",
    "parseRubricMarkdown",
    "serializeTrainingScriptMarkdown",
  ]) {
    if (typeof module_[name] !== "function") {
      throw new CliError(`基础版解析器未导出 ${name}`);
    }
  }
  parserCache.set(appRoot, module_);
  return module_;
}

export function parseBasicScript(appRoot, markdown) {
  const parser = loadBasicParser(appRoot);
  return {
    taskConfig: parser.parseTaskConfig(markdown),
    steps: parser.parseTrainingScript(markdown) || [],
    flow: parser.parseTrainingScriptFlowConfig(markdown),
  };
}

export function parseBasicRubric(appRoot, markdown) {
  if (!String(markdown || "").trim()) return [];
  const parser = loadBasicParser(appRoot);
  return parser.parseRubricMarkdown(markdown) || [];
}

/** Serialize platform steps back into the app's Markdown script format. */
export function serializeBasicScript(appRoot, { steps, taskConfig, sourceMarkdown }) {
  const parser = loadBasicParser(appRoot);
  return parser.serializeTrainingScriptMarkdown({
    steps: Array.isArray(steps) ? steps : [],
    taskConfig: taskConfig || {},
    sourceMarkdown,
  });
}

export function serializeBasicRubric(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return "";
  const total = list.reduce(
    (sum, item) => sum + (Number(item.score ?? item.itemScore) || 0),
    0,
  );
  const sections = list.map((item, index) => {
    const name = String(item.itemName || item.name || `评分项${index + 1}`).trim();
    const score = Number(item.score ?? item.itemScore ?? 0) || 0;
    const description = String(item.description || "").trim() || "见评分区间说明。";
    const requireDetail = String(item.requireDetail || item.requirement || "").trim() ||
      `- 满分 ${score} 分。`;
    return [
      `## ${name}（${score} 分）`,
      `**评价描述：** ${description}`,
      "",
      "**评分区间：**",
      requireDetail,
    ].join("\n");
  });
  return ["# 评价标准", `## 总分：${total} 分`, ...sections]
    .map((part) => part.trim())
    .join("\n\n")
    .concat("\n");
}

function uniqueDuplicates(names) {
  const seen = new Map();
  const duplicates = [];
  for (const name of names) {
    const key = normalizeName(name);
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count === 2) duplicates.push(name);
  }
  return duplicates;
}

function totalScore(items) {
  return items.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
}

export function validateBasicConfig(appRoot, { script, rubric = "", type = "ability" }) {
  const errors = [];
  const warnings = [];
  const pushError = (message) => errors.push(message);
  const pushWarning = (message) => warnings.push(message);

  let parsed;
  try {
    parsed = parseBasicScript(appRoot, script);
  } catch (error) {
    return {
      ok: false,
      errors: [`解析失败: ${error.message}`],
      warnings,
      stats: { stages: 0, rubricItems: 0, characters: String(script || "").length },
      config: null,
    };
  }

  const { taskConfig, steps, flow } = parsed;
  if (!String(taskConfig?.trainTaskName || "").trim()) {
    pushError("未解析到任务名称（需包含「任务名称」或「能力训练名称」）");
  }
  if (!String(taskConfig?.description || "").trim()) {
    pushWarning("未解析到任务描述");
  }
  if (steps.length === 0) {
    pushError("未解析到任何训练阶段（需使用 ### 阶段N: 名称）");
  }

  const names = steps.map((step) => step.stepName);
  const duplicates = uniqueDuplicates(names);
  if (duplicates.length > 0) pushError(`阶段名称重复: ${duplicates.join("、")}`);

  steps.forEach((step, index) => {
    const label = step.stepName || `阶段${index + 1}`;
    if (!String(step.stepName || "").trim()) pushError(`阶段${index + 1} 缺少名称`);
    if (!String(step.llmPrompt || "").trim()) {
      pushError(`阶段「${label}」缺少提示词 llmPrompt`);
    }
    if (!String(step.prologue || "").trim()) {
      pushWarning(`阶段「${label}」缺少开场白`);
    }
    if (!String(step.trainerName || "").trim()) {
      pushWarning(`阶段「${label}」缺少智能体名称`);
    }
    if (type === "oral") {
      if (step.keyVocabularyError) {
        pushError(`阶段「${label}」重点词汇格式错误: ${step.keyVocabularyError}`);
      } else if (!Array.isArray(step.keyVocabularies)) {
        pushWarning(`阶段「${label}」缺少「**重点词汇**」字段（无依据也应输出 []）`);
      }
    }
  });

  const vocabularyCount = steps.reduce(
    (sum, step) => sum + (Array.isArray(step.keyVocabularies) ? step.keyVocabularies.length : 0),
    0,
  );
  if (type === "oral" && steps.length > 0 && vocabularyCount === 0) {
    pushWarning("所有阶段重点词汇为空；若文档确无词汇依据可忽略，否则请补充或重新生成");
  }
  if (type === "oral" && vocabularyCount > 0) {
    const missingExample = steps.reduce(
      (sum, step) =>
        sum +
        (Array.isArray(step.keyVocabularies)
          ? step.keyVocabularies.filter(
              (item) => !String(item?.exampleSentence || "").trim(),
            ).length
          : 0),
      0,
    );
    if (missingExample > 0) {
      pushWarning(
        `有 ${missingExample} 条重点词汇缺少例句（键名需为 exampleSentence，example 会被忽略）`,
      );
    }
  }

  if (flow?.flowType === "graph") {
    const edges = Array.isArray(flow.edges) ? flow.edges.length : 0;
    if (edges === 0) pushWarning("检测到非线性剧本，但没有解析到连线");
  }

  let rubricItems = [];
  if (type === "ability") {
    try {
      rubricItems = parseBasicRubric(appRoot, rubric);
    } catch (error) {
      pushError(`评价标准解析失败: ${error.message}`);
    }
    if (rubricItems.length === 0) {
      pushWarning("未生成评价标准；平台将沿用默认评分项");
    } else {
      const zeroItems = rubricItems.filter((item) => !(Number(item.score) > 0));
      if (zeroItems.length > 0) {
        pushWarning(`有 ${zeroItems.length} 个评分项缺少分值`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      stages: steps.length,
      rubricItems: rubricItems.length,
      vocabulary: vocabularyCount,
      characters: String(script || "").length + String(rubric || "").length,
    },
    config: parsed,
  };
}

export function summarizeBasicConfig(parsed, rubricItems = []) {
  const { taskConfig, steps } = parsed || {};
  return {
    abilityName: taskConfig?.trainTaskName || "",
    description: taskConfig?.description || "",
    stages: (steps || []).map((step, index) => ({
      index: index + 1,
      name: step.stepName,
      trainer: step.trainerName,
      vocabulary: (step.keyVocabularies || []).length,
    })),
    rubric: {
      items: rubricItems.length,
      total: totalScore(rubricItems),
    },
  };
}
