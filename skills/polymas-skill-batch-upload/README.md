# 上传技能 · 文件结构说明

本技能负责把已打包的技能 ZIP 批量上传到 Polymas 技能库，并定稿、发布到指定课程；不参与作业评分。

```
polymas-skill-batch-upload/
├── README.md
├── SKILL.md
├── references/
│   └── polymas-upload-api.md
└── scripts/
    ├── preflight_zips.py
    ├── check_login.js
    ├── find_course.js
    ├── find_skill.js
    ├── inject_upload_input.js
    ├── upload_staged_zip.js
    ├── verify_skill.js
    ├── get_draft_version.js
    ├── finalize_skill.js
    ├── publish_to_course.js
    └── cleanup.js
```

## 必需 / 可选

- `SKILL.md`：执行流程（预检 → 登录与课程确认 → 去重 → 逐个上传 → 取草稿版本 → 定稿 → 发布到课程 → 回查 → 报告）。
- `references/polymas-upload-api.md`：上传、定稿、发布绑定、课程查询接口，类型 id，界面选择器与已知坑。
- `scripts/preflight_zips.py`：本地预检，检查 ZIP 根目录、SKILL.md、frontmatter 与模板外文件，输出 JSON 和 sha256。
- `scripts/*.js`：在页面上下文执行的短函数，由 `evaluate_script` 传入；除 `preflight_zips.py` 外都不在本地运行。

## 使用方式

1. 在右侧内置浏览器登录 `https://pds.polymas.com/skills`。
2. 说“用 polymas-skill-batch-upload 上传 `<目录>` 到课程 `采购与供应管理 内蒙古商贸职业学院`”，并指明目标类型（默认批阅技能）。
3. 技能先查课程、给预检清单，确认后逐个执行 上传 → 定稿 → 发布，最后给出成功/跳过/失败报告。

## 边界

- 只创建、定稿、发布到用户确认过的课程；不覆盖、不切换版本、不移除引用、不删除。
- 不接触登录凭据；所有请求复用浏览器当前会话。
- 类型默认 `批阅技能`（type=1）。作业批阅技能包不要用默认的通用技能类型上传。
- 定稿与发布对所有选课用户可见，必须在批次开始前确认目标课程。
