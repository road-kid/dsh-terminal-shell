# 设计与实施单：CMD 终端方言（v2）

| 项 | 值 |
| --- | --- |
| 状态 | **方案待评审（未开工）** |
| 目标版本 | `0.2.0`（直接正式版，不打 rc） |
| 基线 | DSH `0.2.1-rc.2`；本插件 `dsh-terminal-shell@0.1.7`，HEAD `3aad227`，已发布 npm |
| 关联 | M1 `confinedPolicy`（`docs/PLAN-confined-bash.md`）、M2 极简模式（`docs/PLAN-minimal-mode.md`）、架构总述 `docs/DESIGN.md` |
| 取代 | 本文件 v1（2026-10-24，基线 `dsh-terminal-tool@0.5.1` / HEAD `80ee65b`） |

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
5. **代码量约 1750 行新增 + 约 350 行改动**，其中 `src/cmd/tool.ts`（约 470 行）是最大单件——因为官方 `tool-bash` 只导出 `{Config, apply, inject, name}`，工具定义不可复用，必须用 `defineTool` 重写一份。

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

### 4.2 传输层：临时 `.cmd` 脚本（唯一传输）

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
<用户命令原文，CRLF 归一化>
```

- **无 `cd` 行**：子进程 `cwd` 直接就是 `spec.workdir`，由 spawn 完成，天然支持跨盘符。
- **无尾部 `exit /b %errorlevel%`**：见 D11。
- **UTF-8 无 BOM + CRLF**：BOM 会让首个 token 变成 `\uFEFF@echo` 从而 `@echo off` 失效（探针 1f）。
- 文件路径 `%TEMP%\dsh-cmd-<pid>-<8位随机>\cmd-<uuid>.cmd`，**每次执行一个文件**。

#### 4.2.3 argv 形态

```ts
// 主形态：绝对路径，不带 /s
[cmdPath, '/d', '/q', '/c', scriptPath]

