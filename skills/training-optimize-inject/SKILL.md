---
name: training-optimize-inject
description: "能力训练优化编排：教师给出原始能力训练链接和修改意见，自动从平台拉取现有剧本与评价标准，按意见修订剧本，重新注入并回读校验，模拟学生完成整条训练，由执行技能的 agent 自审对话脚本并直接调整剧本（不使用耗时的系统 21 维评测），回读与自审通过且当前任务明确获准后发布并交付可直接用于评测的对话脚本与优化报告。loop 迭代必须取得用户明确许可，最多 3 轮。覆盖基础版能力训练和口语训练；Pro 暂不支持 HTTP 自动测试。关键词：能力训练优化、训练调优、剧本修改、按意见重注入、闭环迭代、测试脚本、agent 自审、Polymas 能力训练。"
---

# 能力训练优化与重注入

教师已在平台上搭好一份能力训练，但对剧本不满意。本技能把“拉配置 → 按意见修订 → 重注入 → 回测 → agent 自审 → 调整 → 交付”串成一条可复跑流水线。

本技能是编排层，生成/注入/测试/自审的具体规则都在基础技能 `training-config-generate-inject` 里。执行前先读它的 `SKILL.md`，尤其是“自审、优化与迭代”一节和硬性规则。

## 适用与不适用

适用：

- 基础版能力训练（`ability`）和口语训练（`oral`）已搭建、已发布或未发布，需要按教师意见修改剧本。
- 修改后要证明效果：模拟学生跑完整条训练，agent 对照教师文档与自审清单确认没有明显问题，对话脚本可交付。
- 上一轮仍有问题，需要带着累计意见继续修改。

不适用：

- Pro 能力训练（Pro 只有 WebSocket 测试，本技能 v1 不做自动回测）。
- 从零生成一份新训练（用 `training-config-generate-inject`）。
- 只调评分标准、不动剧本（本技能不改评分标准；评价标准从平台原样拉取后回注）。
- 批阅类智能体（用 `polymas-grading-pipeline`）。

## 前置条件

1. 共享代码位于 `~/.agents/skills/training-config-generate-inject` 与 `~/.agents/skills/training-optimize-inject`；配置、凭据、runs/tmp 按端隔离，具体映射见基础技能“共享代码与本端数据”。本端 `config/config.json` 已配置 Cookie（0600、gitignored），不跨端复制。
2. 本地 Agent_Evaluation 应用可访问（默认 `http://localhost:3000`），且已配置 LLM。
3. 教师提供原始训练链接，链接里必须带 `trainTaskId`，路径含 `/ability-training/` 或 `/language-training/`。
4. 技能维护与安装不构成平台操作授权；业务执行前须核对当前许可，fresh、loop、保存并发布分别确认。

```bash
TRAIN="$HOME/.agents/skills/training-config-generate-inject"
OPT="$HOME/.agents/skills/training-optimize-inject"
CLIENT="<根据当前宿主填写 qoder-cn|qoder|dsh|hermes>"
case "$CLIENT" in
  qoder-cn|qoder|dsh|hermes) export TRAINING_CLIENT="$CLIENT" ;;
  *) exit 1 ;; # 未知宿主停下，不猜测、不回退其他端
esac
node "$TRAIN/scripts/run.mjs" paths
```

`paths` 只输出 `client/configPath/runsRoot`，不读配置、不联网；核对归属后才继续。共享根入口必须明确 client；旧端脚本入口可推断。`run.mjs` 与 `save-config.mjs` 均支持 `--client` / `TRAINING_CLIENT`，以及独立绝对配置路径 `--config` / `TRAINING_CONFIG`；使用覆盖项时也须通过 `paths` 核对，不得借用其他端配置。

`doctor` 需要网络，仅在当前获准业务操作时运行 `node "$TRAIN/scripts/run.mjs" doctor`，不通过就停；仅验证本地安装时使用 `paths`。本编排技能不直接读取 Cookie、不猜凭证、不直连平台。

## 输入清单

