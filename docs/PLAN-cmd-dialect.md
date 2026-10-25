# 设计与实施单：终端选项新增 CMD（`cmd.exe`）方言

- 状态：**方案评审中（未开工）**——本文档只做方案、分工与验收约定，不改任何源码
- 目标版本：`0.6.0`
- 关联：M1 受限沙箱策略 `confinedPolicy`（`0.4.1`，commit `2946e3b`）、M2 极简模式（`0.5.1`）
- 基线事实：DSH `0.2.1-rc.2`；本插件 `0.5.1`，方案撰写时 HEAD `80ee65b`，工作区干净
  （`git status` 无改动，另有历史 stash `stash@{0}: On main: restore-deleted-sources` 与本方案无关）；
  本文档随后单独提交，不含任何源码改动
- 参照文档：`docs/DESIGN.md`（架构）、`docs/PLAN-confined-bash.md`（M1）、`docs/PLAN-minimal-mode.md`（M2）

---

## 0. 结论摘要

1. **官方支持要分两层看**：模型可调用的**工具层不支持** cmd（DSH 只发 `bash` / `pwsh` 两个 shell 工具，
   由 `dsh-base` 按平台互斥启用；npm 上 `dsh-tool-cmd` / `dsh-cmd-local` / `dsh-terminal-cmd` /
   `cmd-sandbox` 全部 404）。但**交互式 Web 终端层支持 cmd，且是 Windows 默认**
   （`dsh-api-terminal-controller` 用 `environment.defaultShell ?? "cmd.exe"`，候选表含 `cmd`，
   默认 shell 来自 `process.env.ComSpec`）。那是给人用的 PTY，不是模型工具，所以不构成本插件要补的缺口。
2. **社区有三个插件把 cmd.exe 交给模型，但没有一个可被依赖复用**：`dsh-shell-select`（MIT）、
   `@mzzsfy/dsh-shell-select`、`@qianwenxue1/dsh-shell` 都做到了「用户选 shell，其中含 cmd」，
   并且 `dsh-shell-select` 明确记录**cmd.exe 与 PowerShell 5.1 可以通过沙箱约束**（Git Bash / WSL 不行）。
   但三者都是**整包接管**（替换 `ctx.shell` / 自带工具），不是可嵌入的库，只能作设计参照。
   它们还共同暴露了一条**最重要的架构约束**——**预设会在每个 agent 的 realm 里重新挂载
   `tool-pwsh`/`tool-bash`，任何 `cordis.patch.yml` 都够不到**，所以它们不得不另加「全局工具守卫」
   或运行时 `entry.update` 来压制。本插件现有的「按会话在 `agent/created` 里装配」路线天然绕开了这个坑，
   本方案沿用（详见 §2.4）。
3. **本插件的技术路线（三条决定）**：
   - **传输层用「临时 `.cmd` 脚本文件」**。实测证明：DSH 的 spawn 接缝只接受 argv 数组，
     而 Node 对含引号的 argv 会插入 `\"`，`cmd.exe` 不认识——直接 argv 传命令**必然破相**；
     写成 `.cmd` 文件后引号、`%VAR%` 展开、多行、`exit /b N` 退出码、`chcp 65001` 全部正常。
   - **工具用自研 `cmd` 定义（`defineTool`）**。官方 `bash` 工具的工厂函数没有导出，
     且「挂载官方工具再改名」在 cordis 里走不通（详见 §3.2）：工具注册落在 agent 自己的层，
     `restrict` 只能过滤继承面，改不掉自己的层。
   - **执行器 `CmdExecutor extends LocalBashExecutor`**，照抄现有 `GitBashExecutor` 的沙箱分支结构，
     复用本项目 `confined.ts` 的 `planLaunch` 与 `decorateResult`。
4. **顺带拿到一个安全收益**：cmd 是 Windows 上少数「原生可用 + 可被受限令牌约束」的 shell。
   现有 `dialect: bash` 因为 MSYS2 在受限令牌下起不来，默认 `confinedPolicy: unconfined`（**绕过文件沙箱**）；
   cmd 方言可以把默认值改成 `escalate`，让沙箱重新生效。
5. **明确不做**：cmd 的**持久终端（PTY）方言**（官方 `dsh-terminal-bash` 的 `ShellDialect` 只有
   `'bash' | 'pwsh'`，且 cmd 没有 OSC-133 提示符标记机制，见 §2.1）；不发布独立的
   `dsh-tool-cmd` / `dsh-cmd-sandbox` 包；不接管 `run_code`、子代理、PTY 等不经 `ctx.shell` 的路径。

---

## 1. 目标与非目标

### 1.1 目标

| 编号 | 目标 | 验收方式 |
|---|---|---|
| G1 | 设置页「终端类型」新增第三项 **CMD（cmd.exe）**，写入 `dialect: cmd` | 行内下拉可见、可保存、重载后保持 |
| G2 | 选中后新会话的模型可见工具从 `pwsh` 换成 `cmd`，`pwsh` 与其提示词段落一起消失 | 集成测试断言工具清单与提示词 |
| G3 | `cmd` 工具能正确执行：引号、`%VAR%`、`&`/`&&`/`\|\|`、多行、中文输出、退出码 | 契约测试矩阵（§7） |
| G4 | cmd 方言下默认走沙箱（`confinedPolicy: escalate`），越界写被拒并如实上报 | 受限档位下写工作区外文件被拒 |
| G5 | 失败可解释：找不到 cmd.exe、脚本写不出、沙箱不可用都有独立 skip 原因 | `src/diag.ts` 新增原因 + 单测 |
| G6 | 文档、locale（中/英）、README、CHANGELOG 同步 | 评审 |

### 1.2 非目标

- N1 **不做 cmd 持久终端**：`dsh-terminal-bash` 无 cmd 方言；cmd 没有 OSC-133 等价物，
  官方 `PWSH_PROMPT_SETUP`（`dsh-terminal-bash/lib/index.js:963`）无法平移。
- N2 **不改官方包**、不 fork、不发布 `@deepseek-ai/dsh-tool-cmd`。
- N3 **不动交互式 Web 终端**（`dsh-api-terminal-controller`）：本机 profile 已把它覆盖成 Git Bash，
  那是另一条链路，与模型工具无关。
