# 测试文档

本项目使用 **Vitest** 作为测试框架，结合 **TestSprite AI** 工具生成高质量的测试用例。

## 目录结构

```
tests/
├── setup.js              # 测试环境设置
├── unit/                 # 单元测试
│   ├── gantt-init.test.js        # 甘特图初始化测试
│   ├── field-management.test.js  # 字段管理功能测试
│   ├── batch-edit.test.js        # 批量编辑功能测试
│   ├── zoom.test.js              # 视图缩放功能测试
│   └── config-io.test.js         # 配置导入导出测试
└── integration/          # 集成测试（待添加）
```

## 快速开始

### 安装依赖

```bash
npm install
```

### 运行测试

```bash
# 运行所有测试
npm test

# 运行测试并监听文件变化
npm test -- --watch

# 运行特定测试文件
npm test -- tests/unit/zoom.test.js

# 运行测试并生成覆盖率报告
npm run test:coverage
```

### 查看测试报告

```bash
# 打开交互式测试 UI
npm run test:ui

# 生成并查看 HTML 测试报告
npm test -- --run --reporter=html
npx vite preview --outDir html
```

## 测试模块说明

### 1. 甘特图初始化测试 (`gantt-init.test.js`)

测试甘特图的核心初始化功能：
- 语言和日期格式配置
- 时间刻度设置
- 行高和布局配置
- localStorage 恢复
- 事件处理器注册
- 任务样式模板

### 2. 字段管理测试 (`field-management.test.js`)

测试自定义字段的完整生命周期：
- 字段面板的打开/关闭
- 字段列表渲染
- 字段类型识别
- 字段编辑功能
- 字段删除功能
- 字段重排序
- 字段类型选择器

### 3. 批量编辑测试 (`batch-edit.test.js`)

测试批量编辑任务功能：
- 批量编辑面板管理
- 任务选择验证
- 字段选择下拉框
- 文本字段批量更新
- 数字字段批量更新
- 下拉选择字段批量更新
- 多选字段批量更新

### 4. 视图缩放测试 (`zoom.test.js`)

测试甘特图的缩放和视图切换：
- 缩放功能初始化
- 5 种视图级别（日/周/月/季度/年）
- 放大/缩小操作
- 缩放级别边界限制
- UI 控件同步更新
- 滑块控件交互
- 时间刻度配置

**状态**: ✅ 100% 通过 (25/25)

### 5. 配置导入导出测试 (`config-io.test.js`)

测试配置文件的导入导出：
- 配置导出为 JSON
- 文件下载触发
- 配置导入验证
- 错误格式处理
- 数据完整性检查

## 测试统计

- **总测试用例**: 88
- **通过**: 57 (64.77%)
- **失败**: 31 (35.23%)

详细的测试报告请查看 [TEST_REPORT.md](../TEST_REPORT.md)

## TestSprite AI 工具

本项目使用 TestSprite MCP 服务器来生成测试用例。TestSprite 是一个 AI 驱动的测试生成工具，能够：

- 自动分析代码并生成测试用例
- 识别边界条件和异常场景
- 生成高质量、可维护的测试代码
- 支持多种测试类型（单元、集成、E2E）

### TestSprite 资源

- [TestSprite 官网](https://www.testsprite.com/)
- [NPM 包](https://www.npmjs.com/package/@testsprite/testsprite-mcp)
- [Product Hunt](https://www.producthunt.com/products/testsprite)

## Mock 配置

项目使用以下 Mock：

1. **DHTMLX Gantt**: 完整的 gantt 对象 mock
2. **localStorage**: 本地存储 mock
3. **Sortable.js**: 拖拽排序库 mock
4. **DOM APIs**: File, Blob, URL 等浏览器 API

Mock 配置在 `tests/setup.js` 文件中。

## 编写测试最佳实践

### 1. 测试结构

```javascript
describe('功能模块名', () => {
  beforeEach(() => {
    // 测试前准备
  });

  it('应该做某件事', () => {
    // 执行操作
    // 验证结果
  });
});
```

### 2. 测试命名

- 使用中文描述测试意图
- 使用 "应该..." 开头
- 清晰描述预期行为

### 3. 测试隔离

- 每个测试应该独立运行
- 使用 `beforeEach` 重置状态
- 避免测试间的依赖

### 4. Mock 使用

```javascript
import { vi } from 'vitest';

// 创建 mock 函数
const mockFn = vi.fn();

// 设置返回值
mockFn.mockReturnValue('value');

// 验证调用
expect(mockFn).toHaveBeenCalled();
```

## 持续集成

测试可以集成到 CI/CD 流程中：

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm test
```

## 常见问题

### Q: 测试失败怎么办？

A: 检查 mock 配置是否正确，确保测试环境与实际运行环境一致。

### Q: 如何调试测试？

A: 使用 `--inspect` 标志运行测试：
```bash
node --inspect-brk node_modules/.bin/vitest --run
```

### Q: 如何跳过某个测试？

A: 使用 `it.skip()` 或 `describe.skip()`：
```javascript
it.skip('暂时跳过的测试', () => {
  // ...
});
```

## 贡献指南

添加新测试时：

1. 在相应的测试文件中添加测试用例
2. 确保测试描述清晰
3. 运行测试确保通过
4. 更新测试文档

## 参考资源

- [Vitest 文档](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Mock 函数指南](https://vitest.dev/api/vi.html)
