# AI 教学中心 · 自定义批阅智能体创建

记录自 2026-10-29 的课程资源库页面（`hike-teaching-center.polymas.com`），主包 `index-Cud782dI.js`、创建页 `index-BeO5g8ux.js`、接口模块 `skill-grading-agent-DnZ5Csod.js`。

## 1. 页面与 URL

| 页面 | URL |
|---|---|
| 课程资源库 · 智能体列表 | `https://hike-teaching-center.polymas.com/agent-course-full/resource-hub/{courseId}/agent-course-library/{folderId}/agent?term={term}` |
| 自定义批阅 · 创建/编辑 | `https://hike-teaching-center.polymas.com/agent-course-full/{courseId}/resource/skill-grading/create?agentId={agentRefNid}&libraryId={folderId}&createUser=1&isCreate=1&from=library&agentCode=skill_grading&businessType=course&businessId={courseId}` |

- `agentRefNid`（列表里叫 `agentId`）是“自定义批阅”这个模板 Agent 的 id，本课程是 `WnbFhi2YR1`；同一模板在不同学校可能不同，从已有卡片的 `agentId` 读，不要写死。
- `term` 是学期 id，本课程为 `20271`（2026 年秋冬学期）。创建页 URL 里通常不带 `term`，`api_ctx.js` 会从页面已发生的请求 URL（`?term=`）里补，补不到直接报错。
- **创建页打开时不会建实例**：只请求 `GET /agents/v1/query/template/config`，URL 停在 `isCreate=1`、`instanceNid` 为空，列表里也不会多记录。**点 `保存` 时才调 `POST /agents/v1/create/agent` + `/basic-course/courseAgent/createRef`**，URL 随后变成 `isCreate=0&instanceNid=xxx`。（早期记录写成“点开即建实例”，2026-10-29 复核后更正。）

## 2. 创建流程（界面）

1. 资源库列表页 → 先点页签 `批阅智能体`（在“全部 / 批阅智能体 / 课堂智能体 / 其他智能体”里）；不切这个页签，工具栏没有创建入口。
2. 点工具栏 `创建批阅智能体`（`.search-section .base-button-component`，文本精确匹配）。注意 `添加` 是课程级下拉菜单（创建作业/考试/课件…），不是这里的入口。
3. 弹窗 `选择Agent批阅类型`：8 个卡片（题卷 / 语言写作 / 论文报告 / 视觉设计 / 演示文稿PPT / 自定义批阅 / 能力实训 / 项目过程）。
   点 `.content-item` 里 `.title` 为 `自定义批阅` 的那张 → 进入创建页。
4. 等 `instanceNid` 出现且出现名称输入框（约 2—5 秒）。
5. `基础配置`：批阅名称（`input[type=text]`，placeholder “建议使用与批阅内容相关的名称”，maxlength 500）；批阅描述（Tiptap，上限 2000 字）。
6. `全局信息` → 作业要求 → 选 `手动填写固定要求` → Tiptap（上限 5000 字）。默认项是 `动态获取`，不切过去编辑器不出现。
7. `批阅配置` → `添加技能` → 弹窗 `选择技能`（搜索框 placeholder “请输入关键词”、卡片 `.skill-option-card`、`.skill-name`）→ 勾选 `.el-checkbox` → `确定`。
   列表只含本课程已绑定的技能（来自 `/agents/v1/custom/grading/skill/pageList`），技能绑定见 `polymas-skill-batch-upload`。
8. `保存`（`.save-btn`）→ toast “保存成功”，`上线` 按钮从禁用变可用。
9. `上线` → toast “上线成功”，列表 `state=1`，卡片从“建设中”进“已上线”。

创建页顶部三个页签：`基础配置` / `全局信息` / `批阅配置`；右上角只有 `保存` 和 `上线`（没有“发布”）。

## 3. 接口

### 3.1 列表与去重

```http
POST /teacher-course/course/library/courseAgent/page
{"courseId":"pbDQpwk2EefJwAl53aWL","libraryFolderId":"gqUh50ERzt","state":0,
 "keyword":"","pageNum":1,"pageSize":100,"sTag":"agent_mark","term":20271}
```