- N4 **不做 cmd 的「一次性 + 后台作业」之外的新能力**（无持久 shell、无会话内状态保持）。

---

## 2. 调研结论

### 2.1 DSH 官方对 cmd 的支持

| 子系统 | 是否支持 cmd | 证据 |
|---|---|---|
| 模型工具（`ctx.tools`） | **否** | `dsh-base/cordis.patch.yml:250-288` 只有 `bash-sandbox`/`pwsh-sandbox`/`tool-bash`/`tool-pwsh` 四行，用 `disabled: !!js process.platform === 'win32'`（bash 系）与 `!== 'win32'`（pwsh 系）互斥启用；没有第三行 |
| 官方包 | **不存在** | 安装内 307 个 `@deepseek-ai/*` 包、项目内 48 个包均无 `dsh-tool-cmd`/`dsh-cmd-local`/`cmd-sandbox`；npm registry 对这四个名字全部 404（对照组 `dsh-tool-pwsh`/`dsh-bash-local` 为 200） |
| shell 服务契约 | **方言无关，可扩展** | `dsh-shell` 的 `ShellExecutor` 是抽象类（`resolve` / `execute` / `sandboxMode`），文档明说「子类化后作为插件加载即注册为 `ctx.shell`」，一个上下文只能有一个实现 |
| 持久终端后端 | **否** | `dsh-terminal-bash/lib/types/config.d.ts`：`export type ShellDialect = 'bash' \| 'pwsh'` |
| **交互式 Web 终端** | **是，且为 Windows 默认** | `dsh-api-terminal-controller/lib/index.js:18` `shell = profile(environment.defaultShell ?? (environment.platform === "windows" ? "cmd.exe" : "/bin/sh"))`；`:31` `args: kind === "cmd" ? [] : …`；Config 里 `shellCandidates` 默认含 `"cmd"`；默认值由 `dsh-subprocess-local/lib/index.js:1610-1616` 的 `terminalEnvironment()` 从 `process.env.ComSpec` 提供 |

**结论**：官方在「人能敲命令」的地方给了 cmd，在「模型能敲命令」的地方只给了 pwsh。
本插件要补的正是后者，与现有 `dialect: bash` 的定位完全一致。

### 2.2 社区现状

| 插件 | 版本 / 月下载 | cmd 支持 | 可借鉴 / 不可用的原因 |
|---|---|---|---|
| **`dsh-shell-select`**（`athif23`，MIT） | `0.1.0` / 97 | 支持，且**沙箱约束已验证** | 最接近的同题解。**只给模型一个 `shell` 工具**，shell 由设置决定；把选择结果直接做成 `ctx.shell`；**无法被当前权限档约束的 shell 直接拒绝执行**（与我们的 `unconfined` 默认相反）；「不新增任何执行机制」，截止/上限/后台/沙箱全部沿用官方。README 记录两条 cmd 坑：「命令一次性到达 cmd.exe，所以 `%NAME%` 保持字面量，需要展开时写 `call echo %CD%`」「非 ASCII 输出取决于控制台代码页，可能变成替换字符」——**正是本方案 §3.1/§3.5 要解决的**。注意：其 `peerDependencies` 只到 dsh `0.1.x`，在 `0.2.1-rc.2` 上需 `allow-version` 豁免才能装 |
| **`@mzzsfy/dsh-shell-select`** | `0.4.5` / 578 | 支持 | 三个里维护最活跃（一个月 9 个版本）。**不静态 disable 官方行**：先让官方 pwsh 链路正常启动，运行时用 `entry.update` 关掉 `pwsh-sandbox`/`tool-pwsh`（仅内存），再挂自己的执行器，并用 `system-prompt/assemble` 投影隐藏 pwsh；**接管失败自动回退官方 pwsh 链路**。这套「先保底、再接管、可回退」值得借鉴（我们的 `replace.ts:170`「先验证后隐藏」同源） |
| **`@qianwenxue1/dsh-shell`** | `0.1.0` / 27 | 支持，默认就是 cmd | 自己注册 `shell_exec` + `shell_job_status` 两个工具（**不改名官方工具**），默认 `cmd.exe /d /s /c`，PowerShell 兜底。安全契约齐全：持久 cwd、超时、头尾截断、`exit_code/timed_out/truncated`、后台 `job_id`、命令 denylist、cwd allowlist。单版本、无 UI、无维护，**但「自研工具 + 不改官方工具名」的路线与本方案一致**，其安全契约清单可直接对照 |
| `drscrewdriver/dsh-bash-terminal-ts` | `0.8.3` / 6545 | 仅兜底 | 候选链 `pwsh → powershell.exe → cmd.exe`，说明社区把 cmd 当最低保证；主能力是 Git Bash，无 cmd |
| `KannaKuron/dsh-gitbash-shell` | `0.43.2` / 11860 | 否 | 本插件的直接竞品（Git Bash 接管），**不提供 cmd**——这正是本方案的差异空间 |
| `xswt442-cmd/dsh-unsandboxed-winbash` | `0.4.1` / 886 | 否 | 明确承认「Git Bash 在受限令牌下起不来，所以绕开沙箱」——反向印证 §3.4 的判断 |

另有十余个只提供 **UI 终端面板**（`cmd.exe` 作默认 PTY）的插件，例如 `dsh-terminal`（892/月）、
`dsh-single-terminal`、`dsh-terminal-panel`（314/月，另带九个 `terminal_*` 工具）、`dsh-oh-my-terminal`，
它们与本插件不冲突（不同子系统，见 §2.1 最后一行）。

**结论**：社区已有 cmd 能力，但**没有**任何插件把 cmd 做成「可被本插件复用的工具包」；
且它们的 cmd 实现都受制于同一个 argv 接缝限制。本方案在传输层比现有实现更进一步
（用脚本文件换取完整语义），这是本插件相对社区的差异点。

### 2.3 本机实测（决定实现的关键证据）

在 Node v24.19.0 上，经 `spawnSync`（含 `windowsHide: true`，与 DSH 子进程路径接近）逐项验证：

