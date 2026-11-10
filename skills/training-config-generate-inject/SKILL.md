---
name: training-config-generate-inject
description: 端到端生成并注入能力训练配置，支持能力训练 Pro、基础版能力训练、口语训练三种类型。输入教师实训任务文档与用户建议，调用本地 Agent_Evaluation 系统的生成接口产出配置，校验结构，通过 Polymas 接口新建或复用训练任务、注入阶段/成员/技能/评价标准/重点词汇/封面/背景图，回读校验、当前任务明确获准后发布，并用模拟学生跑完整对话、输出可直接用于评测的测试脚本。测试后由 agent 自审对话脚本并直接调整剧本，不使用耗时的系统 21 维评测；loop 迭代必须取得用户明确许可。关键词：能力训练配置、能力训练 Pro、基础版能力训练、口语训练、训练剧本生成、配置生成、一键注入、新建能力训练、保存、发布、自动测试、测试跑脚本、模拟学生、对话脚本、自审、剧本优化、Polymas、全局成员、技能绑定、阶段注入、重点词汇。
---

# 能力训练配置生成与注入（Pro / 基础版 / 口语）

把教师任务文档 + 用户建议转成可直接上课的能力训练配置，并落到 Polymas 平台。
三种训练类型共用一套流水线，仅生成接口、配置格式和平台写入接口不同。

## 训练类型

| `--type` | 类型 | 生成接口 | 平台接口 | 配置要点 |
| --- | --- | --- | --- | --- |
| `pro`（默认） | 能力训练 Pro | `/api/training-generate-pro` | `/ai-platform/ability-train/*` | 五维阶段提示词、全局成员、技能、无连线 |
| `ability` | 基础版能力训练 | `/api/training-generate` | `/teacher-course/abilityTrain/*` | 剧本 + 评价标准、阶段连线、无全局成员 |
| `oral` | 口语训练 | `/api/training-generate` | `/teacher-course/abilityTrain/*` | 剧本 + 逐阶段「重点词汇」、无评价标准 |

- 类型也可写在 `config/config.json` 的 `training.type` 或环境变量 `TRAINING_TYPE`。
- 从任务 URL 可自动识别：`/ability-training-pro/` → pro，`/ability-training/` → ability，
  `/language-training/` → oral。
- 基础版/口语生成前会先调用 `/api/training-generate/plan` 做模块规划；口语还会自动追加
  「重点词汇」输出要求。跳过规划用 `--no-plan`（不推荐，容易漏阶段）。
- 自动测试（`test`）只覆盖基础版/口语；Pro 测试依赖训练页面内 WebSocket，当前不提供 HTTP 测试。

## 何时使用

- 用户给出实训任务文档（docx/md/txt），要求生成能力训练配置。
- 用户要求「一键注入」「新建能力训练」「保存/发布到平台」。
- 需要在已有训练任务上覆盖或追加阶段、成员、技能。
- 需要先让学生-智能体预演对话，再决定是否注入。
- 注入发布后要验证线上任务能跑通，并产出可交给评测系统的对话脚本。

## 输入清单

开始前向用户确认，缺失项不要猜：

| 输入 | 说明 | 默认 |
| --- | --- | --- |
| 教师任务文档 | 本地路径，支持 docx/doc/md/txt | 必填 |
| 训练类型 | `pro` / `ability` / `oral` | `pro` |
| 用户建议 | 学员层次、阶段数、必须覆盖的流程、角色设定 | 可空 |
| 目标方式 | 新建任务 / 复用已有任务 URL | 询问 |
| 课程 ID | 生成页面链接、新建、发布、数字人管理需要 | 配置或询问 |
| 资源库 ID | 页面 URL 的 `libraryId`，发布时必填 | 配置 |
| 注入模式 | `fresh` 覆盖 / `append` 追加；fresh 必须获当前独立确认 | `fresh`（未确认不执行） |
| 是否发布 | 注入回读通过且当前任务明确获准才发布；未获准的 run/loop 必须加 `--no-publish` | 不预设授权 |
| 是否测试 | 当前获准后用模拟学生跑对话并输出测试脚本；非真实学生成绩 | 按当前任务许可 |
| 模拟学生 | `good` 优秀 / `guided` 需要引导 / `offtopic` 答非所问 / `all` 三种都跑；其他档位须当前明确要求 | `good`（含 DSH） |
| 生成模型 | 训练剧本、评分标准、模块规划、模拟学生共用 | `gpt-5.6-sol` |
| 图像模型 | 封面图和背景图 | `gpt-image-2`（OpenAI 兼容优先） |
| Polymas 登录 | 用户先在浏览器登录，Agent 从会话取 Cookie 写入 `config/config.json` | 必填（平台阶段） |

## 共享代码与本端数据

共享代码根为 `~/.agents/skills`，两技能共用脚本与 references；配置、凭据、运行记录不得进入共享树或跨端复制。本节及后文旧称 `config/config.json`、`runs/`、`tmp/` 均指本端数据根下的路径：

| client | 生成技能本端数据根（配置为根下 `config/config.json`） |
| --- | --- |
| `qoder-cn` | `~/.qoder-cn/skills/training-config-generate-inject` |
| `qoder` | `~/.qoder/skills/training-config-generate-inject` |
| `dsh` | `~/.dsh/skills/training-config-generate-inject` |
| `hermes` | `~/.hermes/skills/polymas/training-config-generate-inject` |

