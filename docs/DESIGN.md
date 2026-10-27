# dsh-terminal-shell — 架构设计

| 项 | 值 |
|---|---|
| 包名 | `dsh-terminal-shell` |
| 版本 | `0.2.1` |
| 插件 entry id | `terminal-shell` |
| 宿主版本要求 | `engines.dsh`: `>=0.2.1-rc.2 <0.3.0`；`engines.node`: `>=22` |
| 契约基线 | DSH `0.2.1`（`configForms` 按 entry id 寻址、`tools.restrict`、`systemPrompt.section`） |
| 文档状态 | 实现定稿（0.2.1） |
| 适用平台 | Windows（`process.platform === 'win32'`）；其它平台整行隐藏、逻辑不介入 |
| 文档依据 | 本仓库 `src/**`、`build.mjs`、`cordis.patch.yml`、`scripts/*.mjs` 的当前代码事实 |

> 本文只描述**已经实现**的行为。历史规划与评审见 `docs/history/`（§16），其中的版本号与文案是归档时的旧值，不作为现状依据。

---

## 2. 目标与范围

### 2.1 要解决的问题

DSH 在 Windows 上默认用一个 PowerShell（`pwsh`）终端工具承载智能体的命令调用。用户希望**按 profile 选择**该工具背后的 shell，而不修改任何 preset 文件、也不接管全局 `ctx.shell`：

- 有人需要 Git Bash 的 POSIX 工具链（`grep`/`sed`/`make`/`gcc`）；
- 有人需要原生 `cmd.exe` 的批处理语义（`%VAR%`、`dir`、`exit /b`）；
- 有人希望维持官方 `pwsh` 不动。

难点在于：工具是**会话级**的。一个正在运行的智能体不能在其脚下热换工具；preset 又是共享的祖先组件。插件因此选择在**每次会话创建时**、在**该会话自己的 scope** 里完成替换（§4），失败则留在官方工具上。

### 2.2 本插件的能力清单

| 编号 | 能力 | 关键实现 |
|---|---|---|
| F1 | 三种方言 `pwsh` / `bash` / `cmd`，默认 `pwsh`（安装即无感） | `src/config.ts`（`dialect` 默认 `pwsh`）、`src/client/locales.ts` |
| F2 | 在 `agent/created` 时只替换这一个会话的终端工具 | `src/index.ts:160`、`src/replace.ts` |
| F3 | bash 路径复用官方 `@deepseek-ai/dsh-tool-bash` + `GitBashExecutor` | `src/replace.ts:175-188`、`src/executor.ts` |
| F4 | cmd 路径用自研 `tool-cmd` + `CmdExecutor` + 批处理传输 | `src/cmd/tool.ts`、`src/cmd/executor.ts`、`src/cmd/script.ts` |
| F5 | 自动发现 Git Bash（注册表 / 环境 / PATH），并在每一步排除 WSL 启动器 | `src/discover.ts`、`src/paths.ts` |
| F6 | 确定性解析 `cmd.exe`（`cmdPath` → `ComSpec` → `%SystemRoot%\System32\cmd.exe`） | `src/cmd/discover.ts` |
| F7 | 受限 Windows 沙箱下的两档策略（`unconfined` / `escalate`），两方言各自默认 | `src/confined.ts`、`src/cmd/executor.ts`（`planCmdLaunch`） |
| F8 | 极简模式 `leave` / `oneshot` / `variant`，并按需注册 `minimal-gitbash` 预设变体 | `src/preset.ts`、`src/replace.ts:110-114` |
| F9 | 持久 Git Bash PTY 后端（独立入口 `./pty`） | `src/pty.ts` |
| F10 | 设置 → 通用 → 「终端 Shell」设置行 | `src/client/**` |
| F11 | 两个只读 `/api` 路由（`/state`、`/discover`）；写入走官方 `configForms` | `src/routes.ts`、`src/shared/protocol.ts` |
| F12 | 全部配置字段 `.volatile()`；每会话取快照，改动只对新会话生效 | `src/config.ts`（`snapshotConfig`） |
| F13 | 失败只写诊断日志（`%TEMP%\dsh-terminal-shell.log`），不抛给会话 | `src/diag.ts` |
| F14 | 为 MSYS/Python 注入 `PYTHONIOENCODING=utf-8`；cmd 侧 `chcp` 到配置代码页（默认 65001） | `src/executor.ts:168`、`src/cmd/executor.ts`、`src/cmd/script.ts:81` |
| F15 | `cmdPath` 覆盖只接受真正的 `cmd.exe` | `src/cmd/discover.ts`（`isCmdExecutable`） |

### 2.3 明确不做

- **不接管全局** `ctx.shell`：profile/host 级执行器始终是平台默认（`src/index.ts:27` 的注释即此约束）。
- **不修改任何 preset 文件**：需要持久 Git Bash 时在运行时派生一个新变体（§7）。
- **不跨平台**：非 `win32` 时 `probeCapability` 返回不支持、设置行 `status` 置 `hidden`、`installSession` 直接 `skip(not-win32)`。
- **不提供持久 `cmd` 终端**：cmd 只有一次性批处理执行。
- **不自己批准任何提权**：`escalate` 只是把「受限启动失败」暴露为沙箱拒绝，让官方 `tool-bash` 的审批流接管。
- **不提供独立「检测」按钮**：扫描是切换方言的副作用（§9.4）。
- **不写死官方 `minimal` preset 的副本**：变体运行时从注册表读文档派生，避免随官方版本漂移。

---

## 3. 整体架构

### 3.1 分层与流程（文字图）

