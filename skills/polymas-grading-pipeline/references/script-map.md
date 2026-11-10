# 脚本调用地图

本技能不复制子技能的脚本。以下路径均以共享安装目录为准；`RUN` 须先按 SKILL.md 设置为项目/用户指定的真实绝对运行目录，位于所有技能安装树外，禁止使用占位。浏览器操作使用当前应用实际可用且已授权的工具；下文 `evaluate_script`、`take_snapshot`、`upload_file` 和 `uid` 仅为工具/参数示例，不是 Hermes、DSH 或其他应用的必备工具名。按实际工具接口执行页面脚本、定位输入并上传文件；工具不可用时停止，不绕过权限和教师确认闸门。

```bash
SKILL_DIR="$HOME/.agents/skills/polymas-grading-pipeline"
BUILDER="$HOME/.agents/skills/assignment-grading-skill-builder"
UPLOADER="$HOME/.agents/skills/polymas-skill-batch-upload"
AGENTER="$HOME/.agents/skills/polymas-grading-agent-create"
ST="$RUN/pipeline-state.json"
```

用 `python3 "$SKILL_DIR/scripts/check_deps.py"` 先确认齐备。`/opt/homebrew/bin/python3` 缺 `pyexpat`，解析 DOCX 时用 `/usr/bin/python3`。

## 0. 依赖与状态

| 脚本 | 作用 | 关键参数 |
|---|---|---|
| `scripts/check_deps.py` | 检查子技能目录与所需脚本 | `--skills-root`（默认 `Path(__file__).resolve().parents[2]`，共享安装时为 `~/.agents/skills`，暂存时为暂存根）、`--json` |
| `scripts/prepare_run.py` | 预检 ZIP、抽元数据、建/合并状态 | `--state`、`--course-name`、`--school`、`--course-query`、`--term`、`--course-id`、`--folder-id`、`--agent-id`、`--json` |
| `scripts/pipeline_state.py set` | 写单个字段 | `--state`、`--slug`、`--path`、`--value` 或 `--value-file` |
| `scripts/pipeline_state.py gate` | 开关闸门 | `--name buildApproved|uploadApproved|testApproved|onlineApproved`、`--yes/--no` |
| `scripts/pipeline_state.py status` | 人读/机读进度 | `--json` |
| `scripts/pipeline_state.py check` | 不变式与阶段前置条件 | `--for upload|agent|online|final` |
| `scripts/evaluate_test_scores.py` | 判定测试分差并写入 `test.*` | `--state`、`--slug`、`--results`、`--max-diff 8`、`--max-mae 5`、`--skip --reason` |
| `scripts/state_to_agent_items.py` | 生成 `window.__agentItems` | `--js` 或 `--json` |
| `scripts/render_report.py` | 生成批次报告 | `--json` |
| `scripts/finalize_run.py` | 归集技能包/批阅介绍/学生作业/平台PDF报告并清理运行目录 | `--run`、`--out-dir`、`--keep-evidence`、`--force` |

`pipeline_state.py set` 的 `--path` 白名单见 `references/pipeline-contract.md`。`agent.skillsBound` 用 JSON 数组字符串：`--value '["FzDSHKhCBc"]'`。

## 1. 造包（builder）

| 脚本 | 何时用 |
|---|---|
| `$BUILDER/scripts/inventory_materials.py <材料目录> --output <run>/inventory.json` | 开始盘点 |
| `$BUILDER/scripts/validate_grading_skill.py <技能目录>` | 打包前静态校验 |
| `$BUILDER/scripts/package_skill.py <技能目录> --output "$RUN/zips/<slug>.zip"` | 出 ZIP |

包内必须含 `references/submission-requirements.md`（学生要求原文）。模板允许 `references/`，这不是模板外文件。

## 2—3. 上传上架（uploader）

先在浏览器执行：

| 页面脚本 | 用途 |
|---|---|
| `$UPLOADER/scripts/check_login.js` | 登录闸门，401/403 即停 |
| `$UPLOADER/scripts/find_course.js` | 课程查询，只取 `exact` 唯一命中 |
| `$UPLOADER/scripts/find_skill.js` | 同名查重 |
| `$UPLOADER/scripts/inject_upload_input.js` | 注入 `input#__skill_upload` |
| `$UPLOADER/scripts/get_draft_version.js` | 取草稿 `skillVersionId` |
| `$UPLOADER/scripts/finalize_skill.js` | 保存草稿 + 定稿（自带 10006 重试） |
| `$UPLOADER/scripts/publish_to_course.js` | 绑定课程并回查 `boundCount` |
| `$UPLOADER/scripts/verify_skill.js` | 列表回查 |
| `$UPLOADER/scripts/cleanup.js` | 收尾 |

上传用 fire-and-poll：发起后把结果写到 `window.__uploadState`，25 秒后单独轮询。不要在一次 `evaluate_script` 里 `await` 整段请求。

