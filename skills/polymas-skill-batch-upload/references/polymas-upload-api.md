# Polymas 技能上传接口与页面流程

记录自 2026-10-28 的 `https://pds.polymas.com/skills` 页面与打包脚本 `index-DJX5W1VG.js`、`course-preview-skills-B6nHh55G.js`、`skill-mapper-VmXXthmv.js`。

## 1. 上传接口

```http
POST https://cloudapi.polymas.com/ai-biz/v1/skill/create/unify/agentSkill
Content-Type: multipart/form-data   # 由浏览器自动带 boundary，不要手写
```

表单字段：

| 字段 | 值 | 说明 |
|---|---|---|
| `zipFile` | 文件对象 | 技能 ZIP，文件名保留 `.zip` |
| `type` | `"1"` | 技能类型，字符串形式 |
| `source` | `"BUILTIN"` | 固定值 |

前端原始实现（压缩代码）：

```js
const i = new FormData;
i.append("zipFile", e);
i.append("type", String(f.value));
i.append("source", "BUILTIN");
const N = await dn(i);           // dn = POST /ai-biz/v1/skill/create/unify/agentSkill
const F = _e(N);
if (!(F != null && F.skillNid)) throw new Error((N == null ? void 0 : N.msg) || "上传失败");
await Oe();                      // 刷新列表
```

成功判据：`code === 200` 且 `data.skillNid` 非空。响应里的 `msg` 是服务端失败原因，原样记录。

## 2. 技能类型 id

`GET /ai-biz/v1/skill/tag/options?category=TYPE` 返回：

| id | code | 名称 |
|---:|---|---|
| 92 | `PROJECT_PROCESS_REVIEW_SKILL` | 项目过程批阅技能 |
| 18 | `ABILITY_TRAIN_REVIEW_SKILL` | 能力实训批阅技能 |
| 1 | `REVIEW_SKILL` | 批阅技能 |
| 2 | `COMMON_SKILL` | 通用技能 |

前端常量：`Lo=1`（批阅）、`Kt=2`（通用）；本地创建弹窗默认 `f=o(Kt)`，即默认 type=2。

`skill-mapper` 也按 `skillType === 1 || "1" || "review"` 或 `typeTagId === 1` 判定为批阅技能。

## 3. 查重与回查

```http
POST https://cloudapi.polymas.com/ai-biz/v1/skill/cardList
Content-Type: application/json

{"pageNum":1,"pageSize":20,"queryWord":"技能名"}
```

返回 `data.records[]`，关键字段：`skillNid`、`name`、`skillType`（1/2）、`versionStatusDesc`、`taskId`、`failReason`、`typeTagId`。`queryWord` 同时匹配名称和描述，必须再用 `name` 精确比对。

其他相关接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/ai-biz/v1/skill/parseTask/runningList` | 正在解析的任务 |
| GET | `/ai-biz/v1/skill/package/retryParse?taskId=` | 重试解析 |
| DELETE | `/ai-biz/v1/skill/deleteParseTask?taskId=` | 删除解析任务 |
| POST | `/ai-biz/v1/skill/metadata/save` | 保存技能元数据 |
| GET | `/ai-biz/v1/skill/version/options/{skillNid}` | 版本列表 |
| DELETE | `/ai-biz/v1/skill/versions/{id}` | 删除版本 |

## 3.1 草稿版本

```http
GET https://cloudapi.polymas.com/ai-biz/v1/skill/{skillNid}
```

返回 `data` 是**数组**，每个元素是一个版本：

| 字段 | 说明 |
|---|---|
| `skillVersionId` | 版本 id，定稿和绑定时作为 `fileId` |
| `fileId` | 与 `skillVersionId` 相同 |
| `version` | `"草稿"` 或 `"1.0.0"` |
| `versionStatus` | 草稿为 `0`，定稿后为 `1` |
| `versionDesc` | 版本说明 |
| `bindCourseCnt` | 已引用课程数 |

刚上传的技能只有草稿项；定稿后数组首项变成正式版本，草稿消失。

未保存的草稿 `fileId` 为空、`filePath` 以 `draft/` 开头；保存过的草稿二者都有值。这个差别决定能不能直接定稿（见 3.2）。

## 3.2 定稿（生成正式版本）

前端源码（`im_capability_square` 主包）：

```js
handlePublish: async () => { const m = await pI(e.value); /* GET /ai-biz/v1/skill/publishVersionNo/{skillNid} */ }
handlePublishConfirm: async ({publishVersion, versionDesc}) => {
  const _ = { userId: userInfo?.userNid, userName: userInfo?.nickName || userInfo?.userName || "",
              skillVersionId: n.value, skillNid: e.value, publishVersion, versionDesc };
  const h = await dI(_);   // POST /ai-biz/v1/skill/publish
  if (h?.code === 200) { se.success("定稿成功"); /* URL 增加 versionStatus=1 */ }
}
```

**必须先保存草稿。** 界面上“保存”按钮对应的就是这一步：

```http
POST /ai-biz/v1/skill/draft/save
Content-Type: application/json