优化技能已有本端 config/runs/tmp 同样留在对应端原根（上表末段换为 `training-optimize-inject`），不搬入共享代码。默认产物进入当前端 `runs`；显式输出目录须为独立绝对路径，不得指向共享树。

```bash
TRAIN="$HOME/.agents/skills/training-config-generate-inject"
OPT="$HOME/.agents/skills/training-optimize-inject"
CLIENT="<根据当前宿主填写 qoder-cn|qoder|dsh|hermes>"
case "$CLIENT" in
  qoder-cn) DATA_ROOT="$HOME/.qoder-cn/skills/training-config-generate-inject" ;;
  qoder) DATA_ROOT="$HOME/.qoder/skills/training-config-generate-inject" ;;
  dsh) DATA_ROOT="$HOME/.dsh/skills/training-config-generate-inject" ;;
  hermes) DATA_ROOT="$HOME/.hermes/skills/polymas/training-config-generate-inject" ;;
  *) exit 1 ;; # 未知宿主停下，不猜测、不借用其他端
esac
export TRAINING_CLIENT="$CLIENT"
node "$TRAIN/scripts/run.mjs" paths
```

`paths` 只输出 `client/configPath/runsRoot`，不读配置、不联网；核对输出确属当前端再继续。`run.mjs` 与 `save-config.mjs` 接受 `--client qoder-cn|qoder|dsh|hermes` 或 `TRAINING_CLIENT`，也接受 `--config <独立绝对配置路径>` / `TRAINING_CONFIG`；覆盖配置时仍须明确端并用同一覆盖项运行 `paths` 确认。旧端脚本入口可推断端，共享根入口必须明确 client。

技能维护与安装不构成平台操作授权。下列业务示例仅用于当前已获准任务；`run` / `loop` 默认自动发布，未获当前发布授权必须传 `--no-publish`，fresh 覆盖与 loop 各自独立确认。

## 前置条件

1. 本地应用已启动：`Agent_Evaluation/frontend`，默认 `http://localhost:3000`。
2. LLM 凭证可用（API Key/URL 优先读 `frontend/.env.local`）。
   规划与生成默认统一用 `gpt-5.6-sol`（写在本端配置的 `llm.model`），需要换模型时用 `--model <id>` 覆盖。
3. Polymas 已登录，Cookie 已写入本端配置。`doctor` 需要网络，仅在获准业务操作时检查；仅验证本地安装时使用 `paths`。

首次使用仅在本端配置不存在时复制模板，不得覆盖已有配置；若设置了独立配置覆盖项，以 `paths.configPath` 为准，不执行下列默认路径拷贝：

```bash
CONFIG="$DATA_ROOT/config/config.json"
mkdir -p "$DATA_ROOT/config"
(umask 077; cp -n "$TRAIN/config/config.example.json" "$CONFIG")
```

### 登录与凭证（每次平台操作前）

固定流程：**用户在浏览器登录 → 当前任务授权读取最小必要凭据 → 写入本端配置 → 全程走接口**。

1. 需要用户登录或切换账号时，先将 Agent 实际连接的浏览器窗口和目标标签页置于前台（如 CDP `Page.bringToFront`；必要时激活对应应用），再请用户在这个窗口操作；不要仅提供端口、资料目录或链接让用户自行辨认。用户确认登录后先检查当前浏览器各相关标签页，登录可能在新标签完成，不要因旧登录页仍在就判断未登录；确认目标课程页面可正常进入后继续。
2. 仅在当前授权范围内，使用当前应用支持的安全会话接口读取平台所需的最小 Cookie（如 `zhs-jt-cas` / `ai-poly`），
   直接写入本端配置的 `polymas.cookie`，同时记录目标的 `courseId`、`libraryId`、`uiBaseUrl`；不要假定 `document.cookie` 包含 HttpOnly 项。
   缺少安全凭据接口时停止并说明，不创建临时 HTTP 接收器；凭据不打印、不贴进对话、不写进 runs/报告、不跨端复制，不收集无关 Cookie 或 localStorage。
3. Hermes 端仅在 `browser_exec` / CDP 可用且本次已获授权时，使用共享 `$TRAIN/scripts/hermes_cookie_refresh.py` 适配登录态刷新；配置仍写 Hermes 本地根下，不写共享树。工具不具备能力时停下说明，不强行执行，也不默认授权刷新。
4. 写入后在当前获准范围内跑只读 `verify` 或 `doctor` 确认可用；失败则请用户重新登录，并确认刷新权限。
5. 取完即删临时文件，本端 `config/config.json` 保持 `0600` 权限（gitignored）。

浏览器只用于**登录**和**取 Cookie**；新建、流程节点初始化、注入、保存、回读、发布
全部用 `node "$TRAIN/scripts/run.mjs"` 走接口。接口异常时才允许在当前授权内把浏览器作为排障兜底。

`POLYMAS_COOKIE`、`POLYMAS_COURSE_ID` 等环境变量或命令行参数可覆盖配置；
Cookie 支持浏览器整串或 `Cookie: ...` 头格式，但只收集最小必要凭据，且不得通过参数或日志泄露。

## 并发执行与性能证据