| 输入 | 必填 | 说明 |
|---|---|---|
| 原始训练链接 | 是 | 必须带 `trainTaskId`；不要传编辑页之外的分享链接 |
| 教师修改意见 | 是 | 逐条写清改哪里、改成什么；一句话意见会导致优化不可控 |
| 教师任务文档 | 否 | 有原始任务文档时强烈建议提供，自审口径更准 |
| 类型 | 否 | 从链接自动判断；判断不出时显式传 `--type ability\|oral` |
| 学生档位 | 否 | 各端（含 DSH）默认 `good`；`guided` / `offtopic` / `all` 须当前明确要求 |
| 自审轮次上限 | 否 | 默认 3；只有用户明确同意开启 loop 时才使用 |

无原始任务文档时，技能会用平台配置合成 `teacher-doc.generated.md` 作为自审参考。这是兜底，必须在报告里注明，不能当正式任务文档用。

## 执行模式与并发（优先减少重复工作）

- **定点修订**：教师意见明确到阶段/行为且不要求修订前后对比时，拉取并校验后可直接按意见修订，不强制跑完整基线；记录“未执行修订前基线”。修改后仍必须完整复测并自审，不能编造前后效果提升。
- **诊断优化**：原因不明、断链、卡阶段或教师要求前后对比时，按下面完整基线流程执行。
- 定点修订没有测试脚本时不要调用 `review`；直接备份并编辑剧本，或仅以教师反馈调用 `optimize --feedback`。完整复测后再生成 review 材料。
- 多个已明确授权的训练优先跨任务并发；各自独立运行目录与目标 ID，同目标的修改/测试顺序执行。使用基础技能新增的 `scripts/batch.mjs`，具体清单格式见 `scripts/batch.README.md`；不通过多个 shell 无锁抢写同一运行目录。
- 一个训练就绪后即可进入下一阶段，不等待其他训练全部完成。教师内容判断与 fresh/发布许可仍是任务级边界；一个任务失败不重跑其他成功任务。
- 优化前后内容完全一致时不重新注入，记录“无变化”；不能仅凭本地无变化声明平台已同步，仍按目标状态回查。
- 仅修改阶段开场白/描述/提示词时优先使用下文增量路径：保留原节点、背景、附件、数字人、连线和评分，不生图、不清空重建。超出支持范围拒绝增量，不能自动降级fresh。
- 完整注入支持图片限并发准备、同会话同任务短期缓存和 `--image-strategy preserve|missing|regenerate`。仅剧本修改不得无故重生图片；无法增量而确需fresh时，在可精确映射资源前提下优先preserve。preserve只保留封面/背景，不迁移阶段附件；`--no-background` 不等于保留。

### 优先增量路径（基础版/口语，文本字段）

1. `pull` 后、修改之前运行 `incremental --run "$RUN" --target-url "$TRAIN_URL" --action snapshot`，保存完整节点/连线及解析基线。已有基线不覆盖。该命令只读平台，但需当前读权限。
2. 按意见编辑剧本，normalize + validate；运行 `incremental --run "$RUN" --target-url "$TRAIN_URL" --action plan` 查看本地差异。plan不联网，但CLI仍加载当前端配置。禁止改评分标准。
3. 当前明确获准修改目标后，执行 `incremental --run "$RUN" --target-url "$TRAIN_URL" --action apply --yes`。只允许 prologue/description/llmPrompt；同名同序、阶段数量、词汇、拓扑和其他字段必须不变。写前检查完整快照、逐项写前检查、写后回读；不是原子CAS，执行期间不要由其他人/任务同时编辑该目标。
4. 成功后仍执行 verify → 完整test → review → 获准后保存发布。不需fresh覆盖许可，因为没有清空动作，但增量写入本身仍需当前修改许可。
5. 失败保留 `incremental.apply.json` 的applied证据，不自动重试/全量重建。解析器trim造成基线不一致也会保守拒绝；先核实差异，不能硬覆盖。需要词汇/阶段增删/改名/连线变化时改走经独立确认的完整注入。
6. 增量不会自动滚动基线。下一轮修改前在新的独立run重新pull/snapshot，避免拿旧基线覆盖教师后续修改。

## 总体流程

