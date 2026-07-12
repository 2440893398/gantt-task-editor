# Agent CLI v2 渐进式能力披露设计

日期：2026-07-12
状态：已获用户确认，待实施

## 1. 背景与目标

当前 `window.app` 命令层能够完成任务、层级、依赖、排程、项目、状态和会话操作，
但 Agent 需要自行推断大量动态规则：当前任务表单有哪些字段、字段是否必填、下拉值
如何编码、工作日历如何影响工期，以及层级或依赖操作需要读取哪些当前数据。

本次改造的目标不是解决单个导入场景，而是让系统本身教会 Agent 如何继续探索：

- 启动提示词只描述稳定入口和探索原则；
- 命令帮助声明何时以及到哪里读取下一层信息；
- 动态配置按摘要、字段详情、选项逐层披露；
- 错误返回结构化的只读 `nextAction`；
- UI、内置 AI 和外部 Agent 使用同一份配置解释与验证逻辑；
- Agent 不需要阅读源码或通过多次写入试错来理解系统。

本设计直接替换 v1 协议，不保留 v1 参数、manifest 格式或兼容分支。

## 2. 范围

### 2.1 包含

- `window.app` manifest、help 和提示词升级为 v2；
- 全部公开命令增加参数说明、示例和渐进式 discovery 元数据；
- 新增表单、排程、日历和层级读取命令；
- 任务创建、更新、查询和导出支持动态字段；
- Agent API 统一使用用户语义的日期；
- 全部主要错误增加结构化 `nextAction`；
- batch、operation、dry-run 和 command runner 迁移到 v2；
- 内置 AI 字段和日历工具复用共享领域服务；
- 对应单元、集成与浏览器验证。

### 2.2 不包含

- Agent 修改字段配置、日历设置或系统设置；
- 新增人员目录或远程选项数据源；
- 自动执行错误返回的 `nextAction`；
- 保留或迁移 v1 外部调用；
- 暴露 DHTMLX 渲染配置、DOM 或 IndexedDB 细节。

## 3. 设计原则

1. **按需披露**：manifest 只列命令，help 解释命令，资源命令返回动态信息。
2. **领域语义优先**：API 暴露用户可理解的日期和字段，不暴露 DHTMLX 内部边界。
3. **单一事实来源**：表单 UI、内置 AI 和 Agent CLI 共享 schema 与验证服务。
4. **只读导航**：`discovery` 和 `nextAction` 只能指向读取命令。
5. **结果可验证**：写命令返回 settle 后的真实状态，不以提交前变更代替最终结果。
6. **配置有版本**：动态配置变化时明确产生 `SCHEMA_CONFLICT`，不静默套用旧规则。
7. **命令保持领域边界**：任务仍由 `task.*` 操作，不增加泛化的 `form.submit`。

## 4. 协议入口

### 4.1 manifest

`window.app.manifest()` 返回低成本命令目录，不包含完整动态配置：

```json
{
    "version": 2,
    "commands": [
        {
            "name": "task.create",
            "summary": "创建任务",
            "mutating": true,
            "dynamic": true,
            "supports": ["dryRun", "batch", "operation"]
        }
    ]
}
```

### 4.2 help

`window.app.help('task.create')` 返回完整静态契约：

- 参数 JSON Schema，包含 description 和枚举说明；
- 输出结构；
- examples；
- `discovery` 导航；
- 可能的错误码；
- batch、dry-run、operation 支持情况。

每个 discovery 项包含：

```json
{
    "when": "录入任务字段前",
    "command": "form.describe",
    "args": { "form": "task", "mode": "create" },
    "reason": "任务表单由当前配置动态生成"
}
```

`mapArgs` 可从目标命令参数映射读取命令参数，例如把
`hierarchy.move.args.id` 映射为 `hierarchy.inspect.taskId`。

无参 `window.app.help()` 返回与 manifest 同级的全命令简表，并附带如何调用
`help(command)` 的说明；它不展开参数 schema、discovery 或动态配置。查询不存在的命令
返回结构化 `UNKNOWN_COMMAND`，其 `nextAction` 指向无参 `help()`。

### 4.3 启动提示词

复制给 Agent 的提示词只保留以下稳定规则：

1. 已知命令直接使用；未知命令读取一次 manifest。
2. 参数或业务语义未知时读取 `help(command)`。
3. 根据 help 的 `discovery` 查询动态配置或当前上下文。
4. 只查询当前操作需要的信息，不预读所有配置。
5. 错误包含 `nextAction` 时优先执行该只读动作。
6. 不读取应用源码，不直接操作 DOM、IndexedDB 或 localStorage。
7. 多项写入使用一次 batch dry-run 和一次 batch commit。

