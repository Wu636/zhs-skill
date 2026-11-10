# 接口契约

所有本地接口由 `Agent_Evaluation/frontend`（Next.js）提供，默认 `http://localhost:3000`。
接口本身不校验登录态；LLM 凭证缺省回落到服务端 `.env.local`。

## 1. 生成 Pro 配置

`POST /api/training-generate-pro`

请求（二选一）：

- `application/json`：`teacherDocContent`、`teacherDocName`、`apiKey`、`apiUrl`、`model`、
  `userGenerationAdvice`、`promptTemplate`
- `multipart/form-data`：`file`（.docx/.doc/文本）+ 同上字段（不含 teacherDocContent）

响应：`text/event-stream`，`data: {json}` 帧：

| type | 负载 |
| --- | --- |
| `start` | `{message}` |
| `chunk` | `{content}` 增量正文 |
| `complete` | `{fullContent, taskName}` |
| `error` | `{message}` |

失败也返回 HTTP 200，必须读取 `error` 事件。
`taskName` 取一级标题去掉「- 能力训练 Pro 配置」；没取到则用 `teacherDocName`。

## 2. 生成预设对话（可选）

`POST /api/training-generate-pro/dialogue`

```json
{
  "markdown": "<Pro 配置全文>",
  "stageIndexes": [0, 1],
  "performance": "excellent | competent | needs_improvement",
  "targetRounds": 2,
  "extraRequirements": "",
  "apiKey": "", "apiUrl": "", "model": ""
}
```

成功返回 SSE：`start{total}`、`progress{stageName,current,total,message}`、
`stage_complete{stage:{stageName,messages[]}}`、`complete{stages,configFingerprint,generatedAt}`。
流开始前的参数错误是普通 JSON 400。

## 3. 注入 Pro 配置

`POST /api/training-inject-pro`

```json
{
  "markdown": "<Pro 配置全文>",
  "targetUrl": "https://.../agent-course-full/{courseId}/...&trainTaskId={id}",
  "cookie": "ai-poly=...; ...",
  "authorization": "Bearer ...（通常留空）",
  "authMode": "cookie | auto",
  "credentials": { "cookie": "...", "authorization": "...", "userNid": "" },
  "mode": "fresh | append",
  "coverStylePrompt": "可空，默认取封面图描述",
  "backgroundStylePrompt": "可空",
  "digitalHumanAvatarMode": "existing | ai",
  "imageProviderMode": "cloudapi | openai",
  "imageModel": "可空",
  "injectCoverImage": true,
  "injectBackgroundImage": true
}
```

- `targetUrl` 必须包含 `trainTaskId`；`businessId`/`courseId` 用于数字人管理。
- 缺少 `targetUrl`/`cookie` 或无法解析 `trainTaskId` 时返回 JSON 400。
- 正常返回 SSE：`start`、`progress{phase,message,current,total}`、`complete{message}`、
  `error{message}`。
- `phase`：`global_config`、`cleanup`、`members`、`skills`、`stages`。
- 单个成员/技能/图片失败通常只产生「跳过」progress，不会中断整体流程；
  只有解析、URL、鉴权等致命错误才发 `error`。

管理类 action（同一路由，普通 JSON）：

- `{"action":"list-skills","targetUrl","cookie"}` → `{skills[]}`
- `{"action":"delete-skills","skillIds":[]}` → `{deleted[],failed[]}`
- `{"action":"list-digital-humans"}` / `{"action":"delete-digital-humans","digitalHumanIds":[]}`

## 4. 平台接口（脚本直接调用）

Base：`https://cloudapi.polymas.com`（校区部署用 `{apiOrigin}/cloud`）。

| 用途 | 方法与路径 |
| --- | --- |
| 新建能力训练 | `POST /ai-platform/ability-train/tasks/create` |
| 保存全局配置 | `POST /ai-platform/ability-train/tasks/edit` |
| 发布 | `POST /ai-platform/ability-train/tasks/publish` |
| 任务详情 | `GET /ai-platform/ability-train/tasks/detail?taskId=` |
| 阶段列表 | `GET /ai-platform/ability-train/steps/list?taskId=` |
| 全局成员 | `GET /ai-platform/ability-train/global-roles/list?trainTaskId=&needSystemRole=true` |
| 技能列表 | `GET /ai-platform/ability-train/skills/list?taskId=` |
| 文件上传 | `POST /basic-resource/file/upload`（multipart） |

