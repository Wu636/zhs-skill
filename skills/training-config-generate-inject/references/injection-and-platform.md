# 注入与平台写入

## 凭证获取（所有平台操作统一入口）

浏览器只负责登录和取 Cookie，其余动作全部走接口：

1. 请用户在浏览器登录课程页面，确认能正常进入。
2. 在当前任务授权范围内，从已登录会话读取最小必要凭据（`zhs-jt-cas`、`ai-poly`），
   直接写入本端 `config/config.json` 的 `polymas.cookie`，同时补 `courseId`、
   `libraryId`、`uiBaseUrl`。`HttpOnly` 凭据不要假设能在 `document.cookie` 里取到。
3. 用只读 `verify` 或 `doctor` 探活；401 或读到空任务说明 Cookie 过期，重新登录再取。
4. 取完即删临时文件，`config/config.json` 保持 `0600`，不要打印 Cookie、不要写入 `runs/`，
   也不要把凭据复制到其他应用目录。

## 注入前门禁（三种类型一致）

1. `normalize --run <目录>`：修围栏、口语词汇键名、Pro `<role>`/「学生」措辞。
2. 按 `normalize` 的 pending 清单补齐内容：口语释义/例句、Pro 五维与跳转、评价标准、
   缺失的开场白/提示词。能依据教师文档补就直接补，补不了再问用户。
3. `validate --run <目录>`：无 error 才允许注入。不要用 `--allow-errors` 跳过。
4. 只有图片生成慢时才用 `--no-cover --no-background` 先验结构，随后补图重跑。

## 写入顺序（Pro，fresh 模式）

1. 读取 `tasks/detail`、`steps/list`、`skills/types`、`skills/list`、`global-roles/list`。
2. **清理**：删除所有阶段；对每个非 system 成员先 `global-roles/edit` 解绑技能，再
   `global-roles/remove`。技能本身不删除（远程 SKILL 包会残留，删除易触发 `140002`）。
3. `tasks/edit` 写入任务名称、描述、字幕、摄像头、训练方式、时长、入场音色。
4. 生成封面图并上传，`tasks/edit` 写入 `trainTaskCover`。
5. 逐个创建全局成员（`global-roles/create`），可选生成头像/数字人，再 `global-roles/edit`
   补全声音、形象、技能等字段。
6. 逐个技能 `skills/create`，**紧接着** `skills/edit` 同步远程 SKILL 服务；
   最后 `global-roles/edit` 绑定技能 nid。
7. 逐阶段生成背景图、`steps/create`、紧接着 `steps/edit` 写入完整阶段数据。
8. `tasks/edit` 把首个阶段设为 `firstStepId`。

`append` 模式跳过清理，按名称复用已有成员，阶段追加在已有阶段之后。

## 写入顺序（基础版/口语，fresh 模式）

1. 查询 `queryConfiguration`、`queryScriptStepList`、`queryScriptStepFlowList` 与
   `queryScoreItemList`。
2. **边界节点**：若任务没有 START/END，直接 `createScriptStep` 补
   `SCRIPT_START` / `SCRIPT_END`（步骤名 `defaultStepName`，`stepExtProperty.trainSubType`
   与训练类型一致）。这是纯接口初始化，不需要打开浏览器编辑页。
3. **清理**：删除非边界节点及其连线；基础版再删除现有评分项。
4. `editConfiguration` 写入任务名称、描述与封面。
5. 逐个阶段生成背景图、`createScriptStep`、`editScriptStep` 写入开场白/提示词/数字人/
   背景图；口语还要写 `stepExtProperty.keyVocabularies`。
6. `createScriptStepFlow` 创建 START→首阶段、阶段间、末阶段→END 连线，并调整 START/END 位置。
7. 基础版逐条 `createScoreItem` 写评价标准；口语跳过评分项。

`append` 模式保留已有节点与连线，新阶段接在末尾。

## 封面图与背景图

- 默认图像模型 `gpt-image-2`，生图方式 OpenAI 兼容优先：
  基础版传 `imageProviderPriority="openai,cloudapi"`，Pro 传 `imageProviderMode="openai"`。
- `gpt-image-2` 的接口只返回 `b64_json`，注入器会转成 data URL 再上传平台；
  Pro 路由已兼容该返回，缺少这段兼容会导致封面/背景图全部跳过。
- 用户指定了其他图像模型时用 `--image-model <id>`；要改回平台 cloudapi 生图用
  `--image-provider cloudapi`。
- **封面图和背景图固定 16:9**：OpenAI 兼容生图请求默认带 `size: 2560x1440`，
  DALL·E 模型退到它支持的 `1792x1024`，seedream 同样是 `2560x1440`；
  prompt 固定包含「严格16:9横版宽屏构图」。cloudapi 平台生图无法控制尺寸，
  若结果不是 16:9 需重生成或改用 openai provider。

## 不可忽视的约束

- **create 后必须 edit**：阶段和技能都是。跳过 edit 会导致阶段内容为空或技能报 `140002`。
- **字段名区分**：写入 steps/global-roles/skills 用 `trainTaskNid`；`tasks/edit` 用
  `trainTaskId`；查询用 `taskId` / `trainTaskId` 各自的参数名。
- **system 角色**（nid=`system`）是主理人，不能删除，也不能当普通成员复用。
- **fresh 是破坏性操作**：目标已有阶段或非系统成员时，脚本要求显式 `--confirm-fresh`。
- **注入不是事务**：中途失败会留下半成品。失败后应重新跑 fresh，而不是在脏状态上 append。
- **单资源失败不致命**：成员/技能/图片失败常以「跳过」progress 出现，最终仍可能 `complete`。
  必须看 `inject.events.jsonl` 里的「跳过/异常」，并用 `verify` 回读确认。