| 方案 | 命令 | 实测结果 | 判定 |
|---|---|---|---|
| A 直接 argv 单元素 | `cmd /d /s /c 'echo "hi"'` | 输出 `\"hi\"`（Node 插入的转义反斜杠原样输出） | 不可用 |
| A' 直接 argv 含路径 | `… 'dir /b "C:\Program Files\Git\bin\bash.exe"'` | 反斜杠被吞，报「不是内部或外部命令」 | 不可用 |
| B 拆分多 argv | `['/d','/c','echo','"hi"']` | 仍是 `"\"hi\""` | 不可用 |
| C 环境变量一次性展开 | `cmd /d /s /c "%DSH_PROBE%"`，值含 `&` | 基本命令可用；但**命令首字符是引号时**报「文件名、目录名或卷标语法不正确」；`%PATH%` 不展开；多行只取第一行 | 受限可用（兜底） |
| D stdin | `cmd /d /q` + 写入命令 | 打印 banner、提示符、`More?`，输出不可用 | 不可用 |
| **E 临时 `.cmd` 脚本** | `cmd /d /s /c <file>` | 引号原样、`%VAR%` 正常展开、多行正常、`exit /b N` 退出码正确、`chcp 65001>nul` 后中文正确 | **选用** |

补充实测（均为 `.cmd` 脚本 + `windowsHide`）：

- `@echo off` + `chcp 65001>nul` + `echo 中文` → 输出正确 UTF-8。
- **不加 `chcp` 时 `echo 中文` 在脚本里也「看起来正确」——这是字节直通的假象**，因为 cmd 把脚本里的
  UTF-8 字节按 OEM 码页当字符读、再原样写回；一旦涉及路径、比较、`for` 等语义就会错。
  **不能依赖**，必须显式 `chcp 65001`。
- 内联（非脚本）`cmd /c echo 中文` → 乱码（`����`），因为命令串由 UTF-16 转成 OEM 936。
- `exit /b 7` → 进程退出码 7；脚本末行 `cmd /c "exit 9"` → 退出码 9（errorlevel 自然传递，无需显式 `exit /b`）。
- 脚本内 `chcp` → `Active code page: 65001`，说明脚本内切换生效。

> 说明：`type 中文文件.txt` 一组探针因 `cwd` 与临时目录不一致而「找不到文件」，
> 两种码页下都失败，**该组结论作废**，不作为证据（实现阶段由 §7 的 T-ENC-3 重新验证）。

### 2.4 社区最重要的教训：预设会重新挂载工具

`dsh-shell-select` 的 `cordis.patch.yml` 头注释原话：

> Disabling rows is not by itself enough for the tools: agent presets re-mount
> `tool-bash`/`tool-pwsh` inside each agent's realm, where no patch can address them.
> The plugin's global tool guard denies those two names wherever they are registered.

即：**`cordis.patch.yml` 只能关掉「宿主层」的行**；`minimal` / `standard` 等预设会在每个 agent
自己的 realm 里重新 `plugin(ToolPwsh)`，补丁够不到那里。这就是为什么 `dsh-shell-select`
必须额外实现一个「全局工具守卫」按名字拒绝，而 `@mzzsfy/dsh-shell-select` 改用运行时
`entry.update` + `system-prompt/assemble`。

**对本方案的意义（三条硬约束）**：

1. **不要走「静态 disable 官方行」路线**。本插件现有的 `agent/created` 按会话装配路线本来就在
   agent realm 内部动手，天然不受这条限制影响 —— 这是既有架构的优势，CMD 必须沿用，
   **不得**为了 cmd 新增 `cordis.patch.yml` 里的 disable 行。
2. **压制官方工具只能用 `agentCtx.tools.restrict({ deny: [...] })`**，作用域必须是该 agent 的 ctx
   （`replace.ts:176` 现有写法），且**必须先 `tools.get(name, agent)` 确认可见再 deny**，
   否则 `restrict` 对未知名字会抛错（现有代码已如此处理，CMD 复用同一模式）。
3. **自研工具必须注册在 agent 自己的层上**，且不能指望 `restrict` 能隐藏它（`restrict` 只过滤继承面）。
   所以 `cmd` 工具一旦挂上就只能是「新增一个工具」，**不能**用「挂上再隐藏」的写法自欺 ——
   这正是 §3.2 选择「自研 + 明确 deny 掉 `pwsh`/`bash`」而不是「改名克隆」的原因。

> 附加教训：`@mzzsfy/dsh-shell-select` 的「**接管失败自动回退官方 pwsh 链路**」是值得照抄的降级策略，
> 与本插件 `replace.ts` 现有的「先验证后隐藏、失败整体回滚」同源，§3.8 的降级设计与之对齐。

---

## 3. 方案设计

### 3.1 传输层：临时 `.cmd` 脚本（`src/cmd-script.ts`）

**为什么不是别的**：DSH 的 spawn 接缝是 `SubprocessSpawnSpec { argv: readonly string[] }`，
注释明确「Never shell-interpreted here」，且 `dsh-subprocess-local` 在 Windows 上还要经
Node runner 用 Win32 `CreateProcessW` 再拼一次命令行（标准 `CommandLineToArgvW` 规则）。
`cmd.exe` 用的是它自己的引号规则，两套规则不兼容——这就是 A/B 两行实测失败的根本原因，
**不是参数没调对，而是接缝本身没有「原始命令行」通道**。脚本文件绕开了整个问题：
命令行上只有 `[cmdPath, '/d', '/s', '/c', <绝对路径>]`，全部是安全字符。

**脚本模板**（UTF-8 **无 BOM**，CRLF 换行）：

```
@echo off
chcp 65001>nul
<用户命令，逐行原样写入，\n → \r\n>
```

- `@echo off`：否则每条命令回显，污染 stdout。
- `chcp 65001>nul`：把子进程控制台代码页切到 UTF-8，使**脚本内中文**与**子程序输出**都按 UTF-8 落管道；
  `>nul` 抑制「Active code page」提示。
- 用户命令原样落盘：不做任何转义、拼接或替换 → **不存在命令注入面**（这是相对 C 方案的重要安全优势）。

**API 草案**：

```ts
export interface MaterializedScript { readonly path: string; readonly dispose: () => Promise<void> }
export async function materializeCmd(command: string, options?: { dir?: string; codePage?: number }): Promise<MaterializedScript>
export async function sweepStaleScripts(dir?: string, olderThanMs?: number): Promise<number>
```

