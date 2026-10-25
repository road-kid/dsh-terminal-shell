# 设计与实施单：CMD 终端方言（v3 · 已实现）

| 项 | 值 |
| --- | --- |
| 状态 | **已实现并交付于 `0.2.0`**。评审报告 `docs/REVIEW-cmd-dialect.md` 的 B1–B10 与 P1-1–P1-8 全部落地；落地后的设计事实见 `docs/DESIGN.md` §14 |
| 目标版本 | `0.2.0`（直接正式版，不打 rc） |
| 基线 | DSH `0.2.1-rc.2`；本插件 `dsh-terminal-shell@0.1.7`，HEAD `37ce291`，已发布 npm |
| 关联 | M1 `confinedPolicy`（`docs/PLAN-confined-bash.md`）、M2 极简模式（`docs/PLAN-minimal-mode.md`）、架构总述 `docs/DESIGN.md` |
| 取代 | 本文件 v2（1426 行）与 v1（2026-10-24，基线 `dsh-terminal-tool@0.5.1` / HEAD `80ee65b`） |

## 本版相对 v2 的变更（评审响应）

v2 经独立评审（`docs/REVIEW-cmd-dialect.md`，含源码核对、编译级验证、10 组真实进程探针）判为「架构方向成立，但落地代码有 10 处必须修正」。v3 逐条处置如下。

**阻塞缺陷 B1–B10（全部已修）**

| # | v2 的问题 | v3 的处置 | 位置 |
| --- | --- | --- | --- |
| B1 | 方言闸门引用尚未声明的 `agentCtx`，且位于 preset 守卫之前 → 编译失败 + 绕过 `minimal` 让位语义 | `agentCtx` 读取上移到闸门之前；`installCmdSession` 的调用点移到 preset 守卫**之后**，与 bash 共用守卫段 | §5.6 |
| B2 | `installCmdSession` 用根 `ctx` 取 `tools`/`systemPrompt` → `restrict()` 必抛（已核实：`dsh-tools/lib/index.js:2993` 明写「requires a scoped context」）；且类型名 `ToolRegistry`/`SystemPromptService` 不存在 | 改用 `agentCtx` 与真实类型 `ToolRuntime`/`SystemPrompt` | §5.6 |
| B3 | `...policy` 展开使 `sandboxPolicy` 始终为 `undefined` → 升级审批**静默失效**（且对象展开绕过 TS 多余属性检查，编译不报错） | 改为 `...(policy !== undefined ? { sandboxPolicy: policy } : {})`，并新增 T-SBX-ESC 用例 | §5.4、§7 |
| B4 | `attached` 在 `if` 块内声明、块外引用 → TS2304；`stopped` 组装偏离官方 | `attached` 收进提升分支块内（块外不再引用，TS2304 消失）；提升分支按官方**单独 `resolve` 一次不带 signal 的 spec** 并 `return waitOnJob(jobs, attached, exec, spec)`——`waitOnJob` 本来就返回完整前台结果（含 `stopped`、含「准备阶段超时」合成的 `timedOut` 结果），块外不需要补任何东西 | §5.4 |
| B5 | `static inject = ['subprocess'] as const` → TS2417 | 去掉 `as const` | §5.3 |
| B6 | 后台作业缺四个守卫 | 补齐 `!backgroundEnabled` / `jobs === undefined` / `signal.aborted` / `startJob` 失败回退前台；错误文案与官方一致 | §5.4 |
| B7 | 移植表把 3 个闭包当可移植函数，且 `canonicalResult` 名字不存在 | 表格标注「`apply()` 内闭包，需重写」，改名 `canonicalBashResult`；并补记 `waitOnJob(registry, attached, exec, spec)` 的真实签名（v2 写成 `(registry, attached, timeoutMs, signal)`，会丢掉 owner/abort/准备超时三条行为） | §4.4、§5.4 |
| B8 | 传输层双路径的兜底分支没接 spawn cwd，触发条件既错又太窄 | **取消双路径，统一单形态**：spawn cwd = scratch、argv 用裸文件名、脚本内 `cd /d` | §4.2、§5.1 |
| B9 | 审批请求 `toolName` 仍是 `"bash"` | 改为 `'cmd'`（已核实 `dsh-tool-bash/lib/index.js:368` 硬编码 `toolName: "bash"`） | §5.4 |
| B10 | C6 改名波及 11 个源文件，含生成的 preset 配置键与 PTY 后端 schema | **移出本次范围**，降级为独立 patch | §10 |

**事实性修订 P1-1–P1-8（全部已改）**

1. **P1-1**：CRLF 从「必须」改为「为兼容旧式工具链而统一使用」——实测 LF-only 脚本（含 `for /l` 与括号块）完全正常。
2. **P1-2**：`%` 触发条件整段删除（随 B8 单路径化一并消失）。
3. **P1-3**：`/q` 会压过脚本内的 `@echo on`，**回显无法在脚本内恢复**；已写入 `cmdDescription()` 与 §4.2.2。
4. **P1-4**：`matchesSignature` 依赖 provider 提供的签名文本，zh-CN 下 cmd 自身诊断是 GBK 中文；把「zh-CN 下 denial 判定命中」列入 T-SBX（§7）。
5. **P1-5**：`ctx.fiber.state === 2` 是 **ACTIVE** 而非 disposed，加注释防止后人「修正」。
6. **P1-6**：`executeArgv` 在准备阶段超时会**跳过** `onStarted`，存在脚本泄漏路径；改为「登记标志 + `finally` 兜底 dispose」。
7. **P1-7**：`getSectionOrder()` 返回 `number`（非可选），`?? 1010` 是死代码，删除。
8. **P1-8**：v2「`isolate()` 子 ctx 注册的段落对 agent 不可见」的理由**是错的**——已核实 `isolate()` 走 `extend()` → `Object.create(parent)`，`kScope` 沿原型链继承，故 `scopeOf(agentCtx.isolate('shell')) === scopeOf(agentCtx)`，段落可见。v3 保留「在 `agentCtx` 注册」的做法（与压空段落同层同生命周期），但换成正确理由。

**评审未提出、本轮自行补充的 3 处**

- **`cd` 守卫**：单路径化后脚本必须自己进 workdir，若无守卫则 workdir 消失时命令会在 scratch 目录里**静默执行**。新增 `cd /d … || (echo … 1>&2 & exit /b 1)`（已实测：失败时 exit 1 且不继续执行）。
- **`InstallResult` 增字段**：`src/index.ts:162` 的日志 `bash=${result.bashPath}` 需要 cmd 对称字段（评审建议 3）。
- **T-SBX-ENC 升格为开工门槛**（评审建议 2）：M0 结束前必须实测「受限令牌下 `chcp` 生效 + scratch 脚本可读」，结果决定 `cmdConfinedPolicy` 默认值。
- **证据脚本入库**：本轮的 6 项探针写成 `docs/probes/cmd-transport.mjs` 与 `docs/probes/cmd-cd-guard.mjs`，评审结论可一键复现（`node docs/probes/cmd-transport.mjs`），不再只留 `%TEMP%` 下的临时产物。

## 本版相对 v1 的变更

v1 写于改名前、且在两轮实测之前，有 15 处需要修正的地方（逐条见 §2）。v2 的实质变化：

1. **传输层从「临时脚本 + 三种传输」收敛为「临时脚本单一传输」**，并修正了 argv 形态（v1 的 `/d /s /c <绝对路径>` 在 `%TEMP%` 含空格时**必然失败**，见 D4）。
2. **推翻 v1「复用 `planLaunch`」**：`planLaunch` 的 win32 分支编码的是「MSYS 起不来」这一 Git Bash 专属事实，对 cmd 不成立（D2）。
3. **沙箱策略从三态收敛为二态**（`escalate` / `unconfined`），`fail` 对 cmd 是不可达分支（D2）。
4. **删除 `cmdTransport: 'env'` 兜底**：实测该路径对「首字符为引号 / 多行 / `%PATH%`」全部失效，保留一个已知坏的开关不是工程决策（D3）。
5. **新增「被杀进程树」与「输出解码」两个硬约束的书面结论**，并据此说明 `cmdCodePage` 的真实边界（D9/D10）。
6. 补全 v1 缺失的 8 个设计点（`bash` 工具同隐藏、`tool:bash` 段落同压、`%~dp0` 语义泄漏、后台作业与脚本生命周期、`JobKindMap` 声明合并、工具描述方言化、工作目录校验、受限沙箱下 `chcp` 风险）。

---

## 0 结论摘要

1. **DSH 官方不支持 cmd 作为模型工具**：`dsh-base` 的 patch 只有 `bash-sandbox` / `pwsh-sandbox` / `tool-bash` / `tool-pwsh` 四行且按平台互斥；npm 上不存在 `dsh-tool-cmd` / `dsh-cmd-local` / `cmd-sandbox`。**但交互式 Web 终端支持 cmd 且是 Windows 默认**（`dsh-api-terminal-controller`），属人工 PTY，与模型工具无关。⇒ cmd 必须由本插件自研。
2. **社区有三条 cmd 路线可参照，但没有一条可直接复用**：`dsh-shell-select`（97 dl/月，cmd 可受限、已停更于 dsh 0.1.x）、`@mzzsfy/dsh-shell-select`（578 dl/月，运行时接管 `ctx.shell` 全套）、`@qianwenxue1/dsh-shell`（27 dl/月，自研 `shell_exec`）。它们的传输层分别是「环境变量一次性展开」与「内联 `cmd /d /s /c`」，**都被本轮实测证伪**（§2.3）。本方案的临时脚本传输是本机 20 项探针里唯一全绿的一条。
3. **架构沿用现有「按会话装配」模型**，不新增静态 patch 行：`agent/created` → `agentCtx.isolate('shell')` → 挂 `CmdExecutor` + 自研 `cmd` 工具 → `tools.restrict({deny:['pwsh','bash']})` → 压掉 `tool:pwsh`/`tool:bash` 两个提示词段落。
4. **cmd 可以受限运行**（与 Git Bash 相反）：官方 `dsh-sandbox-local` 的功能探针本身就是 `cmd /c exit 0`。⇒ cmd 方言**默认走受限沙箱**（`cmdConfinedPolicy: 'escalate'`），`unconfined` 只作为显式逃生口。
5. **代码量约 1900 行新增 + 约 400 行改动**（评审后修正：v2 估的 1750/350 偏低 10–15%），其中 `src/cmd/tool.ts`（约 530 行）是最大单件——因为官方 `tool-bash` 只导出 `{Config, apply, inject, name}`，工具定义与 `startJob`/`waitOnJob`/`approveBashEscalation` 三个闭包都不可复用，必须逐字重写。
6. **传输层只有一条路，且已被实测钉死**：spawn cwd 设为 scratch 目录、argv 传**裸文件名**、脚本首行 `cd /d` 进入真实 workdir。绝对路径形态在路径含 `& ( ) ^ , ;` 或 `%NAME%` 时**全部失败**（本轮复测确认），而裸名形态对空格、`%`、`&`、`( )`、`^`、`,;`、`!` 全部成功。

---

## 1 目标与非目标

### 1.1 目标

| ID | 目标 |
| --- | --- |
| G1 | 设置行的「终端工具」增加第三个选项 `cmd`，与 `pwsh` / `bash` 并列，切换后**新会话**得到名为 `cmd` 的模型工具 |
| G2 | `cmd` 工具的**参数契约与官方 `bash`/`pwsh` 完全一致**（`command` / `description` / `workdir` / `timeoutMs` / `run_in_background` / `sandbox_permissions` / `justification`），结果形状同构（`foreground` / `background` / `promoted` 三分支） |
| G3 | 命令文本按**真实 cmd 语义**执行：`%VAR%` 展开、`&`/`&&`/`\|\|`、管道、重定向、`( )` 块、`if`/`else`、`for`、`call :label`、多行、`^` 转义、`exit /b N` |
| G4 | 非 ASCII 输入输出正确：脚本以 UTF-8（无 BOM）+ CRLF 落盘，脚本第二行 `chcp 65001>nul` |
| G5 | 沙箱：cmd 默认受限运行；`cmdConfinedPolicy: 'unconfined'` 可显式绕过；`sandbox_permissions` 升级链与官方一致 |
| G6 | 后台作业可用：`run_in_background` 返回 `jobId`，`promoteOnTimeout` 超时转后台，作业类型 `cmd` 通过 `JobKindMap` 声明合并接入 `ctx.jobs` |
| G7 | 失败可诊断：新增 skip 原因 `cmd-not-found` / `cmd-script-failed` / `cmd-mount-failed`，全部写入既有诊断日志 |
| G8 | 与现有两种方言**互不干扰**：bash 分支、minimal 变体、confinedPolicy 语义零改动 |

### 1.2 非目标

| ID | 非目标 | 理由 |
| --- | --- | --- |
| N1 | cmd 的**持久终端**（`backendType` 增加 cmd 方言） | `dsh-terminal-bash` 的 `ShellDialect = 'bash' \| 'pwsh'` 且依赖 OSC-133 提示符标记，cmd 无等价机制；本轮搁置 |
| N2 | 内置命令黑名单 / 工作目录白名单 | 用户已决策不做；安全边界由沙箱承担，不由字符串匹配承担 |
| N3 | 为 cmd 单独合成 PATH（MSYS 目录） | `extraPath` 语义是「用户追加目录」，对 cmd 同样生效即可；不额外注入 bash 目录 |
| N4 | 非 UTF-8 代码页的**正确**支持 | 宿主 `output.js:232` 固定 `Buffer.concat(chunks).toString('utf8')`，非 UTF-8 输出必然变成替换字符；`cmdCodePage` 只能作为「让老程序不因 65001 崩掉」的逃生口，不能修复乱码（§4.6） |