{"skillNid":"efGaOQrMoD","skillVersionId":"p13tzqUK6a","userName":"吴盈","fileTree":""}
```

上传接口只创建了草稿记录，从未保存过文件树。跳过保存直接调 `/skill/publish`，服务端返回 `{"code":10006,"msg":""}`，页面提示“定稿失败”，且不写任何原因。这是最容易卡住的一步。

保存后也不要立刻定稿，服务端还要落库，紧接着发仍可能是 `10006`。实测重试 2—3 次（间隔 3—4 秒）即可成功；`finalize_skill.js` 里最多重试 6 次，只对 `10006` 重试。

三步：

```http
POST /ai-biz/v1/skill/draft/save          # 1. 保存草稿
GET  /ai-biz/v1/skill/publishVersionNo/{skillNid}   # 2. 取版本号
POST /ai-biz/v1/skill/publish             # 3. 定稿（10006 时重试）
Content-Type: application/json

{"userId":"JAOpYEAj91","userName":"吴盈","skillVersionId":"JjxkbZ24Aa",
 "skillNid":"E7c4mzgEks","publishVersion":"1.0.0","versionDesc":"首次定稿：生成 1.0.0 版本"}
```

- `draft/save` 的 `fileTree` 传空串即可，不会覆盖 SKILL.md 等已上传文件。
- `publishVersionNo` 的 `data` 是可直接提交的版本号字符串，新上传返回 `"1.0.0"`；已定稿 1.0.0 后返回 `"1.0.1"`。提交时去掉可能的前导 `V`。
- `userId/userName` 来自 `POST /console/v1/get-current-user-detail`（body `{}`）的 `userNid` / `nickName`（无 `nickName` 时退到 `userName`、`realName`）。
- 成功判据：`code === 200`。页面提示“定稿成功”，URL 追加 `versionStatus=1`，右上角按钮从 `定稿` 变成 `创建草稿`。
- 重复定稿会递增版本号，不会覆盖上一版。

## 3.3 发布到课程（绑定引用）

发布入口只在定稿后出现：技能卡片 `⋯` → `发布` → `课程技能` → 选择课程 → `确认发布`。

候选课程查询（`course-preview-skills` 模块）：

```http
POST /course-deliver/course-skill/pageList
Content-Type: application/json

{"pageNum":1,"pageSize":50,"searchKey":"采购与供应管理 内蒙古商贸职业学院"}
```

返回 `data.records[]`：

| 字段 | 说明 |
|---|---|
| `courseId` | 课程 id |
| `courseName` | 课程全名，含机构后缀 |
| `folderId` | 绑定必填，课程所在目录 id |
| `courseRealName` | 课程负责人 |
| `courseSchoolName` | 所属机构 |
| `skillCount` | 课程已有技能数 |

确认发布：

```http
POST /course-deliver/course-skill/batchBindSkill
Content-Type: application/json

{"resourceItems":[{"folderId":"gqUh50ERzt","courseId":"pbDQpwk2EefJwAl53aWL"}],
 "skillVersions":[{"skillNid":"E7c4mzgEks","fileId":"JjxkbZ24Aa"}]}