```
┌─ Host（profile 根）──────────────────────────────────────────────┐
│  cordis.patch.yml  insert: id=terminal-shell, name=dsh-terminal-shell │
│      disabled: !!js process.platform !== 'win32'                     │
│                                                                    │
│  src/index.ts  apply(ctx, config)                                  │
│   ├─ snapshotConfig → sweepStaleScripts（每次 host load 一次）      │
│   ├─ createVariantManager + ctx.inject(['agentPresets']) → 同步变体 │
│   ├─ registerRoutes（/state、/discover）——经 ctx.inject(['connection']) │
│   ├─ ctx.on('loader/volatile-update') → 重新同步变体                │
│   └─ ctx.on('agent/created') → installSession(ctx, agent, snapshot) │
│                                                                    │
│  src/routes.ts ── /api/dsh-terminal-shell/state  (POST, 不扫描)     │
│                 └ /api/dsh-terminal-shell/discover (POST, 扫描)     │
└────────────────────────────────────────────────────────────────────┘
                    │ agent/created（serial，await）
                    ▼
┌─ 会话 scope（每个 agent 一个）──────────────────────────────────────┐
│  preset 守卫（minimal / minimal-gitbash）                           │
│  方言闸门（pwsh→跳过；cmd→installCmdSession；bash→继续）            │
│  agentCtx.isolate('shell')  ← 私有子树，仅本会话可见                │
│    ├─ plugin(GitBashExecutor) 或 plugin(CmdExecutor)                │
│    └─ plugin(ToolBash)        或 plugin(ToolCmd)                    │
│  tools.restrict({deny:[...]})   ← 只过滤“继承层”                    │
│  systemPrompt.section(...)      ← 覆盖/新增提示词段                 │
│  所有 disposer → agentCtx.effect（逆序回滚）                        │
└────────────────────────────────────────────────────────────────────┘
                    │ 浏览器半区
                    ▼
┌─ Client（Web 渲染器）──────────────────────────────────────────────┐
│  src/client/index.ts  slot settings.general.item, id=terminal-shell │
│  row.tsx → store.ts → api.ts → 两个 /api 路由                        │
│  写入：configForms.get('terminal-shell').mutate(...)（不经路由）     │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 scope 模型（关键）

- **preset 是一个共享祖先 scope，不是每个 agent 一份**。`agent.ctx` 挂在该 preset scope 之下，preset 里的 `pwsh` 工具与 `tool:pwsh` 提示词段都是 agent 从这里**继承**来的。
- 因此替换必须落在**两处**：
  1. 在自己新开的 `agentCtx.isolate('shell')` 子树里挂载新执行器与新工具——`isolate` 生成一个无可共享标签的私有 realm，别的 agent 与 host 看不到；
  2. 在 agent 层用 `tools.restrict({deny})` **遮掉继承来的** `pwsh`（cmd 还要遮 `bash`），用同名空 `systemPrompt.section` 压掉对应提示词。
- 于是「preset 无需改动、别的会话不受影响、host 的 `ctx.shell` 保持原样」三件事同时成立。

### 3.3 三条并发的入口

`apply()` 里同时铺设三条互不阻塞的线：

1. **变体线**（`ctx.inject(['agentPresets'])`）：读官方 `minimal` 文档、按需注册/回收 `minimal-gitbash`。找不到服务就整条跳过——没有 `agentPresets` 的部署不需要变体。
2. **路由线**（`ctx.inject(['connection'])`）：注册 `/state`、`/discover`。headless 组合没有 `connection`，设置行就自然缺省，插件仍通过 profile patch 工作。
3. **会话线**（`ctx.on('agent/created')`）：每次创建都重新 `snapshotConfig` 并 `installSession`。

三条线共用同一份配置快照来源，但各自独立失败：变体/路由挂了不影响会话替换，会话替换挂了不影响前两者。

---

## 4. 替换流程

### 4.1 公共入口与前置守卫

`installSession(ctx, agent, snapshot)`（`src/replace.ts:88`）在 `agent/created` 中被 await，因此**任何抛出都会让会话创建失败**。函数体全程防御，永远 resolve 出一个 `InstallResult`。

执行顺序（顺序本身是契约，错误改写会破坏语义）：

1. `process.platform !== 'win32'` → `skip('not-win32')`。
2. `agent.ctx === undefined` → `skip('no-agent-context')`。
3. **preset 守卫**（先于方言闸门）：
   - preset 为 `minimal-gitbash`（本插件的变体，`VARIANT_ID`）→ `skip('already-replaced')`；
   - preset 为 `minimal` 且 `minimalMode !== 'oneshot'` → `skip('minimal-left', minimalMode)`。
   - preset 读取用**会话投影** `sessionProjections.stateOf(session, 'agentPreset')`，回退到不可变 `session.header.agentPreset`；原因：首轮前切 preset 只追加 `agent-preset/selected`，header 不更新。
4. **方言闸门**（必须压在 preset 守卫之后）：`dialect === 'pwsh'` → `skip('dialect-pwsh')`；`dialect === 'cmd'` → `installCmdSession(...)`；否则继续 bash 路径。
   - 放在守卫之后的原因：`minimalMode: variant` 下持久终端 preset 已拥有终端，若在上面挂 cmd 会让 agent 出现两个终端工具，且遮掉 `pwsh`/`bash` 还会剥掉 preset 自己的工具。
   - 必须放在读到 `agentCtx` 之后：`installCmdSession` 需要它（先声明后使用，否则 TS2448）。

### 4.2 bash 路径（`src/replace.ts:129-256`）

1. 探测 `tools` / `systemPrompt`（`ctx.get`，非硬依赖）；缺失 → `skip('missing-service', ...)`。
2. **幂等**：`tools.get('bash', agent) !== undefined` → `skip('already-replaced')`（重试 / 自带 bash 的自定义 preset / 上次残留）。
3. **先发现后动树**：`discoverBash({...})`，找不到 → `skip('bash-not-found', detail)`（`detail` 列出每个被拒候选及原因）。
4. 计算 `bashInstallRoot(found.path)` 与 `bashPathEntries(...)`。
5. 打开 `const shellCtx = agentCtx.isolate('shell')`；
   - `await shellCtx.plugin(GitBashExecutor, {...executorConfig(snapshot), bashPath, pathEntries, loginShell, pythonUtf8})`；
   - `await shellCtx.plugin(ToolBash, { enableRunInBackground: true, promoteOnTimeout: true })`；
   - 两个 fiber 句柄记入 `fibers[]`。
6. **验证工具确实出现**：`tools.get('bash', agent) === undefined` 就 `throw`（进入统一回滚），因为「先遮 pwsh 再发现没 bash」会让会话没有终端工具。
7. 若继承到 `pwsh`：`undo.push(tools.restrict({ deny: ['pwsh'] }))`；并尝试 `systemPrompt.section({ name:'tool:pwsh', order: getSectionOrder('TOOL_PWSH') ?? 1010, text: '' })`（空段在渲染时被丢弃）。若 `pwsh` 段注册失败，只 `warn` 不失败——bash 工具本身才是会话可用的关键。
8. `agentCtx.effect(() => () => { for (const d of undo.reverse()) d() })`：disposer 交给 agent fiber，会话结束逆序执行。
9. 返回 `{ status:'installed', bashPath: found.path }`。

### 4.3 cmd 路径（`src/replace.ts:275-416`）

结构上镜像 bash，三处差异是关键：

1. **只接受 `agentCtx`，绝不拿根 ctx**：`tools.restrict()` 在 context-global scope 上会抛（“a context-global restriction would mask every agent”），`systemPrompt.section()` 挂在根上会把 `tool:cmd` 与被压空的 `tool:pwsh` **泄漏给所有会话**。
2. 遮的是**两个**继承工具，但只遮**实际可见**的：`const inherited = ['pwsh','bash'].filter(n => tools.get(n, agent) !== undefined)`，再 `tools.restrict({ deny: inherited })`。`restrict` 对未知名字会抛（preset 可能已在共享 scope 里重挂 `tool-bash`）。
3. `tool:cmd` 段只在这里注册一次（`NamedEntries` 同 scope 重名会抛，故 `ToolCmd.apply()` 不得再注册）。

其余：先 `discoverCmd(snapshot.cmdPath)`，找不到 → `skip('cmd-not-found', ...)`；`cmdCodePage !== 65001` 时 `warn`（Harness 恒按 UTF-8 解码）；挂 `CmdExecutor`（带 `cmdPath`/`pathEntries`/`codePage`/`pythonUtf8`/`confinedPolicy: cmdConfinedPolicy`）与 `ToolCmd`；验证 `tools.get('cmd', agent)` 存在；注册 `tool:cmd` 段（`order: getSectionOrder('TOOL_PWSH') ?? 1010`）；任何异常 → `skip('cmd-mount-failed', detail)`。返回 `{ status:'installed', bashPath: found.path, cmdPath: found.path }`（`bashPath` 暂时继续承载可执行文件路径，见 §15）。

### 4.4 deny 列表与 prompt section 一览

| 方言 | `tools.restrict` deny | 被压空的 `systemPrompt.section` | 新增段 |
|---|---|---|---|
| bash | `['pwsh']`（仅当继承可见） | `tool:pwsh`（`TOOL_PWSH_ORDER = 1010`） | 复用官方 `tool:bash`（`TOOL_BASH_ORDER = 1000`） |
| cmd | `['pwsh','bash']` 中实际可见者 | 各自 `TOOL_PWSH_ORDER`/`TOOL_BASH_ORDER` | `tool:cmd`（`order` 取 `TOOL_PWSH` 的槽位） |

### 4.5 回滚与失败降级

- 正常路径：disposer 交给 `agentCtx.effect`，随会话 fiber 析构**逆序**执行。
- 部分安装失败：`catch` 里对 `undo.reverse()` 逐个调用、对 `fibers.reverse()` 逐个 `await dispose()`，然后返回 `skipped`（bash 为 `mount-failed`，cmd 为 `cmd-mount-failed`）。
- `src/index.ts:178-185` 还有一层兜底 `try/catch`：万一 `installSession` 自己抛了，记 `{status:'skipped', reason:'mount-failed'}` 并写诊断，**绝不**让异常逃进 `agent/created`。
- 失败语义统一为「留在官方工具上」：会话照常可用，只是 shell 不是用户选的那个，原因进 `%TEMP%\dsh-terminal-shell.log`。

### 4.6 `tools.restrict` 只作用于继承层

`restrict({deny})` 过滤的是 agent **从祖先继承**的可视工具集，不删除、不改写 preset 里的注册；因此它既能去掉 preset 的 `pwsh`，又不影响 preset 的其它工具。副作用：若某个组合根本没有 `pwsh`，`restrict(['pwsh'])` 会因名字未知而抛——所以代码先 `tools.get('pwsh', agent)` 探测再决定是否 deny（`src/replace.ts:201`、`src/replace.ts:339`）。

---

## 5. 沙箱策略

### 5.1 两方言两值

| 字段 | 取值 | 默认 | 位置 |
|---|---|---|---|
| `confinedPolicy`（Git Bash） | `unconfined` \| `escalate` | `unconfined` | `src/config.ts:74`、类型在 `src/shared/protocol.ts:62` |
| `cmdConfinedPolicy`（cmd） | `escalate` \| `unconfined` | `escalate` | `src/config.ts:111`、类型在 `src/shared/protocol.ts:71` |

0.2.1 起**两端都没有 `fail`**：`LaunchPlan`/`CmdLaunch` 都没有 fail 分支（`src/confined.ts:69`、`src/cmd/types.ts:78`）。

### 5.2 默认差异与平台事实

- **bash 默认 `unconfined`**：Windows 沙箱会把子进程降到 Low integrity，MSYS2 在受限令牌下初始化命名共享内存失败（`NtCreateDirectoryObject(...\BaseNamedObjects\msys-)` / `Couldn't create signal pipe`，退出码 `0xC0000022`/`0xC0000142`，见 `src/confined.ts:21-32`）。默认直接启动可保证「装了就可用」，代价是该子进程不在文件沙箱内。
- **cmd 默认 `escalate`**：`cmd.exe` 能在受限令牌下正常启动，而且它正是官方 windows-acl 后端用来做**功能探针**的程序（`cmd /c exit 0`）。因此受限策略值得尊重，拒绝时上报为沙箱拒绝，让模型的 `sandbox_permissions: danger-full-access` 走官方审批。
- `escalate` 从不代表插件自己去批准；它只是让官方 `tool-bash`/`tool-cmd` 暴露 `sandbox_permissions`。