---

## 2 方案审查（对 v1 的复审）

### 2.1 缺陷清单

| # | v1 的问题 | 证据 | v2 的修正 |
| --- | --- | --- | --- |
| **D1** | 基线过期：文档写 `dsh-terminal-tool@0.5.1`、HEAD `80ee65b`、版本 `0.6.0` | 仓库已于 `3aad227` 全量改名为 `dsh-terminal-shell`，npm 上 `0.1.7` 已发布 | 全文重写为当前基线；目标版本 `0.2.0` |
| **D2** | §3.3 称「复用 `src/confined.ts` 的 `planLaunch`」 | `planLaunch` 在 `platform === 'win32'` 分支里的语义是「`unconfined` → direct，`escalate` → confine，其余 fail」，其存在理由是 **MSYS2 在受限令牌下起不来**；cmd 相反（`dsh-sandbox-local` 的功能探针就是 `cmd /c exit 0`） | 新写 `planCmdLaunch()`：受限策略下 `escalate` → `confine`、`unconfined` → `direct`；**`fail` 分支不可达故不提供**；denial 判定不再用 `isMsysStartupDenial` |
| **D3** | 保留 `cmdTransport: 'env'` 作兜底 | 复测：`%DSH_CMD%` 一次性展开对 `echo %PATH%` 输出字面量、对多行只取第一行、对中文输出 GBK | 删除该配置项；传输只有临时脚本一条路径 |
| **D4** | argv 写成 `[cmdPath, '/d', '/s', '/c', scriptPath]` | 探针 1a：`/s` 会剥掉最外层引号对，`%TEMP%` 含空格时 libuv 加的引号被剥掉 → `'C:\Users\John' 不是内部或外部命令`，exit 1。**这是一处会让部分用户必然踩到的真 bug** | 去掉 `/s`：`[cmdPath, '/d', '/q', '/c', scriptPath]`；并保留「脚本路径含 `%` 时退化为裸文件名 + 子进程 cwd」的分支 |
| **D5** | 未处理 `%~dp0` 语义泄漏 | 探针 6：用户命令里的 `%~dp0` 解析为传输脚本所在目录，`%0` 为脚本全路径，`%1`/`%*` 为空 | 不静默改写用户文本；在工具描述与 `tool:cmd` 段落里明确写出「`%~dp0`/`%0`/`%1`/`%*` 无意义，请用 `%CD%`」 |
| **D6** | 只 deny 了 `pwsh` | cmd 方言下若预设把 `tool-bash` 重新挂进 agent realm，`bash` 工具会与 `cmd` 并存（社区 `dsh-shell-select` 的 patch 头注释正是这个教训） | deny 列表按「可见性探测后取交集」构造：`['pwsh','bash']` 中只 deny `tools.get(name, agent) !== undefined` 的那些；`tool:pwsh` 与 `tool:bash` 两个段落都压空 |
| **D7** | 提示词段落 order 用 `getSectionOrder('TOOL_CMD')` | `PromptSectionOrderName` 无 `TOOL_CMD` 键，官方只有 `TOOL_BASH: 1000`、`TOOL_PWSH: 1010` | 用 `getSectionOrder('TOOL_PWSH') ?? 1010` 作为锚点；`tool:cmd` 落在 1010 |
| **D8** | 「不合成 PATH」与既有 `extraPath` 配置语义冲突 | `src/config.ts:44` 的 `extraPath` 文档是「追加到 PATH 的目录」，bash 方言已实现 | cmd 也应用 `extraPath`（`composePath(extraPath, env.PATH)`），只是不追加 MSYS 目录 |
| **D9** | 未说明输出解码由宿主固定为 UTF-8 | `dsh-subprocess-local/lib/output.js:232` `text: Buffer.concat(this.chunks).toString("utf8")` | 写进 §4.6：这决定了 `chcp 65001` 是唯一正确选择，`cmdCodePage` 只是逃生口 |
| **D10** | 未说明超时/中止能否杀干净子进程树 | `dsh-subprocess-local/lib/runner.js` 的 `terminateOwnedJob()` → `terminateJob(api, job, 1)`：宿主本来就把目标进程放进 Job Object，杀的是整棵树 | §4.5 明确：**不需要**自己实现 Job Object；裸 Node `child.kill()` 的「孙进程存活」问题在 DSH 链路里不存在 |
| **D11** | 未规定脚本尾部是否加 `exit /b %errorlevel%` | 探针 1d：直接 `/c <file>` 用「最后一条命令的成功标志」，`call` 用 ERRORLEVEL 变量；两者对 `dir /nonexistent` + `echo recovered` 分别给 0 与 1 | **不加**。理由：bash 语义是「最后一条命令的退出码」，直接形式与之一致；加了反而偏离跨 shell 惯例。用户显式 `exit /b N` 时仍能正确传播 |
| **D12** | 未处理「脚本删除时机」与 `promoteOnTimeout` | 超时转后台后进程仍在跑，脚本必须活到进程真正退出 | 脚本句柄存在 `Map<ShellProcess, CmdScript>`，**只在 `onProcessDone` 里 dispose** |
| **D13** | 工具描述照抄 bash 文案 | `bashDescription()` 里写着 `bash -c` 与 bash 方言 | 重写 `cmdDescription()`：声明 `cmd.exe` 方言、原生 `C:\` 路径、`%VAR%`、`/` 开关、无持久状态 |
| **D14** | 未校验工作目录 | 脚本以「子进程 cwd = 用户 workdir」运行，`cd` 由 spawn 完成；workdir 不存在时 spawn 直接 ENOENT，报错不清晰 | `execute()` 前置 `statSync(spec.workdir).isDirectory()` 校验，失败抛 `HarnessError('working directory does not exist: …')` |
| **D15** | 未评估受限令牌下 `chcp` 是否可用 | 探针在**非受限**上下文测得 `chcp` 生效（默认 936）；受限令牌下子进程仍继承隐藏控制台，但未实测 | 列入 T-SBX-ENC 测试项；若失败则回退「纯 ASCII 命令不受影响、非 ASCII 命令给出诊断警告」 |

### 2.2 v1 中**保留有效**的部分

- 临时 `.cmd` 脚本作为传输层（结论正确，理由在本轮被 20 项探针强化）。
- `@echo off` + `chcp 65001>nul` 的脚本模板。
- UTF-8 无 BOM + CRLF 的落盘格式。
- 自研 `cmd` 工具（`defineTool`）而非克隆官方工具——因为官方工具名硬编码、`tools.register` 落在 agent 自己层无法被 `restrict` 隐藏。
- 三态之外的分工结构（P0 契约 → P1/P2/P3/P4 并行 → P5/P6）。

---

## 3 官方规范符合性

### 3.1 官方是否支持 cmd（分层结论）

| 层 | 支持？ | 证据 |
| --- | --- | --- |
| 模型工具层（`tool-*`） | **否** | `dsh-base/cordis.patch.yml:250-288` 仅 `bash-sandbox`/`pwsh-sandbox`/`tool-bash`/`tool-pwsh`，`disabled: !!js process.platform === 'win32'` 与 `!== 'win32'` 互斥；无第三行 |
| 官方包 | **否** | npm `dsh-tool-cmd`、`dsh-cmd-local`、`dsh-terminal-cmd`、`cmd-sandbox`、`dsh-cmd-sandbox` 全 404；安装内 307 个 `@deepseek-ai` 包无 cmd 相关 |
| `ShellExecutor` 契约 | **方言无关** | `abstract resolve(request): ShellExecSpec` + `abstract execute(spec): Promise<ShellExecution>`，`command: string` 不限定方言 ⇒ 可自研实现 |
| 持久终端后端 | **否** | `dsh-terminal-bash/lib/types/config.d.ts`：`export type ShellDialect = 'bash' \| 'pwsh'` |
| 交互式 Web 终端（人工 PTY） | **是，且为 Windows 默认** | `dsh-api-terminal-controller/lib/index.js:18` `environment.defaultShell ?? (platform === "windows" ? "cmd.exe" : "/bin/sh")`；`:31` `args: kind === "cmd" ? [] : …`；`shellCandidates` 含 `"cmd"`；默认值来自 `dsh-subprocess-local/lib/index.js:1610-1616` 的 `process.env.ComSpec` |
| 沙箱 | **是** | `dsh-sandbox-local/lib/index.js` 的 windows-acl 功能探针即 `cmd /c exit 0`；社区 `dsh-shell-select` README 亦记 "Confinement verified: cmd.exe and PowerShell 5.1, yes" |

**结论**：官方在「人工终端」层面把 cmd 当一等公民，在「模型工具」层面完全没有。本插件填补的正是后者。

### 3.2 社区现状（下载量 = npm 2026-09-23 → 10-22 月窗口）

| 包 | 版本 | dl/月 | cmd 角色 | 与本方案的关系 |
| --- | --- | --- | --- | --- |
| `dsh-shell-select`（athif23） | 0.1.0 | 97 | 单一 `shell` 工具，目录含 cmd | 传输用环境变量展开；README 自记「`%NAME%` 保持字面量，需 `call`」与「非 ASCII 输出取决于代码页」——正是 D3 的两个坑 |
| `@mzzsfy/dsh-shell-select` | 0.4.5 | 578 | 同目录，运行时接管 | 运行时 `entry.update` 关官方行 + 挂全套 `ctx.shell` 缝 + 失败自动回退。架构上更激进，本方案不采用（不接管 `ctx.shell`，只按会话装配） |
| `@qianwenxue1/dsh-shell` | 0.1.0 | 27 | 默认 `cmd.exe /d /s /c` | 自研 `shell_exec` + `shell_job_status`，安全契约齐全；但工具名不同、无 UI |
| `KannaKuron/dsh-gitbash-shell` | 0.43.2 | 11860 | 无 | 直接竞品（Git Bash only） |
| `drscrewdriver/dsh-bash-terminal-ts` | 0.8.3 | 6545 | 仅兜底 | 候选链 `pwsh → powershell.exe → cmd.exe` |
| `xswt442-cmd/dsh-unsandboxed-winbash` | 0.4.1 | 886 | 无 | Git Bash 绕沙箱，佐证「MSYS 在受限令牌下起不来」 |

**关键教训**（引自 `dsh-shell-select` 的 patch 头注释）：

> Disabling rows is not by itself enough for the tools: agent presets re-mount `tool-bash`/`tool-pwsh` inside each agent's realm, where no patch can address them. The plugin's global tool guard denies those two names wherever they are registered.

⇒ 本插件继续走「按会话装配 + `tools.restrict`」路线，不新增静态 disable 行。

### 3.3 插件规范符合性清单

| 规范项 | 本方案 |
| --- | --- |
| `package.json` 的 `dsh` 字段 | 已有 `bundle.patch` / `client.{inject,platform}` / `compatibility` / `hostMin`；本次不新增字段 |
| `cordis.patch.yml` | **不改**（沿用「win32 才插入 `terminal-shell` 一行」） |
| `exports` | **不改**（`./cmd` 不是公开入口，`src/cmd/*` 被 `src/index.ts` 打包进 `lib/index.js`） |
| `locale/{en,zh}.json` | 只含 `meta.*`；行内文案在 `src/client/locales.ts`，本次加 5 个键 |
| `assets/icon.svg` | 不改 |
| 新依赖 | `@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-jobs` 加入 `devDependencies` + `peerDependencies`（optional）+ `build.mjs` 的 `external` |
| 诊断 | 复用 `src/diag.ts` 的 `skip`/`warn`/`note` |
| 可回退 | 任何 cmd 安装失败都 `skip` 而非抛错，会话保留官方 `pwsh` 工具 |
| 版本 | `0.2.0`；`engines.dsh` 不变（`>=0.2.1-rc.2 <0.3.0`） |

---

## 4 架构设计

### 4.1 分层与数据流

```
设置行（Web）
  └─ configForms.mutate → profile patch → dialect: 'cmd'
       ↓
src/index.ts  apply(ctx, config)
  └─ ctx.on('agent/created') → installSession(ctx, agent, snapshot)
       ├─ discoverCmd()                        → CmdLocation | undefined
       ├─ shellCtx = agentCtx.isolate('shell')
       │    ├─ shellCtx.plugin(CmdExecutor, { cmdPath, codePage, confinedPolicy, extraPath, ... })
       │    └─ shellCtx.plugin(CmdTool, { enableRunInBackground, promoteOnTimeout })
       │         ├─ ctx.shell.resolve(...)  → ShellExecSpec（含 sandboxPolicy）
       │         └─ ctx.shell.execute(spec)
       │              └─ CmdExecutor.execute
       │                   ├─ materializeCmd() → %TEMP%\dsh-cmd-<pid>-<rand>\cmd-<uuid>.cmd
       │                   ├─ planCmdLaunch() → confine | direct
       │                   ├─ executeArgv(spec, argv)  [基类：超时/输出收集/溢出落盘/dshEnv]
       │                   └─ onProcessDone → dispose 脚本 + 写 sandbox facts
       ├─ tools.restrict({ deny: ['pwsh', 'bash'] 中可见的那些 })
       └─ systemPrompt.section({ name: 'tool:pwsh', text: '' })
          systemPrompt.section({ name: 'tool:bash', text: '' })
```

### 4.2 传输层：临时 `.cmd` 脚本（唯一形态）

#### 4.2.1 为什么只能是脚本

模型给出的是一段**命令文本**，而 `ShellExecSpec` 只给 `command: string`，最终经 `dsh-subprocess-local` 变成 Windows argv（`SubprocessSpawnSpec.argv`，注释明写 "Never shell-interpreted here"），再由原生 `CreateProcessW` 绑定重排成命令行。cmd.exe **不用 `CommandLineToArgvW` 规则解析自己的命令行**，于是：

| 传输 | 实测结果 |
| --- | --- |
| 单 argv 内联 `'echo "hi"'` | libuv 转义成 `\"hi\"`，cmd 不反转义 → 输出 `\"hi\"` |
| 自己加外层引号 | 同样被 libuv 再转义一层 → 失败 |
| `/s` + 引号包裹 | `/s` 剥掉最外层引号对 → 有空格路径直接崩 |
| 环境变量一次性展开 | `%PATH%` 不二次展开；多行只取第一行；中文变 GBK；32 KB 环境上限 |
| stdin 喂命令 | 打印 banner + 提示符 + `More?`，不可用 |
| **临时 `.cmd` 文件** | **引号原样、`%VAR%` 正常、多行正常、`&`/`|`/`>`/块/`for`/`call` 全部正常、`exit /b N` 正确** |

#### 4.2.2 脚本模板

```
@echo off
chcp <codePage>>nul
cd /d "<workdir，% 双写>" 2>nul || (echo cmd: cannot enter the working directory 1>&2 & exit /b 1)
<用户命令原文，CRLF 归一化>
```

- **`cd` 守卫不是可选项**：脚本由 scratch 目录启动（见 4.2.3），若 workdir 在「校验通过」到「脚本执行」的窗口里消失，没有守卫就会**在 scratch 目录里静默执行用户的删除/覆盖命令**。实测该守卫失败时 `exit 1` 且后续命令不执行。
- **UNC 路径用 `pushd`**（`cd /d` 进不去 UNC）。脚本按首两字符是否为 `\\` 选择动词。
- **无尾部 `exit /b %errorlevel%`**：见 D11。直接 `/c <file>` 取「最后一条命令的成功标志」，与 bash 一致；加尾部 `exit /b` 会改取 ERRORLEVEL，使 `dir /nonexistent` + `echo recovered` 报 1 而 bash 报 0（已实测）。
- **UTF-8 无 BOM**：BOM 会让首个 token 变成 `\uFEFF@echo`，`@echo off` 失效（探针 1f）。
- **CRLF**：实测 LF-only 也能正常工作（含 `for /l` 与括号块），CRLF 只是为兼容旧式编辑器/工具链而统一使用，**不是必需**。
- 文件路径 `%TEMP%\dsh-cmd-<pid>-<8位随机>\cmd-<uuid>.cmd`，**每次执行一个文件**。

#### 4.2.3 argv 形态（单一路径）

```ts
// 唯一形态：spawn cwd = scratch 目录，argv 只给裸文件名
spawn: [cmdPath, '/d', '/q', '/c', basename(scriptPath)]
cwd:   scratchDir
// 脚本自己 cd /d 到真实 workdir（见 4.2.2）
```

v2 曾设计「绝对路径主形态 + 路径含 `%` 时退化」的双路径。本轮复测证明该设计有两个错：

1. **触发条件太窄**：绝对路径形态在路径含 `&`、`(`、`)`、`^`、`,`、`;` 时**必然失败**（exit 1），与 `%` 无关——这是 cmd `/c` 的引号保留规则（「引号内必须是无特殊字符的可执行文件名」）决定的。
2. **触发条件本身写错**：孤立 `%` 与不配对 `%` 都正常，只有「配对且指向真实环境变量」的 `%NAME%` 才失败。

而裸名形态对 `空格`、`%`、`x%TEMP%y`、`&`、`( )`、`^`、`,;`、`!` **全部成功**。⇒ 取消双路径，单一形态严格更强，且不需要维护字符集白名单。

- `/d`：跳过 AutoRun 注册表命令，保证确定性。
- `/q`：关闭命令回显。注意它**压过脚本内的 `@echo on`**，回显在脚本内无法恢复（P1-3）。
- **不带 `/s`**：见 D4。

#### 4.2.4 生命周期

| 时刻 | 动作 |
| --- | --- |
| `execute()` 入口 | `materializeCmd()` 落盘，置 `registered = false` |
| `onStarted` 回调 | `scripts.set(process, script)`；置 `registered = true` |
| 进程结束（含超时转后台后结束） | `onProcessDone` 里 `script.dispose()`，从 Map 删除 |
| `execute()` 正常返回但从未 `onStarted` | `finally` 里兜底 `script.dispose()` |
| `execute()` 抛错 | `finally` 兜底（未登记即删；已登记则留给 `onProcessDone`） |
| 执行器销毁 | `ctx.effect` 里 `rmSync(scratchDir, { recursive: true, force: true })` |
| 宿主异常退出 | 加载时 `sweepStaleScripts()` 清理 `mtime` 超过 24h 的 `dsh-cmd-*` 目录 |

「`finally` 兜底」是评审 P1-6 的修法：`executeArgv` 在**准备阶段超时**（如 `confine()` 卡住）时会跳过 `onStarted`，v2 的 `catch` 方案漏掉了「不抛错但也没启动」这条路径。

### 4.3 执行器 `CmdExecutor`

继承 `LocalBashExecutor`，只覆盖三处（与现有 `GitBashExecutor` 同构）：

| 成员 | 作用 |
| --- | --- |
| `override resolve(request)` | 注入 `extraPath` 到 `PATH`、`PYTHONIOENCODING=utf-8`（`pythonUtf8` 时）、补 `sandboxPolicy` |
| `override async execute(spec)` | 生成脚本 → 决定 launch → `executeArgv`（cwd=scratch、裸名）→ 装饰 `result.sandbox` |
| `override get sandboxMode()` | 决定工具是否广告 `sandbox_permissions` |

**不复用** `src/confined.ts` 的 `planLaunch`（D2），新增 `planCmdLaunch()`：

```ts
function planCmdLaunch(hasSandbox: boolean, policyMode: SandboxMode | undefined, choice: CmdConfinedPolicy): CmdLaunch {
  if (!hasSandbox || policyMode === undefined) return { kind: 'direct', mode: 'danger-full-access' }
  if (policyMode === 'danger-full-access') return { kind: 'direct', mode: 'danger-full-access' }
  if (choice === 'unconfined') return { kind: 'direct', mode: 'danger-full-access' }
  return { kind: 'confine', mode: policyMode }
}
```

denial 判定只用 `matchesSignature(exitCode, stderr, confined.denialSignatures)`（provider 自带签名），**不用** `isMsysStartupDenial`。

> **zh-CN 注意（P1-4）**：`matchesSignature` 依赖 provider 给出的签名文本。cmd 自身的诊断在 zh-CN 下是 GBK 中文，任何「匹配英文 `is not recognized as an internal or external command`」的写法在本机永不命中。开工门槛必须验证 `windows-acl` 的签名与语言无关；否则 `sandbox.denied` 会永远为 `false`（沙箱仍然生效，只是标记缺失）。

### 4.4 工具 `cmd`

因为官方 `tool-bash` 只导出 `{Config, apply, inject, name}`，且工具名与审批 `toolName` 都硬编码在 `apply()` 内部，必须用 `defineTool` 重写。

**可逐字复制到模块顶层的方言无关函数**（来自 `dsh-tool-bash/lib/index.js:22-200`，加一行出处注释）：

| 函数 | 行号 | 作用 |
| --- | --- | --- |
| `sandboxNotes(sandbox, escalationModes)` | :22 | 沙箱 denial / runner-failed 标记 |
| `processOutcome(proc, escalationModes)` | :42 | `ShellProcess` → 作业终态 |
| `processSources(proc)` | :66 | 作业输出拉取源（stdout/stderr 双通道） |
| `ringDelta(chunks)` | :88 | 环形增量读取 |
| `processJob(start, outcome)` | :100 | `JobHooks` 适配器 |
| `streamText(output)` | :135 | 截断提示拼接 |
| `renderResult(result, escalationModes)` | :150 | 前台结果渲染 |
| `renderPromoted(promoted)` | :181 | 超时转后台渲染 |
| `renderJobRead(delta, lossy, spillPaths, sandbox, escalationModes)` | :197 | 后台增量渲染 |

**必须重写的部分**：

| 部分 | 变化 |
| --- | --- |
| `name` | `'bash'` → `'cmd'` |
| `description` | `cmdDescription()`：cmd.exe 方言、`C:\` 原生路径、`%VAR%`、`/` 开关、无持久状态、`%~dp0` 无意义、回显不可恢复、非 ASCII 取决于代码页 |
| 提示词段落 | `tool:cmd`，`order: getSectionOrder('TOOL_PWSH')`（返回 `number`，**无 fallback**，P1-7） |
| 作业 kind | `'bash'` → `'cmd'`（并 `declare module` 合并 `JobKindMap`） |
| `validateBashArgs` | 改名 `validateCmdArgs`，逻辑不变 |
| `presentCall` / `presentResult` | 卡片标题改 `cmd`；`parseExitStatus` 逻辑不变 |
| **`approveBashEscalation`** | **`apply()` 内闭包（:361-374），需重写**；`toolName` 必须是 `'cmd'`（B9） |
| **`startJob`** | **`apply()` 内闭包（:390），需重写**；作业 `kind: 'cmd'` |
| **`waitOnJob`** | **`apply()` 内闭包（:425），需重写**；真实签名 `(registry, attached, exec, spec)`——用 `exec.agent?.id` 取 owner、`spec.timeoutMs` 取等待上限、`exec.signal` 响应中止，并在准备阶段超时时自行合成 `timedOut: true` 的前台结果。返回完整 foreground 结果（含 `stopped`），B4 |
| `canonicalBashResult` | 顶层函数（:295），**名字不是 `canonicalResult`**（B7） |

> 一个都不导出，所以「可移植」只能是**逐字复制**。`tool.ts` 约 530 行（v2 估 470 偏低）。

工具工厂的签名也与官方一致：`const cmdTool = (jobs: JobRegistry | undefined) => { const background = jobs !== undefined; const promote = background && promoteOnTimeout; ... }`。`background` / `promote` 是**工厂级**常量（官方 `:386-388`），不是 `apply()` 级——`apply()` 级只有 `backgroundEnabled` 与 `promoteOnTimeout`。

`output.schema` 三分支（`background` / `promoted` / `foreground`）与官方**逐字一致**（含 `additionalProperties: false` 与 `required: true` 的位置），这样 `render`/`presentResult` 才能共用。

### 4.5 沙箱

| 策略值 | 行为 | 何时用 |
| --- | --- | --- |
| `escalate`（默认） | 受限策略下走 `ctx.sandbox.confine()`；`danger-full-access` 下直跑 | 默认；cmd 能受限，所以默认走真沙箱 |
| `unconfined` | 永远直跑，`result.sandbox.mode` 报 `danger-full-access`，`sandboxMode` getter 返回 `undefined`（不广告 `sandbox_permissions`） | 用户显式要求绕过（老程序与受限令牌冲突时） |

**`sandboxMode` getter 的语义**：只在「下次启动真的会受限」时才上报 mode。否则工具会给模型提供一个「点了也没用」的升级选项。

**行为变化（必须写进发布说明）**：Windows 上 bash 会话在 `escalate` 下实际走 direct（MSYS 起不来），而 cmd 会话会**真的受限**。⇒ 切到 cmd 方言会让沙箱从「名义受限、实际直跑」变成「真的受限」，这是行为变化而非 bug。

**进程树终止**：`dsh-subprocess-local` 的 Windows runner 用 `spawnCurrentTokenJobProcess` 把目标进程放进 Job Object，终止时 `terminateJob(api, job, 1)` 杀整棵树。⇒ 超时/中止**不需要**额外实现，探针里「裸 `child.kill()` 孙进程存活」的问题在 DSH 链路里不存在（D10）。

**受限沙箱下脚本可读**：windows-acl 后端「只限制写，不限制读、网络、进程可见性」，脚本在 `%TEMP%` 只需读权限；runner 虽把子进程的 `TMP`/`TEMP` 重写到私有临时目录，但脚本路径是绝对路径、且由父进程按绝对路径写入，不受影响。**但这一条与 `chcp` 一样属于开工门槛实测项（T-SBX-ENC）**，不能只靠推理。

### 4.6 编码

三层事实决定设计：

1. 宿主**固定**按 UTF-8 解码：`dsh-subprocess-local/lib/output.js:232` `text: Buffer.concat(this.chunks).toString("utf8")`。
2. `chcp 65001` 后，cmd 用 UTF-8 读取**后续脚本行**、用 UTF-8 编码内置命令输出、用 UTF-8 生成子进程 argv；原生工具在 CP 65001 下回退到 ASCII 英文而**不是** GBK（探针 2）。
3. `chcp` 不跨调用泄漏（每次新进程），并发命令互不干扰。

⇒ `cmdCodePage` 默认 `65001`。设为其它值时：脚本仍以 UTF-8 落盘（Node 无 GBK 编码器），`chcp` 改成该值，输出会变成替换字符——**只用于「某些老程序在 65001 下会崩」的逃生场景**，加载时写一条诊断警告。工具描述里明确：非 ASCII 输出要求 65001。

**脚本编码**：UTF-8 **无 BOM**（BOM 破坏 `@echo off`），行尾统一 CRLF。CRLF 不是功能必需（实测 LF-only 正常），选它是为了让脚本在任何编辑器里都显示为正常 `.cmd` 文件，减少人工排障时的困惑。

残留漏洞（文档化，不修复）：`type <file>` 直接把文件原始字节透传，GBK 文件仍会乱码。

### 4.7 `cmd.exe` 发现

确定性三步，不做文件系统扫描：

1. 配置 `cmdPath`（非空且 `statSync().isFile()`）
2. `process.env.ComSpec ?? process.env.COMSPEC`
3. `join(env.SystemRoot ?? env.SYSTEMROOT ?? env.windir, 'System32', 'cmd.exe')`

返回 `{ path, source: 'config' | 'comspec' | 'system-root' }`，`source` 进诊断日志。全部失败 → `skip(id, 'cmd-not-found')`。

### 4.8 配置与客户端

新增/变更配置项（全部 `.volatile()`，与现有一致）：

| 键 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `dialect` | `'pwsh' \| 'bash' \| 'cmd'` | `'pwsh'` | 增加 `'cmd'` |
| `cmdPath` | `string` | `''` | 空表示自动发现 |
| `cmdCodePage` | `number` | `65001` | 见 §4.6 |
| `cmdConfinedPolicy` | `'escalate' \| 'unconfined'` | `'escalate'` | 仅 cmd 方言生效 |

复用：`extraPath`、`pythonUtf8`、`discoverTimeoutMs`（不用于 cmd）、`LocalBashExecutor.Config.dict` 的 `cwd`/`timeoutMs`/`maxTimeoutMs`/`maxOutputBytes`/`maxSpillBytes`/`graceMs`。

客户端（`src/client/`）：

- `row.tsx`：`dialectItems` 增加 `cmd`；`dialect === 'cmd'` 时渲染「cmd.exe 路径」输入 + 「沙箱策略」菜单，隐藏 bash 专属的「bash 路径」「登录 shell」「自动发现」「Python UTF-8」。
- `store.ts`：`setDialect` 允许 `'cmd'`；`normalize` 把未知值回落 `'pwsh'`。
- `locales.ts`：新增 `row.dialect.cmd`、`row.cmdPath.label`、`row.cmdPath.hint`、`row.cmdConfinedPolicy.label`、`row.cmdConfinedPolicy.{escalate,unconfined}`。
- `shared/protocol.ts`：`Dialect` 增加 `'cmd'`；`StateView` 增加 `cmdPath`。

### 4.9 诊断与降级

| 场景 | 处理 |
| --- | --- |
| 找不到 cmd.exe | `skip(id, 'cmd-not-found', detail)`，会话保留官方 pwsh |
| 脚本落盘失败 | `skip(id, 'cmd-script-failed', detail)` |
| 挂载/注册失败 | 回滚已挂载的 fiber 与 disposer，`skip(id, 'cmd-mount-failed', detail)` |
| 成功 | `note(id, 'cmd=<path> source=<source> codepage=<n> confined=<policy>')` |
| `cmdCodePage !== 65001` | `warn(id, 'non-UTF-8 code page …')` |
| 没有可隐藏的继承 shell 工具 | `warn(id, 'no inherited shell tool to hide; leaving the inherited tool list alone')`（与 bash 分支同款，说明 preset 没有挂官方工具） |

**denial 判定在 zh-CN 下可能永不命中**（P1-4）：`matchesSignature` 用的是 provider 给的签名文本；cmd 自身的「不是内部或外部命令」是 GBK 中文，若 `windows-acl` 提供的签名是英文则匹配失败。后果是**沙箱实际生效但 `sandbox.denied` 标记缺失**，模型拿不到 `[sandbox: file access denied …]` 提示。处理：列入 T-SBX 实测项，若确认不命中则在诊断里补一条「denied 标记不可靠」的说明，不伪造判定。

---

## 5 专业正确代码实现

> 约定：相对导入带 `.ts` 后缀（项目既有风格，Node 原生 TS 解析）；`@deepseek-ai/*` 全部外部化。

### 5.1 `src/cmd/script.ts`（新增，约 120 行）

```ts
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Transport for the `cmd` dialect.
 *
 * The model produces a command *string*, but the execution seam only carries
 * argv, and `CreateProcessW` re-quotes argv with `CommandLineToArgvW` rules that
 * cmd.exe does not use. Measured on Windows 11 / Node 24: every inline form
 * either double-escapes quotes or has `/s` strip them, the environment-variable
 * form refuses a second `%VAR%` expansion and truncates at the first newline,
 * and stdin turns into an interactive prompt.
 *
 * A one-shot `.cmd` file is the only transport that preserves the semantics
 * users and models expect from cmd: quotes stay literal, `%VAR%` expands,
 * multi-line and blocks work, and `exit /b N` reaches the process exit code.
 *
 * Files live in a per-executor scratch directory so that a crash leaves at most
 * one directory to sweep, and every execution gets its own file so concurrent
 * calls cannot interleave.
 */

