import { normalizeName } from "./util.mjs";

const VOCAB_KEYS = {
  term: ["term", "vocabulary", "word", "phrase", "english", "单词", "词汇"],
  meaning: ["meaning", "explanation", "translation", "chinese", "definition", "释义", "中文"],
  source: ["source", "basis", "origin", "context", "来源", "依据"],
  exampleSentence: ["exampleSentence", "example", "sentence", "例句"],
};

function pick(item, names) {
  for (const name of names) {
    const value = item?.[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

export function normalizeVocabularyItems(value) {
  if (!Array.isArray(value)) throw new Error("重点词汇必须是 JSON 数组");
  const pending = [];
  const items = value.map((item, index) => {
    if (typeof item === "string") {
      if (!item.trim()) throw new Error(`第 ${index + 1} 条重点词汇为空`);
      pending.push(`第 ${index + 1} 条重点词汇只有词条，缺释义/来源/例句`);
      return { term: item.trim(), meaning: "", source: "", exampleSentence: "" };
    }
    if (!item || typeof item !== "object") {
      throw new Error(`第 ${index + 1} 条重点词汇不是对象`);
    }
    const term = pick(item, VOCAB_KEYS.term);
    if (!term) throw new Error(`第 ${index + 1} 条重点词汇缺少 term/vocabulary`);
    const normalized = {
      term,
      meaning: pick(item, VOCAB_KEYS.meaning),
      source: pick(item, VOCAB_KEYS.source),
      exampleSentence: pick(item, VOCAB_KEYS.exampleSentence),
    };
    const missing = [];
    if (!normalized.meaning) missing.push("meaning");
    if (!normalized.source) missing.push("source");
    if (!normalized.exampleSentence) missing.push("exampleSentence");
    if (missing.length > 0) {
      pending.push(`词汇「${term}」缺 ${missing.join("/")}`);
    }
    return normalized;
  });
  return { items, pending };
}

function parseJsonArray(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("重点词汇为空");
  const attempts = [text];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) attempts.push(text.slice(start, end + 1));
  for (const candidate of attempts) {
    for (const variant of [candidate, candidate.replace(/,\s*([\]}])/g, "$1")]) {
      try {
        return JSON.parse(variant);
      } catch {
        // try next variant
      }
    }
  }
  throw new Error("重点词汇不是合法 JSON 数组");
}

function fenceStart(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("~~~")) return { marker: trimmed.slice(0, 3), lang: trimmed.slice(3).trim() };
  if (trimmed.startsWith("```")) return { marker: "```", lang: trimmed.slice(3).trim() };
  return null;
}

function isFenceClose(line, marker) {
  return line.trim().startsWith(marker);
}

const VOCAB_FIELD = /^\s*(?:[-*+]\s*)?\*\*?重点词汇\*\*?\s*[:：]?\s*(.*)$/;

function isVocabFieldLine(line) {
  const trimmed = String(line || "").trim();
  if (!VOCAB_FIELD.test(trimmed)) return false;
  return /[:：]/.test(trimmed) || /^\s*(?:[-*+]\s*)?\*\*?重点词汇\*\*?\s*$/.test(trimmed);
}

const NON_PARSER_KEYS = new Set([
  "word",
  "phrase",
  "english",
  "translation",
  "chinese",
  "definition",
  "example",
  "sentence",
  "basis",
  "origin",
  "context",
  "单词",
  "词汇",
  "释义",
  "中文",
  "例句",
  "来源",
  "依据",
]);

function sameVocabulary(parsed, items) {
  if (!Array.isArray(parsed) || parsed.length !== items.length) return false;
  return parsed.every((item, index) => {
    if (typeof item === "string") return false;
    const source = item || {};
    if (Object.keys(source).some((key) => NON_PARSER_KEYS.has(key))) return false;
    if (!("term" in source || "vocabulary" in source)) return false;
    if (!("meaning" in source || "explanation" in source)) return false;
    const target = items[index];
    return (
      pick(source, VOCAB_KEYS.term) === target.term &&
      pick(source, VOCAB_KEYS.meaning) === target.meaning &&
      pick(source, VOCAB_KEYS.source) === target.source &&
      pick(source, VOCAB_KEYS.exampleSentence) === target.exampleSentence
    );
  });
}

const JUMP_DEFAULT = "接下来我们将进入下一阶段";
const END_DEFAULT = "本次实训到此结束";

function charCount(text) {
  return Array.from(String(text)).length;
}

