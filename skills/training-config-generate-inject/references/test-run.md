# 测试跑脚本（发布后）

前置：按基础技能 `SKILL.md`「共享代码与本端数据」设置共享 `TRAIN` / `OPT`，明确导出 `TRAINING_CLIENT`（`qoder-cn|qoder|dsh|hermes`），先用 `node "$TRAIN/scripts/run.mjs" paths`（不读配置、不联网）确认本端；配置、凭据、runs/tmp 只留所选端原目录，禁止回退他端或写入共享树。

发布完成后，在当前获准的测试范围内用模拟学生把线上任务完整跑一遍，确认阶段推进正常，
并产出评测系统可直接解析的对话脚本（TXT）。入口是 skill 的 `test` 命令，底层走本地应用的
`POST /api/training-test-run`（SSE）。对话与参考日志均为模拟测试数据，非真实学生作答或成绩，
不得冒充真实学习记录。

## 命令

```bash
node "$TRAIN/scripts/run.mjs" test --run <运行目录> [--student good|guided|offtopic|all] [--max-rounds 10]
```

- 各端（含 DSH）`--student` 默认 `good`；`guided` / `offtopic` / `all` 仅在当前用户明确要求时使用。
  获准用 `all` 时按 `good` → `guided` → `offtopic` 顺序各跑一遍。
- `--max-rounds` 为每个阶段的轮次上限，默认 10；快速验证用 `2`。
- `run` / `loop` 代码默认仍会自动发布，未获当前发布许可必须加 `--no-publish`，不得继承历史默认授权；
  fresh 覆盖与 loop 各需当前独立许可，均不包含发布许可。
- `run` 一条龙里发布成功后会默认执行 `test --student good`，`--no-test` 才跳过；
  未获当前测试许可必须加 `--no-test`。Pro 类型、回读 FAIL 时自动跳过；verify 有 FAIL 禁止发布。
- 测试结果写入 `run.json` 的 `test` 字段，`report.md` 追加「测试跑脚本」章节。

## 平台接口

基础版/口语共用（Cookie 鉴权，`Origin` 头随请求下发）：

| 接口 | 请求体 | 返回 |
| --- | --- | --- |
| `POST /ai-tools/trainRun/runCard` | `{ taskId, stepId, sessionId? }` | `{ sessionId, text, nextStepId, needSkipStep }` |
| `POST /ai-tools/trainRun/chat` | `{ taskId, stepId, text, sessionId }` | `{ text, nextStepId }` |

一轮流程：每阶段先按剧本配置（阶段名、llmPrompt、prologue、interactiveRounds）让 LLM
预生成一段历史日志风格的参考对话；`runCard` 取智能体开场 → 模拟学生参考这份对话作答 →
`chat` 推进 → `nextStepId` 指向下一阶段则切换阶段，为空或达到轮次上限则进入下一条剧本节点。
参考对话只影响表达与推进方式，学生仍需针对当前提问回答；`--no-reference` 关闭预生成。
平台调用超时 120 秒，整个请求受 `maxDuration = 300` 限制。

## 模拟学生档位

| `--student` | 标签 | 行为 |
| --- | --- | --- |
| `good` | 优秀学生 | 理解透彻、表达清晰、结构化回答，主动总结 |
| `guided` | 需要引导的学生 | 覆盖核心但暴露 1-2 个不确定点，会请求提示 |
| `offtopic` | 答非所问的学生 | 理解偏差、跑题或只复述弱相关信息 |

封闭式问题（确认/选择/角色确认）一律先简短直答，不体现性格；只输出学生回答正文，
不超过 200 字；语言跟随智能体提问，口语训练用自然短句。模型复用 `llm.model`。

## 产物

每个当前获准且实际运行的档位产出两个文件，另有一份汇总报告：

- `test-<profile>.json`：完整事件结果（taskId、taskName、steps、messages、completed 等）。
- `test-<profile>.txt`：对话脚本，**评测系统使用这个文件**。
- `test-report.md`：任务信息、阶段覆盖表（是否进入/学生轮次）、产物清单。
- 每份 TXT 还会复制到 `run.json` 记录的教师文档所在目录，命名为
  `<任务名>-test-<profile>.txt`（无任务名时用文档名；文档缺失时只保留运行目录并警告）。
  文档路径是临时副本时用 `--doc <教师文档>` 覆盖导出目录；不得导出到共享树或其他端目录。

TXT 格式必须保持 `frontend/lib/txt-converter.ts` 的 `parseTxtDialogue` 可解析：

```
对话记录
日志创建时间: <ISO 时间>
任务名称: <任务名>
task_id: <trainTaskId>
学生档位: <档位标签>
============================================================
Step: <阶段名> | step_id: <步骤ID> | 第 <N> 轮 | 来源: runCard
AI: <智能体开场>
----------------------------------------
Step: <阶段名> | step_id: <步骤ID> | 第 <N> 轮 | 来源: chat
用户: <学生回答>
----------------------------------------
```

解析要点：元数据行以 `日志创建时间:` / `task_id:` / `学生档位:` 开头；阶段头以 `Step:`
开头且含 `|`；正文以 `用户:` / `AI:` 开头；`---` / `===` 分隔线会被跳过。
不要手工编辑，格式不对就重跑 `test`。

## 判定

- `completed = true` 且预期路径覆盖完整、无异常漏访：测试通过。正常未选中的条件分支不等于异常漏访，
  不能仅凭总阶段覆盖不全判失败。
- 有阶段未访问或未走完：命令以 warn 输出，报告逐条列出未访问阶段与未完成 Run；不回滚已发布任务。
  结合分支条件、预期路径与 `completed` 区分正常未选分支和断链/异常未完成；确需修复时再查连线与
  `nextStepId`，fresh 重注入须另获当前独立覆盖许可。
- 平台 401/403：按 `injection-and-platform.md`「凭证获取」在当前授权内刷新本端 Cookie 后重试。

## Pro 限制

Pro 训练的测试通道是页面内 WebSocket（`wss://cloudapi.polymas.com/ai-platform/ws/trainV2`，
协议 `polymas-pro-train-v2`，事件 `scriptStart` / `stepStart` / `userTextInput` /
`continueCurrentStep` / `heartBeat`），必须由训练页面桥接，没有等价的 HTTP 接口。
`test` 对 `pro` 直接返回「Pro 训练暂不支持 HTTP 自动测试」，不要为此退化成浏览器自动化。