| 步骤 | 动作 | 产出 | 结束条件 |
|---|---|---|---|
| 0 立项 | 确认 client、paths；获准后 doctor、类型判定、建独立运行目录 | 运行目录 | 路径归属正确、依赖与凭证可用；本地安装检查不运行 doctor |
| 1 拉配置 | `pull` | script.md / rubric.md / teacher-doc.generated.md / pull.json | 阶段数与平台一致，校验通过 |
| 2 基线测试（诊断模式） | `test` | test-good.txt / test-good.json | 模拟学生完成预期分支路径，正常未选分支不算异常漏访 |
| 3 agent 自审 | `review` + agent 阅读对话 | review-input-1.md / review-1.md | 写出“通过/不通过”、问题与修改建议 |
| 4 修订与回测 | 直接改剧本或 `optimize --feedback-file` → normalize/validate → 当前获准 inject → verify → test | 新 script.md、新 test-good.txt | fresh 单独确认；校验无 error、回读无 FAIL、测试完成 |
| 4.5 保存并发布（有条件） | `node "$OPT/scripts/save-config.mjs" --target-url "<目标训练链接>" --yes`；CLI 已完成则不重复 | 保存并发布结果或明确未发布 | 回读/自审符合且当前明确授权；先 editConfiguration 后 publishAbilityTrain，回读 `unpublishedChanges=0` |
| 5 继续迭代（可选） | `loop --confirm-loop --review ... --no-publish` | 一轮修订与重测 | loop 独立获准；发布另行授权后才可去掉 no-publish；达到轮次上限 |
| 6 报告 | `summarize.mjs` | 优化报告.md | 报告与运行目录一致 |
| 7 交付 | 汇总路径 | 测试脚本 + 报告 | 教师可复核 |

沿用上述共享 `TRAIN` / `OPT` 与已核实的 `TRAINING_CLIENT`。运行目录使用独立绝对路径，按端隔离，每次新建、不复用、不覆盖，**不得在任何技能树下**（旧端既有运行记录不迁移）：

```bash
RUN_BASE="$HOME/.local/state/training-optimize/$CLIENT/runs"
mkdir -p "$RUN_BASE"
RUN="$(mktemp -d "$RUN_BASE/$(date +%Y%m%d-%H%M%S)-XXXXXX")"
```

后续命令始终显式传 `--run "$RUN"` 或 `--out "$RUN"`；未指定目录时基础 CLI 默认写本端 runs，不得写共享代码树。

## 0. 立项

1. 判断类型：链接含 `/language-training/` → `oral`；含 `/ability-training/` → `ability`；含 `/ability-training-pro/` → Pro，停下说明不支持自动回测。
2. 读教师意见，确认能落到具体阶段或具体行为。意见太笼统（如“优化一下”）时先让教师补充，不要自己编修改范围。
3. 记录本轮将要重建的内容：附件资源数、封面/背景素材数来自 `pull.json`，报告里必须原样带上。
4. **不要预设要跑 loop**：先按“执行模式与并发”选择定点修订或诊断流程；loop 只有在用户明确同意后才使用。

## 1. 拉取现有配置

```bash
node "$TRAIN/scripts/run.mjs" pull \
  --target-url "$TRAIN_URL" \
  --type "$TYPE" \
  --out "$RUN"
```

检查：

- `pull.json.stepCount > 0`；为 0 时先让教师在平台打开一次工作流编辑页，再重试（脚本已内置一次自动重试）。
- `script.md` 阶段数与平台一致；口语训练 `vocabCount` 应与平台重点词汇数量一致。
- `pull.json.warnings` 里关于附件、封面/背景的提示要写进最终报告。

先评估文本增量路径，不默认fresh。确需 `fresh` 才告知：它重建阶段，附件不迁移；封面/背景由image-strategy决定，preserve映射失败会拒绝而不是猜测。教师明确接受实际影响后再执行完整注入；不接受时不得强行fresh。

```bash
node "$TRAIN/scripts/run.mjs" validate "$RUN"
```

校验必须无 error。警告可以带进注入，但要在报告里列出来。

## 2. 基线测试

本节用于诊断模式；定点修订可跳至 3.2 按教师意见修改，再执行 3.3 完整复测和 3.1 自审。诊断模式先让模拟学生跑一遍当前线上/草稿版本，拿到修订前的对话脚本：

```bash
DOC="${TEACHER_DOC:-$RUN/teacher-doc.generated.md}"

node "$TRAIN/scripts/run.mjs" test \
  --run "$RUN" \
  --type "$TYPE" \
  --student good \
  --doc "$DOC" \
  --max-rounds 10
```