- `state=0` 建设中（未上线），`state=1` 已上线。
- 返回体是 `data.list`（不是 `records`），`data.total` 是条数；实测 `state=0/1` 各查一次再合并。
- 记录字段：`instanceNid`（= agentInstanceId = courseAgentId 的前半段）、`instanceName`、`desc`、`isPublish`、`agentId`、`agentCode`（`skill_grading`）、`agentType`（`agent_mark`）、`businessConfig`（JSON 字符串）。
- `businessConfig.gradingConfiguration.skills` 是**技能版本 id 数组**（如 `["JjxkbZ24Aa"]`，对应 `skillVersionId`，不是 skillName）。
- `businessConfig.compositionRequirement.writingRequirementType` 为 `FIXED`（手动填写）/ `STATIC`（动态获取），`writingRequirement` 是作业要求正文。
- 数量接口：`POST /teacher-course/course/library/agent/count` `{libraryFolderId,courseId,term,sTag:"agent_mark"}`。

### 3.2 创建 / 保存 / 上线

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/agents/v1/query/template/config?businessType=SMART_AGENT_COURSE&agentNid=&courseId=&term=` | 取模板默认模型等配置（创建页加载时调一次） |
| GET | `/ai-biz/v1/correction-skill/global-instruction-default?courseId=&term=` | 默认全局批阅指令 |
| POST | `/agents/v1/create/agent` | 建实例（**点保存时**调用，返回 `data` 即 `instanceNid`） |
| POST | `/basic-course/courseAgent/createRef` | 把实例挂到课程资源库 |
| POST | `/agents/v1/update/agent` | 保存（`{agentInstanceNid,ignoreNull:false,...基础信息,businessConfig:JSON串}`），返回新 version |
| POST | `/basic-course/courseAgent/updateRef` | 保存后更新引用（`isPublish:0`） |
| POST | `/basic-course/courseAgent/publish` | 上线（`{courseAgentId:instanceNid,courseId,agentInstanceId,libraryFolderId,isPublish:1,businessType,businessId,agentType}`） |

保存按钮的内部顺序是 `update/agent` → `updateRef`；上线前前端会做校验（名称、描述、作业要求、至少一个技能、评分模块配置），不通过只弹 toast，不发请求。

上线走接口时不需要这些前端校验，**必须自己确保 `businessConfig` 三块齐全**，否则会出现“已上线但打不开/没技能”的空壳。

### 3.3 真实请求体（2026-10-29 抓取）

```jsonc
// POST /agents/v1/create/agent
{
  "businessType": "SMART_AGENT_COURSE",
  "agentRefNid": "WnbFhi2YR1",
  "userId": "Xv1sRbxqpw",
  "schoolId": "15257",
  "businessConfig": "{...}",
  "avatar": "https://prod-polymas.oss-cn-hangzhou.aliyuncs.com/...png",
  "instanceName": "实训8 MRP采购订单Excel批阅",
  "desc": "批阅采购与供应管理实训8……"
}
// → {"code":200,"data":"iL_fBGHXhn"}

// POST /basic-course/courseAgent/createRef
{"courseId":"pbDQpwk2EefJwAl53aWL","agentId":"WnbFhi2YR1","agentInstanceId":"iL_fBGHXhn",
 "businessType":"course","businessId":"pbDQpwk2EefJwAl53aWL","agentType":"agent_mark"}

// POST /agents/v1/update/agent
{"agentInstanceNid":"iL_fBGHXhn","ignoreNull":false,"avatar":"…png",
 "instanceName":"实训8 MRP采购订单Excel批阅","desc":"…","businessConfig":"{...}",
 "courseId":"pbDQpwk2EefJwAl53aWL","term":20271}
// → {"code":200,"data":1}   data 是 version，原样传给 updateRef

// POST /basic-course/courseAgent/updateRef
{"courseId":"pbDQpwk2EefJwAl53aWL","agentId":"WnbFhi2YR1","agentInstanceId":"iL_fBGHXhn",
 "version":1,"createUser":"Xv1sRbxqpw","libraryFolderId":"gqUh50ERzt","isPublish":0,
 "businessType":"course","businessId":"pbDQpwk2EefJwAl53aWL","agentType":"agent_mark","term":20271}

