/**
 * [SCN-FWB-032] ActionsAdapter 必须通过 Executor Protocol v0 的 C1～C5。
 *
 * GitHub Actions 路径是协议的第一个实现。它跑绿是整个 M1 的完成定义之一——
 * 也是全期的回滚保证：任何一步出问题，把默认 adapter 切回 `actions` 即可恢复现状。
 */
import { createActionsAdapter } from '../adapters/actions.js';
import { registerConformanceSuite } from '../conformance/suite.js';

registerConformanceSuite(createActionsAdapter({ provider: 'codex' }));
registerConformanceSuite(createActionsAdapter({ provider: 'claude' }));
