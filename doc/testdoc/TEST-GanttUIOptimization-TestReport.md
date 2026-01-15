# 测试报告（Test Report）

## 1. 报告概述
- **测试对象**：甘特图UI优化与Excel导入导出功能（含多语言视觉一致性测试、本地化细节测试）
- **测试时间**：2026-01-15 16:30 (更新)
- **测试环境**：Windows 11, Chrome (Headless), Playwright 1.x
- **执行人员**：自动化测试
- **测试语言**：中文(zh-CN)、英文(en-US)、日文(ja-JP)、韩文(ko-KR)

## 2. 测试结论
- **总体评估**：❌ 不通过
- **质量建议**：**暂不建议发布**，存在高优先级缺陷需要修复

### 关键问题总结
1. **全语言枚举值映射失败**：所有四种语言（中/英/日/韩）的枚举值导入后均未能正确转换为内部值
2. **跨语言导入完全失败**：任意两种语言间的跨语言导入都存在枚举值映射问题
3. **数据完整性严重受损**：跨语言导入后，优先级和状态字段数据与原始数据不一致

### 多语言测试发现
| 源语言 | 目标语言 | 优先级映射 | 状态映射 | 结果 |
|:------:|:--------:|:----------:|:--------:|:----:|
| zh-CN | en-US | 高 → 高 (应为high) | 进行中 → 进行中 (应为in_progress) | ❌ 失败 |
| zh-CN | ja-JP | 高 → 高 | 进行中 → 进行中 | ❌ 失败 |
| zh-CN | ko-KR | 高 → 高 | 进行中 → 进行中 | ❌ 失败 |
| en-US | zh-CN | High → High (应为high) | Pending → Pending (应为pending) | ❌ 失败 |
| ja-JP | en-US | 高 → 高 | 進行中 → 進行中 | ❌ 失败 |
| ko-KR | zh-CN | 높음 → 높음 (应为high) | 진행중 → 진행중 | ❌ 失败 |

## 3. 测试结果统计
| 类别 | 用例总数 | 通过 | 失败 | 阻塞 | 通过率 |
|:----:|:--------:|:----:|:----:|:----:|:------:|
| UI功能测试 | 4 | 4 | 0 | 0 | 100% |
| Excel导出测试 | 4 | 4 | 0 | 0 | 100% |
| Excel导入基础测试 | 5 | 1 | 4 | 0 | 20% |
| Excel导入边界测试 | 4 | 4 | 0 | 0 | 100% |
| Excel导入异常测试 | 3 | 3 | 0 | 0 | 100% |
| Excel导入本地化测试 | 3 | 0 | 3 | 0 | 0% |
| **多语言往返一致性测试** | 4 | 0 | 4 | 0 | 0% |
| **多语言跨语言导入测试** | 6 | 0 | 6 | 0 | 0% |
| **多语言视觉渲染测试** | 5 | 4 | 1 | 0 | 80% |
| **多语言特殊字符测试** | 2 | 2 | 0 | 0 | 100% |
| **合计** | **38** | **20** | **18** | **0** | **53%** |

## 4. 缺陷列表

### 4.1 Critical 缺陷
| 缺陷编号 | 缺陷描述 | 严重程度 | 关联用例 | 复现步骤 | 状态 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:----:|
| BUG-001 | 跨语言导入时优先级枚举值未转换 | Critical | TC-IM-002, TC-IM-003, TC-IM-004, TC-ML-001~016 | 1. 任意语言环境创建优先级为"high"的任务<br>2. 导出Excel<br>3. 切换到其他语言环境导入<br>4. 检查priority字段值 | Open |
| BUG-002 | 跨语言导入时状态枚举值未转换 | Critical | TC-IM-002, TC-IM-003, TC-IM-004, TC-ML-001~016 | 同BUG-001，检查status字段 | Open |