- 批量任务默认优先跨训练限并发，而不是一个训练从生成到测试全部结束才开始下一个。使用 `scripts/batch.mjs`；先读 `scripts/batch.README.md` 查看清单、依赖、锁、授权声明和 dry-run 用法。只提交当前已获准的阶段，不预先跨过教师审阅或发布闸门。
- 每个训练使用独立绝对运行目录、目标 trainTaskId 和日志；同一训练内 normalize → validate → inject → verify → test/review 按依赖推进。不同训练可交错推进，不设置无必要的整批等待。
- 不在多个进程中修改同一本端配置或刷新凭据；凭据准备在批次前完成，子任务只读使用。不把凭据、Authorization、Cookie 放进批次清单或命令参数。
- 同一对话内问答不能并发；当前 `--student all` 仍顺序执行，不能在同一 run 目录启动多个 test 进程互相覆盖汇总。跨独立训练的 test 可并发。
- 本地应用基础版/口语及Pro注入现支持 `--image-concurrency 1..8`（默认3）图片准备队列；节点和连线仍按依赖写入。`--image-cache reuse|refresh|off` 默认reuse，只复用同会话/课程/任务/生成参数的成功上传素材，进程内TTL30分钟；服务重启不保留，不缓存失败图或临时生成URL。跨任务并发×图片并发会叠加负载，不无限增大。
- `--image-strategy preserve|missing|regenerate` 控制平台旧图：preserve保留且缺失不生成，missing只补缺失，regenerate走生成准备（默认）。按唯一阶段名匹配，结构未知/重名时保守拒绝保留路径，不猜资源映射；只保留封面/背景，不承诺迁移阶段附件。regenerate+cache reuse可复用同输入缓存，强制新图需cache refresh。
- 文本优化优先 `incremental`（详见优化技能）：保留原ID/素材/附件且不生成图片；完整fresh即使保留图片仍会重建节点，不能等同于无损更新。
- 基础版/口语可用 `prepare-images --run <绝对目录> --target-url <URL> --yes [--image-ids cover,background:1]` 仅生成并上传图片，不写任务/节点/评分。当前生图授权仍必需；结果在 `images.prepare.json`。选择失败ID补图，不为补图重新fresh整条训练。缓存不跨服务重启。
- Pro OpenAI兼容生图不再含硬编码密钥回退；须由部署环境提供 `POLYMAS_IMAGE_FALLBACK_API_KEY`。缺失则明确失败，不使用未知凭据。
- 测试结果 JSON 增加 `durationMs` 与无正文的 `timingEvents`；超时覆盖整个 SSE，失败写 `test-<档位>-interrupted.json`。中断不自动重测，先核实平台状态。TXT 交付格式保持不变。
- 批次中间阶段禁止清理；使用旧 `run` 时必须带 `--no-cleanup`，自审/发布决策和交付完成后才执行 finalize。

## 工作流

### 0. 体检

```bash
node "$TRAIN/scripts/run.mjs" doctor
```

必须看到应用可达、解析器存在。Cookie 缺失只会阻止新建/注入/发布，不影响生成。

### 1. 生成配置

```bash
node "$TRAIN/scripts/run.mjs" generate \
  --doc "<教师任务文档路径>" \
  --type pro|ability|oral \
  --name "<任务名称>" \
  --advice "<用户建议>"
```

- 生成可能需要数分钟，脚本会持续打印字符进度。
- Pro 产物在 `config.md`；基础版/口语在 `script.md` + `rubric.md`（评价标准），
  同时写一份合并的 `config.md`。
- 基础版/口语会先跑模块规划，规划结果在 `plan.json`；想单独看阶段规划用 `plan` 命令。
- 想指定输出目录用 `--out <目录>`。口语生成若文档没有词汇依据，阶段词汇应为空数组 `[]`，
  不允许编造。

### 2. 规范化、校验并修正（三种类型都要做）

```bash
node "$TRAIN/scripts/run.mjs" normalize --run <运行目录> [--type pro|ability|oral] [--dry-run]
node "$TRAIN/scripts/run.mjs" validate --run <运行目录>
```

