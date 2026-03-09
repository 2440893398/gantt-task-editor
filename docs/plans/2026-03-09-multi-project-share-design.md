# 多项目管理 + 链接分享 设计文档

**日期:** 2026-03-09  
**状态:** 已批准，待实现

---

## 背景与痛点

1. **离线孤岛**：数据仅存浏览器，跨设备/分享靠手动导出文件，体验割裂。
2. **单项目限制**：IndexedDB 现为全局单实例，维护多个项目排期时数据混乱。

---

## 决策摘要

| 问题 | 方案 |
|------|------|
| 多项目隔离 | 单库 + `project_id` 字段（IndexedDB version 4） |
| 项目切换 UI | 顶部 Toolbar 下拉切换器 |
| 分享方式 | Cloudflare KV + Workers（无登录链接分享） |
| 分享数据范围 | 整个项目（任务 + 字段配置 + 日历） |
| 分享链路 | 本地优先，云端仅做无状态 JSON 中转 |

---

## 第一部分：多项目架构（本地）

### IndexedDB Schema 升级：version(4)

新增 `projects` 表，所有数据表加 `project_id` 复合索引：

```javascript
db.version(4).stores({
    projects:          'id, name, createdAt, updatedAt',
    tasks:             '++id, project_id, priority, status, start_date, parent',
    links:             '++id, project_id, source, target, type',
    history:           '++id, project_id, timestamp, action',
    baselines:         'id, project_id',
    calendar_settings: '++id, project_id',
    calendar_holidays: '[date+countryCode], year, countryCode',
    calendar_custom:   'id, date, project_id',
    person_leaves:     'id, project_id, assignee, startDate, endDate',
    calendar_meta:     '[year+project_id]',
});
```

### Projects 表结构

```typescript
interface Project {
    id: string;          // uuid，如 "prj_abc123"
    name: string;        // 项目名称
    color: string;       // 标识色（hex）
    description: string; // 可选描述
    createdAt: string;   // ISO 8601
    updatedAt: string;   // ISO 8601
}
```

### 数据迁移策略（无感知）

首次启动 version(4) 时，`.upgrade()` 回调：
1. 创建"默认项目"记录（`id: 'prj_default'`，名称取自 `i18n.t('project.default')`）
2. 将现有所有 tasks / links / baselines / calendar_* / person_leaves 补写 `project_id = 'prj_default'`
3. 将 `currentProjectId = 'prj_default'` 写入 localStorage

### State 变更

`src/core/store.js` 中 `state` 新增：

```javascript
currentProjectId: 'prj_default',
projects: [],          // 所有项目列表（元数据缓存）
```

### Storage 层封装策略

在 `src/core/storage.js` 中增加 **项目作用域工厂**，将所有读写的 `project_id` 注入收拢：

```javascript
// 所有带 project_id 的表操作统一通过此函数
export function projectScope(projectId) {
    return {
        getTasks: () => db.tasks.where('project_id').equals(projectId).toArray(),
        saveTasks: (tasks) => { /* clear + bulkAdd with project_id */ },
        getLinks:  () => db.links.where('project_id').equals(projectId).toArray(),
        // ...其他表
    };
}
```

调用方：`const scope = projectScope(state.currentProjectId); await scope.getTasks();`

现有的 `saveGanttData / getGanttData / hasCachedData` 等函数重构为调用 `projectScope` 以保持向后兼容（相同函数签名，内部加 `project_id` 过滤）。

### UI：顶部项目切换器

```
[ 🏗 项目名称  ▾ ]   ←── 紧贴 toolbar 左侧，现有 logo 右边
    ├ 项目A  ●
    ├ 项目B  ●
    ├ ─────────
    ├ + 新建项目
    └ ⚙ 管理项目
```

**切换流程：**
1. 保存当前项目 gantt 数据（`persistGanttData()`）
2. 更新 `state.currentProjectId`、localStorage
3. 重新加载 gantt（`gantt.clearAll()` + 从新 `project_id` 的 scope 读取数据并 `gantt.parse()`）
4. 更新 toolbar 显示项目名称

**管理弹窗（modal）：**
- 列表展示所有项目（名称、任务数、创建时间）
- 操作：重命名、修改颜色、删除（弹二次确认）
- 删除会级联清除该项目所有数据

---

## 第二部分：链接分享（Cloudflare KV 中转）

### 云端架构（极简，约 80 行 Worker）

**Worker 路由：**

```
POST /api/share                 上传整个项目 JSON
GET  /api/share/:key            下载项目 JSON
```