- 文件名：`dsh-cmd-<randomUUID>.cmd`，目录 `os.tmpdir()`。
- `dispose()` 幂等 `unlink`，`ENOENT` 忽略。
- `sweepStaleScripts`：插件加载时清一次超过 24h 的残留（进程被强杀时的兜底）。

**不采用 C 方案（环境变量）**的理由：命令首字符为引号即失败（`"C:\Program Files\x.exe" args` 是
最常见写法之一）、`%VAR%` 不展开、多行失效——三项都是 cmd 用户的日常用法。
保留它作为 `cmdTransport: 'env'` 的**兜底开关**（若脚本路线在某个环境被 EDR 拦截），默认 `script`。

### 3.2 工具身份：自研 `cmd` 工具（`src/cmd-tool.ts`）

**为什么不能复用官方工具**（两条硬约束）：

1. `@deepseek-ai/dsh-tool-bash` 只导出 `{ Config, apply, inject, name }`，**没有工具工厂**；
   工具名 `bash` 硬编码在 `defineTool({ name: … })` 里，插件 Config 也改不了。
2. 「挂载官方工具 → 拿到定义 → 改名注册」走不通：`tools.register` 在 agent 子树里注册会落在
   **agent 自己的层**（DESIGN §12 V1），而 `tools.restrict` 只过滤**继承面**、过滤不掉自己的层；
   若反过来先 `dispose()` 掉 `tool-bash` 的 fiber 再注册克隆体，克隆体的 `execute` 闭包指向已销毁的 ctx。

因此 `cmd` 工具必须用官方推荐的 `defineTool` 自写。**可复用的部分**：

| 复用项 | 来源 | 用途 |
|---|---|---|
| `parseExitStatus` | `@deepseek-ai/dsh-shell`（已导出） | 解析 `[exit code: N]` / `[killed by signal: …]` 尾部标记 |
| `ctx.jobs` 注册表 | `@deepseek-ai/dsh-jobs` | `run_in_background`：`start` / `wait` / `read` / `kill` / `remove` |
| 工具形状 | `dsh-tool-bash/lib/index.js:492-712` 作参照 | 参数、`output.schema` 的 `oneOf`、`presentCall`/`presentResult` 的终端卡片 |
| 提示词段落 | 自写 | 见下 |

**工具契约**（与官方 bash/pwsh 对齐，保证模型迁移成本最低）：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `command` | string | 是 | 交给 cmd.exe 的命令文本，可多行 |
| `description` | string | 是 | 5-10 字的活动描述，用于 UI 卡片 |
| `timeoutMs` | number | 否 | 覆盖默认超时 |
| `run_in_background` | boolean | 否 | 后台作业（`enableRunInBackground` 关闭时不暴露） |

`output.schema` 用 `oneOf` 区分「前台结果」与「后台作业句柄」；`presentResult` 产出终端卡片。

**提示词段落 `tool:cmd`**（自写，约 1-2KB，**不复用** `tool:pwsh` 的文本——那是 PowerShell 语法）：

- 每次调用是独立的 `cmd.exe`，没有会话状态，`cd` 不保留（用 `cd /d X && …` 单行完成）。
- 变量用 `%NAME%`；脚本内可用 `set`；`&&` / `||` / `&` 语义；管道 `|`；重定向 `>` `>>` `2>&1`。
- 路径用反斜杠，含空格必须加引号。
- 常用命令：`dir` / `type` / `copy` / `move` / `del` / `mkdir` / `where` / `tasklist` / `findstr`。
- 没有 `$()`、反引号、`-` 风格参数、`&&` 之外的 POSIX 语法。
- 需要 PowerShell/Git Bash 能力时说明本机已选 cmd，改用对应命令。

### 3.3 执行器：`CmdExecutor extends LocalBashExecutor`（`src/cmd-executor.ts`）

照抄 `src/executor.ts` 的 `GitBashExecutor` 骨架（沙箱三分支、`decorateResult`、`facts` 表），只替换方言相关部分：

| 关注点 | `GitBashExecutor`（现状） | `CmdExecutor`（新增） |
|---|---|---|
| 基类 | `LocalBashExecutor` | 同 |
| argv | `[bashPath, ...login, '-c', command]` | `[cmdPath, '/d', '/s', '/c', scriptPath]` |
| 命令载体 | argv 直传 | **临时 `.cmd` 文件**（§3.1） |
| `resolve()` | 注入 `PATH` 合成 + `PYTHONIOENCODING=utf-8` | 仅注入 `PYTHONIOENCODING=utf-8`；**不合成 PATH**（cmd 用系统 PATH 即可） |
| 沙箱 | 默认 `unconfined`（MSYS2 起不来） | 默认 `escalate`（cmd 可受限） |
| `sandboxMode` | 绕过时返回 `undefined` | 受限时返回真实 mode，让工具暴露 `sandbox_permissions` |
| 清理 | 无 | `onProcessDone` 里 `dispose()` 脚本；`promoteOnTimeout` 后仍以进程结束为准 |
| 编码 | `PYTHONIOENCODING` | 额外 `chcp 65001` 前置（§3.5） |

**脚本生命周期与进程的绑定**（关键实现点）：`executeArgv(spec, argvOrPrepare, onStarted)` 的
`argvOrPrepare` 可以是异步函数，在那里写脚本并把 `scriptPath` 记进闭包；`onStarted(process)` 里
建立 `Map<ShellProcess, MaterializedScript>`；`protected override onProcessDone(process, …)` 里查表清理。
这样**后台提升（`promoteOnTimeout`）后脚本不会被提前删掉**，因为清理发生在进程真正结束时。

**为什么继承 `LocalBashExecutor` 而不是 `PwshLocalExecutor`**：后者的默认 `argv()` 会前置
PowerShell 专用 `ENCODING_PREAMBLE`，且 `spawnSpec` 是私有方法（无法改 ENV 覆盖）；
`LocalBashExecutor` 没有方言前置，语义更干净，且与本项目已有的 `GitBashExecutor` 同源。

### 3.4 沙箱：cmd 是 Windows 上「原生 + 可受限」的少数派

- `dsh-sandbox-windows-acl` 文档：受限令牌「**只限制写，不限制读、网络、进程可见性**」；
  且 `dsh-sandbox-local` 里官方的**功能探针本身就是 `cmd /c exit 0`**——证明 cmd 能在受限令牌下启动。
