# polymas-grading-pipeline

把课程材料一次做成可用的批阅智能体：造批阅技能包 → 上传后用教师样本或模拟样本测分、分差过大就改包重测 → 定稿上架到课程 → 创建并绑定自定义批阅智能体。

本技能只做编排：运行状态、教师确认闸门、跨阶段交接。具体做法仍由三个子技能负责：

| 阶段 | 子技能 |
|---|---|
| 造包 | `assignment-grading-skill-builder` |
| 上传/定稿/上架 | `polymas-skill-batch-upload` |
| 批阅测试 | 本技能自带 `scripts/browser/` 与 `evaluate_test_scores.py` |
| 建智能体 | `polymas-grading-agent-create` |

## 目录

```
polymas-grading-pipeline/
├── SKILL.md                          六阶段流程、批阅测试环、闸门、断点续跑与失败处理
├── README.md
├── references/
│   ├── pipeline-contract.md          状态文件字段、阶段不变式、交接字段、幂等规则
│   ├── script-map.md                 各阶段调用的脚本、参数与页面脚本入口
│   └── checklists.md                 教师确认的原文模板与各阶段检查清单
└── scripts/
    ├── check_deps.py                 检查三个子技能及所需脚本是否齐全
    ├── prepare_run.py                预检 ZIP、抽取元数据、建立/合并状态文件
    ├── pipeline_state.py             写状态、开关闸门、按阶段校验前置条件
    ├── evaluate_test_scores.py       判定教师样本/模拟样本分差并写入状态
    ├── state_to_agent_items.py       从状态生成 __agentItems 注入片段
    ├── render_report.py              从状态生成批次报告与待决事项
    ├── finalize_run.py               归集技能包/介绍/学生作业/PDF报告并清理运行目录
    └── browser/                      批阅测试的页面脚本（setup/start/poll/compact）
```

## 最短用法

```bash
SKILL_DIR="$HOME/.agents/skills/polymas-grading-pipeline"
python3 "$SKILL_DIR/scripts/check_deps.py"
```

1. 造包并按子技能要求把学生提交要求写入包内 `references/submission-requirements.md`。
2. 按 SKILL.md 将 `RUN='<项目中的绝对运行目录>'` 替换为真实绝对路径后初始化状态：`python3 "$SKILL_DIR/scripts/prepare_run.py" "$RUN/zips" --state "$RUN/pipeline-state.json" --course-name ... --school ...`。禁止把占位传给脚本；课程材料、状态与产物不得放在 `~/.agents/skills` 或技能安装树中。
3. 教师确认批阅名称/描述/要求 → `pipeline_state.py gate --name buildApproved --yes`。
4. 查课程、去重、确认上传计划 → `gate --name uploadApproved --yes`。
5. 逐个上传 → 取草稿版本 → 用教师样本或模拟样本测分；通过后再定稿 → 发布，逐步回填状态。
6. `state_to_agent_items.py --js` 生成注入片段 → 建智能体 → 回查。
7. `render_report.py --state ...` 出报告；默认不上线。
8. 交付完成后运行 `finalize_run.py --run "$RUN"`：只保留技能包、批阅技能介绍、学生作业与平台 PDF 批阅报告，并清理运行目录里的中间文件。

## 边界

- 不修改三个子技能，不内置它们的脚本；缺依赖直接报错。
- 不上传、不定稿、不发布、不上线任何未经教师确认的内容。
- 不删除技能或智能体、不切换已绑定的技能版本、不改已上线内容。
- 不读取、不导出、不保存 Cookie / localStorage / Authorization；请求只用页面登录态。
- 状态文件是唯一事实来源，运行期间保留在运行目录，供续跑与审计；交付后由 `finalize_run.py` 归集并清理，清理后不再支持续跑。
