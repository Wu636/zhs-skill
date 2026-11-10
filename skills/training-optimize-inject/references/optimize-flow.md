# 优化流水线契约

本文件记录 `training-optimize-inject` 调用的基础技能命令、字段、产物与判定规则。命令实现以基础技能源码为准，这里只写编排需要的部分。

前置：按 `SKILL.md`「共享代码与本端数据」设 `TRAIN` / `OPT` 与 `TRAINING_CLIENT`，先用 `node "$TRAIN/scripts/run.mjs" paths` 确认本端；`--out` / `--run` 必须是本端数据根下或用户指定的独立绝对目录，禁止写入共享树。发布类命令（`publish`、不带 `--no-publish` 的 `run`/`loop`、`save-config.mjs --yes`）只在当前任务明确获准时执行。

默认流程**不使用系统 21 维评测**：测试后由 agent 阅读对话脚本自审，直接改剧本或按自审结论调用优化接口。`loop` 必须取得用户明确许可，并按自审结论一轮一轮执行。

## 命令与关键字段

### pull

```bash
node "$TRAIN/scripts/run.mjs" pull --target-url <训练链接> --type ability|oral --out <运行目录>
```

- 读取平台 `queryConfiguration`、`queryScriptStepList`、`queryScoreItemList`。
- 用应用自带解析器的 `serializeTrainingScriptMarkdown` 反向生成 `script.md`，保证“拉取 → 校验 → 注入”使用同一套解析规则。
- 产出：`script.md`、`rubric.md`（口语为空）、`teacher-doc.generated.md`、`target.json`、`pull.json`、`run.json`。
- `pull.json` 字段：`type`、`target{targetUrl,trainTaskId,courseId,type}`、`taskName`、`stepCount`、`scoreItemCount`、`vocabCount`、`resourceCount`、`coverCount`、`generatedDocPath`、`warnings`。
- 阶段数为 0 时自动重试一次；仍为 0 视为平台未初始化。

### test

```bash
node "$TRAIN/scripts/run.mjs" test --run <运行目录> --type ability|oral --student good --doc <教师文档> --max-rounds 10
```

- 调用本地 `/api/training-test-run`，模拟学生走完整条训练。
- 产出：`test-good.txt`（评测可解析的对话）、`test-good.json`、`test-report.md`。
- 不做发布校验，未发布训练同样可以测试。

### review

```bash
node "$TRAIN/scripts/run.mjs" review --run <运行目录> --student good
```

- 纯本地汇总，不调用网络：读取教师文档、`rubric.md`、`script.md`、`test-<student>.txt`、`test-<student>.json`。
- 产出 `review-input-<n>.md`（完整自审包）与 `review-<n>.md`（结论模板）。
- `n` 按已有 `review-<n>.md` 递增。
- agent 阅读后把“结论：通过/不通过”、问题清单、修改建议写进 `review-<n>.md`；
  也可以直接修改 `script.md`，改前复制 `script.before-review-<时间戳>.md`。

### optimize

```bash
node "$TRAIN/scripts/run.mjs" optimize --run <运行目录> --type ability|oral --student good \
  --feedback "<教师意见>" --feedback-file <review-n.md> --max-actions 3
```

- 调 `/api/training-optimize`，反馈由自审结论（问题清单 + 修改建议）与教师意见组成。
- 修订稿写回 `script.md`（原稿备份为 `script.before-optimize-<时间戳>.md`），随后 normalize + validate。
- 不下发 `evaluate` 的 21 维结果。

### loop

```bash
node "$TRAIN/scripts/run.mjs" loop --run <运行目录> --type ability|oral --student good \
  --doc <教师文档> --review <review-n.md> --feedback "<教师意见>" \
  --max-iterations 3 --max-actions 3 --mode fresh \
  --confirm-loop --confirm-fresh --timeout 1800 --no-publish --no-cleanup
```

默认带 `--no-publish`；只有当前任务已获发布授权，才可去掉该参数。

默认带 `--no-cleanup`：loop 通过后仍保留运行目录，供 `summarize` / `finalize` 补料；交付前手工执行一次 `finalize`。

**前置条件**：必须先向用户说明 loop 会重新注入并重跑整条训练、耗时较长，取得明确同意后才加 `--confirm-loop`；没有自审结论文件不要开启。

每调用一次只执行一轮：