- **先 normalize，再 validate**：生成结果经常结构不规范（口语词汇键名写成
  `vocabulary/translation/chinese/example`、用 `~~~` 围栏、Pro 提示词混入
  `<role>` 或「学生/学员」）。`normalize` 会自动做这些机械修正，并列出仍需补的内容：
  - 基础版/口语：`~~~` → ` ``` `；重点词汇统一为
    `term / meaning / source / exampleSentence`；缺 JSON 块补 `[]`。
  - Pro：删除 `<role>` 标签；阶段提示词内「学生/学员」统一为「用户」；
    检查五维缺失、下一阶段跳转缺失。
  - 原始文件保留为 `script.orig.md` / `config.orig.md`，修正记录写入 `normalize.json`。
- **能补就自己补，不要直接注入残缺配置**：`pending` 里属于内容缺失的项（口语释义/例句、
  Pro 五维段落、跳转句、成员名/技能指令、评价标准）由 Agent 依据教师文档和用户建议直接
  编辑 `script.md` / `config.md` / `rubric.md` 补全，然后重跑 `normalize` + `validate`。
  只有确实无法从文档推断时才向用户确认，不要凭空虚造事实性内容。
- `error` 必须先处理，否则不要注入；`warn` 建议处理。
- 若整体结构跑偏（阶段数不符、流程缺失、角色错位），带更具体的 `--advice` 重新生成，
  而不是在错误结构上反复手补。
- 校验用的是项目自带解析器，与注入器完全一致。

### 3. 可选：预演对话

```bash
node "$TRAIN/scripts/run.mjs" dialogue --run <运行目录> --stages 1,2 --rounds 4 --performance competent
```

产物 `dialogue.json`。用于检查角色口吻、阶段推进和成员引用是否自然。

### 4. 选定目标

**新建任务：**

```bash
node "$TRAIN/scripts/run.mjs" create-task --run <运行目录> --type pro|ability|oral [--cover <封面图>]
```

- Pro：`POST /ai-platform/ability-train/tasks/create`。
- 基础版/口语：`POST /teacher-course/abilityTrain/createConfiguration`
  （口语请求体带 `trainSubType:"oral"`）。
- 返回 `trainTaskId`，写入 `target.json`。基础版/口语新建后会用同一批接口补齐
  START/END 流程节点，**不需要打开浏览器**。
- `--course-id` 对基础版/口语新建是必填；Pro 新建只影响页面链接与后续发布。

**复用已有任务：** 把训练配置页完整 URL 传给 `--target-url`，或手工写 `target.json`。
URL 中带 `/language-training/`、`/ability-training/`、`/ability-training-pro/` 时会自动识别类型。

**从已有训练反向拉取（基础版/口语）：**

```bash
node "$TRAIN/scripts/run.mjs" pull --target-url "<训练配置页URL>" --type ability|oral --out <运行目录>
```

- 读取平台 `queryConfiguration` / `queryScriptStepList` / `queryScoreItemList`，用应用自带
  `serializeTrainingScriptMarkdown` 反向生成 `script.md` 与 `rubric.md`，可直接 `validate`、`optimize`、`inject`。
- 同时产出 `teacher-doc.generated.md`（任务名 + 描述 + 阶段描述 + 重点词汇），
  仅在教师没有原始任务文档时作为评测兜底，不能当正式文档。
- `pull.json` 记录阶段数、评分项、重点词汇、附件与封面数量及风险提示。
- **不还原流程图分支连线与阶段附件**；`fresh` 重注入会重建阶段并重新生成封面/背景，注入前必须确认。
- 只支持基础版/口语；Pro 没有对应的反向序列化通道。

> 新建后任务只存在于 AI 平台，**不会出现在课程资源库**；必须注入并发布后才进资源库。
> 新建不设置封面时传 `null`，不会导致失败；注入阶段会生成正式封面。

### 5. 注入

```bash
node "$TRAIN/scripts/run.mjs" inject --run <运行目录> --target-url "<训练配置页URL>" --mode fresh
```

- Pro 走 `/api/training-inject-pro`；基础版/口语走 `/api/training-inject`（SSE 相同）。
- `fresh` 会删除目标现有阶段（基础版/口语还会删连线；Pro 还会删非系统成员）。
  目标非空时脚本会拒绝执行，确认后加 `--confirm-fresh`。追加内容用 `--mode append`。
- 基础版会同时注入评价标准；口语会逐阶段注入「重点词汇」到
  `stepExtProperty.keyVocabularies`。
- 评分标准优先结构化直通：pull保留 `rubric.source.json` 原始四字段与Markdown哈希；未改评分时直接复用并逐字段回读比较。新文本严格确定性解析成功则不调用AI，未知格式才回退AI。原始sidecar匹配但结构未知时停止，不能通过丢sidecar/AI猜测宣称无损。普通历史AI提取路径无法精确核验时报告WARN，不以条数相同冒充一致。
- 封面图和背景图默认用 `gpt-image-2`，生图方式为 OpenAI 兼容优先
  （基础版优先级 `openai,cloudapi`，Pro 为 `openai`）。用户指定了模型时用
  `--image-model <id>` 覆盖，指定走平台生图用 `--image-provider cloudapi`。
- 封面图和背景图固定 16:9 横版：生成接口已默认下发 `size: 2560x1440`
  （DALL·E 走 `1792x1024`），prompt 也要求「严格16:9横版宽屏构图」。
  生图后如发现平台图片是方图（例如走了 cloudapi 平台生图），需要重生成或裁切。
- **注入前确认已经过 normalize + validate**，不要跳过第 2 步直接注入。
- 不为图片失败直接重跑整条fresh。基础版/口语优先 `prepare-images` 按失败ID准备图片，再在获准的注入/资源绑定步骤使用；prepare-images本身不绑定节点。结构冒烟可在当前范围内用 `--no-cover --no-background`，但必须明确图片未交付，不能因此认定完整成功。
- 关注日志里的「跳过/异常」，它们不会让整体失败，但意味着资源缺失。

### 6. 回读校验

```bash
node "$TRAIN/scripts/run.mjs" verify --run <运行目录>
```

- Pro：比对任务名、阶段数量/顺序、初始阶段、全局成员、技能与绑定、阶段提示词。
- 基础版：比对任务名、阶段数量/顺序、阶段提示词、评价标准条数。
- 口语：在基础版基础上额外比对 `trainSubType=oral` 和重点词汇条数。
- 有 `FAIL` 时先看 `verify.json` 的 snapshot，再决定重跑 fresh 还是手工修。

### 7. 发布（回读通过且当前任务明确获准后）

先确认当前许可包含目标任务的保存与发布；历史任务或技能维护授权不适用。未获准不执行下列真实写入命令：

```bash
node "$TRAIN/scripts/run.mjs" publish --run <运行目录> --yes
```

Pro 调 `tasks/publish`；基础版/口语必须先调 `teacher-course/abilityTrain/editConfiguration`，再调 `publishAbilityTrain`
（等价编辑页右上角“保存”）。只调 `publishAbilityTrain` 而不先 `editConfiguration` 时，教师端课程资源库列表可能看不到训练。

- `publish` 的 `courseId` / `libraryId` 取自**目标训练链接**，不能用 `config.polymas.courseId`（配置里是别的课程）。
- 回读有 `FAIL` 时**不要发布**：先修复；若需 fresh，另行确认后重注入，再走 verify → 获准发布。保存后必须回读 `unpublishedChanges=0`。
- 发布失败（401/读不到任务/接口报错）时，在当前授权内按「登录与凭证」刷新 Cookie 后重试发布。
- 未获当前发布授权的 `run` / `loop` 必须加 `--no-publish`；脚本默认仍自动发布，文档没有改变代码默认值。
- 通过训练优化页 `/api/training-refine` 注入后，只有回读/自审符合且当前已确认保存与发布才补执行：
  `node "$OPT/scripts/save-config.mjs" --target-url "<目标训练链接>" --yes`。
  `save-config.mjs --dry-run` 不联网、不读配置，仅用于预检，不代表平台验证通过；真实保存必须 `--yes`。CLI 已完成同等保存并回读成功时不重复执行。

### 8. 测试跑脚本（当前获准范围内执行）

```bash
node "$TRAIN/scripts/run.mjs" test --run <运行目录> [--student good|guided|offtopic|all] [--max-rounds 10]
```

用模拟学生把已发布的线上任务从头跑到尾：每阶段先按剧本配置预生成一段「历史日志」参考对话，
再让模拟学生参考它作答：调 `runCard` 取智能体开场，按「优秀/需要引导/答非所问」档位回答，
调 `chat` 推进，直到阶段推进或达到轮次上限。参考对话只作为表达与推进方式参考，
必须针对训练师当前提问作答；`--no-reference` 可关闭预生成，回到纯现场生成。

- 所有端（含 DSH）默认 `--student good`，只跑优秀学生；`guided` / `offtopic` / `all` 仅在当前任务明确要求时使用。明确要求三档时用 `--student all`，会依次产出
  `test-good.txt` / `test-guided.txt` / `test-offtopic.txt`（对话脚本）+ 对应 `.json`
  + 汇总 `test-report.md`；结果写入 `run.json` 的 `test`。
- 独立 `test` 命令支持 `--no-doc-export`：只写独立run目录，不额外复制教师目录，适合多个训练共享教师材料目录时并发测试；之后统一finalize交付，TXT格式不变。默认仍复制教师目录。
- 跑完会把每份 TXT **复制到教师文档所在目录**，命名为 `<任务名>-test-<档位>.txt`
  （无任务名时退回 `<文档名>-test-<档位>.txt`）；`run.json` 里的文档路径缺失或指向临时文件时，
  用 `--doc <教师文档>` 指定导出目录。评测时直接取这份，运行目录里的 `test-*.txt` 仍保留。
- **对话脚本必须是评测系统可直接解析的 TXT 格式**（`frontend/lib/txt-converter.ts` 的
  `parseTxtDialogue`）：元数据行 `日志创建时间:` / `task_id:` / `学生档位:`；
  阶段头 `Step: <阶段名> | step_id: <id> | 第 N 轮 | 来源: runCard|chat`；正文 `用户:` / `AI:`。
  不要手工改格式，改就重新跑 `test`。
- 默认每个阶段最多 10 轮；想看快速验证用 `--max-rounds 2`。5 阶段 × 10 轮的完整测试约 4-5 分钟，
  线上部署受 `maxDuration=300` 限制，接近上限时改用 `--max-rounds 5` 或本地跑。
- Pro 训练暂不支持：它的测试走页面内 WebSocket（`wss://cloudapi.polymas.com/ai-platform/ws/trainV2`），
  没有等价的 HTTP 接口，`test` 会明确拒绝并提示。