## 5. 共享领域服务

新增以下纯领域服务，命令和 UI 都只能通过服务解释配置：

### 5.1 Task Form Schema Service

输入：当前项目、模式 `create|update|query|export`、locale。
数据来源：`SYSTEM_FIELD_CONFIG`、`state.customFields`、`fieldOrder`、
`systemFieldSettings`。
输出：规范化表单 schema、字段详情、选项、`schemaRev`。

系统字段与历史上以自定义字段形态保存的同名配置按 `key` 合并，不得返回重复字段。
系统字段定义提供基础能力，当前用户配置覆盖 label、类型、必填、默认值、选项和启用状态；
不允许覆盖系统字段的不可禁用、只读或推导约束。

字段规范至少包含：

- `key`、本地化 `label`、`description`；
- `type`、`required`、`writable`、`derived`；
- `defaultValue`；
- `constraints`；
- `operators`；
- `valueEncoding`；
- `{ value, label }` 选项；
- 示例值。

`schemaRev` 根据影响验证或写入的规范化配置生成。仅切换显示语言不会改变
`schemaRev`；字段、类型、必填、默认值、选项或启用状态变化会改变它。

选项分为两类：

- **配置定义选项**：存储在字段配置或系统字段 override 中，计入 `schemaRev`，按
  schema revision 校验；
- **数据支撑选项**：来自已注册的实时数据 provider，不计入 `schemaRev`，写入时必须
  通过 provider 对当前值做实时校验。provider 可单独返回 `optionsRev` 供分页查询保持
  一致，但 `optionsRev` 不替代写入时的实时校验。

当前系统没有人员目录。默认 `assignee` 是必填 text 字段，允许录入非空文本，
`form.field` 返回 `optionsAvailable: false`，不得引导 Agent 调用 `form.options`。只有用户
把 assignee 配置为 select/multiselect 时，它才使用配置定义选项并计入 `schemaRev`。
人员请假记录中的 assignee 继续按文本匹配，不引入人员 ID 模型。

### 5.2 Task Value Validation Service

负责：

- 未知、禁用、只读字段检查；
- 必填和默认值；
- text、number、date、select、multiselect 类型校验；
- 显示 label 与实际 value 的区分；
- 查询 operator 与字段类型的兼容性；
- create/update 模式差异；
- 生成字段级错误和对应 `nextAction`。

创建时校验全部已启用必填字段并应用默认值。更新时只校验本次提供的字段，且禁止把
必填字段清空；不因历史任务缺少另一个必填字段而阻止无关字段更新。

### 5.3 Schedule Policy Service

负责描述和执行统一的日期规则：

- API 的 `end_date` 为用户可见的包含式结束日期；
- 内部统一转换为 DHTMLX exclusive end；
- `duration` 使用当前工作日历；
- start/end/duration 同时提供且不一致时拒绝；
- 父任务日期由子任务推导且不可直接写入；
- 写入后返回重新调度和持久化后的真实值。

`policyRev` 覆盖所有会改变日期计算结果的状态：工作周、每日工时、国家/地区设置、
节假日缓存、调休、自定义工作日以及相关负责人的请假数据。上述任一数据写入、删除或
刷新后都必须推进 policy revision。因而 batch preflight 与 commit 之间发生的日历变化
会产生 `POLICY_CONFLICT`，不会使用旧换算结果提交。

### 5.4 Calendar Query Service

复用当前日历设置、节假日、自定义日期和人员请假数据，支持按日期范围、负责人和
类型查询。不得默认返回全部历史日历数据。

### 5.5 Hierarchy Context Service

返回任务的 parent、祖先链、children、previous/next sibling、sibling index、可否
indent/outdent，以及循环检查所需的必要子树信息。

## 6. 新增读取命令

### 6.1 表单

```js
form.describe({ form: 'task', mode: 'create' });
form.field({ form: 'task', mode: 'create', field: 'priority' });
form.options({ form: 'task', field: 'risk_level', query: '高', cursor: null, limit: 20 });
```

`form.describe` 只返回字段摘要；`form.field` 返回完整规则；`form.options` 只处理
select/multiselect 的配置选项或已注册的数据 provider。选项始终使用
`{ value, label }`，Agent 写入 `value`。对 text 字段调用 `form.options` 返回
`CONSTRAINT`，其 `nextAction` 指向 `form.field`。

### 6.2 排程

```js
schedule.describe({ taskId, assignee });
```