### 4.2 Major 缺陷
| 缺陷编号 | 缺陷描述 | 严重程度 | 关联用例 | 复现步骤 | 状态 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:----:|
| BUG-003 | 中文枚举值导入失败 | Major | TC-IM-L01, TC-ML-001, TC-ML-005~007 | 1. 创建包含"高"、"进行中"的Excel<br>2. 导入后priority="高"而非"high" | Open |
| BUG-004 | 英文枚举值导入失败 | Major | TC-IM-L02, TC-ML-002, TC-ML-008 | 1. 创建包含"High"、"In Progress"的Excel<br>2. 导入后priority="High"而非"high" | Open |
| BUG-005 | 混合语言枚举值处理失败 | Major | TC-IM-L04 | 1. Excel中同时包含"高"和"Low"<br>2. 导入后均未正确转换 | Open |
| BUG-006 | 日文枚举值导入失败 | Major | TC-ML-003, TC-ML-009, TC-ML-012~013 | 1. 日文环境导出Excel<br>2. 导入后优先级保持日文显示值 | Open |
| BUG-007 | 韩文枚举值导入失败 | Major | TC-ML-004, TC-ML-010, TC-ML-014~016 | 1. 韩文环境导出Excel<br>2. 导入后优先级保持韩文显示值(높음) | Open |

## 5. 测试详情

