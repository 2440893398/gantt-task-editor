# 工时计算增强 - 工作日历功能需求文档

**日期**：2026-02-25  
**最后更新**：2026-02-25（UI 交互方案调整）  
**状态**：设计完成，待实现  
**设计稿**：`doc/design/pencil-new.pen` → Frame: "Work Calendar UI"

---

## 1. 背景与问题

当前工时计算（`isWorkDay()`）仅跳过周六/周日，存在以下三个问题：

1. **节假日未处理**：中国法定节假日（春节、国庆等）未被排除，且中国特有"补班日"（周末变工作日）未被计入
2. **无自定义工作日**：公司层面的特殊加班日、特殊假期无法配置
3. **请假未影响调度**：指定负责人请假时，其名下任务工期不会自动延期

---

## 2. 解决方案概述

引入**工作日历引擎**，对现有 `isWorkDay()` 进行四层优先级判断：

```
优先级（从高到低）：
1. 用户自定义特殊日（加班日 / 公司假期）
2. 法定节假日缓存（含中国补班日）
3. 人员请假（按任务负责人匹配）
4. 标准周末判断（兜底）
```

---

## 3. 数据模型

### 3.1 全局日历设置（IndexedDB: `calendar_settings`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `countryCode` | string | ISO 2字母国家代码，如 `CN`、`US`、`JP` |
| `workdaysOfWeek` | number[] | 工作日星期序号，如 `[1,2,3,4,5]`（周一至周五） |
| `hoursPerDay` | number | 每天工作小时数，默认 `8` |

### 3.2 节假日缓存（IndexedDB: `calendar_holidays`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | string（主键） | ISO 日期，如 `"2025-01-26"` |
| `name` | string | 节日名称，如 `"春节"` |
| `isOffDay` | boolean | `true`=放假日，`false`=补班日（仅中国有补班日） |
| `countryCode` | string | 国家代码 |
| `year` | number | 年份（索引） |
| `source` | string | `"holiday-cn"` 或 `"nager"` |

### 3.3 用户自定义特殊日（IndexedDB: `calendar_custom`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string（UUID） | 主键 |
| `date` | string | ISO 日期 |
| `isOffDay` | boolean | `false`=加班日，`true`=公司假期 |
| `name` | string | 名称描述 |
| `note` | string | 备注（可选） |
| `color` | string | 甘特图标注颜色：`"orange"`/`"red"`/`"blue"`/`"green"` |

### 3.4 人员请假记录（IndexedDB: `person_leaves`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string（UUID） | 主键 |
| `assignee` | string | 负责人姓名，与 `task.assignee` 完全匹配 |
| `startDate` | string | 请假开始日期 |
| `endDate` | string | 请假结束日期 |
| `type` | string | `"annual"` 年假 / `"sick"` 病假 / `"other"` 其他 |
| `note` | string | 备注（可选） |

### 3.5 缓存元数据（IndexedDB: `calendar_meta`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `year` | number（主键） | 年份 |
| `countryCode` | string | 国家代码 |
| `fetchedAt` | string | 上次拉取时间（ISO 时间戳） |
| `source` | string | 数据来源 |

---

## 4. 节假日数据源

### 4.1 中国（countryCode = "CN"）

