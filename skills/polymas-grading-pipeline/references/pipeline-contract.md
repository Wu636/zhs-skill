# 流水线契约

运行状态文件 `<RUN>/pipeline-state.json` 是唯一事实来源。报告、续跑、闸门判断都从它读，不依赖对话记忆。

## 1. 状态文件结构

```json
{
  "runId": "20261030-172512",
  "createdAt": "2026-10-30T17:25:12",
  "updatedAt": "2026-10-30T18:04:31",
  "course": {
    "name": "基础化学实验 华南农业大学",
    "school": "华南农业大学",
    "query": "基础化学实验 华南农业大学",
    "courseId": "",
    "folderId": "",
    "term": 20271,
    "agentId": ""
  },
  "gates": {
    "buildApproved": false,
    "uploadApproved": false,
    "testApproved": false,
    "onlineApproved": false
  },
  "skills": [
    {
      "slug": "max-bubble-pressure-surface-tension-grading",
      "displayName": "最大泡压法表面张力实验报告批阅",
      "desc": "批阅……",
      "requirement": "必交成果：……",
      "requirementSource": "references/submission-requirements.md",
      "zip": "/abs/path/zips/max-bubble-pressure-surface-tension-grading.zip",
      "sha256": "718706b15cb4…",
      "size": 25839,
      "valid": true,
      "errors": [],
      "warnings": [],
      "build": { "status": "pending", "note": "" },
      "upload": { "status": "pending", "skillNid": "", "httpStatus": null, "msg": "" },
      "test": {
        "status": "pending",
        "approved": false,
        "mae": null,
        "maxDiff": null,
        "skillNid": "",
        "skillVersionId": "",
        "rounds": [],
        "samples": [],
        "candidates": [],
        "note": "",
        "skippedReason": ""
      },
      "finalize": { "status": "pending", "version": "", "skillVersionId": "", "attempts": 0, "msg": "" },
      "publishCourse": { "status": "pending", "boundCount": 0, "msg": "" },
      "agent": {
        "status": "pending",
        "instanceNid": "",
        "verified": false,
        "skillsBound": [],
        "descChars": 0,
        "reqChars": 0,
        "online": false,
        "msg": ""
      }
    }
  ],
  "log": [
    { "ts": "2026-10-30T17:26:03", "stage": "prepare", "skill": "*", "result": "ok", "note": "预检 2 个 ZIP" }
  ]
}
```

字段取值：

| 字段 | 取值 |
|---|---|
| `build.status` | `pending` / `done` / `failed` |
| `upload.status` | `pending` / `uploaded` / `duplicate` / `failed` |
| `test.status` | `pending` / `passed` / `failed` / `inconclusive` / `skipped` |
| `finalize.status` | `pending` / `done` / `skipped` / `failed` |
| `publishCourse.status` | `pending` / `done` / `failed` |
| `agent.status` | `pending` / `created` / `failed` |

`finalize.status=skipped` 只用于“同名技能已定稿、无需再定稿”的复用场景，必须在 `finalize.msg` 写明原因。

## 2. 阶段与不变式

允许的状态迁移：

```
upload:        pending → uploaded | duplicate | failed
test:          pending → passed | failed | inconclusive | skipped
finalize:      pending → done | skipped | failed
publishCourse: pending → done | failed
agent:         pending → created | failed
```

任何阶段只能前进，不回退。失败后重试仍是原状态 → 目标状态，不经过 `pending`。

`pipeline_state.py check` 校验的硬不变式：

1. `finalize.status=done` ⇒ `upload.skillNid` 非空，且 `finalize.skillVersionId` 非空。
2. `publishCourse.status=done` ⇒ `upload.status in (uploaded, duplicate)` 且 `finalize.status in (done, skipped)`。
3. `agent.status=created` ⇒ `agent.instanceNid` 非空、`publishCourse.status=done`、`requirement` 非空。
4. `agent.skillsBound` 必须包含 `finalize.skillVersionId`；不一致说明绑定了别的版本。
5. 任何 `upload.status != pending` ⇒ `gates.buildApproved` 与 `gates.uploadApproved` 为真。
6. `agent.online=true` ⇒ `gates.onlineApproved` 为真，且 `agent.verified=true`。
7. 同一运行内 `sha256` 不得重复。
8. `finalize.status=done` ⇒ `test.status in (passed, skipped)` 或 `gates.testApproved=true`。
9. `test.status=passed` 且 `test.skillVersionId` 非空 ⇒ 必须等于 `finalize.skillVersionId`，否则说明定稿的不是通过测试的版本。
10. 旧状态没有 `test` 字段时只给提醒不报错；`prepare_run.py` 合并旧记录时补 `test.status=skipped`，原因写“旧运行迁移”。