**POST /api/share**
- Body: `{ key?: string, data: ProjectSnapshot }`
- 若 `key` 为空，生成随机 8 位 alphanumeric key
- `KV.put(key, JSON.stringify(data), { expirationTtl: 2592000 })` (30天)
- 返回: `{ key: "abc12345", url: "https://app.com?share=abc12345", expiresAt: "..." }`

**GET /api/share/:key**
- `KV.get(key)` → 404 if expired/not found
- 返回: ProjectSnapshot JSON

**KV 存储结构（ProjectSnapshot）：**

```json
{
    "schemaVersion": 1,
    "exportedAt": "2026-03-09T12:00:00Z",
    "project": {
        "name": "Q2产品排期",
        "color": "#4f46e5",
        "description": ""
    },
    "tasks": [ ... ],
    "links": [ ... ],
    "customFields": [ ... ],
    "fieldOrder": [ ... ],
    "systemFieldSettings": { ... },
    "baseline": null,
    "calendar": {
        "settings": { ... },
        "customDays": [ ... ],
        "leaves": [ ... ]
    }
}
```

### 前端分享流程

**分享方（Share Dialog）：**

```
┌────────────────────────────────┐
│  分享项目：Q2产品排期            │
│                                │
│  分享 Key（留空自动生成）:        │
│  [ abc12345              ]     │
│                                │
│  [      生成分享链接      ]     │
│                                │
│  ✓ 链接已生成（30天有效）:       │
│  https://app.com?share=abc12345│
│  [ 复制链接 ]                   │
│                                │
│  提示：如需更新，下次分享填入      │
│  相同 Key 即可覆盖云端数据        │
└────────────────────────────────┘
```

**接收方（Import Dialog，URL 含 `?share=xxx` 时自动触发）：**

```
┌────────────────────────────────┐
│  检测到分享链接                  │
│  项目：Q2产品排期（52个任务）     │
│  分享时间：2026-03-09 12:00     │
│                                │
│  请选择导入方式：               │
│  ● 新建项目导入（推荐）          │
│    在本地新建项目，不影响现有数据  │
│  ○ 覆盖当前项目                 │
│    替换当前项目数据              │
│                                │
│  [ 取消 ]    [ 确认导入 ]       │
└────────────────────────────────┘
```

### 重新分享（数据更新）流程

用户在分享 Dialog 的 Key 输入框中填入上次分享的 key → POST 时 Worker 执行 `KV.put(sameKey, newData, ...)` → 覆盖旧数据 → 原链接自动指向最新数据。

### 降级方案

Worker 不可达时（中国区网络问题），分享按钮提供备选"下载为文件"，复用现有 `exportFullBackup()` 的 JSON 格式（增加项目元数据字段）。

---

## 第三部分：可行性与风险防控

| 风险 | 具体表现 | 应对 |
|------|---------|------|
| IndexedDB 迁移失败 | 旧数据无 project_id | `.upgrade()` 事务内强制补写 `prj_default`，失败则回滚 |
| storage 改动面宽 | 所有读写要加 filter | `projectScope()` 工厂函数收拢，改调用方不改底层 API |
| Worker 不可用 | 分享失败 | 降级为本地文件下载，Toast 提示原因 |
| KV TTL 过期 | 链接失效 | 前端接收弹窗展示导出时间；过期时提示"请联系分享人重新分享" |
| 大项目上传慢 | >1MB JSON | KV 单值上限 25MB 足够；上传时 Toast 进度提示 |
| 现有备份文件兼容 | 旧 .json.gz 无 project_id | `importFullBackup()` 检测无 project 字段时导入到 currentProject |

**无循环风险原因：** 云端仅做无状态中转，本地逻辑不变，接收方默认"新建项目导入"不破坏现有数据。

---

## 文件变更清单（预览）

```
新建:
  src/features/projects/manager.js       # 项目 CRUD + 切换逻辑
  src/features/projects/ProjectPicker.js  # 顶部切换器 UI 组件
  src/features/projects/ProjectModal.js   # 管理弹窗
  src/features/share/shareService.js      # 云端 POST/GET 封装
  src/features/share/ShareDialog.js       # 分享弹窗 UI
  src/features/share/ImportDialog.js      # 接收方导入弹窗
  workers/share-worker.js                 # Cloudflare Worker（约80行）

修改:
  src/core/storage.js     # version(4) schema, projectScope(), 迁移回调
  src/core/store.js       # state.currentProjectId / projects, 切换 API
  src/main.js             # 初始化 projects, 处理 ?share= URL 参数
  index.html              # toolbar 增加项目切换器挂载点
  src/features/config/configIO.js  # exportFullBackup/importFullBackup 支持 project 字段
  src/locales/*.json      # 新增 project.* / share.* i18n key
```
