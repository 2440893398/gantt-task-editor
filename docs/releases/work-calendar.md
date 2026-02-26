# 工作日历功能实现文档

**实现日期：** 2026-02-25

## 概述

工作日历功能为甘特图编辑器引入了完整的工作日管理引擎，解决了此前三个核心痛点：

1. **法定节假日未识别** — 任务调度不感知国家法定节假日与补班日
2. **无法配置公司特殊日** — 无法单独标注公司加班日或自定义假期
3. **请假不影响排程** — 负责人请假期间任务不会自动跳过

本次实现新建了独立的 `src/features/calendar/` 模块，并对调度引擎与甘特图渲染进行了底层改造。

---

## 架构设计

```
src/
├── features/
│   └── calendar/
│       ├── holidayFetcher.js      节假日拉取与缓存
│       ├── panel.js               UI 面板主框架
│       ├── panel.css              面板完整样式
│       ├── tab1-settings.js       Tab1 基础设置
│       ├── mini-calendar.js       可复用迷你月历组件
│       ├── tab2-special-days.js   Tab2 特殊工作日
│       └── tab3-leaves.js         Tab3 人员请假
├── core/
│   └── storage.js                 （已升级）IndexedDB v3
└── features/gantt/
    ├── init.js                    （已升级）节假日高亮渲染
    └── scheduler.js               （已升级）异步工作日判断
```

**数据流：**
```
节假日 API → holidayFetcher → IndexedDB calendar_holidays
                                       ↓
UI 面板 → 自定义特殊日 / 请假 → IndexedDB calendar_custom / person_leaves
                                       ↓
scheduler.isWorkDay() ← 四层异步查询 ← IndexedDB
                                       ↓
gantt.config.scales.day.css() ← window.__calendarHighlightCache ← IndexedDB
```

---

## 数据层

### IndexedDB 升级：v2 → v3

**文件：** `src/core/storage.js`

新增 5 张表：

| 表名 | 主键 | 索引 | 用途 |
|------|------|------|------|
| `calendar_settings` | `++id` | — | 全局设置（国家、工时、工作日） |
| `calendar_holidays` | `date` | `year, countryCode` | 节假日 API 缓存 |
| `calendar_custom` | `id` | `date` | 用户自定义特殊工作日 |
| `person_leaves` | `id` | `assignee, startDate, endDate` | 人员请假记录 |
| `calendar_meta` | `year` | — | 节假日拉取元数据（时间戳、来源） |

> Dexie 升级规则：v3 的 `.stores()` 必须列出所有旧表，否则旧表会被删除。

**新增导出函数：**

```js
// 设置
getCalendarSettings() / saveCalendarSettings(settings)

// 节假日缓存
getHolidayDay(dateStr) / bulkSaveHolidays(holidays) / clearHolidaysByYear(year, countryCode)

// 缓存元数据
getCalendarMeta(year) / saveCalendarMeta(meta)

// 自定义特殊日
getCustomDay(dateStr) / getAllCustomDays() / saveCustomDay(record) / deleteCustomDay(id)

// 人员请假
isPersonOnLeave(assignee, dateStr) / getAllLeaves() / saveLeave(record) / deleteLeave(id)
```

---

## 节假日拉取模块

**文件：** `src/features/calendar/holidayFetcher.js`

### 数据源

| 国家 | 数据源 | URL |
|------|--------|-----|
| 中国（CN） | holiday-cn | `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{年份}.json` |
| 其他国家 | Nager.Date | `https://date.nager.at/api/v3/publicholidays/{年}/{国家码}` |

### 缓存策略

- 缓存有效期：**30 天**
- 缓存位置：IndexedDB `calendar_holidays` + `calendar_meta`
- 切换国家时自动清除旧缓存再写入新数据
- **拉取失败静默降级**（只忽略周末，不报错）

### 关键函数

```js
// 确保指定年份数据已缓存（检查新鲜度，按需拉取）
ensureHolidaysCached(year)

// 应用启动时后台静默预热当年 + 次年
prefetchHolidays()
```

### holiday-cn 数据格式

```json
{
  "days": [
    { "date": "2026-01-01", "name": "元旦", "isOffDay": true },
    { "date": "2026-02-04", "name": "春节补班", "isOffDay": false }
  ]
}
```

`isOffDay: true` = 法定假日（红色），`isOffDay: false` = 补班日（蓝色）。

---

## 调度引擎升级

**文件：** `src/features/gantt/scheduler.js`

### isWorkDay 四层异步优先级