- 对话与参考日志均须标注为模拟测试数据，非真实学生作答或成绩，不得冒充真实学习记录。
- 测试失败或阶段没走完不会回滚已发布的任务；正常未选中的条件分支不等于异常漏访。对未访问阶段结合分支条件、预期路径与 `completed` 判定，区分正常未选分支与断链/异常未完成。

### 9. 自审、优化与迭代（基础版/口语）

测试脚本产出后，由执行技能的 agent **直接阅读对话脚本并对照教师文档逐阶段自审**，发现问题直接改剧本。
不要默认调用系统 21 维评测：它按 5 维 21 子维串行打分，耗时太长。

```bash
# 1) 生成自审材料：教师文档 + 剧本 + 模拟对话 + 阶段覆盖（纯本地，不调用评测接口）
node "$TRAIN/scripts/run.mjs" review --run <运行目录> [--student good]

# 2) 按自审结论优化：把 review-<n>.md 作为反馈，改剧本并校验
node "$TRAIN/scripts/run.mjs" optimize --run <运行目录> --feedback-file <运行目录>/review-<n>.md [--max-actions 3]

# 3) 改完在当前获准范围内重新走注入与测试；fresh 须先独立确认
node "$TRAIN/scripts/run.mjs" normalize --run <运行目录>
node "$TRAIN/scripts/run.mjs" validate <运行目录>
node "$TRAIN/scripts/run.mjs" inject --run <运行目录> --mode fresh --confirm-fresh
node "$TRAIN/scripts/run.mjs" verify --run <运行目录>
node "$TRAIN/scripts/run.mjs" test --run <运行目录> --student good

# 4) 交付并清理：只保留测试对话与剧本，删掉运行目录里的中间文件
node "$TRAIN/scripts/run.mjs" finalize --run <运行目录> [--out-dir <交付根目录>]
```

