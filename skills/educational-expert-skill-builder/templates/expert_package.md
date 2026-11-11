# 教学专家建包模板

以 [包结构规范](../references/package_spec.md) 为准，按下面的分工生成实际文件。将模板字段替换成专家专用内容。

## SKILL.md

```markdown
---
name: <expert-slug>
description: <面向什么对象、完成什么任务、何时使用>
---

# <专家名称>

## 选择任务
<各项核心任务的触发条件和必要参考文件>

## 处理步骤
<关键输入、依据、判断顺序、输出和缺项处理>

## 证据与边界
<课程口径、来源核验、需要教师或专业人员确认的情形>
```

## EXPERT_CUSTOM.md

保留“专家名称”“专家简介”“具体描述”“可直接粘贴的专家指令”。三段描述见 [专家资料模板](expert_profile.md)。可粘贴指令要包含核心流程、材料缺失时的处理和边界，以便仅粘贴一段也能使用。

## 参考资料、模板与案例

- 参考资料至少包括完成核心任务时会读取的一份学科规则或工作说明。若涉及来源目录，写明入口、用途和核验情况。
- 模板至少覆盖一项主要交付，可用“证据位置 → 判断 → 理由 → 下一步”的结构。评分模板需要写清分值依据和未评项。
- 案例沿用“可发送输入＋预期行为”的结构。生成目标专家自己的案例，选取合适的材料和可观察的通过条件。

## manifest.json

```json
{
  "name": "expert-slug",
  "display_name": "专家显示名称",
  "version": "1.0.0",
  "language": "zh-CN",
  "entrypoint": "SKILL.md",
  "expert_custom": "EXPERT_CUSTOM.md",
  "resources": {
    "references": ["references/workflow.md"],
    "templates": ["templates/output.md"],
    "examples": ["examples/test_cases.md"]
  }
}
```

README 说明怎么使用完整包或可粘贴指令，列出文件树和必需材料。建包后核对资源名称和实际路径，再压缩。