- 产出 `test-good.txt` 与 `test-good.json`，后续自审与复测都以它为输入。
- 对话及参考日志仅为模拟测试数据，非真实学生作答或成绩，不得冒充真实学习记录。
- `completed=false` 或异常漏访时先看 `test-report.md` 与运行日志；阶段覆盖不全不自动判失败，正常未选条件分支不等于异常漏访，须对照预期路径与分支条件判定。
- 用生成的教师文档时，报告里写明“自审口径基于平台合成文档”。

## 3. agent 自审与修订

### 3.1 生成自审材料

```bash
node "$TRAIN/scripts/run.mjs" review --run "$RUN" --student good
```

- 产出 `review-input-<n>.md`：教师文档、评价标准、当前剧本、模拟对话、阶段覆盖与自审清单。
- 产出 `review-<n>.md`：结论模板。agent 必须自己阅读对话与剧本，**不要调用系统 21 维评测**。
- 逐阶段检查：目标是否达成、关键动作是否完成、AI 是否剧透/直接给答案、卡住时是否有引导、阶段切换是否断链、口语词汇是否覆盖、评价标准要求的行为能否被观察到。

### 3.2 落盘结论并修改

把结论写进 `review-<n>.md`：

```markdown
结论：通过

## 问题清单
...
## 修改建议
...
```

不通过时，二选一：

1. **agent 直接改** `script.md`：改前复制 `script.before-review-<时间戳>.md`，只改阶段内容，不动评分标准。
2. **调用优化接口**：

```bash
node "$TRAIN/scripts/run.mjs" optimize \
  --run "$RUN" \
  --type "$TYPE" \
  --student good \
  --feedback "$FEEDBACK" \
  --feedback-file "$RUN/review-<n>.md" \
  --max-actions 3
```

`optimize` 每轮会自动备份为 `script.before-optimize-<时间戳>.md`，随后 normalize + validate。

### 3.3 重注入与复测

优先按上文增量路径执行。以下是**增量不适用且已单独获准fresh**的替代流程，不是默认执行路径：

```bash
node "$TRAIN/scripts/run.mjs" normalize --run "$RUN"
node "$TRAIN/scripts/run.mjs" validate "$RUN"
node "$TRAIN/scripts/run.mjs" inject --run "$RUN" --type "$TYPE" --mode fresh --confirm-fresh --image-strategy preserve
node "$TRAIN/scripts/run.mjs" verify --run "$RUN"
node "$TRAIN/scripts/run.mjs" test --run "$RUN" --type "$TYPE" --student good --doc "$DOC" --max-rounds 10
```

- 校验有 error 立即停止，不要 `--allow-errors` 硬注。
- 回读有 FAIL 立即停止，不要发布。
- 复测完成后回到 3.1 生成下一轮自审材料。
- 上述 fresh 示例只有当前任务已独立明确获准覆盖才可执行；`--confirm-fresh` 不代表技能自带授权。仅限教师给定的 `trainTaskId`，须告知并确认附件不迁移、封面/背景的实际策略；loop 或发布许可不能代替 fresh 确认。

### 3.4 保存并发布（回读/自审符合且当前获准才执行）

平台训练编辑页右上角“保存”由先 `editConfiguration`、后 `publishAbilityTrain` 组成，包含对外发布，不能当作普通本地保存。仅写入阶段、连线、评分标准而未完成保存发布时，教师端课程资源库列表可能看不到训练。

只有回读无 FAIL、自审通过且用户已在当前任务明确确认目标的保存与发布，才执行真实调用；未获准不执行，也不因“必做”补授权：

```bash
node "$OPT/scripts/save-config.mjs" --target-url "<目标训练链接>" --yes
```

- 沿用 `TRAINING_CLIENT`，或显式 `--client`；独立配置用 `--config` / `TRAINING_CONFIG`，不得跨端读取凭据。
- `save-config.mjs --dry-run` 不联网也不读配置，只做预检，不能证明保存成功；真实保存需要 `--yes`，参数不能替代前置确认。
- `courseId` / `libraryId` 一律从目标训练链接读取，**不能用 `config.polymas.courseId`**（配置里可能是别的课程）。
- 脚本回读 `queryConfiguration`，要求 `unpublishedChanges=0`；不为 0 时以失败退出，不要口头声称已保存。
- 通过训练优化页 `/api/training-refine` 的 `import` 注入后，也仅在上述条件满足时补执行。
- `run.mjs publish` 已内置同样的保存逻辑；CLI 已保存并回读成功就不重复执行，不每轮无条件 save。

