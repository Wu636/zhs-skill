# zhs-skill

智慧树 / Polymas 教学工作流技能源码与版本管理。包含训练生成、训练优化、批阅技能构建、上架和智能体创建。此仓库不是平台官方SDK；接口可能变化，实际业务须遵守当前账号权限、教师确认与平台规则。

## 技能清单

| 技能 | 用途 |
|---|---|
| [training-config-generate-inject](skills/training-config-generate-inject/SKILL.md) | Pro / 基础版 / 口语训练生成、注入、测试与交付 |
| [training-optimize-inject](skills/training-optimize-inject/SKILL.md) | 拉取现有训练、按意见修订、增量更新与自审 |
| [polymas-grading-pipeline](skills/polymas-grading-pipeline/SKILL.md) | 批阅材料到技能上架、智能体创建的编排 |
| [assignment-grading-skill-builder](skills/assignment-grading-skill-builder/SKILL.md) | 从课程要求与教师样本构建批阅技能包 |
| [polymas-skill-batch-upload](skills/polymas-skill-batch-upload/SKILL.md) | 技能ZIP预检、限并发上传、定稿与课程绑定 |
| [polymas-grading-agent-create](skills/polymas-grading-agent-create/SKILL.md) | 批阅智能体限并发创建、回查与获准上线 |

## 范围和重要依赖

本仓库仅包含六个技能的说明、脚本、参考文档与测试，**不包含 Agent_Evaluation 应用源码**。

训练技能依赖另外部署的兼容 `Agent_Evaluation/frontend`，包括现有解析器、生成/注入/测试接口，以及性能优化新增的图片准备、结构化评分和增量更新实现。只克隆本仓库不能单独启动训练服务，也不会自动升级已有服务。通过本端配置的 `appRoot` 或环境变量 `TRAINING_APP_ROOT` 指向兼容应用。

批阅浏览器脚本复用当前已授权登录态；不同宿主应使用其实际可用浏览器工具，不导出凭据。

## 安装与配置

技能共享布局约定为 `~/.agents/skills/<skill-name>`；六个目录须保持同级，部分脚本依赖兄弟目录。可将本仓库 `skills/` 中的对应目录安装或链接到该位置，并在当前宿主注册技能。

**已有同名技能时先备份并比较，不直接覆盖或删除。** 此仓库不自动修改当前安装。运行配置、登录态和业务产物必须保留在本端/独立项目目录，不放进源码仓库。训练配置从 [空白示例](skills/training-config-generate-inject/config/config.example.json) 创建，真实配置不要提交。

## 性能优化

- 跨训练任务依赖调度、限并发、独立日志与失败隔离。
- 图片并发参数、短期缓存与素材保留策略（需兼容服务端）。
- 评分结构化直通、内容级增量更新（需兼容服务端）。
- 批阅上传、样本测试、定稿绑定、智能体创建的独立并发执行器。
- 未知写入先查回、不盲目重提；确认闸门不因并发而省略。

详见 [批次执行说明](skills/training-config-generate-inject/scripts/batch.README.md) 和各技能说明。

## 本地离线测试

要求现代 Node.js（建议24）与 Python 3。以下测试使用mock，不执行真实平台业务：

```bash
node --test skills/training-config-generate-inject/tests/*.test.mjs skills/training-config-generate-inject/scripts/lib/*test.mjs skills/polymas-grading-pipeline/tests/*.test.mjs
node skills/polymas-skill-batch-upload/scripts/upload_batch.test.mjs
node skills/polymas-skill-batch-upload/scripts/release_batch.test.mjs
node skills/polymas-grading-agent-create/scripts/api_create_agents.mock.test.mjs
```

依赖外部应用真实解析器/评分helper的3项测试，在未设置 `TRAINING_APP_ROOT` 时明确跳过，不代表通过。配置兼容应用路径后再运行可覆盖这些集成测试。

## 安全与公开范围

- 不提交API key、Cookie、Authorization、账号配置、教师/学生原始材料、运行记录或备份。
- 代码中的 `mock-only`、`fake-token` 等仅为离线测试占位符。
- 文档中的示例ID不应用于真实任务，执行前必须从当前授权目标获取。
- 修改或安装技能不等于授权上传、覆盖、发布或付费生成。
- 不默认选择开源许可证；公开可见不等于授予额外使用许可。

## 版本记录

见 [CHANGELOG.md](CHANGELOG.md)。本仓库从公开清理后的源码快照开始，不包含本机历史业务数据。