### 5.3 `planLaunch`（`src/confined.ts:84`）

```ts
planLaunch({
  hasSandbox, policyMode, choice, platform,
}): { kind: 'confine' } | { kind: 'direct' } {
  //   !hasSandbox || policyMode === undefined → direct
  //   policyMode === 'danger-full-access'      → direct
  //   platform !== 'win32'                     → confine
  //   choice === 'unconfined'                  → direct
  //   否则                                     → confine
}
```

非 Windows 的 MSYS 能在沙箱内启动，所以那里 `confine` 是安全的；Windows 上受限启动会崩（见 4.2），故由 `choice` 决定。

### 5.4 `planCmdLaunch`（`src/cmd/executor.ts:80`）

```ts
planCmdLaunch(
  hasSandbox: boolean,
  policyMode: SandboxMode | undefined,
  choice: CmdConfinedPolicy,
): { kind: 'confine'; mode: SandboxMode } | { kind: 'direct'; mode: 'danger-full-access' } {
  //   !hasSandbox || policyMode === undefined → direct/danger-full-access
  //   policyMode === 'danger-full-access'      → direct/danger-full-access
  //   choice === 'unconfined'                  → direct/danger-full-access
  //   否则                                     → confine/mode
}
```

它**故意不复用** `planLaunch`：后者编码的是「MSYS2 不能在受限令牌下启动」，对 cmd 恰好相反。也没有 `fail` 分支，因为不存在「因沙箱原因无法启动 cmd」的情况。

### 5.5 `sandboxMode()` 契约

`tool-bash` / `tool-cmd` 通过执行器的 `sandboxMode` 决定是否向模型暴露 `sandbox_permissions`。因此**只有下一次启动真的会受限时**才返回 mode；会把命令放到沙箱外时返回 `undefined`（否则等于向模型承诺一个不存在的提权）。

- `GitBashExecutor.sandboxMode`（`src/executor.ts:132`）：`sandbox`/`sandboxPolicy` 任一缺失 → `undefined`；`bypassesSandbox(mode)`（即 `planLaunch(...).kind === 'direct'`）→ `undefined`；`danger-full-access` 视为可见（它确实不受限）。
- `CmdExecutor.sandboxMode`（`src/cmd/executor.ts:156`）：同样逻辑，但用 `confinedPolicy === 'unconfined'` 直接判定。

---

## 6. 极简模式（`minimal` / `minimal-gitbash`）

### 6.1 三种模式（`minimalMode`，`src/config.ts:129`，默认 `oneshot`）

| 值 | 含义 | 对 `minimal` 会话的处理 |
|---|---|---|
| `leave` | 完全不碰 minimal | `skip('minimal-left', 'leave')` |
| `oneshot` | 沿用 0.5 前行为 | minimal 会话也得到一次性 Git Bash（走 bash 路径） |
| `variant` | 不碰 minimal 会话 + 注册 `minimal-gitbash` 变体 | `skip('minimal-left', 'variant')`；变体存在，供**新**会话选择持久 Git Bash |

`minimal` 是官方唯一运行**持久** shell 的 preset，Windows 上是持久 PowerShell。一次性替换无法改变它，所以持久 Git Bash 只能靠第二个 preset 变体。

### 6.2 `minimal-gitbash` 的生成（`src/preset.ts`）

- 常量：`VARIANT_ID = 'minimal-gitbash'`、`MINIMAL_ID = 'minimal'`、`BACKEND_TYPE = 'gitbash'`、`PTY_ROW_ID = 'gitbash-pty'`、`PTY_ROW_NAME = 'dsh-terminal-shell/pty'`、显示名 `极简模式 · Git Bash`、注册 `order: 3.1`。
- `cloneMinimalForGitBash(rows, spec)`（`src/preset.ts:90`）**纯函数**，`structuredClone` 后做三件最小替换：
  1. 从 `persistent-shell` 组里过滤掉 `terminal-pwsh` 与 `persistent-pwsh`；
  2. 找到 `persistent-bash`，删其 `disabled`，把 `config.backendType` 设为 `BACKEND_TYPE`；
  3. 在 `pty` 行之后插入我们的后端行（`id: gitbash-pty`, `name: dsh-terminal-shell/pty`, `config` 内嵌 `bashPath`/`confinedPolicy`/`loginShell`/`pythonUtf8`）。
  - 文档由 `agentPresets.readDocument('minimal')` 取得，用 `!!js` 标签的 YAML schema（`JSON_SCHEMA.extend(JsExpr)`）解析/序列化，保持 loader 方言一致。
- 注册失败不抛：`register` 不会因「挂载失败」而 reject，失败记录在定义上，`verify()` 通过 `list()` 名册检查 `broken` 才报 `failed`（`src/preset.ts:351-366`）。

### 6.3 引用计数与保留

`converge`（`src/preset.ts:309`）在「不再需要变体」时先数引用：

- `countReferences`：遍历 `sessions.list()` 的投影（`agentPreset`），计 live；
- `countPersistedReferences`：扫 `sessionQuery.listSessions()` 的 header；
- 两者相加 `> 0` → 状态 `retained`（**不注销**），因为注销会让这些会话无法打开（`presets.resolve` 抛 `agent-preset/not-found`，官方无回退）；`== 0` → `unregisterVariant()` → `absent`。
- 输入签名变化（`bashPath`/`confinedPolicy`/`loginShell`/`pythonUtf8`）会触发重建；仍绑旧 revision 的会话继续用旧定义。

### 6.4 cmd 下只有两值

cmd 方言**没有持久后端**，所以 cmd 的极简行只提供 `leave` 与 `oneshot`（文案 `row.minimal.oneshotCmd` = 「单次 cmd」），不提供 `variant`——「添加新预设」只会创建一个持久 **bash** 变体，对 cmd 无意义（`src/client/row.tsx:321-324`）。

---

## 7. CMD 方言

### 7.1 为什么传输用一次性批处理脚本（`src/cmd/script.ts:8-25`）

执行缝只传 argv，而 `CreateProcessW` 用 `CommandLineToArgvW` 规则重新引号，cmd.exe 并不遵循这些规则。实测（Windows 11 / Node 24）：

- 内联形式要么把引号双重转义，要么被 `/s` 剥掉；
- 环境变量形式拒绝第二次 `%VAR%` 展开，并在第一个换行处截断；
- stdin 会变成交互式提示。

一次性 `.cmd` 文件是唯一能保留用户/模型期望语义的传输：引号保持字面、`%VAR%` 展开、多行与块可用、`exit /b N` 传到进程退出码。

- 每个执行器一个临时 scratch 目录（`ensureScratchDir`，名前带 pid+uuid，`SCRATCH_PREFIX = 'dsh-cmd-'`），崩溃后最多一个目录待清；每次执行各自一个 `cmd-<uuid>.cmd`，并发不交错。
- 文件以 UTF-8 **无 BOM** 写入（BOM 会让首个 token 变成 `\uFEFF@echo`，静默破坏回显抑制）。
- `sweepStaleScripts(now, root)`：host load 时删 `dsh-cmd-*` 中 mtime 超过 `STALE_MS = 24h` 的目录，从不抛。

### 7.2 裸名 + `/d /q /c`

`scriptArgv(cmdPath, script)` → `{ argv: [cmdPath, '/d', '/q', '/c', basename(script.path)], cwd: dirname(script.path) }`（`src/cmd/script.ts:143`）。