## 4. 继续迭代（loop，必须先得到用户许可）

**loop 会重新注入并重跑整条训练，耗时较长，不要自动开启。** 只有在用户明确同意后才执行，并且每调用一次只跑一轮：

```bash
node "$TRAIN/scripts/run.mjs" loop \
  --run "$RUN" \
  --type "$TYPE" \
  --student good \
  --doc "$DOC" \
  --review "$RUN/review-<n>.md" \
  --feedback "$FEEDBACK" \
  --max-iterations 3 \
  --max-actions 3 \
  --mode fresh \
  --confirm-loop \
  --confirm-fresh \
  --no-publish \
  --no-cleanup \
  --timeout 1800
```

要点：

- `--confirm-loop` 是许可闸门：没有用户明确同意不要加。
- `--review` 是自审结论文件：首行写“结论：通过 / 不通过”。loop 不调用系统 21 维评测。
- 这里加 `--no-cleanup`，是为了跑完还能出报告和做最终 `finalize`；不加时 loop 自审通过会自动清理运行目录。
- `run` / `loop` 代码默认仍自动发布；未获当前发布授权必须保留 `--no-publish`。自审通过 → verify 无 FAIL → 仅当前明确获准才发布，fresh/loop 许可不能替代发布授权。
- 自审不通过 → 按自审建议优化一轮、重注入、回读、重测，然后停下等待下一轮自审。
- 轮次上限默认 3，跨多次调用累计；达到上限停止。
- 退出码：`0` 自审通过；`2` 本轮不通过或需要继续；`1` 执行错误。
- 每轮记录写入 `run.json.loop` 与 `loop-report.md`，只有自审结论与改动阶段，没有系统分数。

仅在当前明确要求其他档位（`guided` / `offtopic` / `all`）且另行获准 loop/fresh 时，才对同一运行目录追加另一档位；会再走完整流程并重注入，保存与发布仍需独立许可：

```bash
node "$TRAIN/scripts/run.mjs" loop --run "$RUN" --type "$TYPE" --student guided \
  --doc "$DOC" --review "$RUN/review-<n>.md" --max-iterations 2 \
  --confirm-loop --confirm-fresh --no-publish --no-cleanup
```

## 5. 生成优化报告

```bash
node "$OPT/scripts/summarize.mjs" --run "$RUN"
```

报告写入 `$RUN/优化报告.md`，包含交付结论、基本信息、教师意见、阶段级改动、剩余问题、风险提示与交付物清单。结论来自 `review-*.md`、`run.json.loop` 与 `publish.json`，不凭记忆补写，也不编造分数。这份报告用于自检和向教师当场汇报，不进入最终交付目录。

## 6. 交付与清理

最终只交付两个文件：

```bash
node "$TRAIN/scripts/run.mjs" finalize --run "$RUN" [--out-dir "<交付根目录>"]
```

默认输出 `<当前目录>/交付/<任务名>/`：

1. `<任务名>-测试对话-good.txt`：可直接导入评测系统的完整对话脚本。
2. `<任务名>-剧本.md`：已落地的优化剧本。

复制并校验后删除 `$RUN`，中间文件（`run.json`、`verify.json`、`review-*`、`优化报告.md`、备份、临时脚本）一并清理。

- 只删运行目录，不碰教师材料目录和平台内容；`--keep-evidence` 只导出不删除，`--out-dir` 指定交付位置。
- 还要继续调优或排查时先不要清理；清理后无法续跑。
- 向教师报告：交付目录、两个文件名、训练链接与 `trainTaskId`、是否已发布，以及未通过时卡在哪些阶段和下一步建议（补充教师意见 / 调整剧本后重跑 / 人工修订）。

## 硬性规则