- 对照 Git Bash：MSYS2 在受限令牌下无法创建 `BaseNamedObjects`（`0xC0000022`，退出码 `-1073741502`），
  这才是本项目默认 `unconfined` 的原因。
- 因此 cmd 方言把 `confinedPolicy` 默认设为 `escalate`：会话要求受限就受限，要求放开就放开，
  并在结果里如实回报 `sandbox.mode`。
- 脚本文件位于 `%TEMP%`，**受限子进程读取不受限**，因此沙箱下可用（§7 T-SBX-2 验证）。

### 3.5 编码

三层防线，缺一不可：

1. **脚本文件**：UTF-8 **无 BOM** + CRLF。BOM 会被 cmd 当成命令的一部分而报错。
2. **脚本首两行**：`@echo off` + `chcp 65001>nul`。实测这是中文正确的前提。
3. **环境**：沿用现有 `pythonUtf8` 开关，注入 `PYTHONIOENCODING=utf-8`，让 cmd 调起的 Python 也走 UTF-8。

**已知副作用**：`chcp` 作用于**控制台**而非进程。沙箱文档说明「子进程共享宿主控制台」，
因此在受限档位下切换代码页可能影响宿主控制台。缓解：
- 由 `cmdCodePage` 配置项控制（默认 `65001`，可设 `0` 表示不切换）；
- 文档明确记录该副作用；
- 实现阶段用 §7 T-ENC-4 观测「执行前后宿主 `chcp` 是否变化」，若确认有污染，则在脚本尾部
  best-effort 恢复（`exit /b` 提前返回时跳过恢复，作为已知边界）。

### 3.6 发现与路径（`src/paths.ts` / `src/discover.ts`）

优先级（与官方 `terminalEnvironment` 一致）：

1. 配置 `cmdPath`（非空即用，且校验文件存在、名字为 `cmd.exe`）；
2. `process.env.ComSpec`；
3. `%SystemRoot%\System32\cmd.exe`；
4. `where cmd` 兜底（可选）。

不引入 `discover` 扫描：cmd.exe 是系统自带、路径唯一，扫描没有意义。UI 上只提供「路径输入框 + 只读展示」，
不提供「扫描」按钮（与 bash 行区分）。

### 3.7 配置与 UI

**Host 侧 `src/config.ts`**：

```ts
dialect: z.union(['pwsh', 'bash', 'cmd'] as const).default('pwsh').volatile(),
cmdPath: z.string().default('').volatile(),          // 空 = 自动（ComSpec → System32）
cmdCodePage: z.number().default(65001).volatile(),   // 0 = 不切换
cmdTransport: z.union(['script', 'env'] as const).default('script').volatile(),
```

`confinedPolicy` 默认值改为**按方言取值**：`dialect === 'cmd' ? 'escalate' : 'unconfined'`。
实现上不给 schema 默认值，而在 `snapshotConfig()` 里当字段缺省时按方言推导（避免 volatile 字段默认值被固化）。

**Client 侧**：`src/client/locales.ts` 增加 `row.dialect.cmd`（中文「CMD（cmd.exe）」/英文「CMD (cmd.exe)」）、
`row.cmd.path.*` 一组键；`row.tsx` 的 `dialectItems` 加第三项，`dialect === 'cmd'` 时渲染 cmdPath 输入框
与 `cmdCodePage`/`cmdTransport` 两个下拉（高级项，可折叠）。所有字符串必须中英双份（官方规范要求本地化）。

### 3.8 诊断与降级

`src/diag.ts` 的 `SkipReason` 增加：

| 原因 | 含义 |
|---|---|
| `dialect-cmd` | 方言不是 bash/cmd（保留现有 `dialect-pwsh` 语义，或合并为 `dialect-other`） |
| `cmd-not-found` | 三个候选路径都不存在 |
| `cmd-script-failed` | 临时脚本写不出（权限/磁盘/EDR） |
| `cmd-mount-failed` | 挂载执行器或工具失败 |

所有失败一律「保留官方 pwsh、记录原因」，绝不让会话失去终端工具——沿用 `installSession` 现有的
「先验证后隐藏」顺序（`replace.ts:170`）。

---

## 4. 代码改动清单

| 文件 | 改动 | 估计 |
|---|---|---|
| `src/cmd-script.ts` | **新增**：脚本落盘、清理、残留清扫 | ~120 行 |
| `src/cmd-executor.ts` | **新增**：`CmdExecutor`（继承 `LocalBashExecutor`） | ~220 行 |
| `src/cmd-tool.ts` | **新增**：`defineTool` 的 `cmd` 工具 + 提示词段落 + jobs 集成 | ~380 行 |
| `src/config.ts` | 方言联合类型、`cmdPath`/`cmdCodePage`/`cmdTransport`、按方言推导默认值 | ~40 行改 |
| `src/paths.ts` | `resolveCmdPath()`、`cmdCandidates()` | ~50 行 |
| `src/replace.ts` | `dialect === 'cmd'` 分支：挂 `CmdExecutor` + `CmdTool`，隐藏 `pwsh`/`bash`，遮蔽段落 | ~80 行改 |
| `src/index.ts` | 启动清扫残留、cmd 方言的加载诊断 | ~20 行改 |
| `src/diag.ts` | 新增 skip 原因 | ~6 行 |
| `src/shared/protocol.ts` | `Dialect` 加 `'cmd'`、`cmdPath` 字段 | ~6 行 |
| `src/routes.ts` | state 路由带 cmd 字段；discover 路由对 cmd 方言直接返回空扫描 | ~15 行改 |
| `src/client/types.ts` / `store.ts` / `row.tsx` / `locales.ts` | 第三项方言、cmdPath 输入、两个高级下拉、中英文案 | ~120 行 |
| `locale/en.json` / `locale/zh.json` | `meta.description` 补 cmd | 2 行 |
| `scripts/contractcheck.mjs` | cmd 执行器契约测试（§7） | ~250 行 |
| `scripts/integration.mjs` | cmd 方言端到端（工具清单、提示词、执行） | ~120 行 |
| `scripts/selftest.mjs` / `rowselftest.mjs` / `rendertest.mjs` | 配置解析、UI 行、渲染 | ~80 行 |
| `docs/DESIGN.md` | 新增 §14「CMD 方言」，更新 §11 限制表 | ~120 行 |
| `README.md` / `CHANGELOG.md` | 新方言、限制、迁移说明 | ~40 行 |