/** Prefix shared by scratch directories and script files, used by the sweeper. */
const SCRATCH_PREFIX = 'dsh-cmd-'
const SCRIPT_PREFIX = 'cmd-'
const STALE_MS = 24 * 60 * 60 * 1000

/** One materialized batch file. */
export interface CmdScript {
  /** Absolute path to the `.cmd` file. */
  readonly path: string
  /** Delete the file. Idempotent and never throws. */
  dispose(): void
}

export interface CmdScriptOptions {
  /**
   * Console code page the script switches to before the command runs.
   *
   * `chcp` applies to the lines read *after* it, so the first line must stay
   * ASCII — which it is. `65001` is the only value that makes the command text,
   * child argv and captured output consistently UTF-8; any other value is an
   * escape hatch for legacy programs that break under UTF-8.
   */
  readonly codePage: number
  /**
   * Directory the command must run in.
   *
   * Required, not optional: the script is spawned from the scratch directory so
   * that its own name never appears on the `cmd.exe` command line (see
   * {@link scriptArgv}), which means the batch file has to enter the real
   * working directory itself.
   */
  readonly workdir: string
}

/**
 * Normalize any line ending to CRLF.
 *
 * cmd parses LF-only files correctly (measured, including parenthesised blocks
 * and `for /l`), so this is not a functional requirement — it is here so that
 * scripts behave the same when a human opens them in Notepad or feeds them to an
 * old tool that assumes CRLF.
 */