// POST /basic-course/courseAgent/publish
{"courseAgentId":"iL_fBGHXhn","courseId":"pbDQpwk2EefJwAl53aWL","agentInstanceId":"iL_fBGHXhn",
 "libraryFolderId":"gqUh50ERzt","isPublish":1,
 "businessType":"course","businessId":"pbDQpwk2EefJwAl53aWL","agentType":"agent_mark","term":20271}
// → {"code":200,"data":true}
```

`userId` / `schoolId` 取自页面登录态 `window.__MAIN_APP_USER_DATA__.polyUserInfo`（`userNid`、`schoolInfo.schoolId`），不是从 Cookie 或 localStorage 读。

接口域名为 `https://cloudapi.polymas.com`；页面同源请求必须带上完整域名，用相对路径会落到 `hike-teaching-center` 上返回 HTML。

### 3.4 businessConfig 完整结构

```json
{
  "compositionRequirement": {
    "writingRequirementType": "FIXED",
    "writingRequirement": "必交成果：\n1. ……"
  },
  "globalConfiguration": {
    "selectedModel": "deepseek-v4.1-flash",
    "globalInstruction": "## 批阅态度\n- ……"
  },
  "gradingConfiguration": {
    "skills": ["GTiJUJpISt"],
    "fullMark": [100]
  }
}
```

- `skills` 存 `skillVersionId`。技能列表 `GET /agents/v1/custom/grading/skill/pageList?courseId=&term=&pageNum=1&pageSize=100` 的记录在 `data.records`（不是 `list`），字段 `name`（slug）/`cnName`/`skillNid`/`skillVersionId`/`inCourse`。
- `globalInstruction` 直接用课程里任一已上线智能体的原文即可，无需自己写；`api_ctx.js` 会自动取。
- `fullMark` 实测存的是 `[100]` 数组。

## 4. 填写的技术要点

- **React/Vue 输入框**：`input` 必须用原生 setter 赋值再派发 `input`，直接 `el.value = x` 不会触发 v-model。
- **Tiptap（ProseMirror）**：`el.innerHTML = x` 或直接改文本节点不会进入编辑器 state，保存时是空的。可靠做法：

```js
ed.focus();
document.execCommand('selectAll', false, null);
document.execCommand('insertText', false, text);
```

  换行会落成独立 `<p>`；以 `1. ` 开头的段落会被识别成有序列表。写完读 `.limit-wrap .current` 计数器（`0 / 2000`、`0 / 5000`）确认字数大于 0，再保存。
- 计数器在写入后约 300—600ms 才更新，读到 `0` 时不要立刻判失败，等一拍再读。
- 技能弹窗的搜索框不一定真正过滤（服务端 query），直接按 `.skill-name` 精确匹配卡片更稳。
- 勾选后 `确定` 要等一拍才从 disabled 变可用。

## 5. 已知坑