合计约 **1700-1900 行**（含测试与文档），其中新代码约 800 行。

---

## 5. 分工安排

原则：**写作用域互不重叠**；接口先冻结、实现再并行；每个工作流自带测试。

### 5.1 阶段与时序

```
P0 契约冻结（Lead，0.5d）
 ├─ 定义 Dialect 扩展、CmdConfig、脚本 API、工具参数/输出契约（只写类型与文档，不写实现）
 │
 ├─ P1 执行器（A）        ──┐
 ├─ P2 工具（B）           ─┤ 三者可并行：P1/P2 只依赖 P0 的接口，P3 只改装配
 ├─ P3 配置与装配（C）     ─┘
 │
 ├─ P4 客户端 UI（D）  ← 依赖 P0 的协议类型（可与 P1-P3 并行）
 ├─ P5 测试（E）       ← 随 P1/P2 同步写契约测试，端到端在 P3 后补
 └─ P6 文档与发布（F） ← 最后，收口
```

### 5.2 工作流与责任人

| 流 | 责任人 | 写作用域（互斥） | 依赖 | 交付物 |
|---|---|---|---|---|
| **P0 契约** | Lead | `docs/PLAN-cmd-dialect.md`、`src/cmd-types.ts`（新） | — | 冻结的接口与本文档终稿 |
| **P1 执行器** | 队友 `cmd-exec` | `src/cmd-script.ts`、`src/cmd-executor.ts` | P0 | 能独立跑通的执行器 + 单测脚本 |
| **P2 工具** | 队友 `cmd-tool` | `src/cmd-tool.ts` | P0 | `cmd` 工具 + 提示词段落 + 后台作业 |
| **P3 配置装配** | 队友 `cmd-wire` | `src/config.ts`、`src/paths.ts`、`src/replace.ts`、`src/index.ts`、`src/diag.ts`、`src/shared/protocol.ts`、`src/routes.ts` | P0（实现可等 P1/P2 接口就绪） | 方言接通、降级路径、诊断 |
| **P4 客户端** | 队友 `cmd-ui` | `src/client/*`、`locale/*` | P0 协议 | 第三项方言 + 中英文案 + 行内控件 |
| **P5 测试** | 队友 `cmd-test` | `scripts/*`、`src/testing.ts` | 跟随 P1/P2/P3 | 契约矩阵 + 端到端 |
| **P6 文档** | Lead（收口） | `docs/DESIGN.md`、`README.md`、`CHANGELOG.md`、`package.json` | 全部 | 发布就绪 |

**协作规则**：
- P0 结束后，Lead 把接口片段直接贴给 A/B/C/D，避免各自读全仓。
- P1/P2 之间的唯一接触点是 `CmdExecutor` 的构造参数与 `ctx.shell` 契约——P0 定死。
- P3 改 `config.ts` 时 P1/P2 不要动同一个文件；若需新增配置字段，向 Lead 提，由 P3 统一落。
- 每个工作流完成即 `git commit`（单一职责提交），Lead 最后统一跑 `npm run check`。

### 5.3 每个工作流的验收口径

| 流 | 完成定义（DoD） |
|---|---|
| P1 | `node scripts/contractcheck.mjs --only cmd` 通过；脚本无残留；`promoteOnTimeout` 后脚本仍在、进程结束后被删 |
| P2 | 工具在假 registry 上注册成功；参数校验、退出码渲染、后台作业三件套有单测 |
| P3 | 三个方言的 `snapshotConfig()` 单测；`cmd-not-found` 降级路径有测试；`npm run typecheck` 通过 |
| P4 | `rowselftest` + `rendertest` 通过；中英文案齐全；无硬编码中文 |
| P5 | §7 矩阵全绿；沙箱用例在受限档位下真实执行 |
| P6 | `npm run check` 全绿；README 截图/说明更新 |

### 5.4 协作机制（Agent Teams 落地方式）

本仓的实现工作由 Lead + 5 个队友在**同一个工作目录**里并行完成，因此必须靠机制而不是默契：

1. **共享任务板**：P0 完成后，Lead 为 P1–P5 各建一条任务，写明
   `write_scopes`（就是 §5.2 的「写作用域」列）与 `blocked_by`（P1/P2/P3 阻塞于 P0 契约任务）。
   队友 `claim` 后才开工，`complete` 时才交接。
2. **写作用域互斥是硬规则**：`src/cmd-*` 归 P1/P2，`src/config.ts`/`replace.ts` 等归 P3，
   `src/client/*` 归 P4，`scripts/*` 归 P5。跨域改动一律**提给 Lead 裁决**，不自行改别人的文件。
3. **契约先行**：P0 产出的 `src/cmd-types.ts` 是唯一真相源；任何一方要改接口，必须先改类型文件并通知
   Lead，由 Lead 广播给其余三方（避免 P1/P2/P3 各自实现出不兼容的形状）。
4. **提交纪律**：每个工作流只提交自己作用域内的文件，提交信息用 `feat(cmd): …` / `test(cmd): …` 前缀；
   Lead 在 M3 之后统一 review `git diff` 并跑 `npm run check`，**不通过则打回**。
5. **验证顺序**：P1/P2 的产出必须能被 P5 用**真实进程**验证（不用 mock）；P3 的降级路径必须由 P5
   在「故意删掉 cmd.exe」的条件下验证；沙箱档位由 Lead 在真实受限环境复核（这是 §8 的最高风险项）。

---

## 6. 最佳实践

### 6.1 符合 DSH 官方插件规范