### 5.1 通过用例 (20条)
| 用例编号 | 用例名称 | 执行结果 | 自动化代码位置 | 备注 |
|:--------:|:--------:|:--------:|:--------------:|:----:|
| TC-UI-001 | 缩放控件交互方向验证 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:103` | - |
| TC-UI-002 | 缩放视图下拉选择验证 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:103` | 与TC-UI-001合并测试 |
| TC-UI-003 | 今日按钮功能验证 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:121` | - |
| TC-UI-004 | 视图选择器移除验证 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:127` | - |
| TC-EX-001 | 导出字段结构验证 (English) | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:139` | - |
| TC-EX-002 | 导出字段结构验证 (中文) | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:168` | - |
| TC-EX-003 | 导出数据值验证 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:189` | - |
| TC-EX-004 | 导出层级关系验证 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:219` | - |
| TC-IM-005 | 层级结构完整性验证 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:436` | - |
| TC-IM-B01 | 空任务名称导入 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:477` | - |
| TC-IM-B02 | 工期边界值 - 零 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:502` | - |
| TC-IM-B07 | 特殊字符任务名 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:524` | Emoji和特殊字符正确保留 |
| TC-IM-B10 | 只有部分列 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:548` | - |
| TC-IM-E01 | 空Excel文件 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:579` | 正确显示错误提示 |
| TC-IM-E02 | 只有表头无数据 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:605` | - |
| TC-ML-V01 | 任务条颜色一致性 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:989` | 各语言下相同优先级颜色一致 |
| TC-ML-V02 | 进度条渲染一致性 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:1033` | 进度条宽度导入前后一致 |
| TC-ML-V05 | 工具栏语言切换 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:1107` | 今日按钮各语言显示正确 |
| TC-ML-S01 | 中日韩混合任务名 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:1132` | 所有CJK字符正确保留 |
| TC-ML-S02 | Emoji任务名多语言 | ✅ 通过 | `tests/e2e/gantt-ui-excel.spec.js:1154` | Emoji在各语言下正确显示 |

### 5.2 失败用例 (18条)

#### 5.2.1 Excel导入基础测试失败 (4条)
| 用例编号 | 用例名称 | 执行结果 | 失败原因 | 关联缺陷 |
|:--------:|:--------:|:--------:|:--------:|:--------:|
| TC-IM-001 | 同语言往返导入 | ❌ 失败 | priority字段导入后不是内部值 | BUG-001 |
| TC-IM-002 | 跨语言导入 (中文 -> 英文) | ❌ 失败 | 中文枚举值"高"未转换为"high" | BUG-001, BUG-002, BUG-003 |
| TC-IM-003 | 跨语言数据完整性验证 | ❌ 失败 | 优先级和状态字段值不正确 | BUG-001, BUG-002 |
| TC-IM-004 | 跨语言导入 (英文 -> 中文) | ❌ 失败 | 英文枚举值"Low"未转换为"low" | BUG-004 |

#### 5.2.2 Excel导入本地化测试失败 (3条)
| 用例编号 | 用例名称 | 执行结果 | 失败原因 | 关联缺陷 |
|:--------:|:--------:|:--------:|:--------:|:--------:|
| TC-IM-L01 | 中文枚举值导入 | ❌ 失败 | priority="高" 而非 "high" | BUG-003 |
| TC-IM-L02 | 英文枚举值导入 | ❌ 失败 | priority="High" 而非 "high" | BUG-004 |
| TC-IM-L04 | 混合语言枚举值 | ❌ 失败 | 所有枚举值均未正确转换 | BUG-005 |

#### 5.2.3 多语言往返一致性测试失败 (4条)
| 用例编号 | 用例名称 | 执行结果 | 失败原因 | 关联缺陷 |
|:--------:|:--------:|:--------:|:--------:|:--------:|
| TC-ML-001 | 中文环境往返一致性 | ❌ 失败 | 导入后priority="高"而非"high" | BUG-003 |
| TC-ML-002 | 英文环境往返一致性 | ❌ 失败 | 导入后priority="High"而非"high" | BUG-004 |
| TC-ML-003 | 日文环境往返一致性 | ❌ 失败 | 导入后priority="高"而非"high" | BUG-006 |
| TC-ML-004 | 韩文环境往返一致性 | ❌ 失败 | 导入后priority="높음"而非"high" | BUG-007 |

#### 5.2.4 多语言跨语言导入测试失败 (6条)
| 用例编号 | 用例名称 | 执行结果 | 失败原因 | 关联缺陷 |
|:--------:|:--------:|:--------:|:--------:|:--------:|
| TC-ML-005 | 中文 -> 英文 | ❌ 失败 | 中文枚举值未映射 | BUG-001, BUG-003 |
| TC-ML-006 | 中文 -> 日文 | ❌ 失败 | 中文枚举值未映射 | BUG-001, BUG-003 |
| TC-ML-007 | 中文 -> 韩文 | ❌ 失败 | 中文枚举值未映射 | BUG-001, BUG-003 |
| TC-ML-008 | 英文 -> 中文 | ❌ 失败 | 英文枚举值未映射 | BUG-001, BUG-004 |
| TC-ML-009 | 日文 -> 英文 | ❌ 失败 | 日文枚举值未映射 | BUG-001, BUG-006 |
| TC-ML-010 | 韩文 -> 中文 | ❌ 失败 | 韩文枚举值未映射 | BUG-001, BUG-007 |

#### 5.2.5 多语言视觉渲染测试失败 (1条)
| 用例编号 | 用例名称 | 执行结果 | 失败原因 | 关联缺陷 |
|:--------:|:--------:|:--------:|:--------:|:--------:|
| TC-ML-V03 | 层级缩进一致性 | ❌ 失败 | 导入后缩进数量与导入前不一致 | - |

## 6. 根因分析

### 6.1 问题定位
问题出在 `src/features/config/configIO.js` 的 `getInternalEnumValue` 函数。

### 6.2 各语言枚举值映射现状
| 语言 | 源值 | 期望内部值 | 实际值 | 是否正确 |
|:----:|:----:|:----------:|:------:|:--------:|
| zh-CN | 高 | high | 高 | ❌ |
| en-US | High | high | High | ❌ |
| ja-JP | 高 | high | 高 | ❌ |
| ko-KR | 높음 | high | 높음 | ❌ |

### 6.3 语言包结构问题
当前语言包采用的映射结构：
```javascript
// 当前结构（有问题）
enums: {
    priority: {
        '高': '高',      // 显示值 → 显示值（无法反向查找内部值）
        'high': '高',    // 内部值 → 显示值
    }
}
```

**问题**：`getInternalEnumValue` 查找 displayValue 时，如果找到的 key 是 '高' 而不是 'high'，就会返回 '高'。

## 7. 修复建议

### 方案1：修改语言包结构（推荐）
将语言包中的枚举定义统一为 `内部值 → 本地化显示值` 格式：
```javascript
// 修复后的结构
// zh-CN.js
enums: {
    priority: {
        'high': '高',
        'medium': '中',
        'low': '低'
    }
}

// en-US.js
enums: {
    priority: {
        'high': 'High',
        'medium': 'Medium',
        'low': 'Low'
    }
}

// ja-JP.js
enums: {
    priority: {
        'high': '高',
        'medium': '中',
        'low': '低'
    }
}