1. 只操作教师明确给出的 `trainTaskId`；不遍历课程、不批量改其他训练。
2. 不读取、不打印、不落盘 Cookie / Authorization / localStorage；平台访问全部由基础技能完成。
3. 不手工拼平台接口；注入只走训练优化页 `/api/training-refine` 或基础技能的 `inject`/`loop`，其余写入只走 `verify`/`publish`/`save-config`。允许 agent 直接编辑本地 `script.md`。
4. 不修改评分标准；不删除线上训练、不改其他训练。
5. `fresh` 注入必须确认附件与封面/背景影响，并写入报告。
6. 不伪造分数：本流程不使用系统 21 维评测，报告里不要出现编造的分数；自审结论、轮次、发布状态必须能在 `review-*.md`、`run.json.loop`、`publish.json` 中找到。
7. 优化结果为空、校验失败、回读 FAIL 时立即停止并如实报告。
8. **loop 必须先取得用户明确许可**：默认不开启；用户同意后才加 `--confirm-loop`，且每轮都要有 `--review`。
9. **不使用系统 21 维评测**：默认由 agent 自审对话脚本并直接调整剧本；`evaluate` 只作为用户明确要求时的可选项。
10. **保存包含发布，禁止无条件重复**：仅回读/自审符合且当前明确获准时，先 `editConfiguration` 后 `publishAbilityTrain`，并回读 `unpublishedChanges=0`；CLI 已完成就不重复 save-config。未获准不运行真实保存，run/loop 必须 `--no-publish`；真实 save-config 须前置确认并带 `--yes`。
11. **交付只留两个文件**：完成后用基础技能 `finalize` 只保留 `<任务名>-测试对话-good.txt` 与 `<任务名>-剧本.md`，校验复制完整后再删运行目录；只删运行目录，不手工删教师材料或平台内容。需要续跑/排查时加 `--keep-evidence`。

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| `pull` 阶段数为 0 | 平台未初始化工作流或凭证过期 | 教师在平台打开工作流编辑页后重试；仍为 0 跑 `doctor` |
| `review` 报缺少测试脚本 | 还没跑测试 | 先执行 `test --run "$RUN"` |
| `loop` 报需要 `--confirm-loop` | loop 耗时长，必须用户明确同意 | 先向用户说明并等待同意，不要自行加参数 |
| `loop` 报需要 `--review` | 没有自审结论 | 先 `review`，把“结论：通过/不通过”写进 `review-n.md` |
| `loop` 报“未优化出可写入的剧本” | 自审建议与现状无差异或优化接口返回原文 | 把问题补到具体阶段与改法后重试 |
| `optimize` 返回结果与原文一致 | 反馈不可执行 | 补充具体阶段、证据与改法，不要原地重复注入 |
| 注入前校验失败 | 优化稿结构被破坏 | 修复 `script.md` 后重跑 `validate`，不要加 `--allow-errors` 硬注 |
| 回读 FAIL | 平台写入不完整 | 保留现场，按 `verify.json` 的 FAIL 项排查；不要直接发布 |
| 测试阶段覆盖不全 | 可能为正常未选分支或异常断链 | 对照分支条件、预期路径和 `test-report.md`；正常未选分支不判异常，仅修复实际断链 |
| 发布后学生端未更新 | 平台缓存/需刷新 | 核对 `publish.json` 与平台状态，不要重复发布 |
| 教师端课程资源库看不到训练 | 尚未保存发布，或发布 courseId 错用了配置的旧课程 | 回读/自审符合且当前获准后才用目标链接运行 `save-config.mjs --yes`，回读 `unpublishedChanges=0`；CLI 已完成不重复，未获准报告未发布 |

## 资源

- `$OPT/scripts/summarize.mjs`：共享脚本，从独立的本端绝对运行目录生成 `优化报告.md`，不向共享树写产物。
- `$OPT/scripts/save-config.mjs`：先 `editConfiguration` 后 `publishAbilityTrain`；明确 client，当前获准且回读/自审符合后带 `--yes`，CLI 已完成不重复；`--dry-run` 不联网、不读配置。
- `$OPT/references/optimize-flow.md`：共享参考，命令字段、产物、退出码与判定规则；授权及路径以本文件当前边界为准。
- 基础技能 `$TRAIN/SKILL.md`、`$TRAIN/references/evaluation-loop.md`、`$TRAIN/references/test-run.md`：共享规则；配置/凭据/既有 runs/tmp 保留本端原根，运行前明确 client 并用 `paths` 核对。