- **裸文件名，绝不用绝对路径**：`/c` 的引号保留规则只在被引用文本是「纯可执行名」时成立；引用**路径**会被剥引号并在首个元字符（`&` `(` `)` `^` `,` `;` 或成对 `%NAME%`）处断开。裸名对所有这些、以及空格与 `!` 都成立。
- **不用 `/s`**：`/s` 会剥掉最外层引号对，破坏 libuv 给含空格路径加的引号。
- **子进程从 scratch 目录启动**，所以批处理脚本自己 `cd /d`（UNC 用 `pushd`）进入真正的工作目录，并带守卫：`cd ... || (echo ... 1>&2 & exit /b 1)`——否则工作目录在验证与执行间消失时，命令会静默地以全写权限跑在 scratch 目录里。
- 脚本头两行：`@echo off`、`chcp <codePage>>nul`；**不追加** `exit /b %errorlevel%`（直接 `/c <file>` 会以最后一条命令的成功标志退出，与其它 shell 一致）。

### 7.3 `cmdPath` 解析与 `isCmdExecutable`

`discoverCmd(configured, env)`（`src/cmd/discover.ts:49`）三步确定性解析：

1. `configured` 非空、`isCmdExecutable(configured)` 且是文件 → `{ source:'config' }`；
2. `ComSpec`/`COMSPEC` 是文件 → `{ source:'comspec' }`；
3. `%SystemRoot%\System32\cmd.exe` 是文件 → `{ source:'system-root' }`；否则 `undefined`。

`isCmdExecutable(path)`：取 basename（忽略大小写）必须 `=== 'cmd.exe'`。这样 `cmdPath` 指向一份 Command Prompt 副本是允许的，但误填 `bash.exe` 会被忽略（否则每个 cmd 会话都会用 cmd 的契约去跑 Git Bash）。cmd 永远不从 `PATH` 取——被劫持的 PATH 不应决定会话用哪个 shell。

### 7.4 代码页

`cmdCodePage` 默认 `65001`（UTF-8），是让非 ASCII 输出活着穿过管道的唯一取值，因为 Harness 无条件按 UTF-8 解码子进程输出。批处理以 `chcp <codePage>>nul` 切换；设为非 65001 是给「必须看到旧 ANSI 页」的命令留的逃生口，会重新引入乱码（`src/config.ts:85-95`）。`readCodePage` 把 1..65535 之外的任何值回落为 65001（`chcp 0` 表示「保持当前页」，不是用户想要的）。

### 7.5 限制清单（`cmd.exe` 固有）

- 每次调用是**新** shell，状态不跨调用；`cd` 不保留（用 `workdir`）。
- `%~dp0`/`%0`/`%1`..`%9`/`%*` 指向内部批处理文件，**不是**调用者写的命令；要工作目录请用 `%CD%`（`src/cmd/prompt.ts`）。
- 非 UTF-8 代码页会让非 ASCII 输出出现替换字符。
- 无持久终端、无 POSIX 工具链；`cmd` 的 `cmdPath` 只接受 `cmd.exe`。
- 沙箱受限启动依赖官方 windows-acl 后端，缺失时上报 `SandboxUnavailableError`。

### 7.6 与 bash 工具的移植关系

`src/cmd/tool.ts`（1011 行）是 `@deepseek-ai/dsh-tool-bash` 的**方言移植**，不是 import：模型面名字叫 `cmd`、`name = 'tool-cmd'`、`inject = ['tools','shell','systemPrompt','shellEnv','workingDirectory']`，参数为 `description`（先于 `command`）、`command`、`timeoutMs`，可选项含 `workdir` 与 `run_in_background`/`sandbox_permissions`。行为与 bash 工具同构：前台等待 + 超时转后台 job、`renderResult`/`renderPromoted`/`renderJobRead` 渲染、`presentCmdCall`/`presentCmdResult` 卡片、`validateCmdArgs` 校验。差异只在 shell 方言与传输（批处理脚本）——见 §15 为何移植而非抽象。

---

## 8. 设置行（Settings → 通用 → 终端 Shell）

### 8.1 与官方 General 行规范对照

`src/client/styles.ts` 严格模仿官方 General 行的视觉规格（颜色全用 `--dsw-alias-*` 令牌，自动跟随明/暗/系统主题）：

| 官方规范 | 本行实现 |
|---|---|
| 标签 14px / 行高 22px | `.tterm-title`、`.tterm-field-label`（`font-size:14px;line-height:22px`） |
| 说明 12px / 行高 18px | `.tterm-description`（`font-size:12px;line-height:18px`，`label-secondary`） |
| 每行 `.5px` 底边 | `.tterm-row{...border-bottom:.5px solid var(--dsw-alias-border-l2)}` |
| 末行无底边 | `.tterm-row:last-child{border-bottom:none}` |
| 两列骨架、行距 | `.tterm-row{display:flex;justify-content:space-between;gap:24px;padding:16px 0}` |

### 8.2 字段与文案表（`src/client/locales.ts` 为唯一权威）

| 设置项 | locale key（zh 值） | 控件 |
|---|---|---|
| 行标题 | `row.title` = 「终端 Shell」 | — |
| 行说明 | `row.description` = 「选择智能体工具调用终端使用的 shell。改动后仅在新会话生效。」 | — |
| 终端类型 | `row.dialect.label` = 「终端类型」；选项 `row.dialect.pwsh/bash/cmd` | `Menu` |
| Git Bash 路径 | `row.path.label` = 「Git Bash 路径」；`row.path.placeholder`、`row.path.none`、`row.path.missing` | 路径控件（下拉 + `Input`） |
| 沙箱策略 | `row.confined.label` = 「沙箱策略」；`row.confined.unconfined` = 「绕过沙箱」、`row.confined.escalate` = 「申请权限」；说明 `row.confined.description`（`{shell}` 参数） | `Menu` |
| 极简模式 | `row.minimal.label` = 「极简模式」；`row.minimal.leave/oneshot/variant` = 「保持 pwsh」/「单次 bash」/「添加新预设」 | `Menu` |
| cmd 极简 | `row.minimal.cmdDescription`；`row.minimal.oneshotCmd` = 「单次 cmd」 | `Menu`（仅 leave/oneshot） |
| cmd.exe 路径 | `row.cmdPath.label` = 「cmd.exe 路径」；`row.cmdPath.description`、`placeholder`、`invalid` | 路径控件 |
| 代码页 | `row.cmdCodePage.label` = 「控制台代码页」；`row.cmdCodePage.description` | `Input` |
| 状态文案 | `row.discovering` / `row.foundNone` / `row.notSupported` / `row.saveFailed` / `row.requestFailed` / `row.rejected` / `row.unavailable` | hint/error |
| 变体提示 | `row.minimal.variantReady` / `variantRetained` / `variantFailed` | note/alert |

### 8.3 控件实现

- 选择器一律「官方 `Menu` + 自定义 `.tterm-selector` 按钮」：`Selector`（`src/client/row.tsx:88`）包一层 `Menu`，触发器是 `<button className="tterm-selector">`，内含 `.tterm-selector-value` 文本与 `IconChevronDownOutlineRegular`（`.tterm-chevron`），带 `aria-haspopup`/`aria-expanded`/`aria-label`。
- 路径行用 `PathRow`（`src/client/row.tsx:141`）：`>1` 个候选时渲染 `.tterm-path-selector`（下拉），否则渲染 `.tterm-path-input`（`Input`）；在 `blur` 或 Enter 时提交草稿。
- 代码页用官方 `Input`（`inputMode="numeric"`），`onBlur`/Enter 提交，非法值不落盘并回弹（`commitCodePage`）。
- 每次渲染都从 `useStoreState(controller)` 读取状态；`controller.start()` 返回的清理函数在卸载时拆除订阅与重试定时器。

### 8.4 切换即扫描（无独立按钮）

`setDialect`（`src/client/store.ts:359`）先乐观写入 `dialect`，成功（即使被拒）后若 `dialect !== 'pwsh'` 立即 `discover(dialect)`。扫描是**选择的副作用**：bash 走文件系统 sweep，cmd 走 `ComSpec`/`SystemRoot` 确定性解析。挂载时不扫描，`/state` 也不扫描。

### 8.5 路径行的宽度

路径行加 `tterm-row--path` 修饰（`src/client/row.tsx:160`）：`.tterm-row--path .tterm-text{flex:0 1 34%}`、`.tterm-row--path .tterm-path-control{flex:1 1 auto;max-width:none}`——把更多横向空间留给长路径，避免被截断成省略号。

### 8.6 只读 / 不支持态

- `status !== 'ready'`（平台未知或非 win32）→ 组件返回 `null` 整行隐藏；非 win32 时 `start()` 把 `status` 置 `hidden`。
- `settingsAvailable === false` → 显示 `row.unavailable`，不假装能保存。
- `supported === false` → 显示 `row.notSupported`（带 `unsupportedReason`），仍是只读。
- `controlsEnabled = writable && supported && !saving && !discovering`：任一不满足即禁用全部控件。