新建任务请求体（平台页面「保存」在无 `trainTaskId` 时调用）：

```json
{
  "trainTaskName": "任务名称",
  "description": "任务描述",
  "trainTaskCover": null,
  "trainTime": null,
  "firstStepId": null,
  "publishStatus": null,
  "voiceUrl": null,
  "openSubtitle": null,
  "openVideo": null,
  "communicateMethod": 3,
  "entranceVoiceType": null,
  "entranceVoiceSpeed": null,
  "entranceVoiceNid": null,
  "extText": { "trainScreen": false, "trainScreenType": 1 }
}
```

- 返回 `data` 直接是新任务的 `trainTaskId` 字符串，不是对象。
- 新建请求不带 `courseId`/`trainTaskId`；`courseId` 只在发布时使用。
- `communicateMethod`：1=语音、2=文本、3=学生自选；`trainScreenType`：1=强制、2=可选。
- 已有 `trainTaskId` 时同一个「保存」走 `tasks/edit`，请求体为 `{ trainTaskId, ...上述字段 }`。

发布请求体：`{ courseId, taskId, libraryFolderId }`（`libraryFolderId` 取页面 URL 的 `libraryId`）。

- 新建后任务只存在于 AI 平台，**不会出现在课程资源库**；发布后才进入课程 `libraryId` 对应资源库。
- 封面为空时 `trainTaskCover` 传 `null`（不要传 `{}`），平台会保留默认入场音频等字段。

## 5. 鉴权

- 平台使用 Cookie（关键项 `ai-poly`，JWT）。
- **只发 Cookie 即可通过鉴权**。额外发送 `Authorization: Bearer <ai-poly>` 反而会返回 401「拒绝访问，未登录」。
- 脚本默认不派生 Authorization；只有配置里显式写了才转发。注入接口用 `authMode: "cookie"` 关闭服务端派生。
- `Cookie` 可直接是浏览器复制的整串，也可以是 `Cookie: ...` 头格式，脚本会剥掉前缀。
- Cookie 过期表现为 HTTP 401/403 或平台 `code=401`。用 `doctor` 可以看 JWT 到期时间。

## 6. 相关环境变量

| 变量 | 作用 |
| --- | --- |
| `TRAINING_APP_BASE_URL` | 本地应用地址 |
| `TRAINING_APP_ROOT` | `Agent_Evaluation/frontend` 路径 |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | 生成模型配置 |
| `POLYMAS_COOKIE` / `POLYMAS_AUTHORIZATION` | 平台凭证 |
| `POLYMAS_COURSE_ID` / `POLYMAS_LIBRARY_ID` | 新建任务与数字人管理 |
| `POLYMAS_API_BASE_URL` / `POLYMAS_UI_BASE_URL` | 校区或私有化部署地址 |

## 7. 基础版能力训练 / 口语训练

### 7.1 模块规划

`POST /api/training-generate/plan`

```json
{
  "trainingType": "ability | oral",
  "teacherDocName": "...",
  "teacherDocContent": "...",
  "planningFeedback": "...",
  "flowPreference": "auto | linear | graph",
  "apiKey": "", "apiUrl": "", "model": ""
}
```

返回 `{plan, validation}`；`validation` 中 `level=error` 必须先修正。`plan.modules` 是阶段列表，
生成时把整个 `plan` 作为 `modulePlan` 回传，可显著减少漏阶段。

### 7.2 生成

`POST /api/training-generate`（JSON 或 multipart，`file` 支持 docx）

```json
{
  "trainingType": "ability | oral",
  "teacherDocName": "...",
  "teacherDocContent": "...",
  "generateScript": true,
  "generateRubric": true,
  "scriptMode": "general",
  "skipRubricSections": true,
  "modulePlan": { "modules": [] },
  "userSuggestions": "...",
  "apiKey": "", "apiUrl": "", "model": ""
}
```