| 规范 | 本方案如何满足 |
|---|---|
| 用 `defineTool` + `ctx.tools.register` 暴露工具 | `cmd` 工具全部走官方 `defineTool`，不自造 Tool 接口 |
| 执行器作为插件挂到 `ctx.shell` | `CmdExecutor extends LocalBashExecutor`，`shellCtx.plugin(CmdExecutor, …)` |
| 单实例服务不重复加载 | 只在 `isolate('shell')` 子树上挂，宿主与其它 agent 不受影响（沿用现状） |
| 资源随 fiber 释放 | 所有 disposer 走 `agentCtx.effect`，失败逆序回滚（沿用 `replace.ts`） |
| 配置字段 `volatile()` | 新增字段全部 `.volatile()`，写入走 `configForms.mutate` |
| 提示词段落注册 | 新段落 `tool:cmd`，order 用 `getSectionOrder('TOOL_CMD') ?? 1011`，失败仅告警 |
| 本地化 | 所有 UI 字符串走 locale，中英双份 |
| 不 fork 官方包 | 只 `import` 公开导出；私有形状不依赖 |
| peerDependencies 而非捆绑 | 维持现状，官方包不写进 `dependencies` |
| 版本区间 | 维持 `engines.dsh ">=0.2.1-rc.2 <0.3.0"`；若用到新 API 才收紧 |
| **预设重新挂载**（社区最大教训，§2.4） | **不**新增静态 `disable` 行；压制官方工具只用 `agentCtx.tools.restrict({deny})`，且先 `tools.get` 确认可见。沿用 `agent/created` 按会话装配路线 |
| **接管可回退** | 先验证 `tools.get('cmd', agent)` 存在再隐藏 `pwsh`/`bash`；任一步失败逆序回滚并降级回官方 pwsh（对齐 `@mzzsfy/dsh-shell-select` 的 auto-fallback） |

### 6.2 代码规范

- **不做字符串拼接执行**：命令只经文件或环境变量传递，永不拼进命令行。
- **不留临时垃圾**：脚本在进程结束即删；加载时清扫 24h 残留；路径与文件名可预测前缀 `dsh-cmd-`。
- **不吞错误**：所有 catch 要么 `warn`/`note` 记录，要么转成结构化 `skip` 原因。
- **默认安全**：cmd 方言默认 `escalate`；`unconfined` 必须显式选择。
- **可观测**：`note()` 记录解析到的 cmd 路径、脚本目录、码页、沙箱决策。
- **类型优先**：方言联合类型只在一处定义（`src/cmd-types.ts`），其余引用它。

### 6.3 测试规范

- 契约测试必须**真起进程**，不用 mock 替身验证 spawn 行为（现有 `contractcheck.mjs` 风格）。
- 每个用例自建临时工作目录，结束清理；不污染用户 `%TEMP%`（沿用现有 `.test-tmp` 约定）。
- 中文/编码用例必须断言**字节层**，不能只看「没报错」。
- 沙箱用例必须验证「写工作区外被拒」，而不是只看退出码。

### 6.4 发布规范

- 语义化版本 `0.5.1 → 0.6.0`（新增方言，向后兼容）。
- CHANGELOG 写明：新增 cmd 方言、默认沙箱档位变化、编码行为、已知限制。
- README 的「已知限制」增加 cmd 三条：无持久终端、`chcp` 副作用、非 UTF-8 子程序输出可能仍乱码。
- **发布渠道现状**：本插件当前只在 GitHub（`dsh plugin add github:<account>/dsh-terminal-tool`），
  **未发布到 npm**（`registry.npmjs.org/dsh-terminal-tool` → Not found）。若要发布，需注意
  `dsh-terminal-tool` 是**无 scope 名**，可能被抢注；建议要么抢注，要么改用 `@<scope>/dsh-terminal-tool`。
  是否随 `0.6.0` 一起上 npm 见 §10 决策点 7。
- **dsh.so 验证**：现有记录 L1–L4 通过、L5 web smoke 失败；`dsh-shell-select` 也报同样错误，
  判断是检测器/环境问题而非插件缺陷，发布前不因此阻塞，但需在 CHANGELOG 里注明。

---

## 7. 测试与验收矩阵

| 编号 | 场景 | 期望 | 级别 |
|---|---|---|---|
| T-BASIC-1 | `echo hello` | stdout `hello`，exit 0 | 必须 |
| T-BASIC-2 | `exit /b 7` | exit 7，工具结果含 `[exit code: 7]` | 必须 |
| T-QUOTE-1 | `echo "hi"` | 输出 `"hi"`（引号保留） | 必须 |
| T-QUOTE-2 | `"C:\Program Files\Git\bin\bash.exe" --version` | 正确执行，不报语法错误 | 必须 |
| T-VAR-1 | `set X=abc` + `echo %X%` | 输出 `abc` | 必须 |
| T-VAR-2 | `echo %PATH%` | 输出真实 PATH（非字面量） | 必须 |
| T-OP-1 | `echo a & echo b` | 两行输出 | 必须 |
| T-OP-2 | `cd /d C:\ && dir /b` | 在目标目录列出 | 必须 |
| T-OP-3 | `cmd /c exit 9`（末行） | exit 9 | 必须 |
| T-MULTI-1 | 三行命令 | 三行都执行 | 必须 |
| T-ENC-1 | `chcp 65001>nul` + `echo 中文` | 输出 UTF-8 `中文` | 必须 |
| T-ENC-2 | Python 打印中文（`pythonUtf8: true`） | 正确 | 必须 |
| T-ENC-3 | `type 中文文件.txt`（cwd 正确） | 正确输出 | 必须 |
| T-ENC-4 | 执行前后宿主 `chcp` 对比 | 记录是否被污染，据结果决定是否恢复 | 观测 |
| T-TIME-1 | 超时命令 | 按 `onExpiry` 处理，结果含超时标记 | 必须 |
| T-TIME-2 | 超时后 `promoteOnTimeout` | 转后台，脚本仍在，结束后被删 | 必须 |
| T-SBX-1 | `escalate` + 工作区写 | 允许 | 必须 |
| T-SBX-2 | `escalate` + 工作区外写 | 被拒，`sandbox.denied` 如实上报 | 必须 |
| T-SBX-3 | 受限档位读 `%TEMP%` 脚本 | 可读（读不受限） | 必须 |
| T-CFG-1 | 三方言快照解析 | 字段与默认值正确 | 必须 |
| T-CFG-2 | `cmdPath` 指向不存在文件 | `cmd-not-found` 降级，会话仍有 pwsh | 必须 |
| T-UI-1 | 行内切到 CMD | 显示 cmdPath 输入与高级项 | 必须 |
| T-UI-2 | 中英文切换 | 无缺失键 | 必须 |
| T-LIFE-1 | 会话结束后 | 无 `dsh-cmd-*.cmd` 残留 | 必须 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 沙箱受限令牌下 `chcp` 失败 | 中文乱码 | T-ENC-1 在受限档位下单独验证；失败则退化为「文档化限制 + `cmdCodePage: 0`」 |
| `chcp` 污染宿主控制台 | 影响其它子进程 | `cmdCodePage` 可关；T-ENC-4 观测；必要时脚本尾部恢复 |
| EDR/杀软拦截 `.cmd` 落盘 | 命令无法执行 | `cmdTransport: 'env'` 兜底开关；错误映射到 `cmd-script-failed` |
| 自研工具与官方工具行为漂移 | 模型体验不一致 | 参数名、输出形状、卡片形态照抄官方；契约测试锁定 |
| 官方 `LocalBashExecutor` 内部变化 | 继承点断裂 | 只在公开/受保护成员上扩展；`engines.dsh` 区间已限制次版本 |
| `promoteOnTimeout` 与脚本清理竞争 | 脚本被提前删 | 清理挂在 `onProcessDone`，T-TIME-2 覆盖 |
| 临时脚本被其它本地进程读取 | 信息泄露（命令文本） | 文件名随机、`%TEMP%` 用户私有、用完即删；文档说明 |

