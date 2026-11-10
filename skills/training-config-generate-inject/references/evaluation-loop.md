# 自审、优化与迭代

前置：按基础技能 `SKILL.md`「共享代码与本端数据」设置共享 `TRAIN` / `OPT`，明确导出 `TRAINING_CLIENT`（`qoder-cn|qoder|dsh|hermes`），先用 `node "$TRAIN/scripts/run.mjs" paths`（不读配置、不联网）确认本端；配置、凭据、runs/tmp 只留所选端原目录，禁止回退他端或写入共享树。

测试脚本产出后，默认由执行技能的 agent **直接阅读对话脚本并对照教师文档逐阶段自审**，
发现问题直接改剧本。系统 21 维评测只保留为可选项，速度慢，不作为默认闭环。

只覆盖基础版与口语；Pro 没有等价的 HTTP 测试通道，`test` / `optimize` / `loop` 会直接拒绝。

## 命令

```bash
# 生成自审材料（纯本地）
node "$TRAIN/scripts/run.mjs" review --run <运行目录> [--student good]

# 按自审结论优化剧本
node "$TRAIN/scripts/run.mjs" optimize --run <运行目录> [--student good] \
  [--feedback "<教师意见>"] [--feedback-file <自审文件>] [--max-actions 3] [--dry-run]

# 可选：系统 21 维评测（慢，必须显式确认）
node "$TRAIN/scripts/run.mjs" evaluate --run <运行目录> [--student good|all] [--pass-score 75] --confirm-evaluate

# 一轮自审驱动的迭代（耗时长；loop 与 fresh 各须当前独立许可）
node "$TRAIN/scripts/run.mjs" loop --run <运行目录> --confirm-loop --review <review-n.md> --confirm-fresh \
  [--student good] [--max-iterations 3] [--max-actions 3] [--feedback "<教师意见>"] \
  [--mode fresh|append] [--max-rounds 10] --no-publish

# 交付归集：只留测试对话与剧本，清理运行目录
node "$TRAIN/scripts/run.mjs" finalize --run <运行目录> [--out-dir <交付根目录>] [--keep-evidence]
```

- 教师文档默认取 `run.json` 的 `docPath`；缺失时用 `--doc` 指定。
- 各端（含 DSH）测试默认 `good`；`guided` / `offtopic` / `all` 仅在当前用户明确要求时使用，
  `all` 不用于 `optimize` / `loop`。
- `run` / `loop` 代码默认仍会自动发布；未获当前发布许可必须保留 `--no-publish`，不得继承历史默认授权。
  只有自审通过、verify 无 FAIL 且当前发布已获准，才可去掉 `--no-publish`；loop/fresh 许可不能替代发布许可。
- `review` 不调用网络；`evaluate` 未加 `--confirm-evaluate` 会直接拒绝。

## review 产物

`review --run <目录>` 读取教师文档、`rubric.md`、`script.md` 与 `test-<档位>.txt`，输出：

| 文件 | 说明 |
| --- | --- |
| `review-input-<n>.md` | 完整自审包：教师文档 + 评价标准 + 当前剧本 + 模拟对话 + 阶段覆盖 + 自审清单 |
| `review-<n>.md` | 结论模板，首行写“结论：通过 / 不通过”，下面是问题清单与修改建议 |

`n` 按运行目录里已有的 `review-<n>.md` 递增。agent 审完后可以直接改 `script.md`
（改前复制 `script.before-review-<时间戳>.md`），也可以把自审文件交给 `optimize --feedback-file`。

## 自审要点

逐阶段核对：阶段目标是否与教师文档一致、关键动作是否完成、AI 是否剧透或直接给答案、
卡住时是否有引导、阶段切换是否断链、提示词是否含角色/场景/任务/结束条件、
口语词汇是否覆盖且表达地道、评价标准要求的行为能否在对话中被观察到。

对话与参考日志均为模拟测试数据，非真实学生作答或成绩，不得冒充真实学习记录。
未访问阶段须结合分支条件、预期路径与 `completed` 判定；正常未选分支不等于异常漏访。
不需要数字打分，也不要把自审结论伪装成系统分数。

## 优化接口

`POST {appBaseUrl}/api/training-optimize`，multipart：