### 8.7 状态机与重试

- 乐观写入：`setDialect`/`setConfinedPolicy`/`setMinimalMode`/`setBashPath`/`setCmdPath`/`setCmdCodePage`/`setCmdConfinedPolicy` 先改本地 store，再 `mutate`；被拒则由下一次表单快照回滚并显示 `row.rejected`。
- **一次重试**：`write`/`persist` 在 `accepted === false` 且非重试时再试一次（revision fence 竞争），真拒绝（只读）第二次仍失败才报错。
- 发现请求：`fetchCandidates(..., AbortSignal.timeout(REQUEST_TIMEOUT_MS))`，`REQUEST_TIMEOUT_MS = 20_000`；失败时 `DISCOVERY_RETRY_MS = 120` 后单次重试（写操作会让 Host 短暂重挂 entry、`/discover` 路由瞬间消失）。
- 卸载时 `clearTimeout(discoveryTimer)` 并执行所有 disposer，定时器不会活过组件。
- 乐观值保护：`syncSettings` 在 `saving || discovering` 时保留本地路径，避免旧快照把用户刚选的路径清空（`src/client/store.ts:303`）。

### 8.8 locale key 清单（完整，`src/client/locales.ts`）

`row.title`、`row.description`、`row.dialect.label`、`row.dialect.pwsh`、`row.dialect.bash`、`row.dialect.cmd`、`row.path.label`、`row.path.placeholder`、`row.path.none`、`row.path.missing`、`row.confined.label`、`row.confined.description`、`row.confined.unconfined`、`row.confined.escalate`、`row.minimal.label`、`row.minimal.description`、`row.minimal.leave`、`row.minimal.oneshot`、`row.minimal.variant`、`row.minimal.cmdDescription`、`row.minimal.oneshotCmd`、`row.minimal.variantReady`、`row.minimal.variantRetained`、`row.minimal.variantFailed`、`row.cmdPath.label`、`row.cmdPath.description`、`row.cmdPath.placeholder`、`row.cmdPath.invalid`、`row.cmdCodePage.label`、`row.cmdCodePage.description`、`row.discovering`、`row.foundNone`、`row.notSupported`、`row.saveFailed`、`row.requestFailed`、`row.rejected`、`row.unavailable`。

命名空间 `LOCALE_NAMESPACE = 'terminal-shell'`，与 profile entry id 一致，使 slot 的 `locale` 与 `label:()=>t('row.title')` 解析到同一本字典。

---

## 9. 配置模型（`export const Config`，`src/config.ts`）

### 9.1 字段表

所有字段都逐叶 `.volatile()`（schemastery 拒绝在整对象或 volatile 字段内部再标 volatile，故逐个叶子标注）。官方 `LocalBashExecutor.Config.dict` 被**原样展开**——本插件挂载的执行器确实是 `LocalBashExecutor` 子类，复用其公开 schema 可保证超时/输出/宽限语义与第一方一致，并让设置表单暴露同样的旋钮。

| 字段 | 类型 | 默认 | volatile | 含义 |
|---|---|---|---|---|
| `dialect` | `'pwsh'\|'bash'\|'cmd'` | `'pwsh'` | 是 | 会话得到的终端工具；默认不改行为 |
| `bashPath` | `string` | `''` | 是 | 显式 bash 可执行文件；空表示自动发现 |
| `bashCandidates` | `string[]` | `[]` | 是 | 额外发现根/显式可执行文件，优先于内置顺序 |
| `autoDiscover` | `boolean` | `true` | 是 | `bashPath` 为空时是否允许发现 |
| `discoverTimeoutMs` | `number` | `1500` | 是 | 一次发现 sweep 的上界（只 stat 文件系统） |
| `loginShell` | `boolean` | `false` | 是 | 传 `-l` 读取登录 profile |
| `extraPath` | `string[]` | `[]` | 是 | 在安装目录之外追加到子进程 PATH |
| `pythonUtf8` | `boolean` | `true` | 是 | 导出 `PYTHONIOENCODING=utf-8`（F14） |
| `confinedPolicy` | `'unconfined'\|'escalate'` | `'unconfined'` | 是 | Git Bash 受限沙箱行为 |
| `cmdPath` | `string` | `''` | 是 | 显式 `cmd.exe`；空表示 `ComSpec` → `System32` 解析 |
| `cmdCodePage` | `number` | `65001` | 是 | 批处理执行前 `chcp` 的代码页 |
| `cmdConfinedPolicy` | `'escalate'\|'unconfined'` | `'escalate'` | 是 | cmd 受限沙箱行为 |
| `minimalMode` | `'leave'\|'oneshot'\|'variant'` | `'oneshot'` | 是 | 官方 `minimal` 预设的处理方式 |
| （展开自 `LocalBashExecutor.Config.dict`） | 官方字段 | 官方默认 | 逐叶 volatile | `timeoutMs`=120000、`maxTimeoutMs`=600000、`maxOutputBytes`=64000、`maxSpillBytes`=64MiB、`graceMs`=3000 等 |

### 9.2 `snapshotConfig(config) → ConfigSnapshot`

- 每次 `agent/created` 都**重新快照**（`src/index.ts:167`），因为 volatile 字段读的是**当前** profile 值——这就是「改动只对新会话生效」的实现，而插件从不回写 profile。
- `snapshotConfig` 通过 `read()` 兼容两种输入：校验后的 `Volatile<T>`（`.get()`）与未经校验的手写配置（普通值），并做全量兜底（`readDialect`→`pwsh`、`readConfinedPolicy`→`unconfined`、`readCmdConfinedPolicy`→`escalate`、`readCodePage`→65001、`readMinimalMode`→`oneshot`）。快照必须**总是**完整，因为抛错会中断 `agent/created`。
- `Object.freeze` 冻结返回对象；`executorConfig(snapshot)` 只取执行器需要的纯值（`confinedPolicy`、`cwd`、`timeoutMs`、`maxTimeoutMs`、`maxOutputBytes`、`maxSpillBytes`、`graceMs`）作为 `ctx.plugin` 的输入。

### 9.3 为什么不能把 volatile 引用回传给执行器

`ctx.plugin()` 会用手写 schema 再校验一次输入，把 volatile 字段变成 `{ get() }` 引用。若把 `snapshotConfig` 里的引用再塞回去，校验会试图冻结一个函数并失败（`src/config.ts:309-315` 注释）。所以 `executorConfig` 只传**已解引用的纯值**；`config.ts` 的 `read()` 是唯一做「解引用」的地方。

---

## 10. 宿主 / 客户端协议（`src/shared/protocol.ts`）

### 10.1 两个路由

| 常量 | 值 | 方法 | 语义 |
|---|---|---|---|
| `ROUTE_STATE` | `/api/dsh-terminal-shell/state` | POST | 平台、设置可用性、当前值、能力探测；**从不扫描** |
| `ROUTE_DISCOVER` | `/api/dsh-terminal-shell/discover` | POST | 按方言重扫候选（纯查询）；切换方言时调用 |

- 常量还有 `SETTINGS_NAMESPACE = 'terminal-shell'`（必须与 `cordis.patch.yml` 的 `id` 逐字一致）。
- 两者都用 POST：客户端发 JSON body（`{}` 或当前路径），载体本就对每个 `/api` 请求鉴权，没有可缓存收益。
- 路由处理器永远返回 `200`，结果放在 body（`{ok:false,error}` 或视图对象），因为客户端会把非 ok 折叠成裸 `HTTP <status>` 丢失原因（`src/routes.ts:183-188`）。
- 注册经 `ctx.inject(['connection'])`：无 HTTP 载体的 headless 组合里没有该服务，设置行就自然缺省，插件仍通过 profile patch 工作。

### 10.2 视图类型

```ts
export interface StateView {
  platform: 'win32' | 'other'
  settingsAvailable: boolean
  dialect: Dialect
  bashPath: string
  cmdPath: string
  bashCandidates: readonly string[]
  capability: CapabilityView
  minimalMode: MinimalMode
  variant: VariantView
  lastReplace?: ReplaceReport
}

export interface DiscoverView { candidates: readonly CandidateView[] }
export interface CandidateView { path: string; source: DiscoverySource; valid: boolean }
export interface CapabilityView { supported: boolean; reason?: string }
export interface ReplaceReport { at: number; applied: boolean; reason?: string }
export interface VariantView { status: 'absent'|'registered'|'retained'|'failed'; id: string; refs: number; reason?: string }
```