function crlf(text: string): string {
  return text.replace(/\r\n?|\n/g, '\r\n')
}

/** Escape a path for use inside a quoted batch line. */
export function escapeBatchPath(path: string): string {
  return path.replace(/%/g, '%%')
}

/**
 * Render the batch file body.
 *
 * `@echo off` suppresses command tracing. `/q` on the command line already does
 * the same and *cannot* be undone by a later `echo on` inside the script, so the
 * transport lines can never be echoed back into the transcript.
 *
 * The `cd` is guarded. Without the guard a workdir that disappears between
 * validation and execution makes the command run in the scratch directory
 * instead — silently, and with full write access. Measured: the guard exits 1
 * and stops the script.
 *
 * No trailing `exit /b %errorlevel%`: cmd's direct form (`/c <file>`) exits with
 * the success flag of the last command, which is what every other shell does.
 * A trailing `exit /b` would switch to the ERRORLEVEL variable instead, so
 * `dir /nonexistent` followed by `echo recovered` would report 1 where bash
 * reports 0.
 */
export function renderCmdScript(command: string, options: CmdScriptOptions): string {
  const lines: string[] = ['@echo off', `chcp ${options.codePage}>nul`]
  // `pushd` handles UNC shares, which `cd /d` cannot enter.
  const verb = options.workdir.startsWith('\\\\') ? 'pushd' : 'cd /d'
  const target = escapeBatchPath(options.workdir)
  lines.push(`${verb} "${target}" 2>nul || (echo cmd: cannot enter the working directory 1>&2 & exit /b 1)`)
  lines.push(crlf(command))
  return `${lines.join('\r\n')}\r\n`
}

/**
 * Choose a scratch directory under the OS temp area.
 *
 * The directory name carries the pid so a later host can tell its own
 * directories from a dead host's.
 */