返回日期格式、日期精度、end 语义、duration 单位、工作日历状态、父级汇总规则、
可写与推导字段以及当前 `policyRev`。

### 6.3 日历

```js
calendar.describe({
    start: '2026-07-01',
    end: '2026-07-31',
    assignee: '张三',
    include: ['settings', 'exceptions', 'leaves'],
});
```

返回工作周、每日工时、国家、日期范围内的节假日/调休/自定义工作日和人员请假。

### 6.4 层级

```js
hierarchy.inspect({ taskId: 12, depth: 1 });
```

返回当前任务的祖先链、必要子树、兄弟上下文和可执行操作，不返回整个项目树。

## 7. 任务命令 v2

### 7.1 创建和更新

```js
task.create(
    {
        parent: 0,
        values: {
            text: '接口联调',
            start_date: '2026-07-13',
            end_date: '2026-07-17',
            priority: 'high',
            assignee: '张三',
            risk_level: 'medium',
        },
    },
    {
        schemaRev: 'task-form-a81c',
        policyRev: 'schedule-42bd',
    }
);
```

```js
task.update(
    {
        id: 12,
        values: { status: 'completed', progress: 1 },
    },
    {
        schemaRev: 'task-form-a81c',
    }
);
```

`schemaRev` 和 `policyRev` 属于执行一致性选项，不属于任务表单值。单条写入时它们
可选：省略表示使用执行时的最新 schema/policy 校验和计算；提供时才进行 revision
冲突检查。当更新包含 start_date、end_date 或 duration 时，命令仍会读取最新 policy
完成归一化。创建和更新最后执行 settle 和持久化，响应返回最终任务。

### 7.2 查询

```js
task.list({
    filters: [
        { field: 'status', operator: 'eq', value: 'pending' },
        { field: 'risk_level', operator: 'in', value: ['high', 'medium'] },
        {
            field: 'start_date',
            operator: 'between',
            value: ['2026-07-01', '2026-07-31'],
        },
    ],
    fields: ['id', 'text', 'assignee', 'risk_level'],
    limit: 100,
});
```

字段 operator：

- text：`eq`、`contains`；
- select：`eq`、`in`；
- multiselect：`containsAny`、`containsAll`；
- number：`eq`、`gt`、`gte`、`lt`、`lte`、`between`；
- date：`before`、`after`、`between`。

`task.get` 支持可选 `fields`。任务读响应把内部 end 转回包含式 `end_date`。

`task.today` 和 `task.overdue` 作为派生条件便捷命令保留。v2 首期不把派生状态伪装成
普通字段，也不支持 `$overdue` 一类特殊 filter key；这两个命令的 help 明确其日期、
完成状态和时区语义。

### 7.3 删除

`task.delete` 的 help 指向 `hierarchy.inspect`。cascade dry-run 必须返回将被删除或
重新挂载的任务 ID，不只返回数量。

## 8. 其他命令的 discovery

| 命令                     | 未知信息                | 导航命令                                 |
| ------------------------ | ----------------------- | ---------------------------------------- |
| `task.create/update`     | 字段、选项、日期规则    | `form.*`、`schedule.describe`            |
| `task.list/get`          | 可查询/返回字段、枚举值 | `form.describe/field/options`            |
| `task.delete`            | 子树和 cascade 影响     | `hierarchy.inspect`                      |
| `schedule.setDates/move` | 日期和工作日规则        | `schedule.describe`、`calendar.describe` |
| `schedule.recalc`        | 受影响层级和依赖        | `hierarchy.inspect`、`link.list`         |
| `hierarchy.*`            | 父级、兄弟、循环风险    | `hierarchy.inspect`                      |
| `link.add/remove`        | 任务和现有依赖          | `task.list`、`link.list`                 |
| `project.switch`         | 项目 ID                 | `project.list`                           |
| `state.export`           | 动态字段 key            | `form.describe`                          |
| `session.undo/redo`      | 当前是否可执行          | `session.history`                        |
| `batch`                  | 步骤命令和 alias 语义   | `help` 对应步骤命令                      |
| `operation.*`            | 生命周期和取消语义      | `help('operation.start')`                |

FS/SS/FF/SF 等固定枚举直接写入 `help('link.add')` 的 enumDescriptions，不增加
`link.describe`。项目列表、任务列表、依赖列表和会话历史已经是合适的动态读取入口。

## 9. 导出 v2

```js
state.export({
    format: 'csv',
    fields: ['text', 'assignee', 'risk_level', 'start_date', 'end_date'],
});
```