// ko-KR.js
enums: {
    priority: {
        'high': '높음',
        'medium': '중간',
        'low': '낮음'
    }
}
```

### 方案2：添加反向映射表
在 `getInternalEnumValue` 中添加完整的反向映射：
```javascript
const ENUM_REVERSE_MAP = {
    priority: {
        // 中文
        '高': 'high', '中': 'medium', '低': 'low',
        // 英文
        'High': 'high', 'Medium': 'medium', 'Low': 'low',
        // 日文
        // '高': 'high' (与中文相同)
        // 韩文
        '높음': 'high', '중간': 'medium', '낮음': 'low',
        // 内部值（原样返回）
        'high': 'high', 'medium': 'medium', 'low': 'low'
    },
    status: {
        // 中文
        '待开始': 'pending', '进行中': 'in_progress', '已完成': 'completed', '已取消': 'suspended',
        // 英文
        'Pending': 'pending', 'In Progress': 'in_progress', 'Completed': 'completed', 'Cancelled': 'suspended',
        // 日文
        '未着手': 'pending', '進行中': 'in_progress', '完了': 'completed', 'キャンセル': 'suspended',
        // 韩文
        '대기중': 'pending', '진행중': 'in_progress', '완료': 'completed', '취소': 'suspended',
        // 内部值
        'pending': 'pending', 'in_progress': 'in_progress', 'completed': 'completed', 'suspended': 'suspended'
    }
};
```

## 8. 风险提示
- ⚠️ **数据完整性风险**：跨语言环境使用导出的Excel文件可能导致枚举字段值损坏
- ⚠️ **兼容性风险**：任意语言环境导出的Excel文件在其他语言环境导入后，优先级和状态字段将无法正常显示和筛选
- ⚠️ **全语言影响**：此Bug影响所有四种语言（中/英/日/韩），不仅仅是跨语言场景
- 🔧 **临时规避**：在修复前，建议用户在同一语言环境下进行导入导出操作，且不要切换语言

## 9. 测试产出物
- 测试用例文档：[TEST-GanttUIOptimization-UnitCase.md](TEST-GanttUIOptimization-UnitCase.md)
- Playwright报告：[playwright-report/index.html](playwright-report/index.html)
- 自动化测试脚本：[tests/e2e/gantt-ui-excel.spec.js](../../tests/e2e/gantt-ui-excel.spec.js)
- 多语言测试截图：`tests/e2e/screenshots/` 目录

## 10. 测试覆盖矩阵

### 10.1 跨语言导入覆盖
| 导出语言 ↓ / 导入语言 → | zh-CN | en-US | ja-JP | ko-KR |
|:-----------------------:|:-----:|:-----:|:-----:|:-----:|
| zh-CN | TC-ML-001 ❌ | TC-ML-005 ❌ | TC-ML-006 ❌ | TC-ML-007 ❌ |
| en-US | TC-ML-008 ❌ | TC-ML-002 ❌ | - | - |
| ja-JP | - | TC-ML-009 ❌ | TC-ML-003 ❌ | - |
| ko-KR | TC-ML-010 ❌ | - | - | TC-ML-004 ❌ |

**结论**：所有测试的跨语言组合均失败，问题根因一致。

---

## 11. 本地化细节测试补充 (2026-01-15)

### 11.1 测试背景
基于代码审查发现的本地化遗漏风险点，新增专项测试验证UI元素本地化完整性。

### 11.2 测试执行结果
| 类别 | 用例总数 | 通过 | 失败 | 通过率 |
|:----:|:--------:|:----:|:----:|:------:|
| 快捷键面板本地化 | 5 | 2 | 3 | 40% |
| 图例面板本地化 | 1 | 1 | 0 | 100% |
| 视图选择器本地化 | 1 | 1 | 0 | 100% |
| 工具栏按钮本地化 | 4 | 3 | 1 | 75% |
| 下拉菜单本地化 | 1 | 0 | 1 | 0% |
| 语言切换边界测试 | 4 | 0 | 4 | 0% |
| 已知缺陷验证 | 3 | 3 | 0 | 100% |
| **合计** | **19** | **11** | **8** | **58%** |

### 11.3 发现的本地化缺陷（新增）

#### 🔴 Critical - 硬编码中文导致本地化失败
| 缺陷编号 | 缺陷描述 | 影响位置 | 复现步骤 | 状态 |
|:--------:|:--------:|:--------:|:--------:|:----:|
| BUG-L01 | 快捷键面板标题硬编码 | `index.html:152` | 切换英文后标题仍显示"快捷键 & 图例" | Open |
| BUG-L02 | 导航分类标题硬编码 | `index.html:159` | 切换英文后仍显示"导航"而非"Navigation" | Open |
| BUG-L03 | 平移视图说明硬编码 | `index.html:161` | 切换英文后仍显示"平移视图" | Open |
| BUG-L04 | 缩放时间轴说明硬编码 | `index.html:169` | 切换英文后仍显示"缩放时间轴" | Open |
| BUG-L05 | 回到今天说明硬编码 | `index.html:177` | 切换英文后仍显示"回到今天" | Open |
| BUG-L06 | 任务操作分类硬编码 | `index.html:186` | 切换英文后仍显示"任务操作" | Open |
| BUG-L07 | 编辑任务说明硬编码 | `index.html:188` | 切换英文后仍显示"编辑任务" | Open |
| BUG-L08 | 调整时间说明硬编码 | `index.html:194` | 切换英文后仍显示"调整时间" | Open |
| BUG-L09 | 调整进度说明硬编码 | `index.html:200` | 切换英文后仍显示"调整进度" | Open |
| BUG-L10 | 图例分类标题硬编码 | `index.html:209` | 切换英文后仍显示"图例"而非"Legend" | Open |
| BUG-L11 | 已完成图例硬编码 | `index.html:213` | 切换英文后仍显示"已完成" | Open |
| BUG-L12 | 未完成图例硬编码 | `index.html:216` | 切换英文后仍显示"未完成" | Open |
| BUG-L13 | 依赖关系图例硬编码 | `index.html:219` | 切换英文后仍显示"依赖关系" | Open |
| BUG-L14 | 滚轮关键词硬编码 | `index.html:173` | 切换英文后仍显示"滚轮"而非"Scroll" | Open |

#### 🟡 Major - 视图选择器option初始值硬编码
| 缺陷编号 | 缺陷描述 | 影响位置 | 复现步骤 | 状态 |
|:--------:|:--------:|:--------:|:--------:|:----:|
| BUG-L15 | 视图选择器option文本硬编码 | `index.html:247-251` | 英文环境下选项仍显示"日视图/周视图/月视图" | Open |

#### 🟢 Info - zoom.js日期格式硬编码
| 缺陷编号 | 缺陷描述 | 影响位置 | 复现步骤 | 状态 |
|:--------:|:--------:|:--------:|:--------:|:----:|
| BUG-L16 | 时间轴日期格式硬编码 | `zoom.js:17-127` | 英文环境下日期仍显示"X月X日"而非"Jan X" | Open |

### 11.4 测试详情

#### 11.4.1 通过用例 (11条)
| 用例编号 | 用例名称 | 执行结果 | 自动化代码位置 |
|:--------:|:--------:|:--------:|:--------------:|
| TC-L-030 | 快捷键面板标题-中文 | ✅ 通过 | `localization-detail.spec.js:204` |
| TC-L-050-053 | 图例标签-四语言 | ✅ 通过 | `localization-detail.spec.js:336` |
| TC-L-001-005 | 视图选择器选项 | ✅ 通过 | `localization-detail.spec.js:383` |
| TC-L-061 | 新建任务按钮-四语言 | ✅ 通过 | `localization-detail.spec.js:432` |
| TC-L-062 | 更多按钮-四语言 | ✅ 通过 | `localization-detail.spec.js:447` |
| TC-L-063-065 | 图标按钮title | ✅ 通过 | `localization-detail.spec.js:462` |
| TC-L-D03 | 快捷键面板硬编码检测 | ✅ 缺陷确认 | `localization-detail.spec.js:637` |
| TC-L-D04 | 图例面板硬编码检测 | ✅ 缺陷确认 | `localization-detail.spec.js:659` |
| TC-L-D05 | 视图选择器硬编码检测 | ✅ 缺陷确认 | `localization-detail.spec.js:676` |

#### 11.4.2 失败用例 (8条)
| 用例编号 | 用例名称 | 执行结果 | 失败原因 | 关联缺陷 |
|:--------:|:--------:|:--------:|:--------:|:--------:|
| TC-L-031 | 快捷键面板标题-英文 | ❌ 失败 | 英文环境下仍显示中文"快捷键 & 图例" | BUG-L01 |
| TC-L-034 | 导航分类标题-四语言 | ❌ 失败 | 非中文环境下仍显示"导航" | BUG-L02 |
| TC-L-060 | 今日按钮-四语言 | ❌ 失败 | 日文/韩文环境测试超时 | - |
| TC-L-070-074 | 下拉菜单项-四语言 | ❌ 失败 | 部分语言测试超时 | - |
| TC-L-100 | 快速语言切换 | ❌ 失败 | 超时，可能存在语言切换性能问题 | - |
| TC-L-101 | 带数据的语言切换 | ❌ 失败 | Lightbox遮罩层阻止点击 | - |
| TC-L-104 | 批量编辑面板本地化 | ❌ 失败 | 测试超时 | - |
| TC-L-105 | 字段管理面板本地化 | ❌ 失败 | 测试超时 | - |

### 11.5 测试日志关键输出

#### 快捷键面板本地化遗漏确认
```
[TC-L-031] Shortcuts title in English: "⌨️ 快捷键 & 图例"
[BUG DETECTED] Hardcoded Chinese in shortcuts panel