export function ensureScratchDir(root?: string): string {
  const dir = root ?? join(tmpdir(), `${SCRATCH_PREFIX}${process.pid}-${randomUUID().slice(0, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Write one script and hand back a handle that deletes it. */
export function materializeCmd(dir: string, command: string, options: CmdScriptOptions): CmdScript {
  const path = join(dir, `${SCRIPT_PREFIX}${randomUUID()}.cmd`)
  // UTF-8 without BOM: a BOM turns the first token into `\uFEFF@echo` and the
  // echo suppression silently stops working.
  writeFileSync(path, renderCmdScript(command, options), 'utf8')
  let disposed = false
  return {
    path,
    dispose(): void {
      if (disposed) return
      disposed = true
      try {
        rmSync(path, { force: true })
      } catch {
        // A script that cannot be deleted is left for the sweeper.
      }
    },
  }
}

/**
 * Name to pass to `cmd.exe`, and the directory to spawn it in.
 *
 * The script is addressed by **bare file name**, never by absolute path, and
 * this is not a special case for `%` — it is the only form that works for every
 * scratch location. Measured on this host, the absolute form exits 1 whenever the
 * directory name contains `&`, `(`, `)`, `^`, `,`, `;` or a paired `%NAME%`:
 * cmd's `/c` quote-preservation rule only keeps the quotes when the quoted text
 * is a plain executable name, so a quoted *path* gets its quotes stripped and
 * the path is then split at the first metacharacter. The bare form succeeds for
 * every one of those, plus spaces and `!`.
 *
 * `/s` is deliberately absent: with `/s`, cmd strips the outermost quote pair of
 * the remainder, which destroys the quotes libuv adds around a path containing
 * spaces (`%TEMP%\John Doe\...` → `'C:\Users\John' 不是内部或外部命令`).
 */
export function scriptArgv(cmdPath: string, script: CmdScript): { argv: string[]; cwd: string } {
  return { argv: [cmdPath, '/d', '/q', '/c', basename(script.path)], cwd: dirname(script.path) }
}

/** Remove scratch directories left behind by a host that died. Never throws. */
export function sweepStaleScripts(now = Date.now(), root = tmpdir()): number {
  let removed = 0
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.startsWith(SCRATCH_PREFIX)) continue
    const dir = join(root, entry)
    try {
      const info = statSync(dir)
      if (!info.isDirectory() || now - info.mtimeMs < STALE_MS) continue
      rmSync(dir, { recursive: true, force: true })
      removed += 1
    } catch {
      // Best effort: a locked directory is retried on the next load.
    }
  }
  return removed
}
```

### 5.2 `src/cmd/discover.ts`（新增，约 60 行）

```ts
import { statSync } from 'node:fs'
import { join } from 'node:path'

/** Where a resolved `cmd.exe` came from, for diagnostics. */
export type CmdSource = 'config' | 'comspec' | 'system-root'

export interface CmdLocation {
  readonly path: string
  readonly source: CmdSource
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve `cmd.exe`.
 *
 * Three deterministic steps instead of a filesystem sweep: every Windows install
 * exposes cmd through `ComSpec` or `%SystemRoot%`, so scanning would only add
 * latency and nondeterminism to session creation. Unlike the Git Bash path there
 * is no WSL-style impostor to filter out — `System32\cmd.exe` is the real thing.
 */
export function discoverCmd(configured: string, env: NodeJS.ProcessEnv = process.env): CmdLocation | undefined {
  const trimmed = configured.trim()
  if (trimmed !== '' && isFile(trimmed)) return { path: trimmed, source: 'config' }

  const comspec = env.ComSpec ?? env.COMSPEC
  if (comspec !== undefined && comspec.trim() !== '' && isFile(comspec)) {
    return { path: comspec, source: 'comspec' }
  }

  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir
  if (systemRoot !== undefined && systemRoot.trim() !== '') {
    const path = join(systemRoot, 'System32', 'cmd.exe')
    if (isFile(path)) return { path, source: 'system-root' }
  }
  return undefined
}
```

### 5.3 `src/cmd/executor.ts`（新增，约 250 行）

```ts
import type { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as BashLocalConfig } from '@deepseek-ai/dsh-bash-local'
import {
  SandboxUnavailableError,
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  matchesSignature,
} from '@deepseek-ai/dsh-sandbox'
import type {
  ConfinedArgv,
  ConfinedSandboxMode,
  RunnerFailureRule,
  SandboxMode,
  SandboxPolicy,
  SandboxProvider,
} from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type {
  ShellExecRequest,
  ShellExecSpec,
  ShellExecution,
  ShellProcess,
  ShellRunResult,
} from '@deepseek-ai/dsh-shell'
import { rmSync, statSync } from 'node:fs'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { composePath } from '../paths.ts'
import { ensureScratchDir, materializeCmd, scriptArgv, type CmdScript } from './script.ts'

/** How to launch under a confined Windows sandbox. */
export type CmdConfinedPolicy = 'escalate' | 'unconfined'

/** Extra config fields carried into the mounted executor. */
export interface CmdExecutorConfig extends BashLocalConfig {
  /** Absolute path to `cmd.exe`. */
  readonly cmdPath: string
  /** Directories to prepend to PATH (`extraPath`). */
  readonly pathEntries: readonly string[]
  /** Console code page the script switches to. */
  readonly codePage: number
  /** Export PYTHONIOENCODING so Python writes UTF-8 into the pipe. */
  readonly pythonUtf8: boolean
  /** How to launch under a confined sandbox. Defaults to `escalate`. */
  readonly confinedPolicy?: CmdConfinedPolicy
}

interface LaunchFacts {
  readonly mode: SandboxMode
  readonly enforcement?: 'full' | 'partial'
  readonly denialSignatures: readonly string[]
  readonly runnerFailureRules: readonly RunnerFailureRule[]
  readonly runnerProgram: string
  readonly workdir: string
}

type CmdLaunch = { readonly kind: 'confine'; readonly mode: ConfinedSandboxMode } | { readonly kind: 'direct'; readonly mode: SandboxMode }

/**
 * Decide how to launch.
 *
 * Deliberately **not** `planLaunch()` from `confined.ts`: that function encodes
 * the Git Bash constraint ("MSYS2 cannot start under a restricted token on
 * Windows"), which is exactly inverted for cmd. `cmd.exe` is what the official
 * windows-acl backend uses as its own functional probe (`cmd /c exit 0`), so a
 * confined policy is honoured rather than bypassed, and there is no `fail`
 * branch: no cmd launch can be impossible for sandbox reasons.
 */
export function planCmdLaunch(
  hasSandbox: boolean,
  policyMode: SandboxMode | undefined,
  choice: CmdConfinedPolicy,
): CmdLaunch {
  if (!hasSandbox || policyMode === undefined) return { kind: 'direct', mode: 'danger-full-access' }
  if (policyMode === 'danger-full-access') return { kind: 'direct', mode: 'danger-full-access' }
  if (choice === 'unconfined') return { kind: 'direct', mode: 'danger-full-access' }
  return { kind: 'confine', mode: policyMode }
}

/**
 * A `LocalBashExecutor` that runs `cmd.exe` instead of bash.
 *
 * Subclassing keeps everything the plugin must not diverge from: deadline
 * arming, output collection and spilling, abort classification, `dshEnv`
 * merging and result shaping all stay first-party. Only three things change —
 * the argv built for the command, the PATH/encoding injected into the child, and
 * the sandbox launch decision.
 */
export class CmdExecutor extends LocalBashExecutor {
  // No `as const`: the base class declares `static inject: string[]`, so a
  // readonly tuple is TS2417.
  static inject = ['subprocess']

  private readonly facts = new Map<ShellProcess, LaunchFacts>()
  private readonly scripts = new Map<ShellProcess, CmdScript>()
  private scratchDir: string | undefined

  constructor(ctx: Context, config: CmdExecutorConfig) {
    super(ctx, config)
    this.ctx.effect(() => () => {
      const dir = this.scratchDir
      this.scratchDir = undefined
      if (dir === undefined) return
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Left for the sweeper.
      }
    }, 'cmd-executor: scratch')
  }

  private get extended(): CmdExecutorConfig {
    return this.config as unknown as CmdExecutorConfig
  }

  private get cmdPath(): string {
    return this.extended.cmdPath
  }

  private get codePage(): number {
    return this.extended.codePage
  }

  private get pythonUtf8(): boolean {
    return this.extended.pythonUtf8
  }

  private get confinedPolicy(): CmdConfinedPolicy {
    return this.extended.confinedPolicy ?? 'escalate'
  }

  private get sandbox(): SandboxProvider | undefined {
    return this.ctx.get('sandbox') as SandboxProvider | undefined
  }

  private get sandboxPolicy(): SandboxPolicyService | undefined {
    return this.ctx.get('sandboxPolicy') as SandboxPolicyService | undefined
  }

  private get scratch(): string {
    this.scratchDir ??= ensureScratchDir()
    return this.scratchDir
  }

  /**
   * Report a sandbox mode only when the next launch would actually confine.
   *
   * The tool uses `undefined` to decide whether to advertise
   * `sandbox_permissions`; claiming a mode the executor then bypasses would offer
   * the model an escalation that changes nothing.
   */
  override get sandboxMode(): SandboxMode | undefined {
    const mode = this.sandboxPolicy?.defaultMode
    if (this.sandbox === undefined || mode === undefined) return undefined
    if (mode === 'danger-full-access') return mode
    return this.confinedPolicy === 'unconfined' ? undefined : mode
  }

  /**
   * Inject PATH and encoding.
   *
   * `spawnSpec` merges `spec.env` after the built-in overrides and before
   * `dshEnv`, so `resolve()` is the only place a PATH can be supplied.
   * `PYTHONIOENCODING` matters here for the same reason it matters for bash:
   * Python writes to a pipe using the locale encoding unless told otherwise, and
   * the harness decodes every pipe as UTF-8.
   */
  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    const base = spec.env?.PATH ?? process.env.PATH ?? process.env.Path
    const env: NodeJS.ProcessEnv = { ...spec.env }
    if (this.extended.pathEntries.length > 0) env.PATH = composePath(this.extended.pathEntries, base)
    if (this.pythonUtf8 && env.PYTHONIOENCODING === undefined) env.PYTHONIOENCODING = 'utf-8'
    return { ...spec, env, sandboxPolicy: spec.sandboxPolicy ?? this.sandboxPolicy?.resolve() }
  }

  override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    // The script is spawned with the scratch directory as its cwd, so a missing
    // workdir would only surface inside the batch file, after the process
    // started. Fail early with the path the caller actually asked for.
    assertDirectory(spec.workdir, 'working directory')

    const script = materializeCmd(this.scratch, spec.command, {
      codePage: this.codePage,
      workdir: spec.workdir,
    })
    // Spawn from the scratch directory and address the script by bare name: the
    // absolute form breaks for any directory name containing `&`, `(`, `)`,
    // `^`, `,`, `;` or a paired `%NAME%`. The batch file enters `spec.workdir`
    // itself.
    const { argv, cwd } = scriptArgv(this.cmdPath, script)
    const spawnSpec: ShellExecSpec = { ...spec, workdir: cwd }
    const sandbox = this.sandbox
    const policy = spec.sandboxPolicy
    const plan = planCmdLaunch(sandbox !== undefined, policy?.mode, this.confinedPolicy)
    let registered = false

    try {
      if (plan.kind === 'direct') {
        const facts = { mode: plan.mode, denied: false } as const
        const execution = await this.executeArgv(spawnSpec, argv, (process) => {
          registered = true
          this.scripts.set(process, script)
        })
        return decorateResult(execution, (result) => ({ ...result, sandbox: facts }))
      }

      if (sandbox === undefined || policy === undefined || policy.mode === 'danger-full-access') {
        throw new Error('cmd-executor: confined launch without a confined sandbox policy')
      }
      const confinedPolicy: SandboxPolicy = { ...policy, mode: plan.mode }
      let confined: ConfinedArgv | undefined
      const execution = await this.executeArgv(
        spawnSpec,
        async (signal) => {
          const prepared = await sandbox.confine(argv, confinedPolicy, signal)
          signal.throwIfAborted()
          confined = prepared
          return prepared.argv
        },
        (process) => {
          registered = true
          this.scripts.set(process, script)
          this.facts.set(process, {
            mode: plan.mode,
            enforcement: confined?.enforcement,
            denialSignatures: confined?.denialSignatures ?? [],
            runnerFailureRules: confined?.runnerFailureRules ?? [],
            runnerProgram: confined?.argv[0] ?? argv[0] ?? this.cmdPath,
            workdir: spec.workdir,
          })
        },
      )
      return decorateResult(
        execution,
        (result) => {
          const ready = confined
          if (ready === undefined) return result
          const failure = classifyRunnerFailure(result.exitCode, result.stderr.text, ready.runnerFailureRules)
          if (failure !== undefined) throw new SandboxUnavailableError(plan.mode, failure.detail)
          return {
            ...result,
            sandbox: {
              mode: plan.mode,
              denied: matchesSignature(result.exitCode, result.stderr.text, ready.denialSignatures),
              enforcement: ready.enforcement,
            },
          }
        },
        (error) => {
          if (spec.signal?.aborted) spec.signal.throwIfAborted()
          const ready = confined
          if (ready !== undefined && isRunnerSpawnFailure(error, ready.argv[0], spec.workdir)) {
            throw new SandboxUnavailableError(plan.mode, error instanceof Error ? error.message : String(error))
          }
          throw error
        },
      )
    } finally {
      // `executeArgv` skips `onStarted` when *preparation* times out (for example
      // a `confine()` that never resolves), so nothing registered the script and
      // `onProcessDone` has nothing to dispose. Only the unregistered case is
      // cleaned here: a registered script must survive until its process exits,
      // because a promoted timeout keeps reading it from a background job.
      if (!registered) script.dispose()
    }
  }

  /**
   * Settle sandbox facts and drop the script.
   *
   * The script cannot be removed when the *tool call* returns: a promoted
   * timeout keeps the process running as a background job, and cmd re-reads its
   * batch file line by line. Only a finished process makes the file dead weight.
   */
  protected override onProcessDone(
    process: ShellProcess,
    stderr: string,
    providerRejected: boolean,
    providerError?: unknown,
  ): void {
    this.scripts.get(process)?.dispose()
    this.scripts.delete(process)

    const facts = this.facts.get(process)
    this.facts.delete(process)
    if (facts !== undefined) {
      const runnerFailed = providerRejected
        ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir)
        : classifyRunnerFailure(process.exitCode, stderr, facts.runnerFailureRules) !== undefined
      process.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature(process.exitCode, stderr, facts.denialSignatures),
        ...(facts.enforcement !== undefined ? { enforcement: facts.enforcement } : {}),
        ...(runnerFailed ? { runnerFailed: true } : {}),
      }
    }
    super.onProcessDone(process, stderr, providerRejected, providerError)
  }
}

function assertDirectory(path: string, label: string): void {
  let ok = false
  try {
    ok = statSync(path).isDirectory()
  } catch {
    ok = false
  }
  if (!ok) throw new HarnessError(`cmd: ${label} does not exist: ${path}`)
}

/** Replace the result of a handle in place, preserving handle identity. */
function decorateResult<T extends ShellExecution>(
  execution: T,
  map: (result: ShellRunResult) => ShellRunResult,
  mapError?: (error: unknown) => never,
): T {
  let decorated: ShellRunResult | undefined
  const original = execution.result.bind(execution)
  execution.result = async (): Promise<ShellRunResult> => {
    if (decorated !== undefined) return decorated
    try {
      decorated = map(await original())
    } catch (error) {
      if (mapError !== undefined) mapError(error)
      throw error
    }
    return decorated
  }
  return execution
}
```

> 实现期注意：`classifyRunnerFailure` 在本项目既有代码里以 `import { classifyRunnerFailure as classifyRunnerFailureMatch }` 别名引入（见 `src/executor.ts:7`），两处保持一致即可；`SandboxUnavailableError` 的构造签名是 `(mode, detail)`。

### 5.4 `src/cmd/tool.ts`（新增，约 530 行）

骨架与**必须逐字对齐**的契约部分：

```ts
import { isAbsolute, sep } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { TOOL_ABORTED, defineTool } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  sandboxPermissionsDescription,
  validateEscalationArgs,
} from '@deepseek-ai/dsh-sandbox'
import { DSH_ENV_PREFIX, parseExitStatus } from '@deepseek-ai/dsh-shell'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ShellExecution } from '@deepseek-ai/dsh-shell'

/**
 * `ctx.jobs` keys its registry by an open `JobKindMap`; declaration merging is
 * the documented way for a plugin to add its own namespace.
 */
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    cmd: 'cmd'
  }
}

export const name = 'tool-cmd'
// No `as const`: cordis's `inject` is typed as a mutable `string[]`, and the
// official tools declare it the same way.
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv', 'workingDirectory']

export const Config = z.object({
  enableRunInBackground: z.boolean().default(true),
  promoteOnTimeout: z.boolean().default(true),
})

/**
 * The tool contract is cmd-dialect: native `C:\...` paths, `%VAR%` expansion,
 * `/` switches. The transport runs the text from a one-shot batch file, so the
 * caveats that follow from that are stated here rather than left to be
 * discovered: `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to the transport script,
 * not to anything the caller wrote.
 */
function cmdDescription(): string {
  return [
    'Execute a Windows `cmd.exe` command and return its stdout/stderr.',
    'Each call runs in a fresh shell: no variable, directory or `setlocal` state survives between calls; pass `workdir` instead of using `cd`.',
    `Managed \`$${DSH_ENV_PREFIX}*\` variables expose current harness environment facts.`,
    'The command runs from a one-shot batch file, so batch syntax (`%VAR%`, `&`, `&&`, `||`, pipes, redirection, `( )` blocks, `if`, `for`, `call :label`, multi-line) behaves exactly as in a `.cmd` file. `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to that internal file and are not useful; use `%CD%` for the working directory.',
    'Non-ASCII output requires the console code page to be UTF-8, which is the default; some legacy programs ignore it.',
    'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.',
    'Provide `description` before `command` in the arguments.',
    'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way.',
  ].join(' ')
}
```

**`apply()` 与工具构造**（与官方 `dsh-tool-bash/lib/index.js:340-730` 同构，差异已标注）：

```ts
export function apply(ctx: Context, config: Config = {}): void {
  const backgroundEnabled = config.enableRunInBackground ?? true
  const promoteOnTimeout = (config.promoteOnTimeout ?? true) && backgroundEnabled
  const defaultMode = ctx.shell.sandboxMode
  const escalationModes = defaultMode === void 0 ? [] : ESCALATION_TARGETS
  const sandboxPolicy = defaultMode === void 0 ? void 0 : ctx.get('sandboxPolicy')
  if (defaultMode !== void 0 && sandboxPolicy === void 0) {
    throw new Error('tool-cmd: the mounted cmd executor confines but ctx.sandboxPolicy is missing')
  }
  const resolveSandboxPolicy = (exec) =>
    sandboxPolicy?.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session })

  // 工具工厂：签名与官方 `bashTool(jobs)` 一致（官方 :386-388）。
  // `background`/`promote` 是**工厂级**常量，不是 `apply()` 级。
  const cmdTool = (jobs: JobRegistry | undefined) => {
    const background = jobs !== undefined
    const promote = background && promoteOnTimeout
    return defineTool({
      name: 'cmd',
      description: cmdDescription(),
      parameters: {
        description: { type: 'string', required: true, description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI).' },
        command: { type: 'string', required: true, description: 'The cmd.exe command to execute.' },
        timeoutMs: { type: 'number', description: promote ? '…moves to the background as a job instead of being killed.' : '…kills the command on expiry.' },
        workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
        ...(background ? { run_in_background: { type: 'boolean', description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.' } } : {}),
        ...(escalationModes.length > 0 ? {
          sandbox_permissions: { type: 'string', enum: [...escalationModes], description: sandboxPermissionsDescription('command') },
          justification: { type: 'string', description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.' },
        } : {}),
      },
      // output.schema / render / presentationMeta / presentCall / presentResult：
      // 与官方 bash 工具逐字一致，只把卡片标题换成 cmd（见 §4.4 表）。
      output: { /* 三分支 oneOf，见下 */ },
      async execute(args, exec) { /* 见下（§5.4 的完整实现） */ },
    })
  }

  // 注册与作业接线：与官方 pwsh 工具 :714-734 逐字一致，只把 kind 换成 'cmd'。
  if (!backgroundEnabled) { ctx.tools.register(cmdTool(undefined)); return }
  let foregroundOnly = ctx.get('jobs') === void 0 ? ctx.tools.register(cmdTool(undefined)) : undefined
  ctx.inject(['jobs'], (jobCtx) => {
    foregroundOnly?.()
    foregroundOnly = undefined
    const unregister = ctx.tools.register(cmdTool(jobCtx.jobs))
    jobCtx.effect(() => () => {
      unregister()
      if (ctx.fiber.state === 2) foregroundOnly = ctx.tools.register(cmdTool(undefined))
    })
  })

  // 提示词段落**不在这里注册**，理由与可见性无关（`isolate()` 只改 cordis 的
  // isolate 维度，`dsh-scope` 的 scope 键仍与父 ctx 相同，子 ctx 注册的段落对
  // agent 一样可见——v2 在这里写的「不可见」是错的）。真正的约束是
  // `NamedEntries` 在**同一层**重名会抛错：段落注册点只能有一个。
  // 这里选 `replace.ts` 的 `installCmdSession`，因为它已经持有 `agentCtx`、
  // 已经在做 `tool:pwsh` 的压空注册，把 `tool:cmd` 放在同一处装配更直观；
  // 文案从 `src/cmd/prompt.ts` 导出，避免两个文件互相 import。
}
```

`CMD_PROMPT_SECTION`（`src/cmd/prompt.ts` 导出，新增，约 10 行）——由 `installCmdSession` 在 `agentCtx` 上以 `name: 'tool:cmd'`、`order: getSectionOrder('TOOL_PWSH')` 注册（`getSectionOrder` 的返回类型是 `number` 而非 `number | undefined`，所以不需要 `?? 1010` 兜底；官方 order 表里没有 `TOOL_CMD`，复用 pwsh 的 1010 让 cmd 段落落在同一位置——bash 方言下这两个段落不会同时存在）：

```
## The `cmd` tool

`cmd` runs a Windows `cmd.exe` command and returns stdout/stderr. Each call is a
fresh shell.

- The contract is cmd-dialect: native `C:\...` paths, `%VAR%` for environment
  variables (not `$env:VAR`), `/` switches (`dir /b`).
- The command runs from a one-shot batch file, so `%VAR%` expands, `&`/`&&`/`||`
  chain, pipes and redirection work, and `( )` blocks, `if`, `for`, `call :label`
  and multi-line commands behave as in a `.cmd` file.
- `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to the internal batch file, not to your
  command; use `%CD%` for the working directory.
- Nothing persists between calls. Use `workdir` instead of `cd`.
```

`execute()` 的核心（**与官方 `dsh-tool-bash/lib/index.js:655-712` 逐行同构**，只把 `bash` 换成 `cmd`、`toolName` 换成 `'cmd'`、作业 `kind` 换成 `'cmd'`）。**`startJob`、`waitOnJob`、`approveCmdEscalation` 三个函数官方没有导出**——它们分别是 `dsh-tool-bash/lib/index.js:390`、`:425`、`:361-374` 里 `apply()` 内部的闭包，必须整段抄进本文件的 `apply()` 里，不能 `import`：

```ts
// 官方 `startJob` 是 JS，返回对象无类型；TS 下需要显式声明（形状见官方 :390-421）。
type AttachedCmdJob = {
  readonly id: JobId
  process: () => ShellExecution | undefined
  stopped: () => string | undefined
}
```

```ts
// 工具工厂：参数就是作业注册表（可能为 undefined），官方命名 `jobs`。
const cmdTool = (jobs: JobRegistry | undefined) => {
  const background = jobs !== undefined
  const promote = background && promoteOnTimeout
  // startJob / waitOnJob / approveCmdEscalation 三个闭包按官方 :361-470 逐字复制，
  // 只改 toolName: 'cmd' 与 kind: 'cmd'。

  return defineTool({
    name: 'cmd',
    description: cmdDescription(),
    parameters: { /* 见上 */ },
    output: { /* 三分支 oneOf，照抄官方 :530-660 */ },
    async execute(args, exec) {
      const standingPolicy = resolveSandboxPolicy(exec)
      validateCmdArgs(args, standingPolicy?.mode)
      const approvedMode =
        args.sandbox_permissions !== undefined && args.justification !== undefined
          ? await approveCmdEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
          : undefined
      const policy = approvedMode === undefined ? standingPolicy : { ...standingPolicy, mode: approvedMode }
      const cwd = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
      const workdir = resolveWorkdir(args.workdir, cwd)
      // `sandboxPolicy` 必须保持为请求的**嵌套字段**，不能 `...policy` 展开。
      // 展开会把 `mode` 摊到请求顶层、`request.sandboxPolicy` 仍是 `undefined`，
      // `CmdExecutor.resolve()` 于是回落到常设受限策略——用户批准了
      // `danger-full-access`，命令却仍然受限。而且对象展开绕过 TS 的多余属性检查，
      // **编译期不会报错**，这个 bug 只能靠 T-SBX-ESC 测试兜住。
      const request = {
        command: args.command,
        ...(workdir !== undefined ? { workdir } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        dshEnv: ctx.shellEnv.collect(exec),
        ...(policy !== undefined ? { sandboxPolicy: policy } : {}),
      }

      // 后台分支：官方 `execute` 的四个守卫一个都不能少。
      if (args.run_in_background === true) {
        if (!backgroundEnabled) throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        if (jobs === undefined) throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        if (exec.signal.aborted) throw toolAborted()
        const spec = ctx.shell.resolve({ ...request, onExpiry: 'none' })
        return { kind: 'background', jobId: startJob(jobs, args, exec, spec).id, cwd: spec.workdir }
      }

      // 提升分支：官方在这里**单独 resolve 一次 spec**（不带 signal——作业有自己的
      // AbortController），然后 `return waitOnJob(...)` 直接返回完整前台结果。
      // 不要复用下面那个带 signal 的 spec，也不要再在外面补 `stopped`。
      if (jobs !== undefined && promote) {
        const spec = ctx.shell.resolve({ ...request, onExpiry: 'none' })
        let attached: AttachedCmdJob | undefined
        try {
          attached = startJob(jobs, args, exec, spec)
        } catch (error) {
          // 官方允许转后台失败退回前台：作业登记失败不该让整次调用失败，
          // 代价只是失去超时提升能力。
          ctx.logger.warn(`cmd: job registration refused, running in the foreground with the timeout kill instead: ${String(error)}`)
        }
        if (attached !== undefined) return waitOnJob(jobs, attached, exec, spec)
      }

      const spec = ctx.shell.resolve({ ...request, signal: exec.signal })
      const result = await (await ctx.shell.execute(spec)).result()
      if (result.aborted) throw toolAborted()
      return { kind: 'foreground', ...canonicalCmdResult(result, spec.workdir) }
    },
    presentCall: presentCmdCall,
    presentResult: presentCmdResult,
  })
}
```

`canonicalCmdResult` = 官方 `canonicalBashResult`（`dsh-tool-bash/lib/index.js:295`）逐字复制改名，字段完全一致（`cwd`/`exitCode`/`signal`/`timedOut`/`aborted`/`timeoutMs`/`stdout`/`stderr`/`sandbox`），`output.schema` 也照抄三分支。

> **注意 `waitOnJob` 的签名是 `(registry, attached, exec, spec)`，不是 `(registry, attached, timeoutMs, signal)`。** 它内部用 `exec.agent?.id` 取 owner、用 `spec.timeoutMs` 取等待上限、用 `exec.signal` 响应中止，并在**准备阶段超时**（`attached.process() === undefined`）时自行合成一个 `timedOut: true` 的前台结果返回。这些都是 v2 漏掉的行为。

### 5.5 `src/config.ts` 变更

```diff
-  dialect: z.union(['pwsh', 'bash'] as const).default('pwsh').volatile(),
+  dialect: z.union(['pwsh', 'bash', 'cmd'] as const).default('pwsh').volatile(),
+  cmdPath: z.string().default('').volatile(),
+  cmdCodePage: z.number().default(65001).volatile(),
+  cmdConfinedPolicy: z.union(['escalate', 'unconfined'] as const).default('escalate').volatile(),
```

```diff
 export type RawConfig = BashLocalConfig & {
-  dialect: 'pwsh' | 'bash'
+  dialect: Dialect
+  cmdPath: string
+  cmdCodePage: number
+  cmdConfinedPolicy: CmdConfinedPolicy
   ...
 }

 export interface ConfigSnapshot {
-  dialect: 'pwsh' | 'bash'
+  dialect: Dialect
+  cmdPath: string
+  cmdCodePage: number
+  cmdConfinedPolicy: CmdConfinedPolicy
   ...
 }
```

```diff
-  const dialect = read<string>(source.dialect, 'pwsh')
-  dialect: dialect === 'bash' ? 'bash' : 'pwsh',
+  dialect: readDialect(source.dialect),
+  cmdPath: read<string>(source.cmdPath, ''),
+  cmdCodePage: readCodePage(source.cmdCodePage),
+  cmdConfinedPolicy: read<string>(source.cmdConfinedPolicy, 'escalate') === 'unconfined' ? 'unconfined' : 'escalate',
```

```diff
-export function wantsBash(snapshot: ConfigSnapshot): boolean {
-  return snapshot.dialect === 'bash'
-}
+export function dialectOfSnapshot(snapshot: ConfigSnapshot): Dialect {
+  return snapshot.dialect
+}
```

新增两个 `read` 辅助：

```ts
function readDialect(value: unknown): Dialect {
  const raw = read<string>(value, 'pwsh')
  return raw === 'bash' || raw === 'cmd' ? raw : 'pwsh'
}

function readCodePage(value: unknown): number {
  const raw = read<number>(value, 65001)
  return Number.isInteger(raw) && raw > 0 ? raw : 65001
}
```

### 5.6 `src/replace.ts` 变更

装配点有两处**结构性**改动（不是措辞问题，照 v2 的写法会直接编译失败或功能失效）：

1. **`agentCtx` 的声明必须上移到方言闸门之前。** 现状 `src/replace.ts:85` 是
   `const agentCtx = agent.ctx`，而方言闸门在 `:83`。v2 在闸门里直接调用
   `installCmdSession(ctx, agent, agentCtx, snapshot)` 会引用尚未声明的变量
   （**TS2448**）。
2. **方言闸门必须下移到 preset 守卫之后。** 闸门留在 `:83` 会绕过 `:98-102` 的
   `VARIANT_ID` / `MINIMAL_ID` 让位语义：`minimalMode: 'variant'` 时持久终端预设
   已经接管，cmd 再挂一个 shell 工具就变成两个终端工具并存；而且 cmd 分支的
   `deny: ['pwsh', 'bash']` 会把持久终端预设自己注册的工具一起 deny 掉。

改后的顺序（`src/replace.ts:80-116` 区间，逐行可对照现状）：

```diff
 export async function installSession(ctx, agent, snapshot): Promise<InstallResult> {
   const id = String(agent.id)
 
   if (process.platform !== 'win32') return { status: 'skipped', reason: skip(id, 'not-win32') }
-  if (snapshot.dialect !== 'bash') return { status: 'skipped', reason: skip(id, 'dialect-pwsh') }
 
   const agentCtx = agent.ctx
   if (agentCtx === undefined) return { status: 'skipped', reason: skip(id, 'no-agent-context') }
 
   // ... preset 注释原样保留 ...
   const preset = presetOf(agentCtx, agent)
   if (preset === VARIANT_ID) return { status: 'skipped', reason: skip(id, 'already-replaced') }
   if (preset === MINIMAL_ID && snapshot.minimalMode !== 'oneshot') {
     return { status: 'skipped', reason: skip(id, 'minimal-left', snapshot.minimalMode) }
   }
 
+  // 方言闸门：必须在这里——在 preset 守卫之后、在任何 mount 之前。
+  if (snapshot.dialect === 'pwsh') return { status: 'skipped', reason: skip(id, 'dialect-pwsh') }
+  if (snapshot.dialect === 'cmd') return installCmdSession(agent, agentCtx, snapshot)
+
   const tools = optional<ToolRuntime>(agentCtx, 'tools')
   const systemPrompt = optional<SystemPrompt>(agentCtx, 'systemPrompt')
   // ... 以下 bash 路径不变 ...
```

注意 `installCmdSession` 的签名不再收根 `ctx`——见下一节 B2 的说明，它只用 `agentCtx`。

`installCmdSession`（新增，约 130 行，与 bash 版本同构）。**三个必须用 `agentCtx` 而不是根 `ctx` 的理由**：①`tools.restrict()` 在根 ctx 上会抛
`"tools.restrict() requires a scoped context (agent.ctx): a context-global restriction would mask every agent — deny the tool for the intended agent instead"`
（`node_modules/@deepseek-ai/dsh-tools/lib/index.js:2993`）；②`systemPrompt.section()` 用根 ctx 会落在 global 层，把 `tool:cmd` 和压空段落污染到**所有**会话；③`tools.get(name, agent)` 的可见性判定本来就以 agent 视图为准。类型名同样以现有实现为准：`ToolRuntime`（`@deepseek-ai/dsh-tools`）与 `SystemPrompt`（`@deepseek-ai/dsh-system-prompt`），不是 `ToolRegistry` / `SystemPromptService`（后两个不存在，照抄得 TS2305）。

```ts
async function installCmdSession(
  agent: Agent,
  agentCtx: Context,
  snapshot: ConfigSnapshot,
): Promise<InstallResult> {
  const id = String(agent.id)
  const tools = optional<ToolRuntime>(agentCtx, 'tools')
  const systemPrompt = optional<SystemPrompt>(agentCtx, 'systemPrompt')
  if (tools === undefined || systemPrompt === undefined) {
    return { status: 'skipped', reason: skip(id, 'missing-service') }
  }
  if (tools.get('cmd', agent) !== undefined) {
    return { status: 'skipped', reason: skip(id, 'already-replaced') }
  }

  const found = discoverCmd(snapshot.cmdPath)
  if (found === undefined) {
    return { status: 'skipped', reason: skip(id, 'cmd-not-found', 'no cmd.exe via config, ComSpec or SystemRoot') }
  }
  if (snapshot.cmdCodePage !== 65001) {
    warn(id, `cmdCodePage=${snapshot.cmdCodePage}: the harness decodes output as UTF-8, so non-ASCII output will contain replacement characters`)
  }

  const undo: (() => void)[] = []
  const fibers: { dispose: () => Promise<void> }[] = []
  try {
    const shellCtx = agentCtx.isolate('shell')
    const executorHost = await shellCtx.plugin(CmdExecutor, {
      ...executorConfig(snapshot),
      cmdPath: found.path,
      pathEntries: [...snapshot.extraPath],
      codePage: snapshot.cmdCodePage,
      pythonUtf8: snapshot.pythonUtf8,
      confinedPolicy: snapshot.cmdConfinedPolicy,
    })
    fibers.push(executorHost)

    const toolHost = await shellCtx.plugin(ToolCmd, { enableRunInBackground: true, promoteOnTimeout: true })
    fibers.push(toolHost)

    if (tools.get('cmd', agent) === undefined) {
      throw new Error('tool-cmd mounted but did not register a cmd tool')
    }

    // Deny every inherited shell tool that is actually visible: `restrict` fails
    // on unknown names, and a preset may have re-mounted tool-bash inside this
    // agent's realm even on Windows.
    const inherited = ['pwsh', 'bash'].filter((name) => tools.get(name, agent) !== undefined)
    if (inherited.length > 0) {
      undo.push(tools.restrict({ deny: inherited }))
      for (const name of inherited) {
        const section = name === 'pwsh' ? 'tool:pwsh' : 'tool:bash'
        try {
          undo.push(systemPrompt.section({ name: section, order: systemPrompt.getSectionOrder(name === 'pwsh' ? 'TOOL_PWSH' : 'TOOL_BASH'), text: '' }))
        } catch (error) {
          warn(id, `could not blank the ${section} prompt section: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } else {
      warn(id, 'no inherited shell tool to hide; leaving the inherited tool list alone')
    }

    // `tool:cmd` 段落注册在 agent 层：与 `tool:pwsh`/`tool:bash` 的压空同一个
    // 作用域，这样模型看到的是「三个 shell 工具里恰好一个」的提示词面。
    // 注意：`NamedEntries` 同层重名会抛错，所以 `ToolCmd.apply()` 里**不能**
    // 再注册同名段落——两处只能选一处，这里选了本函数。
    undo.push(
      systemPrompt.section({
        name: 'tool:cmd',
        order: systemPrompt.getSectionOrder('TOOL_PWSH'),
        text: CMD_PROMPT_SECTION,
      }),
    )

    agentCtx.effect(() => () => {
      for (const disposer of undo.reverse()) {
        try {
          disposer()
        } catch {
          // Rollback is best-effort.
        }
      }
    })
    note(id, `cmd=${found.path} source=${found.source} codepage=${snapshot.cmdCodePage} confined=${snapshot.cmdConfinedPolicy}`)
    return { status: 'installed', bashPath: found.path, cmdPath: found.path }
  } catch (error) {
    for (const disposer of undo.reverse()) {
      try {
        disposer()
      } catch {
        // ignore
      }
    }
    for (const fiber of fibers.reverse()) {
      try {
        await fiber.dispose()
      } catch {
        // ignore
      }
    }
    return { status: 'skipped', reason: skip(id, 'cmd-mount-failed', error instanceof Error ? error.message : String(error)) }
  }
}
```

`InstallResult` 的 `installed` 分支：**本次不改字段名**。v2 计划把 `bashPath` 改成 `executable`，但评审 B10 查明该字段波及 11 个源文件，其中 `src/preset.ts:110` 会把它写进**生成的 preset 行**、同时它还是 PTY 后端 config 的键——改名属于独立重构，不该混进 CMD 功能里。本次做法：保留 `bashPath` 字段名，在 `InstallResult` 上**新增**一个可选 `cmdPath?: string`，`installCmdSession` 返回 `{ status: 'installed', bashPath: found.path, cmdPath: found.path }`（cmd 分支下两者同值），并只更新 `src/index.ts:162` 的日志按方言选择打印哪个字段。改名留给后续单独 PR。

（`bashPath` 在 cmd 分支填同一个值是权宜：`src/index.ts:162` 与 `src/routes.ts` 的 `lastReplace` 都只读 `bashPath`，填上可以避免这次改动扩散到客户端；等字段改名时一起清理。）

### 5.7 `src/diag.ts` / `src/index.ts` / 客户端变更

```diff
 export type SkipReason =
   | 'not-win32'
   | 'dialect-pwsh'
+  | 'cmd-not-found'
+  | 'cmd-script-failed'
+  | 'cmd-mount-failed'
   ...
```

```diff
-  if (!wantsBash(initial)) {
-    writeDiagnostic('loaded with dialect=pwsh; sessions keep the platform terminal tool')
-  }
+  if (initial.dialect === 'pwsh') {
+    writeDiagnostic('loaded with dialect=pwsh; sessions keep the platform terminal tool')
+  } else if (initial.dialect === 'cmd') {
+    writeDiagnostic(`loaded with dialect=cmd; cmdPath=${initial.cmdPath || '(auto)'} codePage=${initial.cmdCodePage} confined=${initial.cmdConfinedPolicy}`)
+    sweepStaleScripts()
+  }
```

`src/index.ts:162` 的安装日志（cmd 分支下 `bashPath` 与 `cmdPath` 同值，打印哪个都行；显式选 `cmdPath` 是为了让日志读起来不自相矛盾）：

```diff
-        writeDiagnostic(`installed session=${id} bash=${result.bashPath}`)
+        const executable = result.cmdPath ?? result.bashPath
+        writeDiagnostic(`installed session=${id} dialect=${snapshotConfig(config).dialect} executable=${executable}`)
```

`InstallResult` 的类型变更（`src/replace.ts`）：

```diff
 export type InstallResult =
-  | { status: 'installed'; bashPath: string }
+  | { status: 'installed'; bashPath: string; cmdPath?: string }
   | { status: 'skipped'; reason: SkipReason; detail?: string }
```

客户端改动（约 90 行）：`shared/protocol.ts` 的 `Dialect` 加 `'cmd'`、`StateView` 加 `cmdPath`；`client/types.ts` 的 `dialect?: Dialect`；`client/store.ts` 的 `normalize` 与 `setDialect`；`client/row.tsx` 的 `dialectItems` 与条件渲染；`client/locales.ts` 新增 5 个键；`routes.ts` 的 state payload 带 `cmdPath`。

---

## 6 分工安排

### 6.1 角色与写作用域

| 阶段 | 负责人 | 写作用域（互斥） | 交付物 | 依赖 |
| --- | --- | --- | --- | --- |
| **P0 契约** | Lead | `src/cmd/types.ts`、`src/shared/protocol.ts`、`src/diag.ts` | `Dialect`/`CmdConfinedPolicy`/`CmdLocation`/`SkipReason` 四个类型定稿；`InstallResult` 增 `cmdPath?: string`（**不改名** `bashPath`） | 无 |
| **P1 传输 + 执行器** | `cmd-exec` | `src/cmd/script.ts`、`src/cmd/discover.ts`、`src/cmd/executor.ts` | 三个文件 + 单测（`scripts/cmdunittest.mjs`） | P0 |
| **P2 工具** | `cmd-tool` | `src/cmd/tool.ts`、`src/cmd/prompt.ts` | `cmd` 工具（三分支 schema、后台作业）+ `tool:cmd` 段落文案 | P0 |
| **P3 装配** | `cmd-wire` | `src/config.ts`、`src/replace.ts`、`src/index.ts`、`src/routes.ts`、`package.json`、`build.mjs` | 配置项、`installCmdSession`、依赖与 external | P0、P1、P2（可先按接口写） |
| **P4 客户端** | `cmd-ui` | `src/client/*`、`locale/*` | 第三选项、条件字段、文案 | P0 |
| **P5 测试** | `cmd-test` | `scripts/*.mjs`（新增文件） | 单测 + 集成矩阵（§7） | P1、P2、P3 |
| **P6 文档与发布** | Lead | `docs/*`、`README*`、`CHANGELOG.md` | DESIGN.md 增章、CHANGELOG 0.2.0、发布 | 全部 |

### 6.2 并行度与依赖图

```
P0 ──┬── P1 ──┐
     ├── P2 ──┼── P3 ── P5 ── P6
     └── P4 ──┘
```

- P1/P2/P4 完全可并行（写作用域不重叠）。
- P3 依赖 P1/P2 的导出符号，但可以先用 P0 定稿的接口写骨架，最后接线。
- P5 在 P3 之后做端到端；P1/P2 的自测可以在各自阶段内先跑。

### 6.3 完成定义（DoD）

| 阶段 | DoD |
| --- | --- |
| P0 | `npm run typecheck` 通过；类型无 `any`；`InstallResult` 增字段后全部调用点编译通过 |
| P1 | 单测覆盖：脚本渲染（`@echo off`/`chcp`/`cd` 守卫/无尾部 `exit /b`/无 BOM）、`scriptArgv`（返回裸名 + scratch cwd）、`planCmdLaunch` 四分支、`discoverCmd` 三步回退；`npm run typecheck` 通过 |
| P2 | 工具在无 jobs 服务时降级为前台模式；`output.schema` 三分支校验通过；`presentResult` 在 `value.kind === 'promoted'` 时正确；提示词段落注册成功；四个后台守卫都有对应用例 |
| P3 | 真机会话：`dialect=cmd` 新建会话出现 `cmd` 工具、`pwsh`/`bash` 消失、两个段落为空；`dialect=bash`/`pwsh` 行为零回归 |
| P4 | `clientsmoke` + `rowselftest` + `rendertest` 通过；切换方言后表单字段正确增减 |
| P5 | §7 矩阵全绿；`npm run check` 全绿 |
| P6 | DESIGN.md 有 cmd 章节；CHANGELOG 有 0.2.0 条目；README 有 cmd 用法与限制 |

### 6.4 协作纪律

1. **契约先行**：P0 定稿前，任何人不得改 `src/shared/protocol.ts`。
2. **写作用域互斥**：上表的文件前缀是硬边界；跨域修改必须先改任务板。
3. **不跑全量 `check`**：各自阶段只跑自己相关的脚本，P5/P6 跑全量。
4. **真实进程验证**：所有「能用」的结论必须来自真机 `cmd.exe` 执行，不接受推断。
5. **提交粒度**：每阶段一个提交，`feat(cmd): …` / `test(cmd): …` / `docs(cmd): …`。

---

## 7 测试矩阵

| ID | 用例 | 期望 |
| --- | --- | --- |
| T-BASIC | `echo hello` / `ver` / `whoami` | exit 0，stdout 含预期文本 |
| T-QUOTE | `echo "C:\Program Files\x.exe" arg` | 引号原样输出（脚本传输的核心价值） |
| T-VAR | `set X=abc` + `echo %X%`；`echo %PATH%` | `abc`；PATH 展开（与环境变量传输的关键差异） |
| T-OP | `echo a & echo b`；`dir /nonexistent \|\| echo recovered`；管道；`>` 重定向 | 各自正确；`\|\|` 分支执行 |
| T-MULTI | 多行命令；`if exist … ( … ) else ( … )`；`for /l %%i in (1,1,3) do echo %%i` | 全部正确执行 |
| T-EXIT | `exit /b 7`；`exit 9`；`cmd /c exit 3`；`dir /nonexistent` | 7；9；3；1 |
| T-ENC | `echo 中文测试`；`node -e "process.stdout.write('中文')"`；`chcp` | UTF-8 字节正确；`Active code page: 65001` |
| T-TIME | `ping -n 30 127.0.0.1` + `timeoutMs: 1000` | 超时后转后台作业；**无残留 PING.EXE**（Job Object 树杀） |
| T-ABORT | 长命令 + 中止 | 进程树全部终止，`aborted: true` |
| T-SBX | `cmdConfinedPolicy: escalate` + `workspace-write`：写工作区外文件 | `sandbox.denied: true`，`[sandbox: file access denied …]` 标记 |
| T-SBX-ENC | 受限模式下 `chcp` 与中文输出 | 记录结果；若失效则文档化限制 |
| T-BG | `run_in_background: true` + `ping -n 5` | 返回 `kind: 'background'` + `jobId`，`job_output` 可读 |
| T-WD | `workdir` 为不存在的目录 | 明确错误 `working directory does not exist` |
| T-WD-GONE | 校验通过后、执行前删掉 `workdir`（脚本内 `cd` 守卫） | exit 1 + stderr 含 `cannot enter the working directory`，**不得**在 scratch 目录静默执行 |
| T-PATH-META | `%TEMP%` 下建目录名为 `a&b (c) ^d ,e ;f` 的 scratch 目录 | 全部正常执行（裸名形态；绝对路径形态在此必失败） |
| T-ECHO-ON | 命令内 `echo on` 后再 `echo x` | 输出仍不含命令行追踪（`/q` 不可恢复，P1-3） |
| T-SBX-ESC | `sandbox_permissions: danger-full-access` + `justification`，用户批准后写工作区外文件 | `result.sandbox.mode === 'danger-full-access'` 且写入成功（**B3 的回归守卫**：审批静默失效时这里必红） |
| T-CFG | 切换 `dialect` 三值 | 新会话得到对应工具；旧会话不变 |
| T-UI | 设置行选择 cmd | 出现「cmd.exe 路径」「沙箱策略」，隐藏 bash 专属字段 |
| T-LIFE | 连续 50 次执行 | 脚本目录文件数不增长（`onProcessDone` 已删）；`sweepStaleScripts` 清掉人造的旧目录 |
| T-REGRESS | `dialect=bash` / `pwsh` / minimal 三模式 | 与 0.1.7 行为完全一致 |

---

## 8 风险与缓解

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | `%TEMP%` 含空格 | 脚本路径带空格 | 去掉 `/s`（D4）；T-BASIC 在含空格路径下复跑 |
| R2 | 脚本路径含元字符（`& ( ) ^ , ;`、配对 `%NAME%`） | 绝对路径形态必然失败 | **已消除**：传输层只有裸名形态（spawn cwd = scratch、脚本自己 `cd /d`），实测对全部元字符成功（§4.2.3、T-PATH-META） |
| R2b | 脚本内 `cd` 失败后命令在 scratch 目录执行 | 用户以为在工作区、实际在 `%TEMP%`，且可写 | 带守卫的 `cd`：失败即 `exit /b 1` 并写 stderr（§5.1、T-WD-GONE）。无守卫时实测 exit 0 静默执行，必须保留守卫 |
| R3 | 受限令牌下 `chcp` 失效 | 非 ASCII 命令乱码 | T-SBX-ENC 实测；失效则文档化并建议 `unconfined`。**开工门槛**：M1 出口必须给出该结论，失败则把 `cmdConfinedPolicy` 默认值改为 `unconfined` |
| R4 | 65001 下某些老程序崩溃 | 命令无法执行 | `cmdCodePage` 逃生口 + 加载警告 |
| R5 | `tool-bash` 被预设重新挂进 agent realm | `bash` 与 `cmd` 并存 | deny 列表动态取可见集（D6）；T-CFG 覆盖 minimal 预设。**注意**：`tools.restrict` 只能隐藏**全局/继承**的工具，作用域内注册（`agentCtx` 自身层）的工具隐藏不掉——所以官方 `bash`/`pwsh` 能被 deny，但若某个预设在自己 realm 里注册同名工具，仍可能并存。结论写「已缓解」而非「已解决」 |
| R6 | 脚本残留堆积 | `%TEMP%` 膨胀 | `onProcessDone` 删 + 24h 清扫 + `ctx.effect` 删目录；准备阶段超时另由 `finally` 兜底（P1-6） |
| R7 | 超时转后台后脚本被提前删 | 后台作业中途失败 | 只在 `onProcessDone` 删（D12）；`finally` 只在**未登记**时删 |
| R8 | 新增 3 个 peerDependency | 宿主版本不匹配时加载失败 | 与现有 `dsh-*` 同版本 `0.2.1-rc.2`，`engines.dsh` 已限定范围 |
| R9 | 工具描述与提示词段落写不清 | 模型写出 `$env:` 或 bash 语法 | `cmdDescription()` + `tool:cmd` 段落显式声明方言；T-BASIC 用模型真实调用验证 |
| R10 | zh-CN 系统下 cmd 的诊断文本是本地化中文 | `matchesSignature` 匹配英文签名永不命中，`sandbox.denied` 恒为 `false` | 沙箱**仍然生效**（拒绝是真实发生的），只是结果里缺 `denied` 标记。不伪造判定；`windows-acl` 的签名与语言无关，可覆盖文件类拒绝。T-SBX 需在中文系统上复核并记录 |
| R11 | `/q` 不可恢复 | 用户命令里 `echo on` 无法恢复回显 | 文档化（§4.2.2、`cmdDescription()`）；实测 `/q` 压过脚本内 `echo on`（T-ECHO-ON） |
| R12 | 审批字段写错导致升级静默失效 | 用户批准了更宽权限但命令仍受限 | 请求里 `sandboxPolicy` 必须是嵌套字段，禁止 `...policy` 展开（B3）；T-SBX-ESC 作为回归守卫 |

---

## 9 里程碑

| 里程碑 | 内容 | 出口 | 估算 |
| --- | --- | --- | --- |
| **M0** | P0 契约定稿 | 类型编译通过，评审通过 | 0.5 天 |
| **M1** | P1 + P2 + P4 并行完成 | 各自单测通过；T-SBX-ENC 已出结论 | 2 天 |
| **M2** | P3 接线完成 | 真机 `dialect=cmd` 会话可用 | 1 天 |
| **M3** | P5 测试矩阵全绿 | `npm run check` 通过 | 1.5 天 |
| **M4** | P6 文档 + `0.2.0` 发布 | npm 上 `0.2.0` 可见，tag 推送 | 0.5 天 |

合计约 5.5 个工作日（评审后较 v2 增加 0.5 天，用于 B1–B10 的返工与 T-SBX-ENC/T-SBX-ESC/T-WD-GONE/T-PATH-META 四条新用例）。工作量口径：新增约 1900 行、改动约 400 行。

---

## 10 待确认决策点

| # | 决策 | 本方案的选择 | 备选 |
| --- | --- | --- | --- |
| C1 | 工具名 | `cmd` | `shell`（与社区 `dsh-shell-select` 一致，但与 pwsh/bash 命名不齐） |
| C2 | 脚本尾部是否加 `exit /b %errorlevel%` | **不加**（与 bash 语义一致） | 加（严格取 ERRORLEVEL，但偏离跨 shell 惯例） |
| C3 | `cmdConfinedPolicy` 是否保留 `fail` | **不保留**（不可达） | 保留三态以与 bash 配置对齐 |
| C4 | `cmdCodePage` 是否保留 | **保留**（逃生口 + 加载警告） | 删除（唯一正确值就是 65001） |
| C5 | `%~dp0` 是否文本替换 | **不替换**，文档化 | 替换为 workdir（静默改写用户文本，风险更高） |
| C6 | `InstallResult.bashPath` 是否改名 `executable` | **本轮不改名**，只新增可选 `cmdPath` | 改名（波及 11 个文件，`src/preset.ts:110` 会写进生成的 preset 行，属独立重构） |
| C7 | 后台作业是否本轮做 | **做**（用户已决策） | 下一版 |
| C8 | cmd PTY | **不做**（N1） | 下一版 |

---

## 附录 A 实测证据索引

本轮 20 项探针的原始产物（含逐例 hex）：

- 报告：`%TEMP%\dsh-probe-cmd\REPORT.md`（23.6 KB，章节 1a–1h / 2 / 3 / 4 / 5 / 6 / 7）
- 脚本：`probe1.js` … `probe20.js` 及对应 JSON dump
- 环境：Node v24.19.0 / Windows 10.0.26300.9711 / zh-CN / 父进程控制台 CP 936

关键结论已在 §2.3 与 §4.2 引用；下列事实来自源码而非探针：

**本轮（v3 评审响应）新增的 6 项探针**，全部在 Node v24.19.0 / Windows 10.0.26300.9711 / zh-CN 上实跑。脚本已随本方案入库，可直接复现：

- `docs/probes/cmd-transport.mjs` —— 绝对路径 vs 裸名（P-A/P-B）、`/q` 与 `echo on`（P-C）、退出码语义（P-F）
- `docs/probes/cmd-cd-guard.mjs` —— `cd` 守卫（P-D）与无守卫（P-E）

```
node docs/probes/cmd-transport.mjs
node docs/probes/cmd-cd-guard.mjs
```

实测输出摘录（P-A/P-B，目录名逐例）：

| 探针 | 输入 | 结果 |
| --- | --- | --- |
| P-A 绝对路径形态 | `[cmd, '/d', '/q', '/c', absPath]`，scratch 目录名含 `&` / `(` / `)` / `^` / `,` / `;` / `%TEMP%` | **全部 exit 1 失败**；`!` 与空格正常 |
| P-B 裸名形态 | `cwd = 脚本目录`，argv `cmd-<uuid>.cmd`，同样 7 种目录名 | **全部 exit 0 成功**（含 `!`、空格、`x%TEMP%y`） |
| P-C `/q` 与 `echo on` | 脚本内 `echo on` 后再 `echo A` / `echo B` | `/q`：输出干净 `A\r\nB`；不加 `/q`：`echo on` 重新开启追踪，命令行原文回显 |
| P-D `cd` 守卫 | `cd /d "不存在" 2>nul \|\| (echo … 1>&2 & exit /b 1)` | exit 1，且**不继续执行**后续命令 |
| P-E 无守卫 | 同上但不加 `\|\|` 守卫 | **exit 0**，后续命令在 scratch 目录静默执行（危险） |
| P-F 退出码语义 | `exit /b 7` / `dir /nonexistent` / `dir /nonexistent` 后 `echo recovered` | 7 / 1 / **0**（证实不加尾部 `exit /b` 才与 bash 一致） |

踩坑记录：早期用 bash heredoc 写探针脚本时，`\\n` 经工具 JSON 解码后变成单反斜杠、JS 单引号字符串里又被当成换行，得到过一次错误的 `CD-FAIL` 结论；改用正斜杠路径重写后复测才正确。**教训：这类探针必须用文件写入而非 heredoc 内联**——`docs/probes/` 下的两个脚本就是修正后的版本。

v2 阶段的 20 项探针产物（含逐例 hex）仍在 `%TEMP%\dsh-probe-cmd\REPORT.md`（23.6 KB，章节 1a–1h / 2 / 3 / 4 / 5 / 6 / 7）与同目录 `probe1.js` … `probe20.js`，属临时产物、不入库；其结论已全部并入 §2.3 与 §4.2。

下列事实来自源码：

| 事实 | 位置 |
| --- | --- |
| 输出固定 UTF-8 解码 | `dsh-subprocess-local/lib/output.js:232` |
| 目标进程在 Job Object 内，终止杀整棵树 | `dsh-subprocess-local/lib/runner.js` `terminateOwnedJob()` → `terminateJob(api, job, 1)` |
| cmd 在受限令牌下可启动 | `dsh-sandbox-local/lib/index.js` 功能探针 `cmd /c exit 0` |
| windows-acl 只限写，不限读 | `dsh-sandbox-windows-acl/lib/types/index.d.ts` 模块注释 |
| 官方无 cmd 工具行 | `dsh-base/cordis.patch.yml:250-288` |
| `ShellDialect` 无 cmd | `dsh-terminal-bash/lib/types/config.d.ts` |
| `JobKindMap` 可声明合并 | `dsh-jobs/lib/types/view.d.ts:26` |
| 提示词 order 无 `TOOL_CMD` | `dsh-system-prompt` 的 `PromptSectionOrderName`（仅 `TOOL_BASH: 1000` / `TOOL_PWSH: 1010`） |
| `restrict` 在根 ctx 上抛错 | `dsh-tools/lib/index.js:2993`（"requires a scoped context (agent.ctx)"） |
| `isolate()` 不改 scope 键（子 ctx 段落仍可见） | `cordis/lib/index.js:1723` + `dsh-scope/lib/index.js:229/299/312` |
| `executeArgv` 准备阶段超时跳过 `onStarted` | `dsh-bash-local/lib/index.js`（`if (!preparationTimedOut) onStarted?.(proc)`） |

## 附录 B 源码定位表

| 主题 | 位置 |
| --- | --- |
| `defineTool` 定义 | `dsh-tools/lib/types/schema.d.ts:178-248` |
| `defineTool` 运行时（校验 + 渲染） | `dsh-tools/lib/index.js:838`、`:3637 createSuccessResult` |
| `tools.register` / `restrict` | `dsh-tools/lib/types/index.d.ts:637`、`:645` |
| 官方 `cmd` 工具的对照实现 | `dsh-tool-bash/lib/index.js:340-730`（`parameters` :495-530、`output.schema` :530-660、`execute` :655、`presentCall/presentResult` :711-712、`apply` 作业接线 :714-734） |
| 方言无关函数（可移植） | `dsh-tool-bash/lib/index.js:22-200` |
| `ShellExecutor` 契约 | `dsh-shell/lib/types/index.d.ts:47-70` |
| `LocalBashExecutor` 扩展点 | `dsh-bash-local/lib/types/index.d.ts`（`executeArgv`、`onProcessDone`） |
| `SandboxProvider.confine` | `dsh-sandbox/lib/types/index.d.ts:118` |
| `SandboxPolicyService` | `dsh-sandbox-policy/lib/types/index.d.ts:71` |
| `JobRegistry` | `dsh-jobs/lib/types/index.d.ts:59` |
| 本项目现有 bash 实现（对照） | `src/executor.ts`、`src/confined.ts`、`src/replace.ts` |