- `StateView`：平台、设置可用性、当前值、能力探测；**刻意不含候选列表**。
- `CandidateView.source` ∈ `saved|configured|candidate|registry|program-files|msys2|cygwin|path|comspec|system-root`（后两者仅 cmd）。
- 内部 `BashCandidate` 与 `CandidateView` 同形，但 Host 还保留被拒候选以便记录**为什么**被拒。

### 10.3 为什么 `/state` 不扫描

一次 bash sweep 会 `reg.exe query` 并 stat 大量候选路径；设置行每次 mount 都读 `/state`。若 `/state` 扫描，打开设置就会卡顿。因此 `/state` 只回读快照；扫描只在 `/discover`（切换方言时）发生。

### 10.4 为什么写入不走路由

浏览器半区通过官方 `configForms` 服务编辑本插件 entry 自己的 Config（`configForms.get('terminal-shell').mutate(...)`）。这样保存落进 profile patch 层，和第一方设置完全一样，loader 会重载 fiber；路由只做读/扫，不承担写职责（`src/routes.ts:20-24`、`src/shared/protocol.ts:13-15`）。

---

## 11. 诊断（`src/diag.ts`）

### 11.1 日志位置

- 默认 `%TEMP%\dsh-terminal-shell.log`（`join(tmpdir(), 'dsh-terminal-shell.log')`）；环境变量 `DSH_TERMINAL_TOOL_DIAG_FILE` 可覆盖（selftest 用）。
- 单文件 append-only，每行 `[ISO 时间戳] message\n`；`writeDiagnostic` 全程 `try/catch`，**写日志失败永不成为会话失败**。
- 消息前缀区分语义：`ok ...`（成功替换）、`warn ...`（非致命）、`skip ... reason=...`（放弃替换）、`error ...`（意外）。

### 11.2 `SkipReason` 表（全量联合，与 `src/diag.ts:52-68` 一致）

| 值 | 何时产生 | 是否当前发射 |
|---|---|---|
| `not-win32` | 非 Windows | 是 |
| `dialect-pwsh` | `dialect === 'pwsh'` | 是 |
| `no-agent-context` | `agent.ctx` 缺失 | 是 |
| `already-replaced` | 已有 `bash`/`cmd` 工具，或 preset 是 `minimal-gitbash` | 是 |
| `bash-not-found` | 发现不到可用 Git Bash | 是 |
| `missing-service` | `tools` 或 `systemPrompt` 不可见 | 是 |
| `minimal-left` | `minimal` 且 `minimalMode !== 'oneshot'` | 是 |
| `mount-failed` | bash 挂载中途异常 | 是 |
| `dialect-cmd` | （保留）请求 cmd 但会话保留拥有终端的 preset | **否（当前未发射）** |
| `cmd-not-found` | `cmdPath`/`ComSpec`/`SystemRoot` 都解析不到 | 是 |
| `cmd-script-failed` | （保留）批处理写不进 scratch 目录 | **否（当前未发射）** |
| `cmd-mount-failed` | cmd 执行器或 `tool-cmd` 挂载异常 | 是 |

> `dialect-cmd` 与 `cmd-script-failed` 在联合类型里声明但当前没有调用点（`grep` 只在 `src/diag.ts` 命中定义）；cmd 会话在 preset 守卫处走的是 `minimal-left`/`already-replaced`，脚本/挂载失败统一折叠为 `cmd-mount-failed`。类型保留是为将来区分场景，属「声明但未使用」。

### 11.3 失败语义

一切失败都收敛为「留在官方工具」：会话照常可用，只是 shell 未切换；原因写入诊断日志与 `lastReplace`（`ReplaceReport`），设置行可通过 `/state` 看到最近一次结果。插件从不把诊断失败或替换失败升级为会话失败。

---

## 12. 模块地图

> 依赖方向：`src/shared/protocol.ts` 是**唯一**允许被 host 半区与 client 半区共同 import 的模块（纯数据，无 node/DOM/React）。client 半区**只**允许依赖它。

### 12.1 宿主侧核心

- **`src/index.ts`** — cordis 插件入口：`name='terminal-shell'`、`inject=[]`（服务用 `ctx.get` 探测）、`apply()` 编排扫描/变体/路由/`agent/created` 监听；提供 `probeCapability`、`installResultFor`、`dialectOf`。依赖 `config`/`replace`/`routes`/`preset`。单独成文件因为它是唯一的资产编排点；`results` Map 按 agent 记忆最近安装结果，`lastReplace` 供设置行。
- **`src/config.ts`** — `Config`（zod）与 `snapshotConfig`、`executorConfig`、`read*` 兜底、`DEFAULTS`。只有它做「volatile 解引用」。单列是因为配置是设置表单投影的前提。
- **`src/confined.ts`** — `ConfinedPolicy` re-export、MSYS 拒绝签名/退出码、`isMsysStartupDenial`、`planLaunch`/`LaunchPlan`。Git Bash 专用启动决策，与 cmd 的决策分离（§15）。
- **`src/executor.ts`** — `GitBashExecutor extends LocalBashExecutor`：覆盖 `argv`/`resolve`/`execute`/`sandboxMode`/`onProcessDone`；`decorateResult`。只改「用哪个 bash、PATH 注入、沙箱决策」，其余第一方行为全部继承。
- **`src/pty.ts`** — `./pty` 入口（`terminal-shell-pty`）：构造 `BashTerminalBackend` 并注入 `spawnTerminal`，用 `ctx.effect(() => ctx.terminals.registerBackend(backend))` 绑定 fiber。单独入口，因为依赖 `@deepseek-ai/dsh-terminal-bash`（并非所有部署都有）。
- **`src/preset.ts`** — `minimal-gitbash` 变体：`cloneMinimalForGitBash`、YAML（`!!js`）解析/序列化、`createVariantManager`、`resolveVariantSpec`。preset 文档操作与生命周期管理器，和会话替换解耦。
- **`src/replace.ts`** — `installSession` + `installCmdSession`：两条安装路径、deny/section/回滚、`InstallResult`。会话替换的唯一实现；`testing.ts` re-export 它。
- **`src/routes.ts`** — `createHandlers`（纯函数）/`registerRoutes`：`/state`、`/discover`。读/扫表面，与写入（configForms）分离。
- **`src/discover.ts`** — `discoverBash`（首个可用）/`scanBashCandidates`（全部）/`enumerateCandidates`；注册表 `reg.exe`、环境根、PATH 派生；排除 WSL。纯文件系统 + 一次廉价 `reg.exe`；与 cmd 的确定性解析是两套（§15）。
- **`src/paths.ts`** — `bashInstallRoot`、`bashPathEntries`、`composePath`、`validateBashPath`、`isWslBash`、`candidateExecutables`、`pathKey`/`samePath`。路径算术独立可测（selftest 主战场）。
- **`src/diag.ts`** — `diagnosticPath`、`writeDiagnostic`、`SkipReason`、`skip`/`warn`/`note`。诊断是横切关注点，单独成文件避免循环依赖。
- **`src/types.ts`** — `DiscoverySource`、`DiscoveredBash`、`DiscoveryReport`。只在「对应服务可选」时才把第一方类型本地化，避免硬依赖。
- **`src/testing.ts`** — 仅测试用入口：re-export `installSession`/`snapshotConfig`/`GitBashExecutor`/`discoverBash`/`planLaunch`/cmd 全套/变体函数。运行时无人 import；`build.mjs` 单独打 `lib/testing.js`。

### 12.2 cmd 半区

- **`src/cmd/types.ts`** — cmd 契约：`CmdSource`/`CmdLocation`/`CmdScript`/`CmdScriptOptions`/`CmdLaunch`/`CmdConfinedPolicy` re-export；纯类型无 node/cordis。四个 cmd 模块的形状中心，避免环（见其文件头依赖图）。
- **`src/cmd/script.ts`** — 传输：`renderCmdScript`、`materializeCmd`、`scriptArgv`、`ensureScratchDir`、`sweepStaleScripts`、`escapeBatchPath`。与执行器分离，纯 I/O 可单测（cmdunittest）。
- **`src/cmd/executor.ts`** — `CmdExecutor extends LocalBashExecutor`：`planCmdLaunch`、`resolve`、`execute`、`sandboxMode`、`onProcessDone`、`decorateResult`。cmd 的 argv/PATH/编码/沙箱决策，同样只覆盖必要方法。
- **`src/cmd/tool.ts`** — `tool-cmd`：模型面 `cmd` 工具（`name='tool-cmd'`，`inject=['tools','shell','systemPrompt','shellEnv','workingDirectory']`）。官方 bash 工具的方言移植（§15）。
- **`src/cmd/discover.ts`** — `isCmdExecutable`、`discoverCmd`、`scanCmdCandidates`。确定性解析，与 bash sweep 分属两套。
- **`src/cmd/prompt.ts`** — `CMD_PROMPT_SECTION`：`tool:cmd` 提示词文本（说明 cmd 方言与批处理传输事实）。文本独立，供 installer 与工具共享而不互相 import。