SSE 事件：`start`、`progress`、`chunk{phase,content}`、`phase_complete{phase,fullContent}`、
`phase_snapshot`、`complete{script, rubric, taskName, resolvedScriptMode}`、`error`。
`phase` 为 `script` 或 `rubric`。口语训练必须让模型逐阶段输出「重点词汇」，
否则平台侧词汇为空。

### 7.3 注入

`POST /api/training-inject`（SSE；与 Pro 注入路由不同）

```json
{
  "trainTaskId": "...",
  "courseId": "...",
  "libraryFolderId": "...",
  "credentials": {
    "authorization": "<原始 token，不加 Bearer>",
    "cookie": "...",
    "userNid": "",
    "trainSubType": "ability | oral"
  },
  "llmSettings": { "apiKey": "", "apiUrl": "", "model": "" },
  "extractionMode": "hybrid",
  "scriptMarkdown": "...",
  "rubricMarkdown": "...（基础版必填，口语忽略）",
  "injectMode": "replace | append",
  "injectKeyVocabularies": true,
  "injectCoverImage": true,
  "injectBackgroundImage": true
}
```

- `trainSubType` 决定节点类型、`stepExtProperty` 结构以及是否写评价标准/重点词汇。
- 阶段写入 `createScriptStep` + `editScriptStep`；连线写入 `createScriptStepFlow`；
  基础版评分项写入 `createScoreItem`。
- 注入前平台必须已有 START/END 节点；新任务未初始化时，脚本用 `createScriptStep`
  直接补两个边界节点，不依赖打开编辑页。

### 7.4 平台接口（基础版/口语）

Base：`https://cloudapi.polymas.com`，前缀 `/teacher-course/abilityTrain`。

| 用途 | 方法与路径 |
| --- | --- |
| 新建任务 | `POST /teacher-course/abilityTrain/createConfiguration` |
| 查询基础配置 | `POST .../queryConfiguration` |
| 阶段列表 | `POST .../queryScriptStepList` |
| 连线列表 | `POST .../queryScriptStepFlowList` |
| 创建/编辑/删除节点 | `POST .../createScriptStep` / `editScriptStep` / `delScriptStep` |
| 创建/编辑/删除连线 | `POST .../createScriptStepFlow` / `editScriptStepFlow` / `delScriptStepFlow` |
| 评分项 | `POST .../createScoreItem` / `editScoreItem` / `delScoreItem` / `queryScoreItemList` |
| 发布 | `POST .../publishAbilityTrain` |

基础版新建请求体（口语只需改 `trainSubType` 与 `extConfig`）：

```json
{
  "trainTaskName": "...",
  "description": "...",
  "trainTaskCover": { "fileId": "", "fileUrl": "" },
  "trainSubType": "ability",
  "trainType": "all",
  "entranceVoiceNid": "",
  "entranceVoiceSpeed": 0,
  "entranceVoiceType": "",
  "courseId": "...",
  "extConfig": {
    "trainTaskName": "...",
    "description": "...",
    "trainScreen": false,
    "trainScreenType": 1,
    "speechTranscription": true,
    "entranceVoiceLanguage": "zh",
    "entranceVoiceSpeedMultiplier": 1
  }
}
```

口语 `extConfig`：`{dialogueLanguage:"en", dialogueDifficulty:"basic",
translationAssistantEnabled:false, speechToTextEnabled:false, answerAssistantEnabled:false,
keyVocabularyEnabled:false, trainScreen:false, trainScreenType:1}`。

新建返回 `{trainTaskId}`。页面：
- 基础版 `/{courseId}/ability-training/create?...&trainTaskId=`
- 口语 `/{courseId}/language-training/create?...&trainTaskId=`

### 7.5 鉴权差异

- Pro 接口只认 Cookie；额外发 `Authorization: Bearer <token>` 会 401。
- 基础版/口语接口可 Cookie-only，也可带**原始 token**（不要加 `Bearer `），
  常用 cookie 项为 `zhs-jt-cas`，回退 `ai-poly`。脚本对这类请求使用 `authStyle: "raw"`。
