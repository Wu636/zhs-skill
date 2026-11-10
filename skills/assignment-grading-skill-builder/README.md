# 作业批阅技能生成器

该 skill 用于把新课程的题目要求、教师补充说明、评分标准和教师已评分/分档样本，转化为严格符合“作业批阅 skills 模板”的课程专用批阅 skill，并固定交付：批阅名称、批阅描述、学生提交作业要求和带单一根目录的 ZIP 技能包。

## 使用方式

提供课程材料目录或压缩包，并说明已确认的歧义、格式二选一关系、教师分数目标或其他特殊要求，然后调用 `$assignment-grading-skill-builder`。

生成器会：

1. 识别当前权威要求与教师最新说明；
2. 区分必交、可选和等价格式；
3. 只在样本实际覆盖的模块建立匿名教师锚点；
4. 创建模板兼容的 `README.md`、`SKILL.md`、references 和 scripts，不加入模板外产品配置目录；
5. 执行静态验证、分档/数值回归和 ZIP 解压复验；
6. 交付可直接配置到教学平台的前三项文案与课程 ZIP。

## 脚本

- `scripts/inventory_materials.py`：盘点权威文档、样本、教师路径标签和附件类型。
- `scripts/validate_grading_skill.py`：检查 frontmatter、score、分值合计、evaluations、本地链接和 UI 元数据。
- `scripts/package_skill.py`：清理常见缓存并打包为单一根目录 ZIP。

详细流程见 `SKILL.md` 和 `references/`。
