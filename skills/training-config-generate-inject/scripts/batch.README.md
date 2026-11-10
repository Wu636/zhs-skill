# 独立训练任务限并发执行器（本地调度层）

入口：`node scripts/batch.mjs --manifest /绝对路径/jobs.json --output /绝对路径/新的批次目录 --dry-run`

仅调用同目录既有 `run.mjs`，使用 Node `spawn`、`shell:false`，不自己实现平台接口、不读配置或凭据。此次开发与测试不执行真实业务。执行真实批次时，由既有 CLI 读取所选客户端的配置。

## 授权与限制（运行前读）

- **manifest grants 是当前人类授权的记录，不是授权来源。** 本地技能优化许可不包含生成付费请求、拉取平台、注入、模拟测试或 fresh 覆盖许可。Agent 必须先取得当前任务相应授权，才可填写 grants 并运行；不能自行把字段设为 true/添加 grant 绕过确认。
- 支持：`generate / plan / pull / normalize / validate / inject / verify / incremental / prepare-images / test / review / optimize`。不支持 `run / loop / publish / create-task / evaluate / finalize / doctor` 或任意命令。
- 不自动发布、不 loop、不清理、不自动重试。inject 必须显式指定 `--mode fresh|append`，缺少 mode 直接拒绝；不继承配置的 fresh 默认值，也不把替换意图悄悄改成追加。fresh 必须同时有 `inject`、`fresh` grants 和 `--mode fresh --confirm-fresh`；仍须人类独立确认覆盖及附件/素材影响。append 也是真实写入，不应在脏状态或需要替换时盲目使用。
- 注入前仍必须完成 normalize → validate 及内容审核；本执行器不是业务完整性检查的替代品。可以用 dependsOn 编排前置步骤，失败阻断后续。回读、人工自审、发布授权仍遵循技能规则。
- 每个 job 明确 `--type pro|ability|oral`；Pro 不支持 plan/pull/test/optimize/incremental/prepare-images。平台命令必须显式 `--target-url`，且类型匹配，不读取隐含 target/config 推断目标。只接受教学中心 HTTPS URL、单一 trainTaskId 和白名单查询字段。
- 不接受 manifest 配置/env/凭据字段，不允许 `--config / --cookie / --authorization / --llm-key / --app-url / --api-base / --allow-errors` 等；未知字段、重复参数和 `--flag=value` 均拒绝。客户端在 manifest 顶层明确指定，不能每 job 覆盖。
- 子进程不继承 `TRAINING_CONFIG`（防止别端自定义配置覆盖），也不继承 `NODE_OPTIONS`；其他既有宿主环境按 CLI 原行为继承。因此调用方须使用已核对的当前客户端环境。本执行器不复制/显示这些值。
- 输出目录与 run/out/doc/feedback-file 使用绝对路径，不能位于技能安装树；不搬迁已有技能树内 runs。新批次目录不能已存在或与 job 输出/锁定目录重叠。
- 不在 manifest、教师材料、反馈中放入凭据。summary 不存原始 argv、目标 URL、异常消息、配置或凭据；子进程 stdout/stderr 分开保存为 0600 文件，对明显凭据标记整行脱敏。这是防御性过滤，不是任意秘密检测器，不能保证识别教师文本里无标记的秘密。

## Manifest v1

```json
{
  "version": 1,
  "client": "dsh",
  "concurrency": 2,
  "jobs": [
    {
      "id": "a-normalize",
      "args": ["normalize", "--type", "ability", "--run", "/project/runs/a"]
    },
    {
      "id": "a-validate",
      "args": ["validate", "--type", "ability", "--run", "/project/runs/a"]
    },
    {
      "id": "b-validate",
      "args": ["validate", "--type", "oral", "--run", "/project/runs/b"]
    }
  ]
}
```

上述绝对路径是示例，须替换成本次独立项目目录。id 唯一、仅 ASCII 字母数字/短横线/下划线，最多 64 字符。每个 job 的 args 是字符串数组，第一个元素是命令。不能放 shell 拼接表达式作为执行方式。

