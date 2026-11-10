# polymas-grading-agent-create

在 Polymas AI 教学中心为课程批量创建“自定义批阅”智能体，并绑定已上架的批阅技能。

默认走**课程接口**（`cloudapi.polymas.com`），不依赖创建页可见性；界面脚本保留作兜底。

## 目录

```
polymas-grading-agent-create/
├── SKILL.md                     批阅智能体创建流程与约束
├── README.md
├── references/
│   └── grading-agent-ui.md      页面 URL、接口链路、真实请求体、填写技巧与已知坑
└── scripts/
    ├── build_manifest.py        从技能包生成创建清单（离线）
    ├── ensure_login.js          登录/页面闸门：未登录就等教师登录，登录后自动继续
    ├── check_page.js            识别当前页面类型并取 courseId/folderId/term
    ├── api_ctx.js               建接口上下文：课程参数、userNid/schoolId、模板模型与全局指令
    ├── api_skill_map.js         技能名 → skillVersionId 映射
    ├── api_create_agents.js     批量建实例 + 挂课 + 写配置 + 落库（不发布）
    ├── api_verify_agents.js     按名称回查名称/描述/要求/技能/上线状态
    ├── api_publish_agent.js     批量上线（需教师确认）
    ├── list_agents.js           查建设中/已上线智能体，按名称去重
    ├── open_type_dialog.js      界面兜底：点“创建批阅智能体”并读类型卡片
    ├── choose_custom_type.js    界面兜底：选中“自定义批阅”
    ├── wait_create_page.js      界面兜底：等创建页出现名称输入框
    ├── fill_basic.js            界面兜底：填批阅名称、批阅描述
    ├── fill_requirement.js      界面兜底：选固定要求并填作业要求
    ├── add_skill.js             界面兜底：弹窗里精确匹配并勾选批阅技能
    ├── save_agent.js            界面兜底：点保存并读结果
    ├── verify_agent.js          界面兜底：刷新后比对名称/描述/要求是否落库
    ├── publish_agent.js         界面兜底：点上线并读结果
    └── cleanup.js               清理注入的全局变量
```

## 最短用法

```bash
python3 scripts/build_manifest.py ~/作业批阅/九个实训批阅skills --out /tmp/agent_manifest.json
```

在已登录 AI 教学中心的页面里按 `SKILL.md` 执行：

1. `ensure_login.js`：未登录时打开登录页等教师登录，登录并入课自动继续；
2. `check_page.js` 确认页面与课程；
3. `api_ctx.js` → `api_skill_map.js` 备好参数与技能版本映射；
4. `list_agents.js` 查重；
5. 写入 `window.__agentItems`，跑 `api_create_agents.js`；
6. `api_verify_agents.js` 回查；
7. 教师确认后写入 `window.__publishList`，跑 `api_publish_agent.js`。

## 边界

- 只创建和保存，不负责上传/发布批阅技能（那是 `polymas-skill-batch-upload`）。
- 不删除智能体、不切换已绑定技能版本、不改已上线内容。
- 上线前必须得到教师确认；未确认时停在草稿。
- 不读取、不导出、不保存 Cookie / localStorage / Authorization；接口请求用页面登录态 `credentials:'include'`。