function stageLabel(title) {
  return String(title || "")
    .replace(/^###\s*/, "")
    .replace(/^阶段[0-9一二三四五六七八九十]+[:：]\s*/, "")
    .trim();
}

function stageBlocks(markdown) {
  const text = String(markdown || "");
  const marks = Array.from(text.matchAll(/^### 阶段[0-9一二三四五六七八九十]+[:：][^\n]*$/gm));
  return marks.map((mark, index) => ({
    start: mark.index,
    end: index + 1 < marks.length ? marks[index + 1].index : text.length,
    title: mark[0].trim(),
  }));
}

function promptFenceRange(block) {
  const promptIdx = block.indexOf("**提示词**");
  if (promptIdx < 0) return null;
  const open = block.indexOf("```", promptIdx);
  if (open < 0) return null;
  const contentStart = block.indexOf("\n", open);
  if (contentStart < 0) return null;
  const close = block.indexOf("\n```", contentStart);
  if (close < 0) return null;
  return { contentStart: contentStart + 1, contentEnd: close };
}

function jumpOutputBlock(phrase) {
  const n = charCount(phrase);
  const unit = /^[\u4e00-\u9fff]+$/.test(phrase) ? "汉字" : "字符";
  return [
    "# 跳转输出（最高优先级，覆盖以上所有要求）",
    "",
    "- 跳转词是平台识别的控制信号：平台按整条消息精确匹配，多一个字、一个标点、一个换行都不会跳转。",
    "",
    "- 未满足全部过关条件时，严禁输出跳转词。",
    "",
    `- 一旦判定过关，不要再说“这一项已经说清”之类的确认语，不要补充说明，也不要再提新问题，本条消息只能是“${phrase}”这 ${n} 个${unit}，前后不得有空格、标点、换行或其他任何字符。`,
    "",
    "- 学生刚回答完最后一处待核事项时，立即判断是否过关；过关就直接只发跳转词，不要再追加确认问题。",
    "",
    "- 严禁把确认语、过渡语与跳转词放在同一条消息里。以下写法平台都识别不到，全部禁止：",
    "",
    `  - 这一项已经说清。${phrase}`,
    "",
    `  - 好的，${phrase}。`,
    "",
    `- 发送前自检：本条消息去掉首尾空白后必须恰好 ${n} 个字符，且逐字等于“${phrase}”；多出任何字符就删到只剩跳转词再发送。`,
  ].join("\n");
}

function endOutputBlock(phrase) {
  const n = charCount(phrase);
  const unit = /^[\u4e00-\u9fff]+$/.test(phrase) ? "汉字" : "字符";
  return [
    "# 结束输出（最高优先级，覆盖以上所有要求）",
    "",
    "- 结束语是平台识别的控制信号：平台按整条消息精确匹配，多一个字、一个标点、一个换行都不会结束。",
    "",
    "- 阶段过关条件未全部满足时，严禁输出结束语。",
    "",
    `- 需要结束时，本条消息只能是“${phrase}”这 ${n} 个${unit}，前后不得有空格、标点、换行或其他任何字符。`,
    "",
    "- 最后的点评、致谢、总结必须放在上一条消息里说完；严禁与结束语放在同一条消息里。以下写法平台都识别不到，全部禁止：",
    "",
    `  - ${phrase}。`,
    "",
    `  - 以上是本次实训的全部内容，${phrase}`,
    "",
    `- 发送前自检：本条消息去掉首尾空白后必须恰好 ${n} 个字符，且逐字等于“${phrase}”；多出任何字符就删到只剩结束语再发送。`,
  ].join("\n");
}

/**
 * Linear ability/oral scripts: make the platform-matched jump/end word a
 * standalone control message. Graph scripts and custom end phrases are left
 * for manual review instead of guessing their keywords.
 */
export function ensureJumpOutputBlocks(markdown) {
  const text = String(markdown || "");
  const changes = [];
  const pending = [];
  if (/##\s*🔀\s*非线性跳转关系/.test(text) || /flowType\s*[:：]\s*["“]?graph/.test(text)) {
    return { text, changes, pending };
  }
  const blocks = stageBlocks(text);
  if (blocks.length === 0) return { text, changes, pending };
  const edits = [];
  blocks.forEach((meta, index) => {
    const isLast = index === blocks.length - 1;
    const block = text.slice(meta.start, meta.end);
    const range = promptFenceRange(block);
    if (!range) return;
    const content = block.slice(range.contentStart, range.contentEnd);
    const marker = isLast ? /#\s*结束输出/ : /#\s*跳转输出/;
    if (marker.test(content)) return;
    const flowMatch = block.match(/\*\*flowCondition\*\*\s*[:：]\s*["“'`]?([^"”'`\n]+)/);
    const flowCondition = (flowMatch?.[1] || "").trim();
    let phrase = isLast ? END_DEFAULT : JUMP_DEFAULT;
    if (flowCondition && flowCondition !== "TASK_COMPLETE") phrase = flowCondition;
    if (flowCondition === "TASK_COMPLETE" && !isLast) {
      pending.push(`${stageLabel(meta.title)} 使用 TASK_COMPLETE 作为非末阶段跳转词，未自动补跳转约束，请人工确认`);
      return;
    }
    if (isLast) {
      const declaresEnd =
        flowCondition === END_DEFAULT || content.includes(END_DEFAULT);
      if (!declaresEnd) {
        pending.push(`${stageLabel(meta.title)} 未写明独立结束语，未自动补结束约束，请人工确认`);
        return;
      }
      phrase = END_DEFAULT;
    } else if (!flowCondition && !content.includes(JUMP_DEFAULT)) {
      pending.push(`${stageLabel(meta.title)} 未找到跳转词，未自动补跳转约束，请人工确认`);
      return;
    }
    const section = isLast ? endOutputBlock(phrase) : jumpOutputBlock(phrase);
    const head = content.replace(/\s+$/, "");
    const inserted = `${head}\n\n${section}\n`;
    edits.push({
      start: meta.start + range.contentStart,
      end: meta.start + range.contentEnd,
      text: inserted,
      label: stageLabel(meta.title),
      kind: isLast ? "结束输出" : "跳转输出",
    });
  });
  let result = text;
  edits
    .slice()
    .sort((a, b) => b.start - a.start)
    .forEach((edit) => {
      result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
      changes.push(`阶段「${edit.label}」提示词已补${edit.kind}独立性约束`);
    });
  return { text: result, changes, pending };
}

/** Mechanical repairs for ability/oral scripts; semantics stay untouched. */
export function normalizeBasicMarkdown(markdown, { type = "ability" } = {}) {
  const changes = [];
  const pending = [];
  const lines = String(markdown || "").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const fence = fenceStart(lines[index]);
    if (fence && fence.marker === "~~~") {
      const hadLang = fence.lang;
      lines[index] = hadLang ? `\`\`\`${hadLang}` : "```";
      changes.push(`第 ${index + 1} 行：代码围栏 ~~~ 改为 \`\`\``);
    }
  }

  const replaceVocabBlock = (start, end, raw) => {
    const parsed = parseJsonArray(raw);
    const { items, pending: vocabPending } = normalizeVocabularyItems(parsed);
    pending.push(...vocabPending);
    if (!sameVocabulary(parsed, items)) {
      const body = JSON.stringify(items, null, 2);
      lines.splice(start, end - start + 1, "```json", ...body.split("\n"), "```");
      changes.push(`第 ${start + 1} 行：重点词汇已规范为 term/meaning/source/exampleSentence`);
    }
    return items.length;
  };

  let vocabularyCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!isVocabFieldLine(lines[index])) continue;
    const valueMatch = lines[index].match(VOCAB_FIELD);
    const inline = (valueMatch?.[1] || "").trim();

    if (inline.startsWith("[")) {
      try {
        const parsed = parseJsonArray(inline);
        const { items, pending: vocabPending } = normalizeVocabularyItems(parsed);
        pending.push(...vocabPending);
        const head = lines[index].slice(0, lines[index].indexOf(inline));
        const body = JSON.stringify(items, null, 2).split("\n");
        lines.splice(index, 1, `${head}`, "```json", ...body, "```");
        changes.push(`第 ${index + 1} 行：内联重点词汇改为围栏 JSON 并规范化`);
        vocabularyCount += items.length;
        index += body.length + 2;
      } catch (error) {
        pending.push(`第 ${index + 1} 行重点词汇无法解析：${error.message}`);
      }
      continue;
    }

    let fenceLine = -1;
    for (let scan = index + 1; scan < Math.min(index + 5, lines.length); scan += 1) {
      if (fenceStart(lines[scan])) {
        fenceLine = scan;
        break;
      }
      if (lines[scan].trim()) break;
    }
    if (fenceLine < 0) {
      if (type === "oral") {
        const insertAt = index + 1;
        lines.splice(insertAt, 0, "", "```json", "[]", "```");
        changes.push(`第 ${index + 1} 行：重点词汇缺 JSON 块，已补空数组 []`);
        pending.push("重点词汇已补 []，请按文档或场景补充实际词汇后再注入");
        index += 4;
      }
      continue;
    }

    const open = fenceStart(lines[fenceLine]);
    let closeLine = -1;
    for (let scan = fenceLine + 1; scan < lines.length; scan += 1) {
      if (isFenceClose(lines[scan], open.marker)) {
        closeLine = scan;
        break;
      }
    }
    if (closeLine < 0) {
      pending.push(`第 ${fenceLine + 1} 行重点词汇围栏未闭合，跳过`);
      continue;
    }
    try {
      vocabularyCount += replaceVocabBlock(
        fenceLine,
        closeLine,
        lines.slice(fenceLine + 1, closeLine).join("\n"),
      );
      index = closeLine;
    } catch (error) {
      pending.push(`第 ${fenceLine + 1} 行重点词汇无法解析：${error.message}`);
    }
  }

  if (type === "oral" && vocabularyCount === 0) {
    pending.push("未识别到任何有效重点词汇；请按阶段补充后重跑 validate");
  }

  const jump = ensureJumpOutputBlocks(lines.join("\n"));
  changes.push(...jump.changes);
  pending.push(...jump.pending);

  return {
    text: jump.text,
    changes,
    pending,
    stats: { vocabulary: vocabularyCount },
  };
}

/** Mechanical repairs for Pro configs; missing content is reported, not invented. */
export function normalizeProMarkdown(markdown) {
  const changes = [];
  const pending = [];
  let text = String(markdown || "");

  const roleTags = text.match(/<\/?\s*role\s*>/gi) || [];
  if (roleTags.length > 0) {
    text = text.replace(/<\/?\s*role\s*>/gi, "");
    changes.push(`移除 ${roleTags.length} 个 <role> 标签`);
    pending.push("已删 <role> 标签；请确认对应位置保留的是 @成员名 引用");
  }

  const promptPattern = /(<script_prompt>)([\s\S]*?)(<\/script_prompt>)/gi;
  let wordingFixes = 0;
  text = text.replace(promptPattern, (whole, open, body, close) => {
    const fixed = body.replace(/学生/g, "用户").replace(/学员/g, "用户");
    if (fixed !== body) wordingFixes += 1;
    return `${open}${fixed}${close}`;
  });
  if (wordingFixes > 0) {
    changes.push(`${wordingFixes} 个阶段提示词内的「学生/学员」改为「用户」`);
  }

  const stagePattern = /###\s*阶段\s*[0-9一二三四五六七八九十]+\s*[:：][^\n]*/g;
  const titles = Array.from(text.matchAll(stagePattern), (match) => match[0].trim());
  const dimensions = [
    "阶段触发条件",
    "背景设定",
    "完整执行流程",
    "阶段结束判定",
    "行为边界规范",
  ];
  const blocks = text.split(/###\s*阶段\s*[0-9一二三四五六七八九十]+\s*[:：]/).slice(1);
  blocks.forEach((block, index) => {
    const label = titles[index]?.replace(/^###\s*/, "") || `阶段${index + 1}`;
    const missing = dimensions.filter((name) => !block.includes(name));
    if (missing.length > 0) {
      pending.push(`${label} 提示词缺五维: ${missing.join("、")}`);
    }
    const nextBlock = blocks[index + 1];
    if (nextBlock) {
      const nextTitle = titles[index + 1]?.replace(/^###\s*阶段\s*[0-9一二三四五六七八九十]+\s*[:：]\s*/, "");
      const hasJumpWord = /跳转到|进入下一|转入|切换到/.test(block);
      const namesNext = nextTitle ? block.includes(nextTitle) : false;
      if (!hasJumpWord || !namesNext) {
        pending.push(`${label} 未写明跳转到下一阶段「${nextTitle || "未知"}」`);
      }
    } else if (!/结束本次实训|结束本次训练|完成本次实训/.test(block)) {
      pending.push(`${label} 未写明「结束本次实训」`);
    }
  });

  return { text, changes, pending, stats: { stages: blocks.length } };
}

export function stageNamesOf(markdown) {
  return Array.from(
    String(markdown || "").matchAll(/###\s*阶段\s*[0-9一二三四五六七八九十]+\s*[:：]\s*([^\n]+)/g),
    (match) => normalizeName(match[1]),
  );
}