### 12.3 client 半区（只依赖 `src/shared/protocol.ts`）

- **`src/client/index.ts`** — client 入口：`inject=['slots','locale']`、`GENERAL_ITEM_ID='terminal-shell'`、`GENERAL_ITEM_ORDER=60`、`seatRow`、`apply`；`configForms` 走 `ctx.get`+延迟 `ctx.inject`。只硬依赖 slots/locale，避免 configForms 未就绪把入口卡成 pending。
- **`src/client/row.tsx`** — `TerminalToolRow` 组件：渲染各控件、草稿状态、路径行、代码页。纯展示 + 调用 controller。
- **`src/client/store.ts`** — 行控制器与状态机：`createRowController`、`createStore`、各类 `normalize*`、`knownPaths`/`knownCmdPaths`、乐观写/重试/发现。逻辑集中在此，便于 rowselftest 无 DOM 测试。
- **`src/client/api.ts`** — `fetchState`/`fetchCandidates`/`RouteError`：两个 `/api` 的 POST 封装。传输层独立。
- **`src/client/locales.ts`** — `LOCALE_NAMESPACE` + `zh`/`en` 字典。文案唯一权威。
- **`src/client/styles.ts`** — 行布局 CSS 字符串，模块物化时 `injectStyles()`（`data-plugin` + `data-plugin-css`）。无 sidecar CSS，样式随脚本走。
- **`src/client/types.ts`** — 结构化的 cordis 服务接口（`ConfigFormLike`/`SlotsService`/`LocaleService`/`ClientContext` 等）与 `TerminalToolValues`。不求第一方声明布局，只列本插件调用面。

### 12.4 共享

- **`src/shared/protocol.ts`** — 双半区共享的纯数据协议（路由、视图、方言/策略/变体类型）。唯一允许双半区共用的模块，因此必须保持无运行时依赖。

---

## 13. 测试

### 13.1 九个脚本

| 脚本 | 用例数 | 覆盖什么 |
|---|---|---|
| `scripts/contractcheck.mjs` | 19 | 静态契约：Config 能投影进设置表单、`cordis.patch.yml` 是合法单行 insert、构建产物导出 cordis 期望的插件形状；对**构建产物 + package manifest** 断言 |
| `scripts/clientsmoke.mjs` | 8 | 以页面方式 `window.__ModuleLoader__.load` 载入 `lib/client.js`，用 stub ctx 驱动 `apply()`，断言行注册进 `settings.general.item` 且有可用 form handle；无 jsdom |
| `scripts/selftest.mjs` | 51 | 无 live harness：`snapshotConfig`、路径算术、PATH 组装、WSL 排除、发现 sweep |
| `scripts/rowselftest.mjs` | 19 | 行控制器全部决策（`store.ts`），`fetch` 按测试 stub |
| `scripts/rendertest.mjs` | 21 | 用 React 18 + jsdom 真实挂载 client bundle，驱动官方控件；抓 hook 顺序、缺 `useEffect`、控件不出现、`onChange` 接错等渲染级 bug |
| `scripts/cmdunittest.mjs` | 37 | `script.ts`/`discover.ts`/`executor.ts` 单测 + 真实 `cmd.exe` 矩阵（守卫、退出码、UTF-8 输出） |
| `scripts/integration.mjs` | 13 | 在一次性 cordis app 里挂真实第一方服务：scoped agent ctx 继承外层 pwsh，再 `installSession()`；验证 bash 落在 agent 自己的工具层、pwsh 消失、`tool:pwsh` 段仅对该 agent 压空、host `ctx.shell` 未动、二次安装为 no-op |
| `scripts/cmdtest.mjs` | 14 | 真实 `cmd.exe` 走真实 `CmdExecutor`（`resolve()`→`execute()`→`result()`）：批处理物化、裸名 argv、受守卫的 `cd`、退出码语义、沙箱启动决策 |
| `scripts/ptytests.mjs` | 3 | `lib/pty.js` 恰好注册一个后端；`unconfined` 启动真的在 ConPTY 里跑 Git Bash 且跨两次 send 保持状态；更严策略拒绝而非静默绕过 |

合计 19+8+51+19+21+37+13+14+3 = **185** 条。

### 13.2 为什么 cmd 测试需要真实 spawn 与 danger-full-access

- `cmd` 的关键性质是**活进程**的性质：`cd` 守卫是否真退出 1、`exit /b N` 是否真传到进程退出码、`chcp 65001` 后 UTF-8 是否真活着穿过管道。对 mock 断言这些等于什么都没证明，所以 `cmdtest.mjs` 与 `cmdunittest.mjs` 都 `spawn` 真 `cmd.exe`。
- 真 spawn 意味着真沙箱：要观察上述行为，测试必须在 `danger-full-access` 下跑（或在无沙箱组合里跑），否则受限启动会干扰对「命令本身」的断言；`planCmdLaunch` 的 `direct/danger-full-access` 分支正是为此可测。
- 传输原语（`renderCmdScript`/`scriptArgv`/`materializeCmd`/`sweepStaleScripts`）已在 `cmdunittest.mjs` 单测，`cmdtest.mjs` 刻意不重复，只测端到端。无法在宿主上跑的矩阵行打印 `(skipped: <reason>)` 计为 skip，绝不伪造 pass。

---

## 14. 与官方规范的一致性（0.2.1 已修）

