---
trigger: always_on
description: 项目结构规范 - 定义文件组织、命名约定和目录结构标准
---

# 项目结构规范

## 核心原则

- **分层组织**：按功能或领域划分目录，遵循"关注点分离"原则
- **命名一致**：使用一致且描述性的目录和文件命名，反映其用途和内容
- **模块化**：相关功能放在同一模块，减少跨模块依赖
- **适当嵌套**：避免过深的目录嵌套，一般不超过3-4层
- **资源分类**：区分代码、资源、配置和测试文件
- **依赖管理**：集中管理依赖，避免多处声明
- **约定优先**：遵循语言或框架的标准项目结构约定

## 目录结构标准

### 根目录结构

```
项目根目录/
├── README.md                    # 项目说明文档
├── package.json                 # 项目配置和依赖管理
├── .gitignore                   # Git忽略文件配置
├── .claude/                     # Claude AI配置
│   └── agents/                  # AI代理角色定义
├── doc/                        # 项目文档
│   ├── design/                  # 设计相关文档
│   ├── impl/                  # 实现报告
│   ├── prd/                  # 需求文档
│   ├── testdoc/                  # 自动化测试报告和测试用例
│   ├── api/                     # API文档
│   └── guides/                  # 使用指南
├── src/                         # 源代码目录
├── assets/                      # 静态资源
├── public/                      # 公共资源
├── tests/                       # 测试文件
└── config/                      # 配置文件
```

### 前端项目结构

```
src/
├── index.html                   # 主入口文件
├── pages/                       # 页面组件
│   ├── home/                    # 首页
│   ├── about/                   # 关于页
│   └── contact/                 # 联系页
├── components/                  # 可复用组件
│   ├── common/                  # 通用组件
│   ├── layout/                  # 布局组件
│   └── business/                # 业务组件
├── styles/                      # 样式文件
│   ├── main.css                 # 主样式文件
│   ├── variables.css            # CSS变量定义
│   ├── components/              # 组件样式
│   └── pages/                   # 页面样式
├── scripts/                     # JavaScript文件
│   ├── main.js                  # 主脚本文件
│   ├── utils/                   # 工具函数
│   ├── components/              # 组件脚本
│   └── pages/                   # 页面脚本
├── assets/                      # 静态资源
│   ├── images/                  # 图片资源
│   ├── icons/                   # 图标资源
│   └── fonts/                   # 字体文件
└── data/                        # 数据文件
    └── mock.json                # 模拟数据
```

### 文档结构

```
doc/
├── README.md                    # 文档首页
├── design/                      # 设计文档
│   ├── DESIGN_SPEC_全局.md           # 全局设计规范
│   ├── DESIGN_SPEC_需求名.md              # 指定需求的设计稿
│   └── prototypes/              # 原型图
├── api/                         # API文档
│   ├── endpoints.md             # 接口文档
│   └── examples/                # 使用示例
├── guides/                      # 使用指南
│   ├── getting-started.md       # 快速开始
│   ├── development.md           # 开发指南
│   └── deployment.md            # 部署指南
└── prd/                         # 产品需求文档
|    └── PRD-功能名-完成情况.md   # 需求文档
└── testdoc/                         # 产品需求文档
    └── TEST-<功能名称>-单元用例.md   # 测试用例
    └── playwright-report   # playwright测试报告
```

## 命名规范

### 文件命名

- **HTML文件**：使用小写字母和连字符，如 `user-profile.html`
- **CSS文件**：使用小写字母和连字符，如 `main-styles.css`
- **JavaScript文件**：使用小写字母和连字符，如 `user-utils.js`
- **图片文件**：使用描述性名称，如 `hero-banner.jpg`
- **文档文件**：使用大写字母和连字符，如 `API-GUIDE.md`

### 目录命名

- 使用小写字母和连字符
- 避免使用空格和特殊字符
- 使用描述性名称，如 `user-management/`
- 复数形式用于集合，如 `components/`、`pages/`

### 变量和函数命名

- **JavaScript变量**：使用驼峰命名法，如 `userName`
- **CSS类名**：使用BEM命名法，如 `.button--primary`
- **HTML ID**：使用连字符，如 `user-profile-form`

## 文件组织规则

### 按功能分组

- 相关文件放在同一目录下
- 每个功能模块独立管理
- 避免跨目录的强依赖

### 按类型分组

- 相同类型的文件放在同一目录
- 如所有样式文件放在 `styles/` 目录
- 如所有脚本文件放在 `scripts/` 目录

### 按层级分组

- 按页面层级组织文件
- 如 `pages/home/` 包含首页相关所有文件
- 如 `components/common/` 包含通用组件

## 依赖管理

### 外部依赖

- 在 `package.json` 中统一管理
- 使用版本锁定确保一致性
- 定期更新和检查安全漏洞

### 内部依赖

- 使用相对路径引用内部模块
- 避免循环依赖
- 明确定义模块接口

## 配置管理

### 环境配置

- 不同环境使用不同配置文件
- 敏感信息使用环境变量
- 配置文件不提交到版本控制

### 构建配置

- 构建工具配置放在根目录
- 如 `webpack.config.js`、`vite.config.js`
- 配置项要有详细注释

## 文档要求

### 必须文档

- `README.md`：项目概述和使用说明
- `CHANGELOG.md`：版本变更记录
- `CONTRIBUTING.md`：贡献指南

### 可选文档

- `API.md`：API文档
- `DESIGN.md`：设计文档

## 质量保证

### 代码规范

- 使用ESLint、Prettier等工具
- 遵循团队编码规范
- 定期进行代码审查

### 测试覆盖

- 单元测试放在 `tests/unit/` 目录
- e2e测试放在 `tests/e2e/` 目录
- 集成测试放在 `tests/integration/` 目录
- 测试覆盖率要求达到80%以上

### 性能优化

- 图片资源优化和压缩
- CSS和JavaScript文件压缩
- 使用CDN加速静态资源

## 部署结构

### 构建输出

- 构建后的文件放在 `dist/` 或 `build/` 目录
- 保持目录结构清晰
- 包含必要的部署说明
