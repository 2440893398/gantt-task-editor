# Vercel 部署 + SEO/GEO + 数据分析 实施报告

> 日期：2026-02-24 | 项目：gantt-task-editor | 域名：<https://gantt-task-editor.vercel.app/>

---

## 一、项目现状分析

| 维度 | 现状 |
|------|------|
| 框架 | Vite SPA（纯前端，无 SSR） |
| 数据存储 | IndexedDB (Dexie)，数据留在用户浏览器 |
| AI 功能 | 客户端直连 OpenAI API，用户自行配置 Key |
| 国际化 | 4 语言 (zh-CN / en-US / ja-JP / ko-KR) |
| CDN 依赖 | DHTMLX Gantt / SortableJS / Google Fonts |
| 构建 | `vite build` → `dist/` |

---

## 二、实施内容

### Phase 1：Vercel 部署配置

| 文件 | 变更 | 说明 |
|------|------|------|
| `vercel.json` | 🆕 新增 | SPA rewrite、安全响应头 (X-Frame/XSS/MIME)、静态资源 1 年缓存 |
| `vite.config.js` | ✏️ 修改 | 关闭 sourcemap、vendor/AI 分块优化 |
| `.env.example` | 🆕 新增 | 环境变量模板 (`VITE_GA4_ID` / `VITE_CLARITY_ID`) |

**分块策略：**

```
vendor chunk → dexie, exceljs, marked, quill, zod
ai chunk    → ai, @ai-sdk/openai
```

---

### Phase 2：SEO 优化

| 文件 | 变更 | 说明 |
|------|------|------|
| `index.html` | ✏️ 修改 | SEO 标题、description、keywords、canonical、Open Graph、Twitter Card |
| `public/robots.txt` | 🆕 新增 | 允许所有爬虫 + sitemap 引用 |
| `public/sitemap.xml` | 🆕 新增 | 站点地图 + 4 语言 hreflang 注解 |
| `public/manifest.json` | 🆕 新增 | PWA Manifest（增强可安装性 + SEO 信号） |
| `src/utils/structuredData.js` | 🆕 新增 | JSON-LD 结构化数据 (WebApplication + FAQ Schema) |

**结构化数据包含：**

- `WebApplication` schema — 帮助搜索引擎识别为在线工具
- `FAQPage` schema — 4 个常见问题，利于 AI 搜索引擎引用

---

### Phase 3：GEO 优化

| 文件 | 变更 | 说明 |
|------|------|------|
| `index.html` | ✏️ 修改 | 5 个 hreflang 标签 (zh-CN/en-US/ja-JP/ko-KR/x-default) |
| `src/utils/geoSeo.js` | 🆕 新增 | 语言切换时动态更新 title、description、OG 标签 |

**GEO 策略要点：**

- 每种语言有独立的 title + description + OG 描述
- 切换语言时自动更新 `<html lang>`、所有 meta 标签
- FAQ Schema 覆盖英文关键问答，利于 AI 搜索引擎（Perplexity / ChatGPT / Google AI Overview）

---

### Phase 4：数据分析工具

| 文件 | 变更 | 说明 |
|------|------|------|
| `src/utils/analytics.js` | 🆕 新增 | GA4 + Clarity 统一初始化 + 事件追踪模块 |
| `src/main.js` | ✏️ 修改 | 集成 analytics / structuredData / geoSeo 三模块 |

**分析工具组合：**

| 工具 | 用途 | 费用 |
|------|------|------|
| Google Analytics 4 | 流量、来源、地域、设备 | 免费 |
| Microsoft Clarity | 热力图、录屏、用户行为 | 免费 |
| Vercel Analytics | 页面访问、Web Vitals | 免费 (Hobby) |

**预定义追踪事件：**

| 事件 | 触发点 |
|------|--------|
| `task_create` | 新建任务 |
| `task_edit` | 编辑任务 |
| `export_file` | 导出 (Excel/JSON/PNG) |
| `import_file` | 导入 |
| `ai_chat` | AI 对话 |
| `language_switch` | 切换语言 |
| `view_mode_switch` | 切换视图模式 |
| `baseline_save` | 保存基线 |
| `critical_path_toggle` | 切换关键路径 |
| `batch_edit` | 批量编辑 |

---

### Phase 5：运营监控策略

**运营指标体系：**

| 指标 | 工具 | 目标 |
|------|------|------|
| DAU / MAU | GA4 | 增长趋势 |
| 流量来源分布 | GA4 | 搜索占比 > 40% |
| 地域分布 | GA4 | 多语言覆盖验证 |
| 7日/30日回访率 | GA4 | > 20% |
| LCP / FID / CLS | Vercel Speed Insights | 全绿 |
| 用户行为热力图 | Clarity | 发现优化点 |
| 各功能使用率 | GA4 Events | 指导功能迭代 |

---

## 三、文件变更汇总

### 新增 (8 个文件)

```
vercel.json                     ← Vercel 部署配置
.env.example                    ← 环境变量模板
public/robots.txt               ← 搜索引擎爬虫规则
public/sitemap.xml              ← 站点地图 + 多语言
public/manifest.json            ← PWA Manifest
src/utils/analytics.js          ← GA4 + Clarity 分析模块
src/utils/structuredData.js     ← JSON-LD 结构化数据
src/utils/geoSeo.js             ← GEO 动态 meta 更新
```

### 修改 (3 个文件)

```
vite.config.js                  ← 关闭 sourcemap + 分块优化
index.html                      ← SEO meta + OG + hreflang + manifest
src/main.js                     ← 集成三个新模块
```

---

## 四、构建验证

```
✓ npm run build — exit code 0
✓ 952 modules transformed
✓ built in 7.17s
✓ 代码分块：vendor / ai / 主包
```

---

## 五、部署后操作清单

| # | 操作 | 状态 |
|---|------|------|
| 1 | Git push 触发 Vercel 自动部署 | ⬜ |
| 2 | 注册 [GA4](https://analytics.google.com/) → 设置 `VITE_GA4_ID` 环境变量 | ⬜ |
| 3 | 注册 [Clarity](https://clarity.microsoft.com/) → 设置 `VITE_CLARITY_ID` 环境变量 | ⬜ |
| 4 | Vercel Dashboard → 启用 Analytics + Speed Insights | ⬜ |
| 5 | [Google Search Console](https://search.google.com/search-console) → 提交 sitemap | ⬜ |
| 6 | 创建 `public/og-image.png` (1200×630px 社交分享封面图) | ⬜ |
| 7 | 创建 PWA 图标 `public/icon-192.png` + `public/icon-512.png` | ⬜ |

> **注意事项：**
>
> - 环境变量设置后需重新部署才能生效（Vercel Dashboard → Settings → Environment Variables）
> - DHTMLX Gantt CDN 版本为评估版，商用需确认许可证
> - AI 功能的 API Key 由用户自行在客户端配置，无安全风险