- `review` 只做本地材料汇总，不调用网络；输出 `review-input-<n>.md`（完整自审包）和
  `review-<n>.md`（结论模板）。agent 读完后在模板里写“结论：通过 / 不通过”、问题清单与修改建议；
  问题明确时可以直接改 `script.md`，改前复制一份 `script.before-review-<时间戳>.md`。
- `optimize` 调 `POST /api/training-optimize`（一次 LLM 请求）：把自审结论与教师意见作为
  `optimizationFeedback`，返回 `optimized_script_markdown`。写盘前备份为
  `script.before-optimize-<时间戳>.md`，随后 normalize + validate；只改剧本，不改评分标准。
  `--dry-run` 只产出优化结果不写盘。
- `evaluate` 保留为系统 21 维评测（`POST /api/evaluate-stream`），**默认拒绝执行**；只有用户明确要求
  深度评测时才加 `--confirm-evaluate`。不要把它放进默认闭环。
- **loop 默认不要开启**：它耗时很长，必须先在对话里向用户说明并取得明确许可，再加 `--confirm-loop`。
  loop 不再调用 21 维评测，而是读取 `--review <自审文件>`：自审通过 → verify → 当前获准后发布；自审不通过 →
  按自审建议优化一轮 → 重新注入 → 回读 → 重测，然后停下等待下一轮自审。未获发布授权必须加 `--no-publish`，loop 许可不包含发布许可。
- loop 的 fresh 重注入会替换目标现有阶段，必须独立取得当前确认后显式 `--confirm-fresh`；不想清空就 `--mode append`。
  每轮边界默认最多 3 轮（`--max-iterations`），跨多次调用累计；达到上限仍未通过就停止。
- 迭代记录写入 `run.json` 的 `loop` 字段与 `loop-report.md`，记录自审结论、改动阶段与结束原因，**没有系统分数**。
- **交付清理**：任务完成后执行 `finalize --run <运行目录>`。默认输出到 `<当前目录>/交付/<任务名>/`，只保留
  `<任务名>-测试对话-good.txt` 与 `<任务名>-剧本.md`，校验复制完整后删除整个运行目录（含 json、备份、
  测试报告、review、临时脚本）。只删运行目录，不碰教师文档目录和平台内容。
  - `--out-dir <目录>` 指定交付根目录；`--keep-evidence` 只导出不删除；`--no-cleanup` 让 `run`/`loop`
    结束时跳过清理；`--allow-missing-test` 在没有测试对话时只交付剧本。
  - 流水线还没结束时不要清理，否则无法续跑；需要继续调优时先保留运行目录。
  - `run` 与自审通过的 `loop` 已默认在结束前自动执行同样的清理。
- Pro 不支持：没有等价的 HTTP 测试/优化通道，`test`/`optimize`/`loop` 对 Pro 直接拒绝。

### 一条龙

```bash
node "$TRAIN/scripts/run.mjs" run \
  --doc "<文档>" --type pro|ability|oral --advice "<建议>" \
  --create --course-id <课程ID> \
  --mode fresh --no-publish --no-test --no-cleanup
```

示例以已获准生成/新建/注入为前提；未获发布授权必须保留 `--no-publish`，fresh 覆盖另行确认。
代码默认仍串联生成（基础版/口语含规划）→ 规范化 → 校验 → 新建（含流程节点初始化）→ 注入 → 回读
→ 自动发布 → 自动测试并输出对话脚本；**只有当前发布获准且回读通过，才可去掉 `--no-publish`**。
测试完成后跑 `review --run <目录>` 生成自审材料，由 agent 阅读后决定是否改剧本；`run` 不调用系统 21 维评测。
回读 FAIL 时自动跳过发布和测试并报错；`--no-publish` 只禁发布，不会自动禁测试，要停在回读同时加 `--no-test`。测试获准后单独执行 test；自审完成前保留 `--no-cleanup`。
已有任务时把 `--create --course-id` 换成 `--target-url "<URL>"`。

`run` 结束时会自动归集交付并清理运行目录：默认只留测试对话与剧本；
想保留现场加 `--keep-evidence`，不想清理加 `--no-cleanup`。清理后无法从运行目录续跑。

单独执行 `inject` 后接着 `verify`；仅在通过且当前已获保存与发布授权时执行 `publish --yes`，
再按许可执行 `test`。未获发布授权停在回读并明确报告未发布，不补跑保存接口。

## 硬性规则

1. **先规范化再校验再注入**：`normalize` → `validate` → `inject`，三种类型一致。
   机械问题由脚本修，内容缺失由 Agent 依文档补齐；存在 `error` 时默认停止，
   不要用 `--allow-errors` 绕过。
2. **破坏性操作边界**：`fresh` 清空目标既有阶段须当前独立确认后加 `--confirm-fresh`；
   发布须当前任务明确授权且回读通过，**verify 有 FAIL 时禁止发布**。未获准的 run/loop 必须 `--no-publish`，不执行 publish/save-config 真实保存。
