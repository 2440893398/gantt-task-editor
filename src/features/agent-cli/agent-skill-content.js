/**
 * Agent skill 的内容单一来源：页面内的指令文本、可下载 skill、以及构建期生成的静态
 * `/agent-skill.md` 全部从这里取，三份拷贝各写一遍必然漂移。
 *
 * 这个模块刻意不 import 任何东西：构建脚本要在 Node 里直接读它，任何顶层 DOM/i18n
 * 依赖都会把构建炸掉。
 *
 * ── 分层原则 ──
 * 入口只放"每次都要"的东西；其余按**触发条件**分片。索引写触发条件而不是主题——
 * 写「批量导入」agent 会顺手都读一遍，等于没拆（外部 Agent 上一次正是这样把两份
 * 完整浏览器文档读进了上下文）。
 *
 * ── 分片之间禁止互相引用 ──
 * "读完一份就执行、不要因为读到新名词再去读下一份"是读者侧的不可执行禁令，拦不住
 * agent 顺手翻。改成作者侧的可校验约束：一个分片需要另一片的事实就地内联，分片正文
 * 里不出现指向其他分片的引用。内联的重复不会漂移，因为重复片段从下面这些常量生成，
 * 不是手维护的。构建脚本对此做静态校验（SCN-AGT-038）。
 */

export const AGENT_CHANNEL_RULES = `浏览器通道规则（写入前必读）
1. 先跑 npm run agent:preflight -- --origin <页面地址>。GO 只许可连接，不等于放行写入；
   NO-GO 就停下，把修复步骤交用户；UNKNOWN 可试连，但第 2 步必须过。
2. 连上先自报家门，不过就停：
   location.origin + ' | ' + (await window.app.project.list()).data.find(p => p.active)?.name
   对不上 = 连错通道，停并报告。
3. 读改用户已有项目须同 profile 同 origin（preview 域名另算）。
   禁用：内置浏览器、IAB、裸 playwright。跑测试或自建自读的任务不受此限。
4. PROJECT_NOT_FOUND 先怀疑通道，禁止用 project.create 绕过。查 localProjects：
   缺则停并报告；有则 project.switch({ id, confirmProjectName }) 后看 writesUnlocked。`;

/**
 * 提示词的最小安全核。取不到 skill 地址时（无 WebFetch 工具、企业代理、离线）提示词
 * 不能变成空的——那是又一次静默降级。这三条即使 skill 全不可达也必须在（SCN-AGT-039）。
 */
export const AGENT_MINIMUM_CORE = `取不到这个地址就说出来，然后只按这三条走，不要自行发挥：
1. 先自报家门：location.origin + 当前项目名，与用户说的对不上就停。
2. 禁用内置浏览器 / IAB / 裸 playwright —— 独立 profile，用户看不到你的产物。
3. PROJECT_NOT_FOUND 先怀疑通道，禁止用 project.create 绕过。`;

/**
 * 分片之间禁止交叉引用，需要同一个事实就地内联。内联从这个常量生成而不是手抄两遍，
 * 所以重复不会漂移。
 */
const IDEMPOTENCY_NOTE = `idempotencyKey 要稳定且唯一：同键同参会复用上次结果；同键不同参返回 CONFLICT
（这是刻意的，避免你把复用当成新写入成功）。重试请复用同一个 key，不要换新 key。`;

