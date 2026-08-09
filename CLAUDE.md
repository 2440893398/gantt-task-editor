# CLAUDE.md — gantt-task-editor

通用项目规范见 @AGENTS.md，两份文件对所有 AI 协作者同等生效。

## 业务测试闭环（必须遵守）

业务测试由「场景清单 + 黄金答案 + 轨迹脚本」三份资产驱动，机制规范的唯一权威文档是
[tests/scenarios/README.md](./tests/scenarios/README.md)。触碰 `tests/scenarios/`、
`tests/e2e/agent-journeys/` 或任何业务行为前先读它。核心纪律：

1. **需求变更先改场景清单**（`tests/scenarios/<域>.md`），能自行推断的直接定并记变更
   日志；业务意图有歧义的写入清单的"例外队列"章节等用户拍板，不要擅自猜。
2. **契约不可私改**：`tests/e2e/agent-journeys/expected/` 与场景验证点是契约。改脚本
   实现随意；改契约必须在 `expected/CHANGES.md` 追加理由（日期、SCN-ID、关联需求）。
   黄金答案只能用 `UPDATE_GOLDEN=1` 重录，禁止手改 JSON。
3. **先见红再见绿**：修失败的业务测试前，先确认失败指向真实业务差异，并说明该测试在
   什么坏行为下会失败。禁止 `test.skip`、删断言、放宽比较来消除报错。
4. **追溯**：业务测试标题含 `[SCN-xxx]`；提交前 `npm run check:scenarios` 必须通过。