```

`skillVersions[].fileId` 就是 `skillVersionId`。

回查引用数：

```http
GET /ai-biz/v1/skill/version/checkBindCoursesByNid?skillNid={skillNid}
```

`data` 为已引用课程数（整数）。另有 `GET /ai-biz/v1/skill/version/checkBindCourse/{skillVersionId}`，返回该版本被引用的课程数。

相关但**不要代做**的接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/course-deliver/course-skill/queryRefCoursePageList` | 发布弹窗里的候选课程（已绑定课程会被排除） |
| POST | `/course-deliver/course-skill/bindVersionPageList` | 技能详情页“管理引用课程”列表 |
| POST | `/course-deliver/course-skill/switchVersion` | 切换课程使用的版本 |
| POST | `/course-deliver/course-skill/batchUnbindSkills` | 批量移除引用 |

## 4. 界面流程与选择器

1. `创建技能` → 弹窗：`创建空白技能`、`本地上传`、模版列表、类型筛选按钮。
2. 选类型 → 点 `本地上传` → 弹窗“创建通用技能”（标题固定，不代表类型）。
3. 文件输入：

```html
<input class="el-upload__input" type="file" name="file"
       accept=".zip,.ZIP,application/zip,application/x-zip-compressed">
```

该 input 默认隐藏且 `auto-upload=false`，选中文件不会发请求，必须点 `提交`。
4. `提交` 后 emit 文件对象，父组件调用上述上传接口，成功后 `上传成功` 并刷新列表。

## 5. 实测记录（2026-10-28）

上传 `实训1_戴尔采购案例PPT批阅.zip`（`type=1`）：

- 请求：`POST /ai-biz/v1/skill/create/unify/agentSkill`，HTTP 200。
- 响应：`{"code":200,"data":{"skillNid":"E7c4mzgEks","name":"procurement-dell-case-ppt-grading"},...}`。
- 列表回查：`skillType=1`、`typeTagId=1`、`versionStatus=0`（草稿）、`failReason` 为空、`taskId` 为空。
- 技能详情 `GET /ai-biz/v1/skill/{skillNid}` 返回数组，首项含 `skillVersionId`（草稿版本号 `JjxkbZ24Aa`）、`name`、`description`、`filePath`、`updatedBy`。
- 页面内 `fetch(..., {credentials:'include'})` 的 GET 与 multipart POST 均无需额外鉴权头。

定稿与发布（同一个技能）：

- `GET /ai-biz/v1/skill/publishVersionNo/E7c4mzgEks` → `{"code":200,"data":"1.0.0"}`。
- `POST /ai-biz/v1/skill/publish`（payload 见 3.2）→ `code=200`，页面提示“定稿成功”，列表出现 `1.0.0`。
- 定稿后 `publishVersionNo` 变为 `"1.0.1"`；`GET /ai-biz/v1/skill/E7c4mzgEks` 首项 `version="1.0.0"`、`versionStatus=1`，草稿项消失。
- `POST /course-deliver/course-skill/pageList` 用 `searchKey="采购与供应管理"` 命中 `courseId=pbDQpwk2EefJwAl53aWL`、`folderId=gqUh50ERzt`、`courseSchoolName=内蒙古商贸职业学院`。
- `POST /course-deliver/course-skill/batchBindSkill`（payload 见 3.3）→ `code=200`；技能详情页“引用课程数”由 0 变 1，“管理引用课程”表格出现该课程，使用版本 1.0.0。
- `GET /ai-biz/v1/skill/version/checkBindCoursesByNid?skillNid=E7c4mzgEks` → `{"code":200,"data":1}`。
- 发布后再次用同一课程查询 `queryRefCoursePageList`，返回 0 条（已绑定的课程不再出现在候选里）。

结论：`type=1` 确实落为批阅技能；上传后是草稿状态，`cnName` 为空，卡片名称显示 SKILL.md 的 `name`（英文 slug），描述显示中文 description。只有走完 定稿 → 发布 才会在课程中可用，卡片 meta 从“未发布”变为“课程”。