- generate/plan/pull 必须使用 `--out <绝对目录>`；其余使用 `--run <绝对目录>`，不能依赖 CLI 默认目录。
- generate/plan 必须提供 `--doc`；test 也必须提供 `--doc`，保持教师材料口径明确。**批量测试推荐加 `--no-doc-export`**：保留各自 run 目录内标准 TXT/JSON，跳过教师材料目录的额外复制，使同一教师材料对应的独立训练也能并发。该开关需要已更新的 run.mjs / lib/test-run.mjs 支持。
- grants 为字符串数组：联网命令必须有 `network`；inject 额外需 `inject`；fresh 额外需 `fresh`；test 额外需 `test`。
- test 默认 good；guided/offtopic/all 必须额外具有 `student:guided` / `student:offtopic` / `student:all` grant。all 仍由既有 CLI 内部串行档位，本执行器只负责跨 job 并发。
- `dependsOn: ["earlier-job-id"]` 可选，只能引用更早 job，避免环路。
- 可用选项按命令白名单：公共 type/timeout；生成 doc/name/advice/model/flow；注入 mode/confirm-fresh/no-cover/no-background/image-concurrency/image-cache/image-strategy；测试 doc/student/max-rounds/no-reference/no-doc-export/model；优化 feedback/feedback-file/max-actions/model/dry-run。准确全集见 batch.mjs 的 FLAGS。

inject 可传 `--image-concurrency 1..8` 和 `--image-cache reuse|refresh|off`，由更新后的既有 CLI 消费。batch 不自行生图或读取缓存。inject 和 prepare-images 另支持 `--image-strategy preserve|missing|regenerate`（主 CLI 默认 regenerate）：preserve 保留线上已有图、缺失也不生成；missing 仅补缺失图；regenerate 按输入及 cache 策略准备图。**缓存 reuse 不等于保留线上旧图**；regenerate+reuse 可以重用同输入缓存，若要强制生成新图，应指定 regenerate+`--image-cache refresh`。batch 不重新解释这些业务策略，由更新后的 CLI 执行。跨任务并发与单任务图片并发会叠加，设置时需考虑总请求数；这些参数不豁免注入/覆盖授权。

需要显式远程 job 时，其字段结构例如（**只有已取得本次授权才可实际运行**）：

```json
{
  "id": "a-verify",
  "grants": ["network"],
  "args": ["verify", "--type", "ability", "--run", "/project/runs/a", "--target-url", "https://hike-teaching-center.polymas.com/agent-course-full/COURSE/ability-training/create?trainTaskId=TASK&libraryId=LIBRARY"]
}
```

## incremental 增量更新

args 形态：`["incremental", "--run", "/project/runs/a", "--type", "ability", "--target-url", "<真实训练URL>", "--action", "snapshot|plan|preflight|apply"]`。只支持 ability/oral，始终需要显式目标与运行目录，遵守相同目标/路径顺序锁。

- `snapshot`：pull 后、修订前获取基线；需要 `network` grant。
- `plan`（默认）：依据已有 baseline 文件本地规划；不需要 network grant。**实际执行仍通过 run.mjs 加载本端配置，因此不是“不读凭据的 dry-run”。** 只有 batch 自身 `--dry-run` 才保证不启动 CLI、不读配置。
- `preflight`：回查目标确认增量计划可执行；需要 `network` grant。
- `apply`：需要 `network` + `inject` grants，并显式 `--yes`。不是 fresh，不接受 `--mode` 或 `--confirm-fresh`。依然必须有当前人类对该目标写入的明确授权；grants 和 yes 不能代替授权。
- `--yes` 仅 apply 可用，其他 action 携带即拒绝。增量更新约束、基线完整性与业务回读由主 CLI 负责；批次仅调度，不自动生成缺失基线、不自动回退到 fresh。

## prepare-images 独立素材准备

仅 ability/oral：`["prepare-images", "--run", "/project/runs/a", "--type", "ability", "--target-url", "<真实训练URL>", "--yes", "--image-concurrency", "2", "--image-cache", "reuse", "--image-ids", "cover,background:1"]`。