`fields` 未指定时导出当前表单可见字段；指定时通过 form schema 验证。JSON、CSV、MD
使用同一字段选择和日期归一化逻辑。

## 10. 错误与 nextAction

统一错误结构：

```json
{
    "ok": false,
    "error": {
        "code": "INVALID_FIELD_VALUE",
        "message": "risk_level 不接受值 urgent",
        "field": "risk_level",
        "nextAction": {
            "command": "form.field",
            "args": {
                "form": "task",
                "mode": "create",
                "field": "risk_level"
            },
            "reason": "读取字段的合法选项和实际传参值"
        }
    }
}
```

`stepIndex` 和 `op` 只由 batch 在包装具体 step 错误时增加；单命令错误不包含它们。

导航映射：

- 未知命令 → `manifest`；
- 参数结构错误 → `help(command)`；
- 未知字段 → `form.describe`；
- 字段值错误 → `form.field` 或 `form.options`；
- schema 变化 → `form.describe`；
- 排程规则或日期冲突 → `schedule.describe`；
- 工作日问题 → `calendar.describe`；
- 层级循环/位置约束 → `hierarchy.inspect`；
- 依赖循环 → `link.list`；
- 项目不存在 → `project.list`；
- revision 冲突 → `state.rev`；
- 任务不存在 → `task.list`。

静态 discovery 和运行时 nextAction 使用同一个 `createReadAction()` 工厂。工厂通过
registry 验证目标命令存在且 `mutating === false`：命令注册阶段校验静态 metadata，
错误构造阶段再次校验动态 action。任一道校验失败都拒绝生成 action，并记录开发错误；
命令层绝不自动执行 nextAction。

### 10.1 v2 错误码清单

| 错误码                | 语义                                | 典型 nextAction                    |
| --------------------- | ----------------------------------- | ---------------------------------- |
| `UNKNOWN_COMMAND`     | 命令不存在                          | 无参 `help()`                      |
| `BAD_ARGS`            | 静态参数结构、类型或格式错误        | `help(command)`                    |
| `INVALID_FIELD`       | 动态字段未知、禁用或只读            | `form.describe`                    |
| `INVALID_FIELD_VALUE` | 动态字段值、operator 或枚举无效     | `form.field/options`               |
| `SCHEMA_CONFLICT`     | 提供的 schemaRev 已过期             | `form.describe`                    |
| `POLICY_CONFLICT`     | 提供的 policyRev 已过期             | `schedule.describe`                |
| `NOT_FOUND`           | 项目、任务、链接或 operation 不存在 | 对应 list 命令                     |
| `CONFLICT`            | 项目 revision 或活动项目发生变化    | `state.rev` 或 `project.list`      |
| `CONSTRAINT`          | 只读模式或业务约束不允许操作        | 领域读取命令                       |
| `CYCLE`               | 层级或依赖会形成循环                | `hierarchy.inspect` 或 `link.list` |
| `BUSY`                | 同类 operation 正在执行             | `operation.status`                 |
| `RUNNING`             | operation 尚未完成                  | `operation.status`                 |
| `CANCELLED`           | operation 已取消                    | `operation.result`                 |
| `EXEC_ERROR`          | 无法分类的执行或持久化失败          | 无自动恢复动作                     |

v1 的 `ENUM` 不再作为独立错误码：静态 JSON Schema 枚举错误归入 `BAD_ARGS`，动态
字段选项错误归入 `INVALID_FIELD_VALUE`。所有错误码由协议测试锁定。

## 11. Batch 与 Operation

- batch step 使用各命令的 v2 参数；
- alias 只在 command schema 标记为 `x-batch-ref: true` 的 ID 语义参数中解析，例如
  `parent`、任务 `id`、link `source/target`；
- 任意文本和动态 `values` 不扫描 `$` 前缀，因此任务名、描述和自定义字段可以安全地
  以 `$` 开头；v2 不提供字符串转义语法，也不支持在普通文本中内插 alias；
- batch dry-run 执行 schema、字段、日期、层级和依赖预检；
- 错误包含 `stepIndex`、`op` 和对应 `nextAction`；
- 包含 schema 相关任务写入的 batch 必须在 batch 执行选项提供 `schemaRev`；包含日期
  或排程写入的 batch 还必须提供 `policyRev`；
- schemaRev/policyRev 在 batch preflight 和 commit 前各检查一次；
- 成功响应返回 settle 后的 created/updated/deleted 摘要；
- operation 原样保留命令结果和结构化错误，不丢失导航信息。

## 12. 内置 AI 工具