[TC-L-034] zh-CN: Expected "导航", Actual "导航"
[TC-L-034] en-US: Expected "Navigation", Actual "导航"  // 本地化失败!
[TC-L-034] ja-JP: Expected "ナビゲーション", Actual "导航"  // 本地化失败!
[TC-L-034] ko-KR: Expected "탐색", Actual "导航"  // 本地化失败!
```

#### 视图选择器硬编码确认
```
[TC-L-001-005] en-US View options: ['日视图', '周视图', '月视图', '季度视图', '年视图']
[LOCALIZATION BUG] en-US view selector still contains Chinese options
```

#### 图例面板硬编码确认
```
[TC-L-D04] Legend items in English: ['已完成', '未完成', '依赖关系']
[BUG DETECTED] Chinese legend items: ['已完成', '未完成', '依赖关系']
```

### 11.6 修复建议

#### 11.6.1 快捷键/图例面板修复
需要在 `index.html` 中为所有硬编码文本添加 `data-i18n` 属性：

```html
<!-- 修改前 -->
<span class="shortcuts-title">
    <span>⌨️</span>
    <span>快捷键 & 图例</span>
</span>

<!-- 修改后 -->
<span class="shortcuts-title">
    <span>⌨️</span>
    <span data-i18n="shortcuts.title">快捷键 & 图例</span>
