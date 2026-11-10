# 作业批阅 skill 模板契约

## 1. 最终目录

```text
<skill-name>/
├── README.md
├── SKILL.md
├── references/       # 可选；有实际参考文件时保留
└── scripts/          # 可选；有确定性脚本时保留
```

要求：

- ZIP 只有一个根目录；根目录名等于 frontmatter 的 `name`。
- 最终批阅包不含 `agents/`、`assets/`、`.DS_Store`、`__MACOSX`、缓存、临时渲染或原始学生样本。
- `README.md` 使用 `references/template-readme.md` 的结构说明。
- `SKILL.md` 是平台执行批阅的核心文件。

## 2. SKILL.md 固定骨架

```text
---
name: lowercase-hyphen-name
description: "批阅对象 + 参考标准 + 评分/评价方式 + 触发场景"
---

# 批阅名称

## 批阅对象
输入、支持附件、读取方式、需要先读的 references、脚本用途

## 批阅流程
取证、打分、扣分/封顶、审计、输出

## 1. 评分项（score）
score_type、full_score、配置表、固定 JSON 输出

## 2. 评价项（evaluations）
评价项配置表、JSON 输出
```

frontmatter 只写 `name` 和 `description`。`name` 只用小写字母、数字和连字符，并与根目录一致。

## 3. score 三选一

只声明一种 `score_type`：

### dimension

适合多个质量维度。必须提供：

- `full_score`；
- 每个维度的名称、分值、评分描述和评分规则；
- 各维度分值之和等于满分；
- 输出 `total`、`dimensions[].key/name/score/full/reason`。

### gradient

适合整体档位。必须提供：满分、每个梯度的分值或范围、标签和描述，并输出 `gradient.label/reason`。

### item

适合固定成果或题目逐项评分。必须提供：`item_split`、`item_count`、每项编号/分值/内容/描述/规则，并输出 `items`。

## 4. evaluations

必须提供“综合评语”和“改进建议”，可增加证据摘要、错误清单、时间戳、人工复核、置信度等。评价项不参与分数计算，输出合法 JSON，由平台 A to UI 渲染。

推荐结构：

```json
"evaluations": {
  "综合评语": "...",
  "改进建议": [
    {"问题": "...", "怎么改": "...", "目标": "..."}
  ]
}
```

## 5. 执行信息

主文件应明确：

- 批阅对象和支持格式；
- 规则优先级；
- 多模态取证步骤；
- 缺项、格式等价、封顶、统一扣分和单一归因；
- 样本校准覆盖范围与防标签泄漏；
- score/evaluations JSON 示例；
- 输出前的合计、证据、重复扣分和评语一致性审计。

## 6. references 与 scripts

- 主文件引用的本地 Markdown 路径必须存在；
- references 只保存执行所需的长规则和匿名化校准锚点；
- scripts 只处理确定性任务，不替代专业评分；
- 没有实际内容时省略对应目录；
- 顶层不添加模板未列出的产品配置目录。