- 必须具备 `network` + `images` grants 和显式 `--yes`。会生成并上传素材，因此仍须当前人类授权；不写训练节点，不要求 inject grant，也不自动发布/覆盖节点。
- 可选 `--image-concurrency 1..8`、`--image-cache reuse|refresh|off`、`--image-strategy preserve|missing|regenerate`、`--timeout <秒>`。`--image-ids` 是逗号分隔的 `cover` 或 `background:<从1开始的正整数>`，不接受空项、重复项、空格或其他名称；省略时由主 CLI 按其默认素材范围处理，执行前须核对范围。
- 不支持 job 参数 `--dry-run`；需预检时使用 **batch 顶层 `--dry-run`**，保证不启动任何业务子进程。incremental job 暂也不允许 `--dry-run`，避免与其 action=plan 混淆。
- 使用现有 run/target 锁、依赖失败阻断、独立日志，不自动重试素材上传。素材准备后是否应用到节点由后续明确获准的步骤负责。

## 调度与失败语义

- 默认并发 2；manifest 或 `--concurrency` 可配置 1..32，CLI 覆盖 manifest。不同目标/独立目录的 job 不等待整批，可立即使用空闲槽位。
- 同 trainTaskId 或同/父子目录（含现有 symlink 别名）自动添加先后依赖，按 manifest 顺序排队。前一个失败，冲突后继标记 blocked，避免在脏状态继续写入。
- test 未加 `--no-doc-export` 时，把教师文档所在目录也加入锁，因为 CLI 按平台任务名称导出 TXT，可能同名。**推荐批量 test 加 `--no-doc-export`**，这时仅锁各自 run 目录和目标；不同训练使用同一份教师文档仍可并发。不加该开关且需要额外复制时，使用独立教师材料目录。相同目标或 run 仍会串行，不因关闭额外复制而放开冲突写入。
- 并发锁限于**当前一个 batch 进程**。不要同时运行多个批次或其他工具操作相同目标/目录；不提供跨进程/跨设备分布式锁。调度期间不要改目录符号链接。
- 每个 job 一个子进程，零退出码记 succeeded，非零/启动异常记 failed；互不依赖的 job 继续执行，不自动重试写入。
- `succeeded` 仅代表 CLI 退出码为零，不自动等价于业务验收通过（例如仍需检查测试 completed、review结论及 verify 结果）。
- `--job-timeout <秒>` 默认 3600（1..86400），超过后终止子进程，5 秒后强制终止；SIGINT/SIGTERM 停止排队并终止当前子进程。**终止本地进程不保证取消服务端任务**，timed_out/cancelled 后先回查，不直接重跑。
- 每次状态变化原子替换 summary.json（同目录临时文件→rename）。保留每 job 状态、退出码、起止时间、耗时和日志路径；目录 0700，summary/log 0600。不复制 manifest，不在控制台打印业务输出。
- 失败分支需要独立回读时：保持当前批次默认失败阻断不变；待原批次相关子进程结束、确认没有仍在执行的服务端写入后，在**新的批次输出目录**提交显式目标的 verify job，不携带原失败任务的 dependsOn。这样可以回读原目标/运行目录且不会重试写入。不能通过伪造目标或改路径绕过当前批次依赖。当前没有 run-on-failure/always 开关。
- 不自动续跑；重复执行同 output 目录会拒绝。进程崩溃时 summary 可能保留 running，需要先人工回查服务端，再创建新的明确批次，不把它当作失败重试。

## dry-run 与退出码

`--dry-run` 只校验 manifest、路径/冲突、授权记录，写 planned summary；不 spawn、不读取配置/凭据、不联网、不创建 job 业务目录。它不能证明登录有效、平台可写或教师已经授权。

CLI 成功/planned 为 0；任何 job failed/blocked/cancelled/timed_out 或 manifest 错误为 1。CLI 错误信息刻意不回显参数值。可通过导出的 validateManifest/executeBatch 做本地测试，但不要把 manifest 当作不可信来源的代码执行器。

## 离线验证

```bash
node --test "$HOME/.agents/skills/training-config-generate-inject/tests/batch.test.mjs"
```

测试使用内存 mock runner 与临时本地目录，不启动 run.mjs、不访问平台、不读取配置凭据。覆盖限并发、冲突排队/符号链接、独立失败/依赖阻断、dry-run、安全白名单、授权闸门、导出目录锁及输出隔离。