// 退化形态：脚本路径含 '%'（cmd 在打开文件前会展开它，所有直接形式都失败）
// 此时 spawn 的 cwd 改为脚本目录，argv 只给裸文件名，脚本内改用 cd /d 进入 workdir
[cmdPath, '/d', '/q', '/c', basename(scriptPath)]
```

- `/d`：跳过 AutoRun 注册表命令，保证确定性。
- `/q`：关闭命令回显（等价且强于 `@echo off`，不受 BOM 与用户 `echo on` 影响）。
- **不带 `/s`**：见 D4。

#### 4.2.4 生命周期

| 时刻 | 动作 |
| --- | --- |
| `execute()` 入口 | `materializeCmd()` 落盘；`scripts.set(process, script)` 在 `onStarted` 回调里登记 |
| 进程结束（含超时转后台后结束） | `onProcessDone` 里 `script.dispose()`，从 Map 删除 |
| `execute()` 抛错（spawn 失败等） | `catch` 里立即 `dispose()` |
| 执行器销毁 | `ctx.effect` 里 `rmSync(scratchDir, { recursive: true, force: true })` |
| 宿主异常退出 | 加载时 `sweepStaleScripts()` 清理 `mtime` 超过 24h 的 `dsh-cmd-*` 目录 |

### 4.3 执行器 `CmdExecutor`

继承 `LocalBashExecutor`，只覆盖三处（与现有 `GitBashExecutor` 同构）：

| 成员 | 作用 |
| --- | --- |
| `override resolve(request)` | 注入 `extraPath` 到 `PATH`、`PYTHONIOENCODING=utf-8`（`pythonUtf8` 时）、补 `sandboxPolicy` |
| `override async execute(spec)` | 生成脚本 → 决定 launch → `executeArgv` → 装饰 `result.sandbox` |
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

### 4.4 工具 `cmd`

因为官方 `tool-bash` 只导出 `{Config, apply, inject, name}`，且工具名硬编码，必须用 `defineTool` 重写。`src/cmd/tool.ts` 的结构：

**可原样移植的方言无关函数**（来自 `dsh-tool-bash/lib/index.js:22-200`，加一行出处注释即可）：

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
| `description` | `cmdDescription()`：cmd.exe 方言、`C:\` 原生路径、`%VAR%`、`/` 开关、无持久状态、`%~dp0` 无意义、非 ASCII 取决于代码页 |
| 提示词段落 | `tool:cmd`，order `getSectionOrder('TOOL_PWSH') ?? 1010` |
| 作业 kind | `'bash'` → `'cmd'`（并 `declare module` 合并 `JobKindMap`） |
| `validateBashArgs` | 改名为 `validateCmdArgs`，逻辑不变（`command`/`description` 非空、`timeoutMs` 有限正数、`sandbox_permissions` 与当前模式相等时直接放行，否则 `validateEscalationArgs`） |
| `presentCall` / `presentResult` | 卡片标题改 `cmd`；`parseExitStatus` 逻辑不变 |

`output.schema` 三分支（`background` / `promoted` / `foreground`）与官方**逐字一致**（含 `additionalProperties: false` 与 `required: true` 的位置），这样 `render`/`presentResult` 才能共用。

### 4.5 沙箱

| 策略值 | 行为 | 何时用 |
| --- | --- | --- |
| `escalate`（默认） | 受限策略下走 `ctx.sandbox.confine()`；`danger-full-access` 下直跑 | 默认；cmd 能受限，所以默认走真沙箱 |
| `unconfined` | 永远直跑，`result.sandbox.mode` 报 `danger-full-access`，`sandboxMode` getter 返回 `undefined`（不广告 `sandbox_permissions`） | 用户显式要求绕过（老程序与受限令牌冲突时） |

**进程树终止**：`dsh-subprocess-local` 的 Windows runner 用 `spawnCurrentTokenJobProcess` 把目标进程放进 Job Object，终止时 `terminateJob(api, job, 1)` 杀整棵树。⇒ 超时/中止**不需要**额外实现，探针里「裸 `child.kill()` 孙进程存活」的问题在 DSH 链路里不存在（D10）。

**受限沙箱下脚本可读**：windows-acl 后端「只限制写，不限制读、网络、进程可见性」，脚本在 `%TEMP%` 只需读权限；runner 虽把子进程的 `TMP`/`TEMP` 重写到私有临时目录，但脚本路径是绝对路径，不受影响。

### 4.6 编码

三层事实决定设计：

1. 宿主**固定**按 UTF-8 解码：`dsh-subprocess-local/lib/output.js:232` `text: Buffer.concat(this.chunks).toString("utf8")`。
2. `chcp 65001` 后，cmd 用 UTF-8 读取**后续脚本行**、用 UTF-8 编码内置命令输出、用 UTF-8 生成子进程 argv；原生工具在 CP 65001 下回退到 ASCII 英文而**不是** GBK（探针 2）。
3. `chcp` 不跨调用泄漏（每次新进程），并发命令互不干扰。

⇒ `cmdCodePage` 默认 `65001`。设为其它值时：脚本仍以 UTF-8 落盘（Node 无 GBK 编码器），`chcp` 改成该值，输出会变成替换字符——**只用于「某些老程序在 65001 下会崩」的逃生场景**，加载时写一条诊断警告。工具描述里明确：非 ASCII 输出要求 65001。

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

---

## 5 专业正确代码实现

> 约定：相对导入带 `.ts` 后缀（项目既有风格，Node 原生 TS 解析）；`@deepseek-ai/*` 全部外部化。

### 5.1 `src/cmd/script.ts`（新增，约 120 行）

```ts
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
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
   * Directory to enter inside the script.
   *
   * Only used by the `%`-in-path fallback, where the script cannot be addressed
   * by path on the command line. `%` is doubled because cmd expands the script
   * line before executing it.
   */
  readonly chdir?: string
}

/** Normalize any line ending to CRLF, which is what cmd expects. */
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
 * `@echo off` suppresses command tracing; `/q` on the command line already does
 * the same, but keeping both means a user command that turns echoing back on
 * still cannot corrupt the transcript of the *transport* lines.
 *
 * No trailing `exit /b %errorlevel%`: cmd's direct form (`/c <file>`) exits with
 * the success flag of the last command, which is what every other shell does.
 * A trailing `exit /b` would switch to the ERRORLEVEL variable instead, so
 * `dir /nonexistent` followed by `echo recovered` would report 1 where bash
 * reports 0.
 */