批次实测（2026-10-28，实训4—11 共 8 个包，全部 `type=1`，全部定稿 `1.0.0` 并绑定同一课程）：

| 包 | skillNid | 定稿版本 | 绑定课程数 | 备注 |
|---|---|---|---|---|
| 实训4 | `rnwTBCUtda` | 1.0.0 | 1 | 另有一个未定稿的重复草稿 `ekhUoXtERn`（15 秒超时后误重试产生） |
| 实训5 | `glr6CXmR4j` | 1.0.0 | 1 | 10006 → 等 6 秒 → 成功 |
| 实训6 | `efGaOQrMoD` | 1.0.0 | 1 | 保存后第 3 次定稿成功 |
| 实训7 | `CgjwlhXZY8` | 1.0.0 | 1 | 保存后第 3 次定稿成功 |
| 实训8 | `0I7oSAqsjz` | 1.0.0 | 1 | 脚本 3 次重试用尽仍 10006，隔一次单独重发即 200 |
| 实训9 | `X1rcOHgWd0` | 1.0.0 | 1 | 保存后第 3 次定稿成功 |
| 实训10 | `hIxPOf0DPD` | 1.0.0 | 1 | 保存后第 3 次定稿成功 |
| 实训11 | `tPsAHdr7Nc` | 1.0.0 | 1 | 保存后第 3 次定稿成功 |

结论补充：

- 每个包从上传到绑定约 1 分钟，主要耗时在上传解析（20—30 秒）和 10006 重试窗口。
- 10006 的重试窗口不稳定：有时 6 秒够，有时 12 秒还不够。脚本重试耗尽后不要重新上传，隔 5—10 秒对同一个 `skillVersionId` 再发一次 `publish` 即可。
- 全部 9 个技能最终都是单版本 `1.0.0`、`bindCourseCnt=1`，详情接口里已无草稿项。

## 6. 已知坑
- **上传必须 fire-and-poll**：`evaluate_script` 15 秒超时，上传要 20—30 秒。`await` 整个请求会超时，而服务端照常建出技能；重试就多一个同名草稿（实训4 的 `ekhUoXtERn` 就是这么来的）。发起后立刻返回，轮询 `window.__uploadState`。
- **定稿前必须保存草稿**：上传落的草稿 `fileId` 为空，直接 `publish` 只会得到 `code 10006` + 空 `msg`；界面上点“保存”再“定稿”就好了。
- **10006 要重试但别重传**：保存后落库有延迟，隔 3—10 秒重发 `publish`。重传 ZIP 只会多一个草稿。
- **弹窗标题误导**：本地上传弹窗永远叫“创建通用技能”，实际类型由创建弹窗里选中的类型决定；不选则 type=2。
- **选文件不等于上传**：`auto-upload: false`，网络面板在点“提交”前没有任何请求。
- **解析异步**：上传返回即建了草稿，解析可能稍后完成或失败，要看 `failReason`。
- **同名不覆盖**：接口只新建；重名会得到两个技能或服务端报错，需人工处理。
- **登录态在浏览器**：直接 `fetch(..., {credentials:'include'})` 即可，不要自行拼 Authorization。
- **上传 ≠ 上架**：草稿没有“发布”入口，必须先定稿；定稿对话框里的版本号不是随便填的，用 `publishVersionNo` 返回值。
- **重复定稿会升版**：已定稿的技能再定稿会生成 `1.0.1`，而课程仍引用旧版本，需要额外“切换版本”，不要重复点。
- **同名课程跨校存在**：`pageList` 的 `searchKey` 是模糊匹配，必须用 `courseName` 全名精确比对，并核对 `courseSchoolName`。
- **绑定要 folderId**：`batchBindSkill` 缺 `folderId` 会失败，它只出现在 `pageList` 记录里，不能凭 `courseId` 猜。
- **发布入口在卡片上**：`⋯` → `发布`，不在技能详情页的“管理引用课程”里。走错入口会让人误以为没有发布入口。