/** 分片：键即文件名（agent-skill/<key>.md）。trigger 是索引里印的触发条件。 */
export const AGENT_SKILL_SHARDS = [
    {
        key: 'batch-import',
        title: '批量新增与修改',
        trigger: '当你要一次新增或修改多个任务时',
        body: `把所有 task.create 合并成一次 batch，不要逐条创建、不要逐条预览。

1. 读一次 await window.app.state.rev() 拿 rev。
2. 一次 batch dryRun 看合并后的 diff。
3. 用最新 ifRev 提交同一批 steps。

步骤之间要引用前一步新建的 id，用 $ref：先给该步加 as: '别名'，
后续步骤写 { $ref: '别名' }。带 $ref 的步骤在 dryRun 里不预览（id 尚不存在），
这是预期行为，不是错误。

写动态字段前先 await window.app.form.describe({ form: 'task', mode: 'create' })，
拿 schemaRev 并复用到本次 batch；只对不认识的字段再调 form.field / form.options。
不同项目的字段约束不同（同一个字段可能是自由文本，也可能是固定选项），
不要凭上一个项目的经验直接写。

${IDEMPOTENCY_NOTE}`,
    },
    {
        key: 'long-operations',
        title: '长任务与异步操作',
        trigger: '当写入量大可能超时，或收到 BUSY / RUNNING 时',
        body: `大批量或耗时写入走异步操作通道，别让单次调用挂住：
await window.app.operation.start({ command, args, steps, idempotencyKey: '稳定唯一值' })
然后轮询 operation.status()，到终态再用 operation.result() 取最终值。

${IDEMPOTENCY_NOTE}

operation.cancel() 只是尽力而为的取消请求。操作若已经成功，取消不会回滚——
那种情况用 await window.app.session.undo()。

收到 BUSY / RUNNING：已有操作在跑。按错误里的 nextAction 去 operation.status() 轮询，
不要并发再发一次。`,
    },
    {
        key: 'error-recovery',
        title: '错误恢复',
        trigger: '当任何命令返回 ok:false 时',
        body: `错误里带 nextAction 就先执行它指的那个只读命令，再重试；没有恢复动作的
CONSTRAINT 才停止。需要回滚用 await window.app.session.undo()。

PROJECT_NOT_FOUND —— 页面 URL 里的项目在这个浏览器里不存在。先怀疑浏览器通道：
一个内置浏览器、一个独立的自动化 profile、或另一个 preview 域名，都会呈现一个
合法但无关的数据世界；空库还会被自动补出一个「默认项目」，看起来就像正常的
全新安装。禁止用 project.create 绕过。对照错误负载里的 localProjects：
  - 没有用户说的那个项目 —— 停下并报告通道问题。
  - 有 —— project.switch({ id, confirmProjectName: '用户口述的项目名' })，
    然后检查返回的 writesUnlocked 是否为 true；仍为 false 就不要重试写入。

SCHEMA_CONFLICT / INVALID_FIELD —— 表单结构变了。重新
form.describe({ form: 'task', mode: 'create' }) 取新的 schemaRev 再写。
POLICY_CONFLICT —— 排期策略变了，重新 schedule.describe 取 policyRev。
CONFLICT —— rev 过期，重新 state.rev 后用新 ifRev 提交。
不要读源码去猜动态配置。`,
    },
    {
        key: 'isolated-fallback',
        title: '够不到 window.app 时',
        trigger: "当 typeof window.app === 'undefined' 但页面明明已经加载好",
        body: `不要据此断定命令层不存在。有些浏览器工具在 isolated world 里执行页面
JavaScript，那里看不见页面全局的 window.app。改用页面上可见的命令 runner：

1. 点击 #agent-guide-btn。
2. 把 JSON 填进 #agent-guide-command-input，例如
   {"command": "state.snapshot", "args": {"level": "summary"}}
3. 点击 #agent-guide-run-command。
4. 从 #agent-guide-run-output 读 JSON。

这条通道只试一次。控件不可用或超时就报告阻塞，不要反复重开页面、切换浏览器或
重复探测——上一次外部 Agent 正是在这里连续超时 5 次、约 180 秒。

不要用 javascript: URL，不要直接改 DOM / IndexedDB / localStorage 绕过，
也不要模拟拖拽。`,
    },
    {
        key: 'schedule-semantics',
        title: '排期与日历语义',
        trigger: '当你要写 start_date / end_date / duration 或建依赖时',
        body: `duration 的语义是**日历天**：duration = N 意味着 end = start + N - 1（自然日），
不按工作日展开。工时只接受整数天，源数据里的半天需要你在页面外先取整。

父任务的日期由子任务上卷得出，不能直接写；父任务的负责人是子任务负责人的去重聚合。

对有入向 FS 依赖约束的任务执行 schedule.move 会返回 CONSTRAINT 而不是静默失败——
这是刻意的，说明该任务的开始时间由前置决定。要挪它就先改前置或改依赖。

写这些字段前先 await window.app.schedule.describe()，拿 policyRev 并复用到写入。`,
    },
    {
        key: 'channel-troubleshooting',
        title: '通道排查',
        trigger: '当预检给出 NO-GO / UNKNOWN，或自报家门对不上时',
        body: `项目数据存在浏览器 profile 的 IndexedDB 里，不随账号走。三条互不相通的边界：

1. profile —— 内置浏览器、IAB、裸 playwright（无 --cdp-endpoint）各自开独立 profile。
2. origin —— Pages 的 preview 域名（4bed446a.xxx.pages.dev 这类）是独立 origin、独立数据。
3. 机器 —— 换一台电脑就是另一份数据。

能到达用户数据的通道：Claude in Chrome 扩展、Codex 的 chrome 后端、
playwright 加 --cdp-endpoint。Codex 的 chrome 后端还受
~/.codex/browser/config.toml 的 [origins].allowed 与 [full_cdp].allowed 白名单管；
目标 origin 不在里面时，approval_mode = never_ask 会让它直接拒绝并**静默退到 IAB**。

npm run agent:preflight -- --origin <页面地址> 会把上面这些逐条查一遍，
并对不可用的通道给出可直接交给用户的修复步骤。

排查不通就停下报告，不要退到内置浏览器 / IAB 继续干活：那里看得到一个能用的页面，
但那是另一份数据，用户永远看不到你的产物。`,
    },
];