```
优先级 1（最高）：用户自定义特殊日（calendar_custom）
优先级 2：        法定节假日缓存（calendar_holidays）
优先级 3：        人员请假（person_leaves，仅当有 assignee 时）
优先级 4（兜底）：标准工作日设置（calendar_settings.workdaysOfWeek）
```

```js
export async function isWorkDay(date, assignee = null) → Promise<boolean>
export async function getNextWorkDay(date, assignee = null) → Promise<Date>
export async function addWorkDays(date, days, assignee = null) → Promise<Date>
```

### 禁用原生 auto_scheduling，改为手动异步调度

原生 `gantt.autoSchedule()` 是同步的，无法等待异步工作日判断。本次关闭原生引擎，新增 `scheduleAsyncReschedule(taskId)`：

```js
// 触发时机：任务拖拽完成 / 新建依赖连线
async function scheduleAsyncReschedule(taskId)
```

逻辑：遍历 taskId 的所有 FS（Finish-to-Start）后继，根据前置任务 `end_date` + lag 计算新开始日期（跳过非工作日），递归向下传播。

**init.js 中同步关闭：**
```js
gantt.plugins({ auto_scheduling: false, ... });
// 三行 auto_scheduling 配置已移除
```

---

## 甘特图列背景色高亮

**文件：** `src/features/gantt/init.js` + `src/styles/pages/gantt.css`

### 高亮缓存机制

使用 `window.__calendarHighlightCache`（`Map<dateStr, type>`）避免在 `gantt.config.scales` 的同步 `css()` 回调中直接访问 IndexedDB：

```
应用启动
  └─ initCalendarHighlightCache()
       ├─ prefetchHolidays()              后台拉取节假日
       ├─ getAllCustomDays() → cache       写入自定义日
       └─ refreshHolidayHighlightCache()  写入法定假日
            └─ gantt.render()             触发重绘
```

用户修改设置后调用 `refreshHolidayHighlightCache()` 重刷缓存并触发 `gantt.render()`。

### 颜色映射

| 类型 | CSS 类 | 背景色 | 含义 |
|------|--------|--------|------|
| `holiday` | `gantt-day-holiday` | `#FEE2E2` 浅红 | 法定假日 |
| `makeupday` | `gantt-day-makeupday` | `#DBEAFE` 浅蓝 | 补班日 |
| `overtime` | `gantt-day-overtime` | `#FFEDD5` 浅橙 | 自定义加班日 |
| `companyday` | `gantt-day-companyday` | `rgba(254,226,226,0.7)` | 公司假期 |

---

## UI 面板

**文件：** `src/features/calendar/panel.js` + `panel.css`

### 入口

工具栏「更多」下拉菜单 → 「工作日历」（动态 `import()` 懒加载）

### 面板结构

```
[工作日历] ×
─────────────────────────────
 基础设置 | 特殊工作日 | 人员请假
─────────────────────────────
 [Tab 内容区]
─────────────────────────────
              [取消] [保存设置]
```

点击「保存设置」触发 `CustomEvent('calendar:save')`，各 Tab 监听后自行保存数据。

---

## Tab1 — 基础设置

**文件：** `src/features/calendar/tab1-settings.js`

| 配置项 | 说明 |
|--------|------|
| 国家/地区 | 下拉选择，影响节假日数据源（CN / US / JP 等 8 个国家） |
| 每日工作小时数 | 步进按钮，1–24 小时 |
| 工作日设置 | 7 个 Chip（周日–周六），点击切换激活状态 |
| 节假日状态卡 | 显示缓存来源与更新时间，「重新拉取」按钮强制刷新 |

---

## Tab2 — 特殊工作日

**文件：** `src/features/calendar/tab2-special-days.js`

### 日历视图

- 月历显示当月所有日期，法定假日/补班日/自定义日以颜色标注
- **点击任意日期**弹出浮窗：
  - 选择类型：加班日（橙）/ 公司假期（红）
  - 输入备注
  - 已有标注时显示「删除标注」按钮
- 保存后立即刷新月历 + 甘特图列背景色

### 列表视图

- 表格展示所有自定义日，显示日期 / 类型徽章 / 备注
- 删除按钮即时生效
- 「添加」按钮切换到日历视图引导用户点击日期

---

## Tab3 — 人员请假

**文件：** `src/features/calendar/tab3-leaves.js`

### 日历视图

- 当月有人请假的日期显示**叠加头像**：
  - 每人固定颜色（8 色轮换）
  - 最多显示 3 个头像，超出显示 `+N`