- **平台没有连线**：阶段跳转完全靠提示词里的下一阶段名称，名称写错就断链。

## 注入后的回读校验

Pro 会读取任务详情、阶段、全局成员、技能，并比对：

| 检查 | 判定 |
| --- | --- |
| 任务名称 | 与配置「能力名称」一致 |
| 阶段数量/名称 | 数量一致、名称齐全、顺序一致（顺序不一致记 warn） |
| 初始阶段 | `firstStepId` 等于列表首个阶段（缺失记 warn） |
| 全局成员 | 配置中的成员都能在平台找到；fresh 模式多余成员记 warn |
| 成员 prompt | 角色描述为空记 warn |
| 技能 | 配置中的技能都存在 |
| 技能绑定 | 技能 `globalRoleNid` 或角色 `skills` 字段能对应该成员，否则 warn |
| 阶段提示词 | `llmPrompt` 非空；没有 `<role>` 标签记 warn（成员引用可能未转换） |

基础版/口语会读取 `queryConfiguration`、`queryScriptStepList`、`queryScoreItemList` 并比对：

| 检查 | 判定 |
| --- | --- |
| 任务名称 | 与剧本「任务名称」一致 |
| 阶段数量/名称/顺序 | 排除 START/END 后逐项比对 |
| 阶段提示词 | 每个节点 `llmPrompt` 非空 |
| 评价标准 | 基础版比对评分项条数 |
| 重点词汇 | 口语比对 `stepExtProperty.keyVocabularies` 总条数 |
| 训练类型 | 口语要求 `trainSubType=oral` |

任一项 `fail` → 退出码 1。

## 常见故障

| 报错/现象 | 原因 | 处理 |
| --- | --- | --- |
| HTTP 401 / code 401 | Cookie 或 Authorization 过期；基础版/口语若带 `Bearer ` 也会 401 | 重新登录；基础版/口语用 Cookie 或原始 token |
| `未找到 START/END 节点` | 新任务流程未初始化 | 脚本会用 `createScriptStep` 自动补边界节点；仍失败查看该接口返回 |
| `createScriptStep` 500 | 边界节点 DTO 字段不全 | 使用脚本内置的完整默认 DTO，不要只传 `nodeType` |
| `无法从 URL 中提取 trainTaskId` | targetUrl 缺参数 | 复制训练配置页完整 URL |
| `解析失败！未找到成员和阶段` | Markdown 格式不对 | 先跑 `validate` |
| 技能创建 `140002` | create 后没有 edit 或远程包冲突 | 重跑 fresh；必要时在平台删除同名技能 |
| 角色删除 `140030` | 技能仍绑定在角色上 | 先 edit 解绑再删（注入器已处理） |
| 阶段内容为空 | 只 create 没 edit | 重新注入 |
| 图片全部跳过 | 图片服务不可用 | 设 `injectCoverImage=false` / `injectBackgroundImage=false` 后重跑 |
| 注入超过 5 分钟 | 图片/数字人生成慢 | 本地无 Vercel 限制；线上部署受 `maxDuration=300` |

## 新建任务与发布

- 新建（Pro）：页面「保存」在 URL 无 `trainTaskId` 时调用
  `POST /ai-platform/ability-train/tasks/create`，返回 `data` 就是新 `trainTaskId` 字符串。
  此时任务只在 AI 平台存在，**课程资源库列表里看不到**。
- 新建（基础版/口语）：调用 `POST /teacher-course/abilityTrain/createConfiguration`，
  `trainSubType` 分别传 `ability` / `oral`，返回 `{trainTaskId}`；新建后用
  `createScriptStep` 补齐 START/END，再用注入接口写阶段/连线/评分项/词汇。
- 封面：Pro 的 `trainTaskCover` 传 `null` 表示不设封面；基础版/口语传
  `{fileId:"",fileUrl:""}`。需要封面用 `--cover` 上传后传 `{fileId, fileUrl}`。
- 保存：Pro 再次「保存」走 `POST /ai-platform/ability-train/tasks/edit`；
  基础版/口语走 `editConfiguration`。注入本身已完成保存。
- 发布：Pro 用 `POST /ai-platform/ability-train/tasks/publish`；基础版/口语用
  `POST /teacher-course/abilityTrain/publishAbilityTrain`。发布后任务才进入课程资源库，
  学生可见。发布是对外可见动作，只在**当前任务**已获发布授权时执行；未获授权传
  `--no-publish`，verify 有 FAIL 时一律不发布。技能文档里的历史授权不能沿用。

## 运行产物

基础版/口语的 `runs/<时间>-<任务名>/` 额外包含：

```
├── plan.json             模块规划结果
├── script.md             训练剧本
├── rubric.md             评价标准（口语为空）
```

三种类型共有：

```
runs/<时间>-<任务名>/
├── run.json              运行元信息（不含凭证）
├── config.md             最终配置
├── config.meta.json      模型、字符数、指纹
├── generate.events.jsonl 生成事件
├── validate.json         结构校验
├── dialogue.json         可选预设对话
├── target.json           新建任务的 trainTaskId / 课程 / 链接
├── inject.events.jsonl   注入过程事件
├── inject.result.json    注入结果与跳过项
├── verify.json           平台回读快照与比对
├── publish.json          发布结果
└── report.md             汇总报告
```