</span>
```

需要修改的位置清单：
| 行号 | 当前文本 | 需添加的i18n键 |
|:----:|:--------:|:--------------:|
| 152 | 快捷键 & 图例 | shortcuts.title |
| 159 | 导航 | shortcuts.navigation |
| 161 | 平移视图 | shortcuts.panView |
| 169 | 缩放时间轴 | shortcuts.zoomTimeline |
| 173 | 滚轮 | shortcuts.scroll |
| 177 | 回到今天 | shortcuts.goToToday |
| 186 | 任务操作 | shortcuts.taskOperations |
| 188 | 编辑任务 | shortcuts.editTask |
| 194 | 调整时间 | shortcuts.adjustTime |
| 200 | 调整进度 | shortcuts.adjustProgress |
| 209 | 图例 | shortcuts.legend |
| 213 | 已完成 | shortcuts.completed |
| 216 | 未完成 | shortcuts.incomplete |
| 219 | 依赖关系 | shortcuts.dependency |

#### 11.6.2 视图选择器修复
需要在 `i18n.js` 的 `updatePageTranslations()` 函数中添加对 `<option>` 标签的处理：

```javascript
// 在 updatePageTranslations() 中添加
document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (el.tagName === 'OPTION') {
        el.textContent = t(key);
    } else {
        el.textContent = t(key);
    }
});
```

#### 11.6.3 zoom.js日期格式本地化
需要将 `ZOOM_LEVELS` 中的 format 函数改为使用 i18n：

```javascript
// 修改前
format: function (date) {
    return date.getFullYear() + "年" + (date.getMonth() + 1) + "月";
}

// 修改后
format: function (date) {
    return i18n.formatDate(date, 'yearMonth');
}
```

### 11.7 测试产出物
- 本地化细节测试脚本：[tests/e2e/localization-detail.spec.js](../../tests/e2e/localization-detail.spec.js)
- Playwright HTML报告：[doc/testdoc/playwright-report/index.html](playwright-report/index.html)
- 测试用例文档：[TEST-GanttUIOptimization-UnitCase.md](TEST-GanttUIOptimization-UnitCase.md) (第6章新增)