`check --for upload|agent|online|final` 在不变式之外，再按目标阶段检查“能否开始”：

| `--for` | 额外要求 |
|---|---|
| `upload` | 每个技能 `valid=true`，ZIP 仍存在，`buildApproved` |
| `agent` | 每个技能 `publishCourse.done`、`requirement` 非空、有 `skillVersionId`，且 `test.status in (passed, skipped)` 或 `testApproved` |
| `online` | 每个技能 `agent.created` 且 `verified=true`、`onlineApproved` |
| `final` | 以上全部 |
| 缺省 | 只跑不变式 |

## 3. 跨阶段交接字段

| 从 | 到 | 字段 | 用途 |
|---|---|---|---|
| 造包 | 状态 | `zip`、`sha256` | 上传去重、断点识别 |
| 造包 | 状态 | `displayName`、`desc`、`requirement` | 智能体名称、描述、固定要求 |
| 上传 | 测试 | `upload.skillNid`、`test.skillVersionId` | 用草稿版本执行批阅 |
| 测试 | 定稿 | `test.status`、`test.skillVersionId` | 只有通过候选能定稿，版本必须一致 |
| 定稿 | 发布 | `finalize.skillVersionId` | `batchBindSkill` |
| 发布 | 智能体 | `publishCourse.boundCount` | 能否绑技能的前置条件 |
| 智能体 | 报告/上线 | `agent.instanceNid` | 补存、上线、回查 |

智能体阶段绑定的是 `skillVersionId`，不是 `skillNid`。同名技能可能有多个版本，必须用本次定稿的那个。

## 4. 幂等与续跑

- **上传**：同一 `sha256` 只能上传一次。状态里已有 `upload.skillNid` 时不再上传。
- **测试**：同一轮结果只写一次 `test.rounds`；重测是新轮次，不覆盖历史。失败候选重传会新建同名技能草稿，旧草稿不定稿、不发布。
- **定稿**：`finalize.status` 非 `pending` 时不再定稿，避免生成 1.0.1 而课程仍引用 1.0.0。
- **发布**：`boundCount > 0` 时不重复绑定。
- **智能体**：有 `agent.instanceNid` 时只能补存（`update` + `updateRef`），不能 `create`。
- **ZIP 变更**：同一 slug 的 sha256 变化且该技能已上传时，`prepare_run.py` 报冲突并停止。需教师决定是“当新技能另起一条”还是“放弃旧记录”。

## 5. 失败分类

| 类别 | 例子 | 是否重试 | 处理 |
|---|---|---|---|
| 可重试的时序问题 | 定稿 `10006` | 是，最多 6 次 | 等 3—4 秒再试 |
| 登录失效 | 401/403 | 否 | 停止整批，教师登录 |
| 包问题 | 预检失败、根目录不唯一 | 否 | 修包重新打包 |
| 名称冲突 | 同名技能/智能体已存在 | 否 | 教师决定复用或改名 |
| 参数/权限 | 其他非 200 错误码 | 否 | 原文上报，定位 `step` |
| 半成品 | `create` 成功、`createRef` 失败 | 是 | 用 `instanceNid` 补存 |
| 测试样本失败 | 报告 `FAILED` 或 8 分钟仍 `PENDING` | 是 | 先查模型名与报告 `taskId`，换有效模型重测 |
| 测试分差过大 | 教师样本超阈值、模拟样本档位错位 | 是 | 按失分点改技能，重传新候选，最多 3 个候选 |

服务端返回的 `msg` 必须原样写进 `*.msg` 和报告，不改写成“格式错误”之类的猜测。

## 6. 产物路径

```
tmp/<run>/
├── pipeline-state.json
├── zips/
│   ├── <slug>.zip
│   └── …
├── test/
│   ├── hw-1.jpg             # 教师样本，绝不进技能包
│   ├── simulated/           # 好/中/差模拟作业
│   └── results-round1.json  # correction_test_compact.js 输出
└── report.md                # render_report.py 输出（可选保存）
```

状态文件不放进技能包，也不上传到平台。