页面上下文变量：

```js
window.__skillName   // 查重
window.__skillType   // 固定 1
window.__skillNid    // 定稿/发布
window.__skillVersionId
window.__courseId
window.__courseFolderId
```

## 3.5 批阅测试（本技能自带脚本）

浏览器脚本都在 `scripts/browser/`，在已登录的 `cloudapi.polymas.com` 页面执行：

| 页面脚本 | 用途 |
|---|---|
| `browser/correction_test_setup.js` | 读 `window.__ctConfig`，注入 `input#__ct_file_input`，初始化 `window.__ctState` |
| `browser/correction_test_start.js` | 上传样本、逐个 `execute`，fire-and-poll，立即返回 |
| `browser/correction_test_poll.js` | 每调用一次拉一轮 `report-detail`，直到 `phase=done` |
| `browser/correction_test_compact.js` | 输出 `evaluate_test_scores.py` 可读的 JSON |

流程：

1. `evaluate_script` 设置 `window.__ctConfig`（字段见 SKILL.md 3.5.2）。
2. 执行 setup，`take_snapshot` 找到 aria-label 为 `__ct_file_input` 的输入，用它的 `uid` 逐个 `upload_file` 上传 `needsFiles`。
3. 执行 start；之后每 20 秒执行一次 poll，`phase=done` 为止。
4. 执行 compact，把返回值保存为 `$RUN/test/results-round1.json`。
5. `python3 "$SKILL_DIR/scripts/evaluate_test_scores.py" --state "$ST" --slug <slug> --results "$RUN/test/results-round1.json"`。

平台接口（只复用浏览器登录态）：

| 接口 | 用途 |
|---|---|
| `POST /basic-resource/file/upload?hidden=false` | 上传学生样本附件 |
| `POST /ai-biz/v1/correction-skill/execute` | 用草稿版本跑批阅（`isTestRun=true`） |
| `GET /ai-biz/v1/correction-skill/report-detail?taskId=` | 取报告与分数 |

有效模型：`deepseek-v4.1-flash`（默认）、`Doubao-Seed-2.0-pro`、`qwen3.8-max`。`gpt-4o` 会让任务永久 `PENDING`。

## 4. 建智能体（agent skill）

页面脚本：

| 脚本 | 用途 |
|---|---|
| `$AGENTER/scripts/ensure_login.js` | 登录/页面闸门 |
| `$AGENTER/scripts/check_page.js` | 判定 `library|create|other` |
| `$AGENTER/scripts/api_ctx.js` | 课程参数、userNid/schoolId、模板模型与全局指令 |
| `$AGENTER/scripts/api_skill_map.js` | 技能名 → `skillVersionId` |
| `$AGENTER/scripts/list_agents.js` | 建设中/已上线查重 |
| `$AGENTER/scripts/api_create_agents.js` | 建实例 + 挂课 + 写配置 + 落库（不发布） |
| `$AGENTER/scripts/api_verify_agents.js` | 回查配置与绑定 |
| `$AGENTER/scripts/api_publish_agent.js` | 上线（需闸门 C） |
| `$AGENTER/scripts/cleanup.js` | 收尾 |

注入片段由状态生成：

```bash
python3 "$SKILL_DIR/scripts/state_to_agent_items.py" --state "$ST" --js
```

输出是完整的 `() => { window.__agentItems = [...]; return ...; }`，直接作为 `evaluate_script` 的 `function`。条目里同时带 `skillName` 和 `skillVersionId`，脚本优先用后者。

`agentId` 取“自定义批阅”创建页 URL 的 `agentId`；列表页没有时，给当前 URL 补 `&agentId=<id>` 后刷新再跑 `api_ctx.js`，并回填 `course.agentId`。

查重和回查前先设列表参数（值从状态文件读）：

```js
() => {
  window.__agentQuery = {
    courseId: "<course.courseId>",
    folderId: "<course.folderId>",
    term: <course.term>,
    keyword: ""
  };
  return true;
}
```

## 5. 报告

```bash
python3 "$SKILL_DIR/scripts/render_report.py" --state "$ST"
python3 "$SKILL_DIR/scripts/render_report.py" --state "$ST" --json > "$RUN/report.json"
```

报告只读状态文件，不发请求，不改变任何状态。

## 6. 交付归集

```bash
python3 "$SKILL_DIR/scripts/finalize_run.py" --run "$RUN"
python3 "$SKILL_DIR/scripts/finalize_run.py" --run "$RUN" --out-dir "<交付根目录>" --keep-evidence
```

默认输出 `<当前目录>/交付/<课程名>-<runId>/`：`技能包/`、`批阅技能介绍.md`、`学生作业/`（有测试时）、`平台批阅报告/`（有 PDF 时）。
校验复制完整性后删除运行目录；只删 `$RUN`，不碰课程材料。未完成阶段需 `--force`，只想导出用 `--keep-evidence`。
