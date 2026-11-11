# 能力训练 Pro 配置格式

前置：按基础技能 `SKILL.md`「共享代码与本端数据」设 `TRAIN="$HOME/.agents/skills/training-config-generate-inject"`、`OPT="$HOME/.agents/skills/training-optimize-inject"`，明确导出 `TRAINING_CLIENT`（`qoder-cn|qoder|dsh|hermes`），先用 `node "$TRAIN/scripts/run.mjs" paths`（不读配置、不联网）确认本端。配置、凭据、runs/tmp 只留所选端原目录，禁止回退他端或写入共享树。

生成接口 `/api/training-generate-pro` 输出的 Markdown 必须能被
`frontend/lib/training-injector-pro/parser.ts` 解析。注入脚本 `validate` 直接加载该解析器，
因此这里的规则与实际注入完全一致。

## 顶层结构

```markdown
# {能力名称} - 能力训练 Pro 配置

## 全局配置
- **能力名称**:
- **描述**:
- **训练方式**: 学生自选 | 语音 | 文本
- **默认打开字幕**: 是 | 否
- **全程开启摄像头**: 是 | 否
- **训练总时长**: 不限时 | 自动 | 数字（分钟）
- **入场音色**: 音色名称，可空
- **封面图描述**: 用于 AI 生图的一句话

## 全局成员配置
### 成员1: {AI 角色名}
- **数字人性别**: 男性 | 女性
- **数字人年龄层**: 儿童 | 成年 | 老年
- **角色描述**: 平台 global-role.prompt，必填
- **模型**: Doubao-Seed-2.0-pro
- **声音**: 音色名称，可空
- **形象描述**: 用于 AI 生成头像
- **技能**:
  - {技能名} | 类型: 自定义技能 | 描述: 触发条件
    <skill_instruction>
    ### 命令
    ### 使用场景
    ### 执行规则
    ### 输出解释
    ### 示例
    </skill_instruction>

## 训练剧本
### 阶段1: {卡片名称}
**卡片描述**:
**用户扮演角色名称**:
**AI 对用户称呼**:
**用户扮演角色描述**:
**剧本模型**: Doubao-Seed-2.0-pro
**对话结束策略**: 达成目标后结束 | 超时结束 | 手动结束
**是否可跳过**: 是 | 否
**背景图描述**:

**阶段剧本提示词**:
<script_prompt>
依据剧本设定统筹实训进程，按既定逻辑调度各角色，有序分配对应任务与履职动作。

【阶段触发条件】
【背景设定】
【完整执行流程】
步骤1 - 环节：
  - 参与人员：@成员名
  - 具体动作：
【阶段结束判定】
达成结束条件后，跳转到【阶段2 名称】阶段
【行为边界规范】
- 允许：
- 禁止：
</script_prompt>
```

## 硬性规则

1. **五维结构缺一不可**：阶段触发条件、背景设定、完整执行流程、阶段结束判定、行为边界规范。
2. **跳转写在提示词里**：Pro 版没有连线。非最后阶段必须写出下一阶段的**具体名称**；
   最后阶段写「结束本次实训」。
3. **成员引用用 `@成员名`**，成员名必须与「全局成员配置」一致。
4. **参训学生统一称「用户」**，不要写「学生/学员」，也不要输出 `<role>` 标签或 nid；
   注入时会把 `@成员名` 转成 `<role>nid</role>`。
5. **一个技能一段 instruction**：`<skill_instruction>` 不能为空，且要与技能职责对应。
6. **不要占位符**：`[阶段名称]`、`[具体内容]`、`待补充`、省略号都会被判为可疑内容。
7. **名称唯一**：阶段名称、成员名称不能重复，否则平台会混淆复用与跳转。

## 校验命令

```bash
node "$TRAIN/scripts/run.mjs" normalize --run <运行目录>     # 先做机械修正
node "$TRAIN/scripts/run.mjs" validate <配置.md>
node "$TRAIN/scripts/run.mjs" validate --run <运行目录>
```

退出码 0 表示无 error；warn 不影响注入，但建议修正。

`normalize` 对 Pro 会自动删除 `<role>` 标签、把 `<script_prompt>` 内的
「学生/学员」改为「用户」，并列出每阶段缺失的五维段落和下一阶段跳转句。
这些内容缺失不做臆造，由 Agent 依据教师文档补进 `config.md` 后重跑。

## 常见问题与修法

| 现象 | 原因 | 修法 |
| --- | --- | --- |
| `未解析到训练阶段` | 阶段标题不是 `### 阶段N: 名称` | 按模板重写标题 |
| `缺少五维结构` | LLM 漏写某一维度 | 直接编辑 config.md 补齐 |
| `未写明跳转到下一阶段` | 只写了「进入下一阶段」 | 写出具体阶段名称 |
| `引用了未定义的成员` | `@某人` 与成员名不一致 | 统一名称或删除引用 |
| `技能缺少 <skill_instruction>` | 只写了技能描述 | 补命令/场景/规则/输出/示例 |
| `包含 <role> 标签` | 生成时越权输出 nid | 删除标签，保留 `@成员名` |

## 生成时提升质量的建议

- `--advice` 里明确写出：目标学员层次、阶段数量、必须覆盖的业务流程、期望的角色数量。
- 建议生成后先跑 `validate`，再人工看一遍阶段跳转名称是否首尾相接。
- 需要课堂预演时，用 `dialogue --run <目录>` 生成指定阶段的学生-智能体对话。

