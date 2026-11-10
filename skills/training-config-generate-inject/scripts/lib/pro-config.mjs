import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CliError, normalizeName } from "./util.mjs";

const DIMENSIONS = [
  { label: "阶段触发条件", pattern: /(【\s*阶段触发条件\s*】|阶段触发条件\s*[:：])/ },
  { label: "背景设定", pattern: /(【\s*背景设定\s*】|背景设定\s*[:：])/ },
  { label: "完整执行流程", pattern: /(【\s*完整执行流程\s*】|完整执行流程\s*[:：])/ },
  { label: "阶段结束判定", pattern: /(【\s*阶段结束判定\s*】|阶段结束判定\s*[:：])/ },
  { label: "行为边界规范", pattern: /(【\s*行为边界规范\s*】|行为边界规范\s*[:：])/ },
];

const PLACEHOLDER_PATTERNS = [
  /\[(?:阶段名称|具体内容|具体描述|成员名|技能名称|能力名称|描述)[^\]]*\]/,
  /待补充|待完善|TODO|TBD/,
  /\[\.{3}\]|……\s*$/m,
];

let cachedParser = null;

/** Load the app's own Pro markdown parser so validation matches injection exactly. */
export function loadProParser(appRoot) {
  if (cachedParser && cachedParser.appRoot === appRoot) return cachedParser.fn;

  const requireFromApp = createRequire(path.join(appRoot, "package.json"));
  let ts;
  try {
    ts = requireFromApp("typescript");
  } catch {
    throw new CliError(
      `无法加载 ${appRoot}/node_modules/typescript，请先在应用目录执行 npm install`,
    );
  }

  const parserPath = path.join(appRoot, "lib/training-injector-pro/parser.ts");
  if (!fs.existsSync(parserPath)) {
    throw new CliError(`未找到 Pro 解析器: ${parserPath}`);
  }

  const output = ts.transpileModule(fs.readFileSync(parserPath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const module_ = { exports: {} };
  new Function("require", "module", "exports", output)(
    () => ({}),
    module_,
    module_.exports,
  );
  const fn = module_.exports.parseProMarkdown;
  if (typeof fn !== "function") {
    throw new CliError("Pro 解析器加载失败：未导出 parseProMarkdown");
  }

  cachedParser = { appRoot, fn };
  return fn;
}

export function parseProConfig(appRoot, markdown) {
  const parse = loadProParser(appRoot);
  return parse(markdown);
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

function collectMemberRefs(prompt) {
  const matches = prompt.matchAll(
    /@([^\s，。、；：,;:!?！？@<>【】\[\]()（）「」"'“”]+)/g,
  );
  return Array.from(matches, (match) => match[1]);
}

export function validateProConfig(appRoot, markdown) {
  const errors = [];
  const warnings = [];
  const pushError = (message) => errors.push(message);
  const pushWarning = (message) => warnings.push(message);

  let parsed;
  try {
    parsed = parseProConfig(appRoot, markdown);
  } catch (error) {
    return {
      ok: false,
      errors: [`解析失败: ${error.message}`],
      warnings,
      stats: { stages: 0, members: 0, skills: 0, characters: markdown.length },
      config: null,
    };
  }

  const { globalConfig = {}, members = [], stages = [] } = parsed || {};

  if (!String(globalConfig.abilityName || "").trim()) {
    pushError("全局配置缺少「能力名称」");
  } else if (globalConfig.abilityName === "未命名") {
    pushWarning("能力名称解析为「未命名」，请检查全局配置格式");
  }
  if (!String(globalConfig.description || "").trim()) {
    pushWarning("全局配置缺少「描述」");
  }
  if (!String(globalConfig.coverImageDescription || "").trim()) {
    pushWarning("全局配置缺少「封面图描述」，注入时封面图会使用默认文案");
  }
  if (members.length === 0 && stages.length === 0) {
    pushError("未解析到任何全局成员和训练阶段，配置格式与 Pro 模板不匹配");
  }
  if (stages.length === 0) {
    pushError("未解析到训练阶段（需使用 ### 阶段N: 名称）");
  }
  if (members.length === 0 && stages.length > 0) {
    pushWarning(
      "未解析到全局成员；若文档包含 AI 角色，请检查「## 全局成员配置」与「### 成员N: 名称」格式",
    );
  }

  const duplicateStages = uniqueDuplicates(stages.map((item) => item.cardName));
  if (duplicateStages.length > 0) {
    pushError(`阶段名称重复: ${duplicateStages.join("、")}`);
  }
  const duplicateMembers = uniqueDuplicates(
    members.map((item) => item.memberName),
  );
  if (duplicateMembers.length > 0) {
    pushError(`全局成员名称重复: ${duplicateMembers.join("、")}`);
  }

  members.forEach((member, index) => {
    const label = member.memberName || `成员${index + 1}`;
    if (!String(member.memberName || "").trim()) pushError(`成员${index + 1} 缺少名称`);
    if (!String(member.roleDescription || "").trim()) {
      pushError(`成员「${label}」缺少角色描述（平台 prompt 必填）`);
    }
    if (!["男性", "女性"].includes(String(member.avatarGender || "").trim())) {
      pushWarning(`成员「${label}」数字人性别不是「男性/女性」，将使用默认形象`);
    }
    if (!["儿童", "成年", "老年"].includes(String(member.avatarAgeGroup || "").trim())) {
      pushWarning(`成员「${label}」数字人年龄层不是「儿童/成年/老年」，可能匹配到不合适音色`);
    }
    if (!String(member.modelId || "").trim()) {
      pushWarning(`成员「${label}」缺少模型，将使用默认模型`);
    }
    if (!String(member.avatarDescription || "").trim()) {
      pushWarning(`成员「${label}」缺少形象描述`);
    }
    const skills = Array.isArray(member.skills) ? member.skills : [];
    skills.forEach((skill) => {
      if (!String(skill.skillInstruction || "").trim()) {
        pushWarning(`成员「${label}」的技能「${skill.skillName}」缺少 <skill_instruction>`);
      } else if (skill.skillInstruction.trim().length < 60) {
        pushWarning(`成员「${label}」的技能「${skill.skillName}」指令过短`);
      }
      if (!String(skill.skillDescription || "").trim()) {
        pushWarning(`成员「${label}」的技能「${skill.skillName}」缺少描述`);
      }
    });
  });

  const memberNames = members.map((member) => member.memberName).filter(Boolean);

  stages.forEach((stage, index) => {
    const label = stage.cardName || `阶段${index + 1}`;
    const prompt = String(stage.scriptPrompt || "");
    if (!String(stage.cardName || "").trim()) pushError(`阶段${index + 1} 缺少卡片名称`);
    if (!String(stage.cardDescription || "").trim()) {
      pushWarning(`阶段「${label}」缺少卡片描述`);
    }
    if (!String(stage.userRoleName || "").trim()) {
      pushError(`阶段「${label}」缺少「用户扮演角色名称」`);
    }
    if (!String(stage.userRoleDescription || "").trim()) {
      pushWarning(`阶段「${label}」缺少「用户扮演角色描述」`);
    }
    if (!String(stage.userAssignName || "").trim()) {
      pushWarning(`阶段「${label}」缺少「AI 对用户称呼」，平台会从角色名推导`);
    }
    if (!String(stage.scriptModel || "").trim()) {
      pushWarning(`阶段「${label}」缺少剧本模型`);
    }
    if (!String(stage.backgroundImageDescription || "").trim()) {
      pushWarning(`阶段「${label}」缺少背景图描述`);
    }
    if (!prompt.trim()) {
      pushError(`阶段「${label}」缺少阶段剧本提示词`);
      return;
    }

    const missing = DIMENSIONS.filter(
      (dimension) => !dimension.pattern.test(prompt),
    ).map((dimension) => dimension.label);
    if (missing.length > 0) {
      pushError(`阶段「${label}」提示词缺少五维结构: ${missing.join("、")}`);
    }

    if (/<\s*role\s*>/i.test(prompt)) {
      pushError(`阶段「${label}」提示词包含 <role> 标签，生成阶段不允许输出，注入时会重复编码`);
    }

    const nextStage = stages[index + 1];
    if (nextStage) {
      const hasJumpWord = /跳转到|进入下一|转入|切换到/.test(prompt);
      const namesNext = nextStage.cardName
        ? prompt.includes(nextStage.cardName)
        : false;
      if (!hasJumpWord || !namesNext) {
        pushError(
          `阶段「${label}」未写明跳转到下一阶段「${nextStage.cardName}」`,
        );
      }
    } else if (!/结束本次实训|结束本次训练|完成本次实训/.test(prompt)) {
      pushWarning(`最后阶段「${label}」未明确写「结束本次实训」`);
    }

    if (/学生|学员/.test(prompt)) {
      pushWarning(`阶段「${label}」提示词出现「学生/学员」，Pro 模板要求统一写「用户」`);
    }

    const refs = collectMemberRefs(prompt);
    const unknownRefs = refs.filter(
      (ref) =>
        !memberNames.some((name) => ref.startsWith(name)) &&
        !["用户", "学生", "学员"].includes(ref),
    );
    if (unknownRefs.length > 0) {
      pushWarning(
        `阶段「${label}」引用了未定义的成员: @${Array.from(new Set(unknownRefs)).join("、@")}`,
      );
    }
    if (memberNames.length > 0 && refs.length === 0) {
      pushWarning(`阶段「${label}」没有使用 @成员名 引用任何全局成员`);
    }

    if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(prompt))) {
      pushWarning(`阶段「${label}」提示词疑似包含占位符或省略内容`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      stages: stages.length,
      members: members.length,
      skills: members.reduce(
        (sum, member) => sum + (member.skills?.length || 0),
        0,
      ),
      characters: markdown.length,
    },
    config: parsed,
  };
}

export function summarizeConfig(parsed) {
  const { globalConfig = {}, members = [], stages = [] } = parsed || {};
  return {
    abilityName: globalConfig.abilityName || "",
    description: globalConfig.description || "",
    stages: stages.map((stage, index) => ({
      index: index + 1,
      name: stage.cardName,
      userRoleName: stage.userRoleName,
    })),
    members: members.map((member) => ({
      name: member.memberName,
      gender: member.avatarGender,
      ageGroup: member.avatarAgeGroup,
      skills: (member.skills || []).map((skill) => skill.skillName),
    })),
  };
}