- **`exports` 七个子路径**：`.`、`./locale/*.json`、`./icon`、`./cordis.patch.yml`、`./package.json`、`./client`、`./pty`（`package.json:39-56`）。
- **`dsh.bundle.patch`**：`./cordis.patch.yml`（`package.json:72-75`）；patch 内容是一条 `insert` 行，`disabled: !!js process.platform !== 'win32'`。
- **`dsh.client`**：`platform: 'web'` + `inject: ['@deepseek-ai/dsh-client-ui-settings-general','@deepseek-ai/dsh-client-locale']`（`package.json:76-82`）。
- **peerDependencies**：`@deepseek-ai/cordis`（`~4.0.5`）与 `@deepseek-ai/dsh-llm`（`>=0.2.1-rc.2 <0.3.0`）都在其中；`@deepseek-ai/dsh-jobs`、`@deepseek-ai/dsh-terminal-bash` 标 `optional`（`package.json:103-116,157-164`）。
- **`build.mjs` 的 `external`**：包含 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-jobs`（以及全部第一方包与 `js-yaml`/`node:*`），避免把第一方类内联——此前 `HarnessError` 被内联导致 `lib/index.js` 膨胀（166KB → 修复后 87KB）。
- **声明文件**：`lib/types/*.d.ts` 由 `build.mjs` **手写生成**（`index.d.ts`、`client/index.d.ts`、`pty.d.ts`），已同步 `cmd` 方言与两值沙箱策略；`tsc --emitDeclarationOnly` 会拖入整个第一方 `.d.ts` 图，故不用。
- **审批走官方流程**：插件从不调用审批、不解析审批结果；`escalate` 只把受限启动失败上报为沙箱拒绝，由官方 `tool-bash`/`tool-cmd` 的 `sandbox_permissions` 流程处理。
- **不读私有字段的例外说明**：插件只通过公开服务/结构读取状态——`sessionProjections.stateOf(session,'agentPreset')`、`agentPresets.readDocument('minimal')`、`presets.list()`、`connection.fetch.register`、`configForms`。`src/pty.ts` 因官方 `ResolvedConfig` 类型未从包根导出且 tarball 不含 `./src/*`，**就地重述**了 `BashTerminalBackend` 构造器接受的结构（`ResolvedBackendConfig`），这是唯一「重述而非 import 类型」的例外，属结构性契约而非私有字段访问。

---

## 15. 设计取舍与「刻意的重复」

| 取舍 | 决定 | 理由 |
|---|---|---|
| `src/cmd/tool.ts` 为何是移植而非共用 | 复制官方 bash 工具的骨架，改方言/传输 | bash 工具把 `['bash','-c',command]` 与 POSIX 描述写死；抽公共层要改第一方包，代价大于一次移植。移植保住 schema/UX/后台 job/渲染一致 |
| `discover` 两套为何不合并 | `src/discover.ts`（bash 文件系统 sweep）与 `src/cmd/discover.ts`（确定性解析）并存 | 候选来源与语义完全不同：bash 要扫注册表/env/PATH 并排除 WSL；cmd 只需 `cmdPath→ComSpec→System32`。合并只会引入与方言无关的分支 |
| prompt 段落分方言 | `tool:pwsh` / `tool:bash` / `tool:cmd` 各自文本 | 三种方言对模型的事实不同（`%VAR%` vs `$VAR` vs `$env:`、批处理传输限制）。共用一段会误导模型 |
| `planLaunch` vs `planCmdLaunch` 位置 | `planLaunch` 在 `src/confined.ts`，`planCmdLaunch` 在 `src/cmd/executor.ts` | 两者编码**相反**的平台事实（MSYS 不能受限 vs cmd 能受限且是功能探针），且 cmd 版无 `fail` 分支。放一起会诱使复用错误前提 |
| 已知可合并但暂不合并（一）：`decorateResult` | `src/executor.ts:305` 与 `src/cmd/executor.ts:334` 各有一份 | 都是 ~10 行的 `execution.result` 原地包装；抽到共享模块会为「几乎不变」的代码制造新依赖边，且两份都强调 handle 身份必须保留。重复成本低于抽象成本 |
| 已知可合并但暂不合并（二）：回滚骨架 | `installSession` 与 `installCmdSession` 的 `undo.reverse()`/`fibers.reverse()` 结构几乎相同 | 两条路径的失败标签（`mount-failed` vs `cmd-mount-failed`）与 deny/section 细节不同；过早抽象会把方言差异塞进参数。当前保持局部清晰 |
| `bashPath` 字段暂时承载 cmd 可执行文件 | cmd 安装结果同时填 `bashPath` 与 `cmdPath` | 该名被 `src/preset.ts:110` 的生成 preset 行与 PTY 后端 config key 引用，改名会拖入客户端可见的 schema 变更；故 cmd 路径作为附加可选字段，重命名留待独立变更 |

---

## 16. 历史文档索引

`docs/history/` 保存开发期的规划与评审记录，按当时版本原样归档，**不是**当前实现说明：

| 文件 | 原用途 | 归档原因 |
|---|---|---|
| [docs/history/README.md](history/README.md) | 历史文档导航 | — |
| [docs/history/PLAN-cmd-dialect.md](history/PLAN-cmd-dialect.md) | `cmd.exe` 方言的 P0/P1 施工单（目标 0.2.0） | 已交付，合并进本文 §7 |
| [docs/history/PLAN-confined-bash.md](history/PLAN-confined-bash.md) | 受限沙箱下 Git Bash 的处理 | 已交付，现行语义见本文 §5 |
| [docs/history/PLAN-minimal-mode.md](history/PLAN-minimal-mode.md) | 官方 `minimal` 预设的三种处理 | 已交付，现行语义见本文 §6 |
| [docs/history/REVIEW-cmd-dialect.md](history/REVIEW-cmd-dialect.md) | `cmd` 方言交付前独立评审（B1–B10 / P1-1–P1-8） | 评审项已全部落地，结论留作追溯 |

> 归档文档里的版本号是重编号前的旧编号（`0.4.x`/`0.5.x`），与当前 `0.2.x` 不是同一套；其中的设置行文案（如「终端工具」「受限沙箱时」）是 0.2.1 改版前的旧文案，现状以 `src/client/locales.ts` 为准。

---

## 附录 A. 补充设计要点

### A.1 加载与生命周期

`cordis.patch.yml` 只有一条 `insert`，`disabled: !!js process.platform !== 'win32'`——非 Windows 上插件根本不会被加载，`probeCapability` 的 `not-win32` 分支只是「被直接 import 时」的防御。`src/index.ts` 声明 `inject = []`，所有服务都在 `apply()` 内用 `ctx.get()` 惰性探测；这样插件在任何组合（含无 connection/无 agentPresets 的 headless）里都能加载，只是相应功能降级。

### A.2 `apply()` 的同步顺序

1. `const snapshot = snapshotConfig(config)`（host 级初值，仅用于 sweep 与变体）；
2. `sweepStaleScripts(Date.now(), scratchRoot)` 清理过期 cmd scratch 目录；
3. 若存在 `agentPresets`：`createVariantManager(...)` 并把当前快照同步进变体（`converge`）；
4. `ctx.on('loader/volatile-update', ...)` 时用新快照重新 `converge`——这样改设置后变体定义跟着更新；
5. `registerRoutes`（若有 `connection`）；
6. `ctx.on('agent/created', ...)` 注册会话替换监听。

每步都在自己的 `try/catch` 或服务探测下，互不影响。

### A.3 HMR / 重载不泄漏

- `src/pty.ts` 用 `ctx.effect(() => ctx.terminals.registerBackend(backend))`：backend 注册随 fiber 析构注销，HMR 或重载不会留下旧 backend。
- 会话内的 `shellCtx` fiber 句柄记入 `fibers[]`，部分安装失败时逐个 `await dispose()`；成功路径交给 `agentCtx.effect`。
- 每条 `agent/created` 都先做幂等检查（`tools.get('bash'|'cmd', agent)`），重试不会叠加第二套工具。

### A.4 中文输出的编码链

MSG/Windows 原生程序常按系统 ANSI 页输出；Harness 统一按 UTF-8 解码。因此本插件做两件事：

- bash 侧：`pythonUtf8` 打开时导出 `PYTHONIOENCODING=utf-8`（F14），只影响 Python 子进程；
- cmd 侧：批处理开头 `chcp 65001`，把控制台输出页切到 UTF-8（§7.4）。

两者都不改变 Harness 的解码方式，只是让子进程「说 UTF-8」。

---

## 附录 B. 关键常量速查

| 常量 | 值 | 位置 |
|---|---|---|
| `TOOL_PWSH_ORDER` | `1010` | `src/replace.ts` |
| `TOOL_BASH_ORDER` | `1000` | `src/replace.ts`（取值沿用官方 `tool-bash` 段位） |
| `GENERAL_ITEM_ID` | `'terminal-shell'` | `src/client/index.ts` |
| `GENERAL_ITEM_ORDER` | `60` | `src/client/index.ts` |
| `LOCALE_NAMESPACE` | `'terminal-shell'` | `src/client/locales.ts` |
| `SETTINGS_NAMESPACE` | `'terminal-shell'` | `src/shared/protocol.ts` |
| `ROUTE_STATE` | `'/api/dsh-terminal-shell/state'` | `src/shared/protocol.ts` |
| `ROUTE_DISCOVER` | `'/api/dsh-terminal-shell/discover'` | `src/shared/protocol.ts` |
| `VARIANT_ID` | `'minimal-gitbash'` | `src/preset.ts` |
| `MINIMAL_ID` | `'minimal'` | `src/preset.ts` |
| `BACKEND_TYPE` | `'gitbash'` | `src/preset.ts` |
| `PTY_ROW_ID` / `PTY_ROW_NAME` | `'gitbash-pty'` / `'dsh-terminal-shell/pty'` | `src/preset.ts` |
| `SCRATCH_PREFIX` | `'dsh-cmd-'` | `src/cmd/script.ts` |
| `STALE_MS` | `24h` | `src/cmd/script.ts` |
| `DEFAULT_CMD_CODE_PAGE` | `65001` | `src/config.ts`、`src/client/store.ts` |
| `REQUEST_TIMEOUT_MS` | `20_000` | `src/client/store.ts` |
| `DISCOVERY_RETRY_MS` | `120` | `src/client/store.ts` |

---

## 附录 C. 术语与缩写

| 术语 | 含义 |
|---|---|
| DSH | DeepSeek Harness，本插件的宿主运行时 |
| entry / entry id | profile patch 里的一行插件条目及其标识（本插件为 `terminal-shell`） |
| preset | 一套可复用的 Cordis 组合（工具、提示词、终端等），是 agent 的共享祖先 scope |
| scope / `isolate` | Cordis 的可见性单元；`isolate('shell')` 生成无可共享标签的私有子树 |
| volatile | schemastery 字段标记：值按读取时实时解析，用于投影进设置表单 |
| fiber | Cordis 的生命周期单元；`ctx.effect` 注册的 disposer 随 fiber 析构逆序执行 |
| `configForms` | 官方设置表单服务；写入落进 profile patch 层，loader 随后重载 fiber |
| PTC | Programmatic Tool Calling，工具以代码方式被调用的渲染/签名路径 |
| ConPTY | Windows 伪控制台，持久终端后端借它承载 Git Bash |
| MSYS2 | Git Bash 的 POSIX 运行时；受限令牌下初始化命名共享内存会失败 |
| snapshot | `snapshotConfig` 产出的、解引用后的完整配置值对象 |
| escalation / `escalate` | 受限启动失败时上报为沙箱拒绝，由官方审批流决定是否提权 |
