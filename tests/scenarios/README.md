# 业务测试闭环（Scenario Loop）— 机制规范

本文档是业务测试闭环的**唯一权威规范**。所有 AI 协作者（Claude Code、Codex 等）
在触碰业务测试相关文件前必须先读完本文档。CLAUDE.md 与 AGENTS.md 中的相关章节
均指向此处。

## 1. 三份资产

| 资产 | 位置 | 作用 |
|---|---|---|
| 场景清单 | `tests/scenarios/<域>.md` | 定义"测什么"：每条业务场景一个 SCN-ID，附可核对的验证点 |
| 黄金答案 | `tests/e2e/agent-journeys/expected/*.json` | 定义"期望结果"：归一化后的业务状态快照，由真实运行捕获后冻结 |
| 业务测试脚本 | `tests/e2e/agent-journeys/*.spec.js` | 定义"怎么测"：标题内嵌 `[SCN-xxx]` 与清单双向追溯 |

## 2. 闭环流程（AI 自循环，例外才升级人类）

```
需求/代码变更
   ↓
① AI 更新场景清单：能从需求、代码、历史行为推断的直接定（新增/保留/废弃），记入清单
   变更日志；业务意图有歧义、无法推断的 → 写入清单"例外队列"章节，等用户拍板
   ↓
② AI 写/修脚本 → 真实运行 → 捕获业务状态 → 对照场景验证点逐条核对 → 冻结为黄金答案
   ↓
③ 日常全量测试：纯比对（npm run test:e2e），机器完成，零 AI 参与
   ↓
④ 出现差异 → AI 二选一：
   - 是 bug → 修产品代码，黄金答案不动
   - 是需求变更的预期后果 → 更新黄金答案 + 在 expected/CHANGES.md 追加理由
   ↓
⑤ 独立审查（另起会话或 /code-review）审计理由 → 审不过或有歧义 → 进例外队列
```

## 3. 硬性规则（AI 不得违反）

1. **契约与实现分离**：`expected/` 目录和场景清单中的验证点是契约。修改脚本步骤
   （选择器、等待、操作顺序）可自由进行；修改契约必须在
   `tests/e2e/agent-journeys/expected/CHANGES.md` 中追加一条记录（日期、SCN-ID、
   变更原因、关联需求），无记录的契约变更视为违规。
2. **先见红再见绿**：修复失败的业务测试前，必须先确认失败信息指向真实业务差异
   （不是环境问题），并在结论中说明"这个测试在什么坏行为下会失败"。禁止用
   `test.skip`、删除断言、放宽比较（如深比较降级为 truthy）等方式消除报错。
3. **验证点必须可核对**：场景清单里每条场景的验证点必须落到可观察数据上
   （日期、数量、状态、错误码），能通过 `window.app.state.snapshot` / `task.get` /
   `link.list` 等读命令核实。写不出可核对验证点的场景 → 进例外队列。
4. **黄金答案只能由真实运行产生**：用 `UPDATE_GOLDEN=1` 重录，禁止手改 JSON。
   重录后必须对照场景验证点核对一遍再提交。
5. **追溯完整性**：每个业务测试标题必须含 `[SCN-xxx]`；每条 `active` 场景必须被
   至少一个测试或标记为 `manual`/`todo`。`npm run check:scenarios` 校验，CI 必须绿。
6. **需求变更先动清单再动脚本**：先在清单上标废弃/新增并记日志，再改脚本。

## 4. 日常命令

```bash
npm run check:scenarios                        # 清单↔脚本对账
npx playwright test tests/e2e/agent-journeys   # 跑业务轨迹测试（纯比对）
UPDATE_GOLDEN=1 npx playwright test tests/e2e/agent-journeys   # 重录黄金答案（需附理由）
```

Windows PowerShell 重录：`$env:UPDATE_GOLDEN='1'; npx playwright test tests/e2e/agent-journeys; Remove-Item Env:UPDATE_GOLDEN`

## 5. 场景清单文件格式

每个业务域一个 Markdown 文件，场景表格式（供 `scripts/check-scenario-coverage.mjs` 解析）：

```
| ID | P | 场景 | 验证点 | 状态 |
```

- **ID**：`SCN-<域缩写>-<三位数>`，永不复用；废弃的行保留，状态改 `deprecated`
- **P**：P0（致命/核心路径）、P1（常用）、P2（边缘）
- **状态**：`active`（须有自动化覆盖）、`todo`（待补脚本）、`manual`（人工检查单）、
  `deprecated`（业务已不存在）
- 文件末尾必须有 **变更日志** 和 **例外队列** 两个章节

## 6. 黄金答案的归一化

黄金答案不存原始快照，存 `tests/e2e/agent-journeys/helpers.js` 中
`captureBusinessState()` 产出的**业务状态**：任务以名称为键（场景数据内名称必须唯一）、
父子关系用名称表达、日期为本地 `YYYY-MM-DD`（end 为含端点日）、剔除 id/rev/时间戳等
易变字段。这保证黄金文件人类可读、可直接对照场景验证点核对。