- **类型弹窗 8 选 1**：不是所有卡片都能绑技能，只有“自定义批阅”走这条链路；点错会进论文/PPT 的创建页。
- **保存时才建实例**：进入创建页只拉模板配置，列表不会多记录；`保存` 触发 `create/agent` + `createRef`。接口路径下 `create/agent` 只要返回 200 就已落库，中途放弃会留一条空智能体，需人工删除（不可逆，必须用户确认）。
- **保存 ≠ 上线**：`isPublish=0` 只在老师端“建设中”可见；`上线` 后学生可见，等同于发布，必须事先确认。
- **技能版本绑定的是 versionId**：技能重新定稿升版后，已建智能体仍指向旧版本，需要重新选技能。
- **创建入口在页签里**：只有切到 `批阅智能体` 页签，工具栏才出现 `创建批阅智能体`；停在 `全部` 页签时只看得到 `添加` 和 `批量选择`。
- **隐藏窗口会让过渡卡住**：内置浏览器不可见时，Element Plus 的 `dialog-fade-leave` 停在 `*-leave-active`，`.el-dialog` 仍 `display:block`，看起来“关不掉”，其实已经关了。判断可见性看父级 `.el-overlay` 的 `display`，或在 `list_pages` 里确认页面可见后再操作。
- **隐藏窗口还会让 Tiptap 丢输入**：`document.visibilityState === 'hidden'` 时 `execCommand('insertText')` 只改 DOM、不进 ProseMirror 模型，保存下来是空的。`fill_basic` / `fill_requirement` 遇到 `hidden` 会直接报错，先打开内置浏览器面板。
- **字数计数器不可靠**：编辑态下服务端回填的内容可能显示 `0 / 2000`，同一页面 `作业要求` 却能显示 `234 / 5000`。计数器只能当参考，判断是否写进去要看编辑器 `innerText`，最终以“保存后刷新，再比对回填内容”为准（`verify_agent.js`）。
- **保存后必须刷新复核**：保存完直接读页面 DOM 读到的是自己刚打进去的字，不代表服务端存住；要 `location.reload()` 后重新比对。
- **同名不拦截**：资源库允许同名智能体，去重必须自己做（按 `instanceName` 完全匹配）。
- **列表要翻全量**：`pageSize:100` 一次拿全，但页面上只渲染当前筛选/分页的卡片；去重看接口返回的 `items`，不要只数屏幕上有几个。实测该课程已有 7 条历史智能体（含教师此前建的“网上集中采购案例小组讨论批阅”），其中部分 `skillVersionIds` 为空，属于早期 AI 生成，不要拿来当本次绑定结果。
- **模型默认**：新建实例默认 `deepseek-v4.1-flash`，全局指令取 `global-instruction-default`。不改也能用。
- **登录闸门**：`ensure_login.js` 靠 `window.__MAIN_APP_USER_DATA__.polyUserInfo.userNid` 与 URL 判断状态，不碰 Cookie/凭证。未登录时打开 `https://hike-teaching-center.polymas.com/` 会跳登录页，由教师输入账号密码，脚本每 5 秒复查一次，最长等 10 分钟。
- **后台标签会被节流**：内置浏览器面板关掉后 `document.visibilityState` 变 `hidden`，页面里的延时任务基本不再触发，界面路径会卡在填不进去。接口路径完全不依赖页面可见性，优先走接口。

## 6. 实测记录（2026-10-29）

课程 `pbDQpwk2EefJwAl53aWL` / `folderId=gqUh50ERzt` / `term=20271`（内蒙古省区，userNid=`Xv1sRbxqpw`，schoolId=`15257`）。

**接口链路已全量跑通**（实训7—11 共 5 条，从建实例到上线）：

| 实训 | instanceNid | skillVersionId | 要求字数 | 结果 |
|---|---|---|---|---|
| 实训7 ABC分类 | `MNJ_qASZS9` | `Hcxw3WChrI` | 346 | 保存+上线 |
| 实训8 MRP订单 | `iL_fBGHXhn` | `GTiJUJpISt` | 368 | 保存+上线 |
| 实训9 采购批量 | `trMzAhshww` | `1a3BG5vkAb` | 287 | 保存+上线 |
| 实训10 供应商遴选 | `GZMd8u3fDr` | `sRY87AEUJ2` | 314 | 保存+上线 |
| 实训11 供应商绩效 | `0m4h4vMM5e` | `B4i6ywZWxw` | 354 | 保存+上线 |

回查结果：5 条全部 `reqType=FIXED`、`skills` 与上表一致、`fullMark=[100]`、`model=deepseek-v4.1-flash`、`isPublish=1`。

早期界面路径的记录与教训：

- 实训1 `SV5U6ZT9hV`：界面重填名称、描述 98 字、要求 311 字，绑定 `JjxkbZ24Aa`，保存后刷新复核三项全 `true`，已上线。
- 实训4—6 走界面建成并上线（`oHejlOLSsQ` / `dxb3S6mDy7` / `rOoB0nR4So`），其中实训7 过程中技能弹窗报“暂无技能”，改用接口补存成功——说明弹窗空列表是前端问题，接口侧技能一直在。
- `list_agents.js`：`courseAgent/page` 记录在 `data.list`；技能 `pageList` 记录在 `data.records`，两个接口不一样。
- 去重必须看接口全量 `items`，不要只数页面卡片。
