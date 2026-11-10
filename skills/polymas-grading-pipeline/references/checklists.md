# 闸门与检查清单

三次确认都必须拿到教师明确的“继续”，沉默、默认或“应该可以”都不算。确认前把表中信息完整展示出来。

## 闸门 A：造包结果

展示内容（每门实验一行）：

| 字段 | 要求 |
|---|---|
| 批阅名称 | 面向教师，不含内部术语 |
| 批阅描述 | 说明批阅对象、格式、六个维度与总分 |
| 学生提交要求 | 必交、可选、二选一格式齐全，无评分内部逻辑 |
| 分值结构 | 六个维度及分值，合计 100 |
| ZIP | 文件名、大小、sha256 前 12 位、预检结果 |

提问：“以上 N 个批阅技能包是否按此名称、描述、要求和分值定稿？确认后进入上传。”

通过后：

```bash
python3 "$SKILL_DIR/scripts/pipeline_state.py" gate --state "$ST" --name buildApproved --yes
```

## 闸门 B：上传与上架计划

展示内容：

| 字段 | 要求 |
|---|---|
| 目标课程 | 课程全名 + 机构 + `courseId` |
| 目标类型 | 批阅技能（type=1） |
| 每个 ZIP | 名称、大小、sha256、查重结果 |
| 动作 | 上传 → 批阅测试 → 定稿 1.0.0 → 发布到该课程 |
| 影响 | 定稿与发布对选课师生可见；测试只跑草稿，不改课程内容 |

提问：“确认把以上 N 个技能上传、定稿并发布到「课程名（机构）」？”

通过后：

```bash
python3 "$SKILL_DIR/scripts/pipeline_state.py" gate --state "$ST" --name uploadApproved --yes
python3 "$SKILL_DIR/scripts/pipeline_state.py" check --state "$ST" --for upload
```

## 闸门 D：批阅测试结论

通过时不需要额外确认，直接进入定稿。以下三种情况必须拿到教师明确同意：

| 情况 | 展示内容 | 确认命令 |
|---|---|---|
| 教师选择不测试 | 无样本原因、直接发布的风险 | `gate --name testApproved --yes` |
| 测试待定（`inconclusive`） | 未完成样本、报告状态、重测计划 | 同上 |
| 测试未通过但教师要求继续 | 每份样本的实测/教师分、分项差距、已知风险 | 同上 |

提问：“测试结论是 X，是否仍按当前版本定稿并发布？”

## 闸门 C：智能体上线

展示内容：第 5 步回查表（名称 / 绑定版本 / instanceNid / 保存状态 / 回查结果）。

提问：“这些智能体现在上线吗？上线后该课程所有师生可见。”

通过后：

```bash
python3 "$SKILL_DIR/scripts/pipeline_state.py" gate --state "$ST" --name onlineApproved --yes
```

先上线一条，回查为 `online` 并到课程端确认学生可见，再上线其余。

## 阶段检查清单

### 造包完成

- [ ] 每个包根目录唯一，目录名与 frontmatter `name` 一致
- [ ] 根目录只有 `README.md`、`SKILL.md`，以及 `references/`、`scripts/`
- [ ] `references/submission-requirements.md` 存在且非空
- [ ] `validate_grading_skill.py` 通过，六维合计 100
- [ ] 包内无学生样本、姓名、学号、教师分数文件
- [ ] `prepare_run.py` 预检全部 `ok`

### 上传前

- [ ] `pds.polymas.com/skills` 已登录（`check_login.js` 返回 200）
- [ ] 课程在 `exact` 里唯一命中，机构一致
- [ ] 同名查重完成，冲突已由教师决定
- [ ] `check --for upload` 通过

### 批阅测试后

- [ ] 教师样本 1—3 份，均有教师总分与满分；无样本时已询问并留痕
- [ ] 每份报告 `reportStatus=SUCCESS`，分数取自 `scoreData.totalScore/fullMark`
- [ ] 教师样本单份分差 ≤8、MAE ≤5；模拟样本次序 好≥85 / 中70—84 / 差<70
- [ ] `test.status` 已写入，轮次与候选记录完整
- [ ] 只有通过测试的 `skillVersionId` 进入定稿；失败候选保持草稿
- [ ] 跳过/待定/带病通过时 `testApproved` 已确认

### 上传后

- [ ] 每个成功技能有 `skillNid`
- [ ] 定稿返回 `1.0.0` 且取得 `skillVersionId`
- [ ] `finalize.skillVersionId` 与 `test.skillVersionId` 一致
- [ ] 发布后 `boundCount > 0`
- [ ] 失败项已记录服务端原文，未进入阶段 4
- [ ] `check --for agent` 通过

### 建智能体后

- [ ] 每条有 `instanceNid`
- [ ] 名称、描述、要求逐字一致
- [ ] `requirementType=FIXED`，`fullMark=[100]`
- [ ] `skills` 含本次定稿的 `skillVersionId`
- [ ] 状态为 `building`，未误上线

### 交付前

- [ ] `render_report.py` 输出完整，合计与逐条一致
- [ ] 待决事项列清楚（未确认闸门、失败项、未验证项）
- [ ] 两个页面的 `cleanup.js` 已执行
- [ ] 状态文件保留在运行目录

## 常见误操作

| 误操作 | 后果 | 正确做法 |
|---|---|---|
| 直接定稿不保存草稿 | `10006`，界面只显示“定稿失败” | 先 `draft/save` |
| 为确认再定稿一次 | 生成 1.0.1，课程仍引 1.0.0 | 回查详情，不重复定稿 |
| 上传超时后整批重跑 | 同名重复技能 | fire-and-poll，先查重 |
| 智能体创建超时后重跑 | 两条同名智能体 | 轮询状态，用 `instanceNid` 补存 |
| 技能上传失败仍建智能体 | 绑定为空或绑旧版本 | 先过 `check --for agent` |
| 测已定稿版本而不是草稿 | 改技能后无法再测同一版本，只能升版 | 测试固定用 `test.skillVersionId` 草稿 |
| 没教师分就测试 | 无法判定分差 | 先要总分/满分，或改用模拟样本 |
| 学生样本放进技能包 | 泄露学生信息、包结构不合规 | 样本只放 `$RUN/test/` |
| 测试失败仍定稿旧候选 | 上线错误判分 | 改包重传新候选，旧候选不定稿 |
| 用技能库最新版本绑定 | 与课程引用版本不一致 | 用本次 `finalize.skillVersionId` |
| 把 `agentId` 删掉重开页面 | 上下文丢失 | 从创建页 URL 取，补到列表页 URL |