- 点击有头像的日期弹出请假信息卡（只读）：显示所有请假人员姓名 + 假期类型

### 列表视图

- 表格展示所有请假记录：负责人头像 + 姓名 / 起止日期 / 类型徽章
- 内联表单添加请假（姓名 / 开始日期 / 结束日期 / 类型 / 备注）
- 删除即时生效

### 假期类型

| 值 | 显示 |
|----|------|
| `annual` | 年假（蓝色） |
| `sick` | 病假（橙色） |
| `other` | 其他（灰色） |

---

## 迷你月历组件

**文件：** `src/features/calendar/mini-calendar.js`

Tab2 和 Tab3 共用的无状态纯函数组件：

```js
renderMiniCalendar({
    container,      // HTMLElement
    year,           // number
    month,          // 0-indexed
    highlights,     // Map<dateStr, { type, label?, avatars? }>
    onDayClick,     // (dateStr, el, event) => void
    onMonthChange,  // (year, month) => void
})
```

- 周一为起始列（ISO 标准）
- 支持头像叠加渲染（Tab3 专用）
- 支持文字标签渲染（Tab2 专用）

---

## 国际化

**文件：** `src/locales/zh-CN.js` / `en-US.js` / `ja-JP.js` / `ko-KR.js`

所有 4 个语言包均新增 `calendar` 命名空间，包含 30 个翻译键，覆盖面板标题、Tab 名称、字段标签、操作按钮、状态文案等。

---

## 技术说明

### 为何关闭原生 auto_scheduling

DHTMLX 原生 `auto_scheduling` 插件是同步执行的，无法 `await` 异步的 `isWorkDay()`。若保留原生引擎，节假日/请假判断将被跳过，退化为纯周末判断。本次改为手动事件驱动的 `scheduleAsyncReschedule()`，在 `onAfterTaskDrag` 和 `onAfterLinkAdd` 事件中异步执行级联调度。

### 高亮缓存的必要性

`gantt.config.scales` 的 `css()` 回调是同步的，每次渲染都会调用。不能在其中直接 `await` IndexedDB 查询。因此引入 `window.__calendarHighlightCache` 作为预热缓存，应用启动时一次性加载，用户修改设置后触发增量刷新。

### IndexedDB 版本升级注意事项

Dexie 要求每个新版本的 `.stores()` 必须声明**所有**已存在的表，否则旧表将被删除。v3 完整保留了 v2 的 4 张表，再追加 5 张新表。

---

## 已知限制

1. `scheduleAsyncReschedule` 目前仅处理 **FS（Finish-to-Start）** 依赖，SS/FF/SF 类型暂不支持
2. 节假日高亮缓存只覆盖**当年 + 次年**，跨年度大型项目需手动切换年份后等待重刷
3. 人员请假仅影响**调度计算**，甘特图列背景色不会因请假而变色（设计决策）
4. 节假日 API 依赖网络，离线环境将降级为仅忽略周末

---

## 相关文件索引

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/core/storage.js` | 修改 | DB v3 + 5 张新表 + CRUD 函数 |
| `src/features/calendar/holidayFetcher.js` | 新建 | 节假日拉取与缓存 |
| `src/features/calendar/panel.js` | 新建 | 面板主框架 |
| `src/features/calendar/panel.css` | 新建 | 面板完整样式 |
| `src/features/calendar/tab1-settings.js` | 新建 | 基础设置 Tab |
| `src/features/calendar/mini-calendar.js` | 新建 | 迷你月历组件 |
| `src/features/calendar/tab2-special-days.js` | 新建 | 特殊工作日 Tab |
| `src/features/calendar/tab3-leaves.js` | 新建 | 人员请假 Tab |
| `src/features/gantt/scheduler.js` | 修改 | isWorkDay 异步化 + 手动调度 |
| `src/features/gantt/init.js` | 修改 | 关闭 auto_scheduling + 高亮缓存 |
| `src/styles/pages/gantt.css` | 修改 | 4 种节假日列背景色 CSS |
| `src/main.js` | 修改 | 启动时预拉取节假日 |
| `index.html` | 修改 | 更多菜单添加工作日历入口 |
| `src/locales/zh-CN.js` | 修改 | calendar 命名空间 i18n |
| `src/locales/en-US.js` | 修改 | calendar 命名空间 i18n |
| `src/locales/ja-JP.js` | 修改 | calendar 命名空间 i18n |
| `src/locales/ko-KR.js` | 修改 | calendar 命名空间 i18n |
