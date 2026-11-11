# 教学专家 Skill 生成器

把一段教师需求或课程文档做成一个新的教学专家 Skill。既可新建或更新完整包，也可单独生成专家介绍或验收提问。

## 开始使用

将完整目录作为 Skill 使用，并调用 `$educational-expert-skill-builder`。在只有自定义指令字段的环境里，可复制 [EXPERT_CUSTOM.md](EXPERT_CUSTOM.md) 中“可直接粘贴的专家指令”一节。

> 根据我提供的课程需求，制作一个标准文件夹结构版专家 Skill。给我专家名称、按“使用场景／核心功能／输出与边界”撰写的具体描述，以及可下载的 ZIP。请把可直接发送的验收提问和教师核对点放进包里。

直接发自然语言需求即可。需要统一收集教师需求时，可使用 [需求采集表](templates/expert_requirements.md)。需要更新现有专家时，附旧版 ZIP 和本次要改的内容。

## 文件结构

```text
educational-expert-skill-builder/
├── SKILL.md
├── EXPERT_CUSTOM.md
├── README.md
├── manifest.json
├── references/
│   ├── requirement-to-workflow.md
│   └── package_spec.md
├── templates/
│   ├── expert_requirements.md
│   ├── expert_profile.md
│   └── expert_package.md
├── examples/
│   └── test_cases.md
└── scripts/
    └── pack_skill.py
```

归档工具使用 Python 3 标准库。具体用法和交付检查见 [包结构规范](references/package_spec.md)。