export function renderCmdScript(command: string, options: CmdScriptOptions): string {
  const lines: string[] = ['@echo off', `chcp ${options.codePage}>nul`]
  if (options.chdir !== undefined) {
    // `pushd` handles UNC shares, which `cd /d` cannot enter.
    const verb = options.chdir.startsWith('\\\\') ? 'pushd' : 'cd /d'
    lines.push(`${verb} "${escapeBatchPath(options.chdir)}"`)
  }
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
 * Command line for `cmd.exe`.
 *
 * `/s` is deliberately absent. With `/s`, cmd strips the outermost quote pair of
 * the remainder, which destroys the quotes libuv adds around a path containing
 * spaces (`%TEMP%\John Doe\...` → `'C:\Users\John' 不是内部或外部命令`). Without
 * `/s`, cmd's default rule keeps an exactly-two-quote, whitespace-separated,
 * quoted argument intact, so both spaced and unspaced paths work.
 *
 * A `%` anywhere in the path is expanded by cmd *before* it opens the file, for
 * every direct form. The fallback therefore passes a bare name, which the child
 * resolves against its own working directory (the scratch directory), and the
 * script enters the real workdir itself.
 */
export function cmdArgv(cmdPath: string, scriptPath: string): string[] {
  if (scriptPath.includes('%')) return [cmdPath, '/d', '/q', '/c', basename(scriptPath)]
  return [cmdPath, '/d', '/q', '/c', scriptPath]
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
import { cmdArgv, ensureScratchDir, materializeCmd, type CmdScript } from './script.ts'

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
  static inject = ['subprocess'] as const

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
    // The script is spawned with the command's working directory, so a missing
    // directory would surface as a spawn failure with a confusing ENOENT on the
    // script rather than on the directory.
    assertDirectory(spec.workdir, 'working directory')

    const script = materializeCmd(this.scratch, spec.command, { codePage: this.codePage })
    const sandbox = this.sandbox
    const policy = spec.sandboxPolicy
    const plan = planCmdLaunch(sandbox !== undefined, policy?.mode, this.confinedPolicy)

    try {
      if (plan.kind === 'direct') {
        const facts = { mode: plan.mode, denied: false } as const
        const execution = await this.executeArgv(
          spec,
          cmdArgv(this.cmdPath, script.path),
          (process) => {
            this.scripts.set(process, script)
          },
        )
        return decorateResult(execution, (result) => ({ ...result, sandbox: facts }))
      }

      if (sandbox === undefined || policy === undefined || policy.mode === 'danger-full-access') {
        throw new Error('cmd-executor: confined launch without a confined sandbox policy')
      }
      const confinedPolicy: SandboxPolicy = { ...policy, mode: plan.mode }
      const argv = cmdArgv(this.cmdPath, script.path)
      let confined: ConfinedArgv | undefined
      const execution = await this.executeArgv(
        spec,
        async (signal) => {
          const prepared = await sandbox.confine(argv, confinedPolicy, signal)
          signal.throwIfAborted()
          confined = prepared
          return prepared.argv
        },
        (process) => {
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
    } catch (error) {
      script.dispose()
      throw error
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

### 5.4 `src/cmd/tool.ts`（新增，约 470 行）

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
import type { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { Agent } from '@deepseek-ai/dsh-agent'

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
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv', 'workingDirectory'] as const

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

  const cmdTool = (registry: JobRegistry | undefined) =>
    defineTool({
      name: 'cmd',
      description: cmdDescription(),
      parameters: {
        description: { type: 'string', required: true, description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI).' },
        command: { type: 'string', required: true, description: 'The cmd.exe command to execute.' },
        timeoutMs: { type: 'number', description: promoteOnTimeout ? '…moves to the background as a job instead of being killed.' : '…kills the command on expiry.' },
        workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
        ...(backgroundEnabled ? { run_in_background: { type: 'boolean', description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.' } } : {}),
        ...(escalationModes.length > 0 ? {
          sandbox_permissions: { type: 'string', enum: [...escalationModes], description: sandboxPermissionsDescription('command') },
          justification: { type: 'string', description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.' },
        } : {}),
      },
      // output.schema / render / presentationMeta / presentCall / presentResult：
      // 与官方 bash 工具逐字一致，只把卡片标题换成 cmd（见 §4.4 表）。
      output: { /* 三分支 oneOf，见下 */ },
      async execute(args, exec) { /* 见下 */ },
    })

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

  // 提示词段落**不在这里注册**：工具插件挂在 `agentCtx.isolate('shell')` 的子 ctx 上，
  // 而段落对 agent 的可见性由 agent 层决定（现有实现正是把 `tool:pwsh` 的压空注册在
  // `agentCtx` 上）。因此 `tool:cmd` 段落由 `replace.ts` 的 `installCmdSession` 在
  // `agentCtx` 上注册，文案从 `src/cmd/prompt.ts` 导出。
}
```

`CMD_PROMPT_SECTION`（`src/cmd/prompt.ts` 导出，新增，约 10 行）——由 `installCmdSession` 在 `agentCtx` 上以 `name: 'tool:cmd'`、`order: getSectionOrder('TOOL_PWSH') ?? 1010` 注册：

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

`execute()` 的核心（与官方同构，差异标注）：

```ts
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
  const request = {
    command: args.command,
    ...(workdir !== undefined ? { workdir } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    dshEnv: ctx.shellEnv.collect(exec),
    ...policy,
  }

  if (registry !== undefined && args.run_in_background === true) {
    const spec = ctx.shell.resolve({ ...request, onExpiry: 'none' })
    const attached = startJob(registry, args, exec, spec)   // kind: 'cmd'
    return { kind: 'background', jobId: attached.id, cwd: spec.workdir }
  }

  const spec = ctx.shell.resolve({ ...request, signal: exec.signal })
  if (registry !== undefined && promoteOnTimeout) {
    const attached = startJob(registry, args, exec, { ...spec, onExpiry: 'none' })
    const promoted = await waitOnJob(registry, attached, spec.timeoutMs, exec.signal)
    if (promoted !== undefined) return promoted
  }
  const process = await ctx.shell.execute(spec)
  const result = await process.result()
  if (result.aborted) throw toolAborted()
  const stopped = attached?.stopped()
  return { kind: 'foreground', ...canonicalResult(result, spec.workdir), ...(stopped !== undefined ? { stopped } : {}) }
}
```

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

当前 `:83` 的方言闸门改为三分支，并抽出 bash 专属路径：

```diff
-  if (snapshot.dialect !== 'bash') {
-    return { status: 'skipped', reason: skip(id, 'dialect-pwsh') }
-  }
+  if (snapshot.dialect === 'pwsh') {
+    return { status: 'skipped', reason: skip(id, 'dialect-pwsh') }
+  }
+  if (snapshot.dialect === 'cmd') {
+    return installCmdSession(ctx, agent, agentCtx, snapshot)
+  }
```

`installCmdSession`（新增，约 110 行，与 bash 版本同构）：

```ts
async function installCmdSession(
  ctx: Context,
  agent: Agent,
  agentCtx: Context,
  snapshot: ConfigSnapshot,
): Promise<InstallResult> {
  const id = String(agent.id)
  const tools = optional<ToolRegistry>(ctx, 'tools')
  const systemPrompt = optional<SystemPromptService>(ctx, 'systemPrompt')
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
          undo.push(systemPrompt.section({ name: section, order: systemPrompt.getSectionOrder(name === 'pwsh' ? 'TOOL_PWSH' : 'TOOL_BASH') ?? (name === 'pwsh' ? TOOL_PWSH_ORDER : TOOL_BASH_ORDER), text: '' }))
        } catch (error) {
          warn(id, `could not blank the ${section} prompt section: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } else {
      warn(id, 'no inherited shell tool to hide; leaving the inherited tool list alone')
    }

    // `tool:cmd` 段落注册在 agent 层：与 `tool:pwsh`/`tool:bash` 的压空同一个作用域，
    // 这样模型看到的是「三个 shell 工具里恰好一个」的提示词面。
    undo.push(
      systemPrompt.section({
        name: 'tool:cmd',
        order: systemPrompt.getSectionOrder('TOOL_PWSH') ?? TOOL_PWSH_ORDER,
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
    return { status: 'installed', bashPath: found.path }
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

`InstallResult` 的 `installed` 分支复用 `bashPath` 字段（语义为「被挂载的执行器路径」），或改为 `executable: string`——**建议改名为 `executable`**，同时更新 `src/index.ts:162` 的日志与 `src/routes.ts` 的 `lastReplace`。

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

客户端改动（约 90 行）：`shared/protocol.ts` 的 `Dialect` 加 `'cmd'`、`StateView` 加 `cmdPath`；`client/types.ts` 的 `dialect?: Dialect`；`client/store.ts` 的 `normalize` 与 `setDialect`；`client/row.tsx` 的 `dialectItems` 与条件渲染；`client/locales.ts` 新增 5 个键；`routes.ts` 的 state payload 带 `cmdPath`。

---

## 6 分工安排

### 6.1 角色与写作用域

| 阶段 | 负责人 | 写作用域（互斥） | 交付物 | 依赖 |
| --- | --- | --- | --- | --- |
| **P0 契约** | Lead | `src/cmd/types.ts`、`src/shared/protocol.ts`、`src/diag.ts` | `Dialect`/`CmdConfinedPolicy`/`CmdLocation`/`SkipReason` 四个类型定稿；`InstallResult.executable` 改名 | 无 |
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
| P0 | `npm run typecheck` 通过；类型无 `any`；`InstallResult` 改名影响点全部编译通过 |
| P1 | 单测覆盖：脚本渲染（CRLF/无 BOM/`%` 转义/`chdir`）、`cmdArgv`（含 `%` 退化）、`planCmdLaunch` 四分支、`discoverCmd` 三步回退；`npm run typecheck` 通过 |
| P2 | 工具在无 jobs 服务时降级为前台模式；`output.schema` 三分支校验通过；`presentResult` 在 `value.kind === 'promoted'` 时正确；提示词段落注册成功 |
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
| T-CFG | 切换 `dialect` 三值 | 新会话得到对应工具；旧会话不变 |
| T-UI | 设置行选择 cmd | 出现「cmd.exe 路径」「沙箱策略」，隐藏 bash 专属字段 |
| T-LIFE | 连续 50 次执行 | 脚本目录文件数不增长（`onProcessDone` 已删）；`sweepStaleScripts` 清掉人造的旧目录 |
| T-REGRESS | `dialect=bash` / `pwsh` / minimal 三模式 | 与 0.1.7 行为完全一致 |

---

## 8 风险与缓解

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| R1 | `%TEMP%` 含空格 | 脚本路径带空格 | 去掉 `/s`（D4）；T-BASIC 在含空格路径下复跑 |
| R2 | 脚本路径含 `%` | 所有直接形式失败 | `cmdArgv` 退化为裸文件名 + 脚本内 `cd /d`（§5.1） |
| R3 | 受限令牌下 `chcp` 失效 | 非 ASCII 命令乱码 | T-SBX-ENC 实测；失效则文档化并建议 `unconfined` |
| R4 | 65001 下某些老程序崩溃 | 命令无法执行 | `cmdCodePage` 逃生口 + 加载警告 |
| R5 | `tool-bash` 被预设重新挂进 agent realm | `bash` 与 `cmd` 并存 | deny 列表动态取可见集（D6）；T-CFG 覆盖 minimal 预设 |
| R6 | 脚本残留堆积 | `%TEMP%` 膨胀 | `onProcessDone` 删 + 24h 清扫 + `ctx.effect` 删目录 |
| R7 | 超时转后台后脚本被提前删 | 后台作业中途失败 | 只在 `onProcessDone` 删（D12） |
| R8 | 新增 3 个 peerDependency | 宿主版本不匹配时加载失败 | 与现有 `dsh-*` 同版本 `0.2.1-rc.2`，`engines.dsh` 已限定范围 |
| R9 | 工具描述与提示词段落写不清 | 模型写出 `$env:` 或 bash 语法 | `cmdDescription()` + `tool:cmd` 段落显式声明方言；T-BASIC 用模型真实调用验证 |

---

## 9 里程碑

| 里程碑 | 内容 | 出口 |
| --- | --- | --- |
| **M0** | P0 契约定稿 | 类型编译通过，评审通过 |
| **M1** | P1 + P2 + P4 并行完成 | 各自单测通过 |
| **M2** | P3 接线完成 | 真机 `dialect=cmd` 会话可用 |
| **M3** | P5 测试矩阵全绿 | `npm run check` 通过 |
| **M4** | P6 文档 + `0.2.0` 发布 | npm 上 `0.2.0` 可见，tag 推送 |

---

## 10 待确认决策点

| # | 决策 | 本方案的选择 | 备选 |
| --- | --- | --- | --- |
| C1 | 工具名 | `cmd` | `shell`（与社区 `dsh-shell-select` 一致，但与 pwsh/bash 命名不齐） |
| C2 | 脚本尾部是否加 `exit /b %errorlevel%` | **不加**（与 bash 语义一致） | 加（严格取 ERRORLEVEL，但偏离跨 shell 惯例） |
| C3 | `cmdConfinedPolicy` 是否保留 `fail` | **不保留**（不可达） | 保留三态以与 bash 配置对齐 |
| C4 | `cmdCodePage` 是否保留 | **保留**（逃生口 + 加载警告） | 删除（唯一正确值就是 65001） |
| C5 | `%~dp0` 是否文本替换 | **不替换**，文档化 | 替换为 workdir（静默改写用户文本，风险更高） |
| C6 | `InstallResult.bashPath` 是否改名 `executable` | **改名** | 保留旧名（语义错位） |
| C7 | 后台作业是否本轮做 | **做**（用户已决策） | 下一版 |
| C8 | cmd PTY | **不做**（N1） | 下一版 |

---

## 附录 A 实测证据索引

本轮 20 项探针的原始产物（含逐例 hex）：

- 报告：`%TEMP%\dsh-probe-cmd\REPORT.md`（23.6 KB，章节 1a–1h / 2 / 3 / 4 / 5 / 6 / 7）
- 脚本：`probe1.js` … `probe20.js` 及对应 JSON dump
- 环境：Node v24.19.0 / Windows 10.0.26300.9711 / zh-CN / 父进程控制台 CP 936

关键结论已在 §2.3 与 §4.2 引用；下列事实来自源码而非探针：

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