**数据源**：[NateScarlet/holiday-cn](https://github.com/NateScarlet/holiday-cn)

- **URL 格式**：`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{年份}.json`
- **特点**：直接抓取国务院公告，**完整包含补班日**，覆盖 2007-2027 年，每日自动更新，MIT 开源免费，无需 API Key
- **数据结构**：
  ```json
  {
    "year": 2025,
    "days": [
      { "name": "春节", "date": "2025-01-26", "isOffDay": false },
      { "name": "春节", "date": "2025-01-28", "isOffDay": true }
    ]
  }
  ```
  `isOffDay: false` = 补班日（周末须上班），`isOffDay: true` = 放假日

### 4.2 其他国家

**数据源**：[Nager.Date API](https://date.nager.at/Api)

- **URL 格式**：`https://date.nager.at/api/v3/publicholidays/{年份}/{国家代码}`
- **特点**：完全免费无需 API Key，无速率限制，CORS 已启用，覆盖 100+ 国家
- **局限**：仅返回假期首日，无补班日概念（其他国家也无此概念）

### 4.3 数据拉取策略

```
应用启动时：
  异步静默拉取当年 + 次年数据（不阻塞界面）

拉取判断（每年）：
  1. 检查 calendar_meta，若 fetchedAt 在 30 天内 → 跳过
  2. 否则请求远程 API → 成功则写入 IndexedDB 并更新 meta
  3. 拉取失败 → 降级为仅跳过周末，提示用户可手动配置

降级说明：
  拉取失败时不报错，静默降级。
  用户可在「特殊工作日」中手动配置节假日。
```

---

## 5. 调度引擎改造

### 5.1 `isWorkDay()` 升级（四层判断）

```javascript
async function isWorkDay(date, assignee = null) {
  const dateStr = toDateStr(date);

  // 第1层：用户自定义特殊日（最高优先级）
  const custom = await getCustomDay(dateStr);
  if (custom) return !custom.isOffDay;

  // 第2层：法定节假日缓存
  const holiday = await getHolidayDay(dateStr);
  if (holiday) return !holiday.isOffDay;

  // 第3层：人员请假（仅当任务有负责人时）
  if (assignee) {
    const onLeave = await isPersonOnLeave(assignee, dateStr);
    if (onLeave) return false;
  }

  // 第4层：标准周末判断（兜底）
  const settings = await getCalendarSettings();
  return settings.workdaysOfWeek.includes(date.getDay());
}
```

### 5.2 请假对任务调度的影响示例

```
任务A：负责人=张三，工期=3天，开始=3月10日（周一）
张三请假：3月11日（周二）—3月12日（周三）

计算结果：
  3月10日（周一）→ 工作日 ✓  第1天
  3月11日（周二）→ 张三请假 ✗  跳过
  3月12日（周三）→ 张三请假 ✗  跳过
  3月13日（周四）→ 工作日 ✓  第2天
  3月14日（周五）→ 工作日 ✓  第3天
  结束日期 = 3月14日（而非原来的3月12日）
```

### 5.3 异步改造说明

DHTMLX 原生 `auto_scheduling` 插件为同步执行，需要关闭原生自动调度，改为事件驱动的手动异步调度：

- 监听 `onAfterTaskDrag` / `onAfterTaskUpdate` 等事件
- 触发 `await recalculateSchedule(taskId)` 异步重算
- 批量调用 `gantt.updateTask()` 更新结果

---

## 6. 用户界面

### 6.1 入口

工具栏「更多」下拉菜单中新增**「工作日历」**菜单项（日历图标，绿色高亮，与其他菜单项视觉区分）。

### 6.2 面板结构

560px 宽弹窗，三个 Tab 页签：

#### Tab 1：基础设置

| 字段 | 控件 | 说明 |
|------|------|------|
| 国家/地区 | 下拉选择 | 国旗 + 国家名，影响节假日数据源和周末定义 |
| 每日工作小时数 | 数字步进器（-/+） | 默认 8，影响工时换算 |
| 工作日设置 | 7个可点击 Chip（一二三四五六日） | 蓝色=工作日，灰色=休息日 |
| 节假日数据 | 状态卡片 + 重新拉取按钮 | 显示加载状态、数据来源、更新时间；拉取失败时显示降级提示 |

#### Tab 2：特殊工作日

顶部提供**日历视图 / 列表视图**两种子视图切换。

**日历视图（默认）**

- 月历主体，可翻月导航
- 日期格颜色标注：

  | 颜色 | 含义 |
  |------|------|
  | 浅红 `#FEE2E2` + 红色文字 | 法定节假日（放假日） |
  | 浅蓝 `#DBEAFE` + 蓝色文字 | 补班日（周末变工作日，仅中国） |
  | 浅橙 `#FFEDD5` + 橙色文字 | 用户自定义加班日 |
  | 浅红 `#FEE2E2` + 红色文字 | 用户自定义公司假期 |

- 每格内显示日期数字 + 小标签（加班 / 法定假 / 补班 / 公司假）
- 底部图例说明颜色含义
- **点击任意日期** → 弹出小浮窗，包含：
  - 标题：日期 + 星期
  - 类型单选：加班日 / 公司假期（已标注的日期预填当前类型，支持修改）
  - 备注输入框（可选）
  - 确认 / 取消按钮
  - 已标注的日期额外显示「删除标注」入口

**列表视图**

表格形式，列：日期 / 类型（加班日·橙色 / 公司假期·红色）/ 备注 / 删除操作  
右上角「添加」按钮，打开「添加特殊工作日」子弹窗。

**添加子弹窗字段**：
- 日期（日期选择器）
- 类型（单选：加班日 / 公司假期）
- 备注（可选文本）
- 甘特图标注颜色（橙/红/蓝/绿 四种颜色圆点选择）

#### Tab 3：人员请假

顶部提供**日历视图 / 列表视图**两种子视图切换。

**日历视图（默认）**

- 月历主体，可翻月导航
- 有请假记录的日期格显示**叠加头像**：
  - 每个请假人员对应一个固定颜色的圆形头像（取姓名首字）
  - 多人请假时头像横向叠加（-6px 偏移），最多显示 3 个，超出显示 `+N`
  - 日期格背景色为该人员颜色的浅色版（多人时混合为最浅蓝 `#EFF6FF`）
- 底部图例：人员姓名 + 对应颜色圆点
- **点击有请假记录的日期** → 弹出信息卡，列出当天所有请假人员：
  - 每行：头像 + 姓名 + 假期类型徽章（年假/病假/其他）
  - 不提供在弹窗内直接编辑，需跳转列表视图操作

**列表视图**

表格形式，列：负责人头像+姓名 / 开始→结束日期 / 类型（年假·蓝色 / 病假·橙色 / 其他）/ 删除操作  
右上角「添加请假」按钮，打开「添加请假」子弹窗。

**添加子弹窗字段**：
- 负责人（下拉，选项来自任务列表中 `assignee` 字段去重后的列表）
- 开始日期 / 结束日期（日期选择器）
- 类型（年假 / 病假 / 其他）
- 备注（可选）

### 6.3 甘特图视觉反馈

| 日期类型 | 甘特图列背景色 |
|---------|--------------|
| 法定节假日（放假日） | 浅红色 `#FEE2E2` |
| 中国补班日（周末变工作日） | 浅蓝色 `#DBEAFE` |
| 用户自定义加班日 | 浅橙色 `#FFEDD5` |
| 用户自定义公司假期 | 浅红色（同法定节假日） |
| 人员请假 | 不在甘特图显示，仅影响调度计算 |

---

## 7. 涉及改造的文件

| 文件 | 改造内容 |
|------|---------|
| `src/features/gantt/scheduler.js` | `isWorkDay()`、`addWorkDays()`、`getNextWorkDay()` 改为异步；引入四层判断逻辑 |
| `src/core/storage.js` | 新增 `calendar_settings`、`calendar_holidays`、`calendar_custom`、`person_leaves`、`calendar_meta` 五个 IndexedDB 表 |
| `src/features/gantt/init.js` | 关闭 DHTMLX 原生 `auto_scheduling`；监听任务变更事件触发手动异步调度；添加节假日甘特图列背景色渲染 |
| `src/locales/*.js` | 新增工作日历相关 i18n 文案 |
| 新增 `src/features/calendar/` | 工作日历模块：节假日拉取、缓存管理、设置面板 UI |

---

## 8. 不在范围内（YAGNI）

- 节假日数据的历史版本管理
- 多个"日历配置"互相切换（当前仅一个全局配置）
- 项目级别的独立日历配置（预留接口，暂不实现）
- 请假审批流程
- 请假与甘特图视觉联动（请假不显示在甘特图上，只影响计算）
- 日历视图点击弹窗内直接新增请假（跳转列表视图添加）