---

# 基础版能力训练 / 口语训练配置格式

生成接口 `/api/training-generate` 输出两份 Markdown：剧本 `script.md` 与评价标准
`rubric.md`。校验直接加载 `frontend/lib/training-injector/parser.ts` 的
`parseTrainingScript` / `parseRubricMarkdown`，与实际注入一致。

## 剧本结构

````markdown
# {任务名称} - 训练剧本配置

## 基础配置
- **任务名称**: ...
- **任务描述**: ...
- **智能体角色**: ...
- **目标受众**: ...

## 训练阶段

<!-- STAGE_START:1 -->
### 阶段1: {阶段名}
**虚拟训练官名字**: ...
**数字人性别**: 女性
**数字人年龄层**: 成年
**模型**: roleplay
**声音**: 默认
**形象**: 默认
**阶段描述**: ...
**背景图**: ...
**互动轮次**: 3
**flowCondition**: "接下来我们将进入下一阶段"
**transitionPrompt**: ...

**重点词汇**:            <!-- 仅口语训练必须 -->
```json
[{"vocabulary":"...","explanation":"...","exampleSentence":"...","source":"..."}]
```

**开场白**: ...
**提示词**: ...
```markdown
# Role
# Context & Task
# Opening Line
# Workflow & Interaction Rules
# Response Constraints
```
<!-- STAGE_END:1 -->
````

## 硬性规则

1. 每个阶段必须有 `### 阶段N: 名称`、`阶段描述`、`开场白`、`提示词`。
2. 口语训练每个阶段必须有 `**重点词汇**:` 字段，后接 JSON 数组；没有文档依据时输出 `[]`。
3. 基础版必须生成评价标准，口语不生成评价标准。
4. 阶段名称不能重复；多阶段默认线性推进，分支流程用 `flowCondition` 与连线配置表达。
5. 剧本中不要输出平台 nid；数字人、音色由注入器按配置匹配。
6. `互动轮次` 只写数字（解析器取首个 `\d+`，平台上限 30）。它不等于必须按轮次结束：
   往返多或浮动大的阶段应在剧本 `配置说明` 注明平台要设「按时长 → 不限时」
   （`endStrategy=0`、`interactiveRounds=-1`、`trainTime=-1`），数字轮次仅作重新注入时的备用上限。
7. 线性剧本每个非末阶段提示词末尾必须有 `# 跳转输出（最高优先级…）` 段，最后阶段必须有
   `# 结束输出（最高优先级…）` 段：平台按整条消息精确匹配，段内要写死逐字跳转词
   （`接下来我们将进入下一阶段` / `本次实训到此结束` 或阶段自己的 `flowCondition`）、
   禁止与确认语/标点/换行混发、给错误示例和字符数自检。缺少时 `normalize` 会自动补
   （仅限使用默认/`flowCondition` 跳转词的线性阶段），`validate` 会给 `warn`。
   完整示例（跳转版 + 结束语版）与替换规则见 `references/jump-output-block.md`，
   `normalize` 自动补的文本与该示例逐字一致。

## 评价标准结构（基础版）

```markdown
# {任务名称} - 评价标准

## 总分：100 分
## 一、{评分项名称}（{分值} 分）
**评价描述：** ...
**评分区间：**
- **{区间} 分：** ...
```

解析后按评分项逐条写入平台 `createScoreItem`。

## 校验命令

```bash
node "$TRAIN/scripts/run.mjs" normalize --run <运行目录>              # 自动读 run.json 的 type
node "$TRAIN/scripts/run.mjs" validate --run <运行目录>              # 自动读 run.json 的 type
node "$TRAIN/scripts/run.mjs" validate <剧本.md> --type ability|oral
```

基础版/口语的 error 包括：缺任务名、无阶段、阶段名重复、提示词为空、口语词汇 JSON 解析失败；
warn 包括：缺描述/开场白/智能体名、缺重点词汇字段、词汇为空、未生成评价标准。

## 生成不规范时的修正顺序

生成模型偶尔会换键名或用错围栏，先跑 `normalize` 再 `validate`：

```bash
node "$TRAIN/scripts/run.mjs" normalize --run <运行目录> --type oral
node "$TRAIN/scripts/run.mjs" validate --run <运行目录>
```

`normalize` 自动处理：

| 问题 | 处理 |
| --- | --- |
| `~~~` 代码围栏 | 改为 ` ``` `（解析器只认反引号围栏） |
| 词汇键名 `vocabulary/translation/chinese/example/basis` | 统一为 `term / meaning / source / exampleSentence` |
| 词汇数组带尾逗号、或夹在说明文字里 | 提取 `[...]` 并去尾逗号后重新序列化 |
| `**重点词汇**` 后没有 JSON 块 | 补空数组 `[]`，并在 pending 中提示补真实词汇 |
| 词条只有字符串 | 转成 `{term, meaning:"", source:"", exampleSentence:""}` 并提示补全 |

脚本只做机械修正。`pending` 里属于内容缺失的项（释义、例句、开场白、提示词、评价标准、
阶段数量不符）必须由 Agent 依据教师文档与用户建议直接编辑 `script.md` / `rubric.md` 补全，
补完再跑一次 `normalize` + `validate`；不要带着 error 注入，也不要编造文档里没有的事实。
原始文件会保留为 `script.orig.md`，修正记录在 `normalize.json`。