| 字段 | 说明 |
| --- | --- |
| `trainingType` | `ability` 或 `oral`（Pro 不支持） |
| `teacherDocFile` | 教师文档 |
| `dialogueFile` | 当前档位的测试 TXT |
| `scriptMarkdown` | 当前 `script.md`（基础版也可能在 `config.md`） |
| `rubricMarkdown` | 有 `rubric.md` 时一并传入；口语不传 |
| `optimizationFeedback` | 自审结论（问题清单 + 修改建议）与教师意见 |
| `maxActions` | 单轮最多修订阶段数，默认 3 |
| `apiKey` / `apiUrl` / `model` | 复用 `config.llm` |

SSE 事件：`start` → `progress` → `complete`（`result`）或 `error`。
`result.optimized_script_markdown` 是修订后的完整剧本；`applied_actions` / `skipped_actions` / `warnings`
写进 `optimize-<时间戳>.json`。写盘前把原文备份为 `script.before-optimize-<时间戳>.md`
（基础版为 `config.before-optimize-*`），随后自动 normalize + validate。

## loop 规则

1. **必须先取得当前用户明确许可**：向用户说明 loop 会重新注入并重跑整条训练、耗时较长，同意后才加
   `--confirm-loop`；不要因为“顺便跑一下”就开启，也不能沿用历史任务默认授权。
2. 每调用一次只执行一轮：读取 `--review <自审文件>` 的结论。
3. 自审“通过”：`verify` 当前平台状态；只有自审通过、verify 无 FAIL 且当前发布已获准才发布。
   否则必须使用 `--no-publish`，结束并报告未发布；verify 有 FAIL 时禁止发布并停止。
4. 自审“不通过”：按自审建议优化 → 写回剧本 → normalize/validate → 当前获准的 fresh 重注入 → verify → 重测，
   然后停下，等 agent 对新对话再生成一轮自审；本轮不发布。
5. 达到轮次上限（默认 3，跨多次调用累计）停止。
6. 优化结果无变化、校验失败或回读 FAIL，立即停止并写明原因。
7. `loop` 的 fresh 重注入会替换目标现有阶段，必须取得当前独立覆盖许可后才加 `--confirm-fresh`；
   loop 许可不包含 fresh 许可，参数也不代表用户授权。`--mode append` 不清空。
8. 每轮记录写入 `run.json` 的 `loop` 字段，汇总在 `loop-report.md`：

| 轮次 | 自审结论 | 优化阶段 | 备注 |
| --- | --- | --- | --- |
| 1 | 不通过 | 2 | 阶段 2 引导不足，已重测 |
| 2 | 通过 | - | verify 通过；未获当前发布许可，未发布 |

## 系统 21 维评测（可选）

`POST {appBaseUrl}/api/evaluate-stream`，multipart：教师文档 + `test-<档位>.txt`。
固定 5 维 21 子维，SSE 事件：`start` → `progress` / `dimension_complete` → `complete` / `error`。
`report.total_score` 为总分，`issues` / `suggestions` 可作补充依据。

- 只有用户明确要求深度评分时才运行；必须加 `--confirm-evaluate`。
- 结果写 `evaluate-<档位>.json` 与 `evaluate.json`；不要用它驱动默认 loop。
- 返回 2 表示有脚本低于通过线，不是命令执行失败。

## 交付归集与清理

```bash
node "$TRAIN/scripts/run.mjs" finalize --run <运行目录> [--out-dir <交付根目录>]
```

默认输出 `<当前目录>/交付/<任务名>/`，只保留：

- `<任务名>-测试对话-good.txt`：交给评测系统的模拟对话脚本
- `<任务名>-剧本.md`：当前生效剧本

复制并校验大小一致后删除运行目录（`run.json`、`verify.json`、`review-*`、备份、测试报告、临时脚本一并删除）。
只删运行目录，不碰教师文档目录和平台内容。

- `--out-dir <目录>`：交付根目录，默认 `<当前目录>/交付`
- `--keep-evidence`：只导出，不删运行目录
- `--allow-missing-test`：没有测试对话时只交付剧本
- `run` 与自审通过的 `loop` 会自动执行同样的清理；`--no-cleanup` 关闭，`--keep-evidence` 保留现场

清理后不能从运行目录续跑；还要继续调优就先保留现场。

## 判定与排障

- `review` 报缺少测试脚本：在当前测试许可内先跑 `test --run <目录>`。
- 自审材料过大：直接读关键文件（`script.md`、`test-<档位>.txt`、教师文档），不要重复粘贴。
- 优化后仍无改善：看 `optimize-*.json` 的 `skipped_actions` 与 `warnings`，
  通常是把“优化一下”这类笼统意见当成了修改建议；补到具体阶段与改法。
- 不要为追求分数改评分标准或伪造对话；优化只改剧本。