3. **全部走接口**：新建、初始化流程节点、注入、保存、回读、发布都不依赖浏览器自动化；
   浏览器只用于登录和取 Cookie，接口异常时才作为排障兜底。
   **“保存”= `editConfiguration` + `publishAbilityTrain`，保存后必须回读 `unpublishedChanges=0`**；
   只调用发布接口时教师端课程资源库可能看不到训练。
4. **凭证只存本端配置**：Cookie 仅写本端 `config/config.json` 或当前明确指定的独立配置（gitignored、0600）；
   仅取已授权的最小凭据，不打印、不贴进对话、不写 runs/报告/共享树，不跨端复制。
5. **Pro 版没有连线**：阶段跳转靠提示词里的下一阶段名称，校验会检查首尾衔接。
6. **基础版/口语有连线**：注入器会创建节点连线并把 START/END 放到流程两侧；
   新建任务若没有 START/END，脚本会用 `createScriptStep` 接口自动补齐。
7. **create 后必须 edit**：Pro 的阶段/技能都由注入器处理；基础版/口语节点由注入器补齐内容，
   不要手工只调 create。
8. **注入非事务**：失败后若需重新 fresh，须确认当前覆盖许可；不要在脏状态上 append。
9. **口语重点词汇逐阶段输出**：即使文档没有词汇依据也要输出 `**重点词汇**: []`，
   不得遗漏字段或编造词汇。
10. **Pro 生成没有独立规划阶段**：规划接口只用于基础版/口语。
11. **代码默认不等于授权**：`run` 默认回读通过 → 发布 → 自动测试；无当前发布授权必须 `--no-publish`，不允许测试时加 `--no-test`。模拟数据须明确标注，不代表真实学生成绩。
12. **测试脚本格式不可改**：TXT 必须保持 `parseTxtDialogue` 可解析（元数据行 + `Step:` 头 +
    `用户:`/`AI:` 正文），否则评测系统读不到阶段和轮次。
13. **Pro 不能 HTTP 测试**：Pro 的测试通道是页面内 WebSocket，`test` 对 Pro 直接报不支持，
    不要为此改走浏览器自动化；需要 Pro 测试时明确告知用户当前未覆盖。
14. **loop 必须先取得用户明确许可**：默认走 `review` 自审流程，不开启 loop；确需 loop 时，
    先向用户说明“会重新注入并重跑整条训练、耗时较长”并得到同意，再加 `--confirm-loop` 和 `--review`。
    fresh 重注入还要 `--confirm-fresh`；校验失败或回读 FAIL 时立即停止。
15. **不使用系统 21 维评测**：默认由 agent 阅读 `review-input-<n>.md` 与 `test-<档位>.txt` 自审，
    直接改剧本；`evaluate` 仅在用户明确要求时加 `--confirm-evaluate`，不要放进默认闭环。
    优化只改剧本，`optimize`/`loop` 不改评分标准；教师若要求改评分标准，
    回到文档与评分标准生成流程，而不是在优化接口里硬塞。
16. **pull 后先核对再注入**：`pull.json` 的 `stepCount` 必须与平台一致；`warnings` 里的附件、
    封面/背景提示要告知用户。`fresh` 重建会丢阶段附件，不接受就停在拉取结果，不强行注入。
17. **教师意见优先于自审结论**：`--feedback` / `--feedback-file` 是硬要求，自审结论只作为补充；
    两者冲突时以教师意见为准，并在报告里说明取舍。
18. **交付后清理**：任务完成后用 `finalize` 只保留 `<任务名>-测试对话-good.txt` 与 `<任务名>-剧本.md`，
    校验复制完整后再删除运行目录；只删运行目录，不手工删教师文档目录或平台内容。
    还需要续跑或排查时用 `--keep-evidence` / `--no-cleanup` 保留现场。

## 资源呈现边界

- 本用户的阶段辅助资源优先采用直接生成的静态图片并上传绑定，不使用 HTML，除非当次明确要求网页交互。词汇图依据原文，助答图使用留空句框，原文阶段背景不重生成。
- 用户提出“资源图/资源文件”不等于同意制作 HTML。涉及阶段辅助资源时，先核实平台支持格式与教师希望的呈现形式，不默认生成或上传 HTML；用户说资源稍后处理时立即停止资源生成/绑定。保留原图、剧本和评分标准，未完成的资源明确标记待定，不把独立网页交互当作平台原生功能。

## 交付物

向用户报告：

- 任务名称、`trainTaskId`、可打开的页面链接。
- 交付目录路径与两个最终文件：`<任务名>-测试对话-good.txt`、`<任务名>-剧本.md`。
- 校验错误/警告、注入跳过项、回读失败项。
- 是否已发布（未发布要明确说明）。
- 测试阶段覆盖与总轮次，注明模拟数据而非真实学生成绩；未访问阶段或未完成 Run 逐条列出，
  区分正常未选分支与异常漏访。
- 运行目录是否已清理；保留现场时再给出 `report.md`、`verify.json`、`test-report.md` 路径。
- 测试对话脚本就是交给评测系统的最终文件，不要手工改格式。

## 排障