1. 读取 `--review` 的首行结论；
2. 自审“通过” → `verify` 当前平台状态，无 FAIL 且当前已获发布授权则发布，退出 0；未获授权则停在已注入状态并报告未发布；
3. 自审“不通过” → 调用优化接口修订剧本并备份；
4. `normalize` 后 `validate`，有 error 停止；
5. `inject --mode fresh --confirm-fresh` 重建阶段；
6. `verify` 回读，FAIL 停止；
7. `test` 重新生成对话，然后停下等待下一轮自审。

停止条件：

- 自审通过；
- 达到 `--max-iterations`（默认 3，跨多次调用累计）；
- 优化结果为空、校验失败、回读 FAIL。

发布：

- 自审通过、回读无 FAIL，且当前任务明确获准 → 才可执行 `publish --yes`；
- 未获当前授权 → 保留 `--no-publish`，注入结果保留，报告写明未发布；
- 未通过 → 不发布，保留最后一次注入结果，报告写明未发布。

退出码：`0` 自审通过；`2` 本轮不通过或需要继续（属于正常业务结果）；`1` 执行错误。

## 运行目录产物

| 文件 | 来源 | 用途 |
|---|---|---|
| `script.md` | pull / optimize | 当前剧本，注入与报告的事实来源 |
| `script.before-optimize-*.md` | optimize | 每轮修订前备份 |
| `rubric.md` | pull | 评价标准，保持平台原样 |
| `teacher-doc.generated.md` | pull | 无原始文档时的评测兜底 |
| `pull.json` | pull | 拉取摘要与风险提示 |
| `validate.json` | validate | 结构校验结果 |
| `inject.result.json` / `inject.events.jsonl` | inject | 注入结果与过程事件 |
| `verify.json` | verify | 回读比对，含 FAIL 明细 |
| `publish.json` | publish | 发布结果 |
| `test-good.txt` / `test-good.json` / `test-report.md` | test | 对话脚本与测试报告 |
| `review-input-<n>.md` / `review-<n>.md` | review | 自审材料与 agent 结论 |
| `optimize-*.json` | optimize | 单轮优化结果 |
| `loop-report.md` | loop | 迭代记录表（自审结论，无系统分数） |
| `run.json` | 全部命令 | `test`、`review`、`optimize`、`loop`、`published` 等状态 |
| `优化报告.md` | summarize | 内部报告，仅供交付前自查，不随交付保留 |

以上均为运行目录内的过程产物，交付时只保留两件：`<训练名>-剧本.md` 与 `<训练名>-测试对话-good.txt`。

## 交付归集与清理

```bash
node "$TRAIN/scripts/run.mjs" finalize --run <运行目录> [--out-dir <交付根目录>] [--keep-evidence]
```

- 默认交付根目录为当前工作目录下的 `交付/`，输出到 `交付/<训练名>/`；`--out-dir` 可改根目录，不能指向运行目录内部。
- 复制并逐一校验大小后，删除整个运行目录；`--keep-evidence` 只复制不删除，用于后续继续迭代。
- 运行目录缺少 `test-<student>.txt` 时默认拒绝清理；确实只需要剧本时加 `--allow-missing-test`。
- `run` 与自审通过的 `loop` 默认自动执行同样的归集（`--no-cleanup` 关闭，`--keep-evidence` 保留证据）。
- 删除后无法续跑：需要再迭代时保留运行目录或重新 `pull`。

## 判定规则

- 判定依据是 `review-<n>.md` 的“结论：通过 / 不通过”，不做数字评分。
- 学生档位：默认 `good`；`all` 不允许用于 optimize/loop。
- 不使用 `/api/evaluate-stream` 的 21 维评测；只有用户明确要求时才单独运行 `evaluate --confirm-evaluate`。
- 报告中的自审结论、轮次、发布状态只能取自 `review-*.md`、`run.json.loop`、`publish.json`。
- 不编造分数；报告中出现数字分数即视为错误。

## 已知边界

- 只支持基础版与口语；Pro 无 HTTP 测试。
- `pull` 不还原流程图分支连线与阶段附件；封面/背景会按注入配置重新生成。
- 优化接口只改剧本阶段，不重写评分标准。
- loop 耗时较长，默认关闭；必须先取得用户明确许可。
- `finalize` 会删除整个运行目录，删除后不能续跑下一轮；要继续迭代就加 `--keep-evidence`。
- agent 直接修改 `script.md` 后，必须重新 normalize → validate → inject → verify → test，不能只改文件就交付。