`get_field_config`、`get_custom_fields`、`get_field_statistics`、
`get_calendar_info` 保留现有内置工具名称，但其实现改为调用共享领域服务。这样可以
避免同时改动内置 AI skill 路由，同时确保内置 AI 与外部 Agent 获得相同的字段、
选项、日历和日期语义。

每个换底工具保留现有外部输出 shape，增加 golden/snapshot 回归测试，并核对
`src/features/ai/skills/**/SKILL.md` 对字段名称、label/value 和日期编码的假设。共享服务
可以返回更丰富的内部模型，但 adapter 必须显式转换为原工具 shape。

## 13. 安全与性能

- 所有发现命令只读，并继续遵守分享页 read-only 边界；
- 不向 Agent 返回内部字段、未启用字段或存储实现；
- 选项查询限制 `limit` 上限并支持 cursor；
- calendar 查询要求日期范围后才返回 exceptions/leaves；
- form schema 可按 `projectId + mode + schemaRev + locale` 缓存；
- 项目切换或配置 revision 变化时失效；
- help 和 manifest 不包含动态选项，避免 token 膨胀。

## 14. 实施边界

改造涉及 Agent CLI registry、manifest、result、dispatch、batch、命令定义、任务/排程
领域操作、字段配置、日历服务、内置 AI 工具和 guide prompt。为保持模块清晰：

- registry 只保存静态命令元数据；
- discovery 服务只负责导航元数据和只读目标校验；
- schema/validation 服务不依赖 UI；
- command adapter 负责把领域结果转换为 Agent API 日期和字段语义；
- UI 与内置 AI 只消费共享领域服务，不反向依赖 Agent CLI。

### 14.1 实施顺序

1. 先完成并验证当前工作区在途的 project create/switch、mutation gate 和 guide prompt
   改动，避免 v2 在未稳定的 dispatch/api-builder 基础上开发；
2. 落地共享领域服务和纯单元测试：form schema、value validation、schedule policy、
   calendar query、hierarchy context；
3. 升级 registry、manifest/help、错误码和 `createReadAction()`；
4. 新增 `form.*`、`schedule.describe`、`calendar.describe`、`hierarchy.inspect` 只读命令；
5. 一次性切换 `task.*` 和 `state.export` 到 v2 数据契约；
6. 改造 batch 的 schema 标记型 alias、revision 检查和错误包装；
7. 改造 operation 和可见 command runner，确保不丢失 v2 结果；
8. 内置 AI 工具换底并运行输出 shape 回归；
9. 更新 Agent guide prompt、生成 Skill.md 和完整浏览器流程验证。

每一步独立提交并通过对应测试后再进入下一步，不把现有工作区未提交改动混入 v2
提交。

## 15. 质量计划（Tier 3）

### 场景

Agent 从 manifest/help 开始，按 discovery 获取动态字段、排程或层级信息，通过一次
batch dry-run 和一次提交完成操作，并能根据结构化错误继续探索。

### 风险

- 任务数据形状整体变化；
- 日期 inclusive/exclusive 转换和工作日计算；
- batch alias、事务、revision 和回滚；
- 层级、依赖、日历和持久化核心流；
- 内置 AI 与外部 Agent 配置解释不一致；
- 当前工作区已有未提交改动，需要逐文件避免覆盖。

### 验证

1. 先为 v2 manifest/help、schemaRev、动态字段、日期写入和 nextAction 编写失败测试。
2. 分模块实现并运行对应 unit tests。
3. 运行全部 `tests/unit/agent-cli` 和相关字段、日历、排程、store 测试。
4. 运行 `npm test`。
5. 浏览器验证：manifest → help → form/schedule discovery → batch dry-run → commit →
   state readback。
6. 浏览器验证 schema conflict、字段错误和层级/依赖错误的 nextAction。
7. 检查 read-only 页面、operation runner 和项目切换。
8. 为内置 AI 字段/日历工具增加输出 shape snapshot，并核对相关 Skill.md 消费约定。
9. 最终报告未覆盖风险，不以提交成功代替实际状态验证。

## 16. 验收标准

- Agent 无需阅读源码即可从任一公开命令找到所需动态信息；
- 所有动态字段能被发现、验证、创建、更新、筛选和导出；
- 所有 Agent 日期均使用包含式 end，内部边界不泄漏；
- 错误能给出安全、可执行且只读的下一步；
- batch 一次 dry-run 即能集中暴露字段、日期和结构错误；
- 写响应与 settle 后真实状态一致；
- 内置 AI、任务表单 UI 和 Agent CLI 使用同一份 schema 与日历解释；
- v1 接口和测试全部迁移，不保留兼容分支。