// ── 以下是渲染逻辑：构建脚本与页面内的可下载 skill 共用同一份，避免两种表示漂移 ──

export const SKILL_ENTRY_PATH = '/agent-skill.md';
export const SKILL_SHARD_DIR = '/agent-skill';

export function skillShardPath(key) {
    return `${SKILL_SHARD_DIR}/${key}.md`;
}

/** FNV-1a。同步、纯 JS，Node 与浏览器同码，避免为了算版本引入 crypto/subtle 分叉。 */
function hashString(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildSkillShard(shard) {
    return `# ${shard.title}

> 触发条件：${shard.trigger}
> 这一份是自包含的。读完就执行，不要再去找别的文件。

${shard.body}
`;
}

/**
 * 内容版本。skill 是静态资产，页面代码是另一条部署线（CN 还惯性滞后），两边错配时
 * Agent 拿到的指引与实际 schemaRev 对不上且没有任何信号。版本号不参与任何判定，
 * 只让错配可诊断——而不是又一起"每步合规、整体是错"的静默事故。
 */
export const SKILL_VERSION = hashString(
    AGENT_CHANNEL_RULES + AGENT_SKILL_SHARDS.map((shard) => buildSkillShard(shard)).join('\n')
);

/**
 * @param {{baseUrl?: string}} options baseUrl 为空时索引印相对路径（构建产物用）；
 *   传入页面 origin 时印绝对地址（可下载 skill 用，装到别处也能取到分片）。
 */
export function buildSkillEntry({ baseUrl = '' } = {}) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const index = AGENT_SKILL_SHARDS.map(
        (shard) => `- ${shard.trigger}，读 ${base}${skillShardPath(shard.key)}（${shard.title}）`
    ).join('\n');

    return `# Gantt Task Editor — Agent 操作规范

构建版本：${SKILL_VERSION}

页面暴露 \`window.app\` 命令层，\`document.documentElement.dataset.agentApi === 'window.app'\`。
目标是完成用户任务，不要只评估能力。

${AGENT_CHANNEL_RULES}

## 命令清单

不在本文件里——它随部署变化，写进静态文件必然过期。
运行时取：\`await window.app.manifest()\`，或读页面里的 \`#agent-api-manifest\`。
已知命令直接执行，不要先调 help/manifest；参数不明确时才读一次。

## 按需索引

按触发条件读，一次只读需要的那一份。不要预读，不要"先都看一遍"。
每一份都是自包含的，读完直接执行。

${index}

## 每次都适用

- 先读完成任务所需的最小状态；解析附件在页面外完成，不要把原始文件交给命令层。
- 完成后把项目直达链接（命令结果里的 \`url\`）给用户，让他能立刻核对产物。
`;
}