---

## 9. 里程碑

| 里程碑 | 内容 | 出口条件 |
|---|---|---|
| M0 | 本方案评审通过 | 用户确认 §10 决策点 |
| M1 | P0 契约冻结 + P1/P2 实现 | 执行器与工具各自单测通过 |
| M2 | P3 装配 + P4 UI | 设置页可选 CMD，新会话拿到 `cmd` 工具 |
| M3 | P5 测试矩阵 | §7 必须项全绿 |
| M4 | P6 文档 + 发布 `0.6.0` | `npm run check` 全绿 |

---

## 10. 待用户确认的决策点

1. **工具名**：`cmd`（与现有 `bash`/`pwsh` 一致）——**建议**；还是改成社区 `dsh-shell-select` 那样
   统一的 `shell`（更稳，但对现有用户是破坏性变更，且要同时改 bash/pwsh 两条路径）。
2. **cmd 方言的 `confinedPolicy` 默认值**：`escalate`（**建议**，让沙箱重新生效）还是沿用全局 `unconfined`。
3. **后台作业**：`0.6.0` 是否一并实现 `run_in_background`（**建议是**，否则与 bash 方言能力不对等）。
4. **编码开关**：是否需要 `cmdCodePage` 配置项（**建议是**，默认 65001）。
5. **持久终端**：确认 `0.6.0` **不做** cmd PTY（理由见 §1.2 N1），后续是否单独立项。
6. **发布节奏**：一次性发 `0.6.0`，还是先 `0.6.0-rc.1` 给一台机器验证。
7. **是否上 npm**：当前仅 GitHub 安装；若要上，无 scope 名有被抢注风险，建议同时决定命名
   （保持 `dsh-terminal-tool` 抢注 vs 改 `@<scope>/dsh-terminal-tool`）。
8. **是否引入命令 denylist / cwd allowlist**：`@qianwenxue1/dsh-shell` 带了这两项。
   **建议不做**——官方 `tool-bash`/`tool-pwsh` 都没有 denylist，安全边界由沙箱（`confinedPolicy`）
   与 DSH 权限档负责；额外黑名单会给用户「虚假安全感」且易被绕过。若坚持要做，只作为可选配置默认关闭。

---

## 附录 A：复现实验（供实现阶段参考）

```js
// 传输方式对比的最小复现（Node v24.19.0，Windows）
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const opts = { encoding: 'buffer', windowsHide: true }
const run = (label, argv) => {
  const r = spawnSync(argv[0], argv.slice(1), opts)
  console.log(label, r.status, JSON.stringify(r.stdout?.toString('utf8')), JSON.stringify(r.stderr?.toString('utf8')))
}

// A: 直接 argv —— 引号被 Node 转义成 \" ，cmd 不认
run('A', ['cmd.exe', '/d', '/s', '/c', 'echo "hi"'])

// E: 临时脚本 —— 引号、变量、多行、退出码全部正常
const script = join(tmpdir(), 'dsh-cmd-probe.cmd')
writeFileSync(script, '@echo off\r\nchcp 65001>nul\r\nset X=abc\r\necho "hi" & echo %X%\r\necho 中文\r\nexit /b 7\r\n', 'utf8')
run('E', ['cmd.exe', '/d', '/s', '/c', script])
```

## 附录 B：相关源码定位

| 主题 | 位置 |
|---|---|
| 平台互斥的 shell 行 | `@deepseek-ai/dsh-base/cordis.patch.yml:250-288` |
| cmd.exe 作为交互终端默认值 | `@deepseek-ai/dsh-api-terminal-controller/lib/index.js:18,31` |
| `ComSpec` 来源 | `@deepseek-ai/dsh-subprocess-local/lib/index.js:1610-1616` |
| 执行器基类 | `@deepseek-ai/dsh-shell`（`ShellExecutor`、`parseExitStatus`） |
| bash 执行器参照 | `@deepseek-ai/dsh-bash-local/lib/index.js` |
| 沙箱包装参照 | `@deepseek-ai/dsh-bash-sandbox/lib/index.js:162` |
| 工具定义参照 | `@deepseek-ai/dsh-tool-bash/lib/index.js:492-712` |
| 本插件装配点 | `src/replace.ts:83,114,148-172,176-207` |
| 本插件沙箱策略 | `src/confined.ts`、`src/executor.ts:145,186-243` |
| 社区参照：单一 `shell` 工具 + 设置选择 | `dsh-shell-select`（`athif23/dsh-shell-select`），其 patch 头注释是 §2.4 的出处 |
| 社区参照：运行时接管 + 失败回退 | `@mzzsfy/dsh-shell-select`（`entry.update` + `system-prompt/assemble`） |
| 社区参照：自研 `shell_exec` 安全契约清单 | `@qianwenxue1/dsh-shell`（denylist、cwd allowlist、头尾截断、`job_id`） |
| 社区参照：cmd 的已知坑（一次性传参 / 码页） | `dsh-shell-select` README 的 "Quirks" 段 |