| 现象 | 处理 |
| --- | --- |
| `doctor` 显示应用不可达 | 启动 `frontend` 的 dev server，或改 `--app-url` |
| 401/403 | Pro 只认 Cookie；基础版/口语用原始 token（`zhs-jt-cas`/`ai-poly`），不要加 `Bearer `。仍失败则重新登录更新 `polymas.cookie` |
| 新建成功但资源库看不到 | 未发布任务只在 AI 平台；回读通过且当前获准后才用 `--yes` 发布，否则如实报告未发布 |
| `未解析到训练阶段` | Pro 用 `### 阶段N: 名称`；基础版/口语检查剧本阶段标题 |
| 注入报「未找到 START/END 节点」 | 新任务流程未初始化；脚本已自动调 `createScriptStep` 补齐，若仍失败看接口错误 |
| 技能 `140002` | 平台同名技能残留；fresh 重跑或先删同名技能 |
| 注入 5 分钟超时 | 线上部署受 `maxDuration=300`；本地重跑，或先关图片 |
| 阶段提示词无 `<role>` | 检查配置里是否用了 `@成员名` 且成员名一致（Pro） |
| 口语词汇 0 条 | 先跑 `normalize --type oral` 修键名/围栏；仍不足则按阶段补词后重跑 validate |
| 口语词汇解析失败 | 生成用了 `chinese/example/basis` 等非标准键；normalize 会统一为 `term/meaning/source/exampleSentence` |
| Pro 提示词有五维缺失/跳转缺失 | normalize 会列 pending；编辑 config.md 补段落或跳转句后重跑 validate |
| Pro 提示词混入 `<role>` | 直接跑 normalize，自动删除标签，保留 `@成员名` |
| `test` 报「Pro 训练暂不支持」 | 预期行为：Pro 测试走页面内 WebSocket，HTTP 无法复现；告知用户该类型未覆盖 |
| 测试卡住/超时 | 平台接口 120s 超时；先 `--max-rounds 2` 快速验证，再定位是 `runCard` 还是 `chat` 慢；线上整体受 `maxDuration=300` 限制，5 阶段满 10 轮约 4-5 分钟，逼近上限时降轮次或本地跑 |
| 测试报告有阶段未访问 | 先对照分支条件与预期路径；正常未选分支不是异常漏访，只有应访问却未访问才检查连线与 `nextStepId` |
| 测试脚本评测系统读不出阶段 | 确认用的是 `test-*.txt` 而不是 `.json`；重跑 `test` 生成标准格式，勿手工编辑 |
| 测试对话答非所问 | 模型或提示槽位问题；换 `--model` 或检查剧本提示词是否缺少引导语 |
| `review` 报缺少测试脚本 | 先执行 `test --run <目录>` 生成 `test-<档位>.txt` |
| `evaluate` 报需要 `--confirm-evaluate` | 这是有意拦截：21 维评测太慢，默认改用 `review` 自审；用户明确要求时才加参数 |
| `evaluate` 超时 | 21 个子维度串行打分，默认 900s；线上 `maxDuration=300` 会先断，改为本地跑 |
| `optimize` 返回结果与原文一致 | 说明自审结论或教师意见不够 actionable；补充到具体阶段与改法后重试，不要原地重复注入 |
| `loop` 报需要 `--confirm-loop` | loop 耗时长，必须先征得用户明确同意，不要自行加参数绕过 |
| `loop` 报需要 `--review` | 先 `review --run <目录>`，把“结论：通过/不通过”写进 `review-<n>.md` 再传入 |
| `loop` 报需要 `--confirm-fresh` | 重注入会清空阶段；须取得当前独立覆盖许可后才加参数，或在获准范围内改用 `--mode append` |
| `loop` 第一轮后就停下 | 正常：一轮 loop 结束会等待下一轮自审；按提示重新 `review`，不要连续盲目跑 |
| `finalize` 报缺少 `test-<档位>.txt` | 还没跑测试；先 `test`，或确实只要剧本时加 `--allow-missing-test` |
| 清理后想继续调优 | 运行目录已删，无法续跑；从交付的剧本重新建运行目录，或下次加 `--keep-evidence` / `--no-cleanup` |
| `pull` 阶段数为 0 | 平台工作流未初始化或凭证失效；让教师在平台打开该训练编辑页后重试，仍失败跑 `doctor` |
| `pull` 后注入丢附件/换背景 | 预期行为：`fresh` 会重建阶段，附件不迁移、封面/背景按配置重生成；不接受就改走平台复制训练后优化副本 |

## 资源

- `references/config-format.md`：Pro 配置格式、校验清单、常见修法
- `references/api-contract.md`：本地生成/注入接口与平台接口契约
- `references/injection-and-platform.md`：写入顺序、破坏性边界、回读判定与故障表
- `references/test-run.md`：测试接口、模拟学生档位、脚本输出格式与 Pro 限制
- `references/evaluation-loop.md`：自审材料、优化接口、loop 许可与停止条件、产物
- 上述 `references/*` 均相对共享 `$TRAIN`，不是本端数据根。
- `$TRAIN/scripts/run.mjs`：共享入口；先明确 client 并用 `paths` 确认本端配置/runs，`node "$TRAIN/scripts/run.mjs" help` 查看参数。
- `$OPT/scripts/save-config.mjs`：先保存后发布；`--dry-run` 不读配置/不联网，真实调用须当前确认及 `--yes`，CLI 已完成则不重复。
- `$TRAIN/scripts/hermes_cookie_refresh.py`：仅 Hermes 已授权且 browser_exec/CDP 可用时适配；凭据只写 Hermes 本地配置。
- `$TRAIN/config/config.example.json`：共享模板；仅首次无配置时复制到本端 `config/config.json`，不得覆盖。
