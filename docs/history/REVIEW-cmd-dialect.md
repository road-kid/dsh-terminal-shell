# 《PLAN-cmd-dialect.md》最终评审

| 项目 | 内容 |
| --- | --- |
| 评审对象 | `docs/PLAN-cmd-dialect.md`（v2，1426 行，状态「方案待评审（未开工）」） |
| 评审基线 | 插件 `dsh-terminal-shell@0.1.7`，HEAD `37ce291`；DSH `0.2.1-rc.2`；Windows 10.0.26300.9711 / zh-CN / Node v24.19.0 |
| 评审方式 | ① 逐节核对 plan 引用的源码行号与事实；② 用项目 TypeScript 对 §5 的代码骨架做编译级验证；③ 对 `cmd.exe` 行为做 10 组真实进程探针（argv / 元字符 / 退出码 / 编码 / 语法广度 / 沙箱上下文） |
| 结论 | **架构方向成立，功能可实现；但 §5 落地代码与 §5.6 装配点有 10 处必须修正的缺陷（其中 3 处直接编译不过、2 处架构放错层、1 处会让升级审批静默失效），修完才可开工。** |

---

## 0. 结论摘要

1. **架构选点正确，不需要推翻。** 「按会话装配」——`agent/created` → `agentCtx.isolate('shell')` → 自研 `CmdExecutor` + 自研 `cmd` 工具 → `tools.restrict` → 压掉官方提示词段落——是当前 DSH 里唯一可行的 cmd 路线，且已被现有 Git Bash 方言在同一仓库里跑通（`src/replace.ts` 与 `src/executor.ts` 就是活模板）。
2. **传输层结论（临时 `.cmd` 脚本）被实测完全证实**，且比 plan 设想的还要更简单：plan 的「主形态 + `%` 兜底」双路径应当**合并为单一兜底形态**，因为探针证明兜底形态在所有危险字符下都成功，而绝对路径主形态在 `& ( ) ^ , ;` 下全部失败。
3. **沙箱「二态」决策正确且比 bash 更干净**：`cmd.exe` 正是官方 windows-acl 后端的自检探针，因此 `escalate` 默认值成立，`planCmdLaunch` 无 `fail` 分支的论证成立。
4. **问题集中在两层**：
   - **架构放错层 2 处**：`installCmdSession` 用根 `ctx` 而非 `agentCtx` 取 `tools`/`systemPrompt`（会导致 `restrict` 抛错或污染全局层）；方言闸门被放在 preset 守卫之前（会绕过 `minimal`/`minimal-gitbash` 的让位语义）。
   - **代码级 8 处**：3 处编译错误（`agentCtx` 未声明先用、`attached` 作用域、`static inject ... as const`）、1 处静默安全缺陷（`...policy` 展开导致升级审批丢失）、2 处契约缺守卫（后台作业）、2 处移植表遗漏（`startJob`/`waitOnJob`/`approveBashEscalation` 是闭包，`canonicalResult` 名字不存在）。
5. **工作量估计偏低约 10–15%**：新增约 1900 行（plan 估 1750），改动约 400 行（plan 估 350）。主要增量在 `src/cmd/tool.ts`（470 → 约 530 行，需自带 3 个闭包）与传输层单路径化。
6. **建议把 C6（`bashPath` → `executable` 改名）移出本次范围**：该名字贯穿 11 个源文件，并被写入生成的 preset 行与 PTY 后端 config schema，是一次与 cmd 无关的破坏性重命名，会显著抬高回归面。

---

## 1. 架构评审

### 1.1 分层定位：只能在「会话层」装配 —— 成立

plan §3.1 的结论逐条核对无误：

| 候选层 | 判定 | 依据（已核对源码） |
| --- | --- | --- |
| 模型工具层（`dsh-base` patch） | **否** | `dsh-base/cordis.patch.yml` 只有 `bash-sandbox`/`pwsh-sandbox`/`tool-bash`/`tool-pwsh` 四行且按平台互斥，没有 cmd 分支 |
| 官方包 | **否** | 不存在 cmd 版 `tool-*` / `*-local` 包 |
| `ShellExecutor` 契约层 | **是** | `dsh-shell` 的 `ShellExecutor` 只抽象 `resolve()` / `execute()`，方言无关；`LocalBashExecutor` 的一切（deadline、输出收集与溢写、abort 分类、`dshEnv` 合并、结果整形）都可原样继承 |
| 持久终端后端 | **否** | `dsh-terminal-bash` 的 `ShellDialect = 'bash' \| 'pwsh'`，无 OSC-133 支持 |
| 交互式 Web 终端 | **是**（且已是 Windows 默认） | `dsh-api-terminal-controller` 已是默认终端面 |
| 沙箱 | **是** | `windows-acl` 自己的功能探针就是 `cmd /c exit 0` |

**判定：成立。** 继承 `LocalBashExecutor` 只覆盖 `resolve`/`execute`/`sandboxMode` 三处，是本方案最有价值的决策——它把「会话级 deadline、输出上限与溢写、abort 语义、结果 schema」这些最容易写错的东西全部留在第一方实现里。

### 1.2 传输层：临时 `.cmd` 脚本 —— 成立，但应简化

plan §4.2.1 的论证（`SubprocessSpawnSpec.argv` 注释 "Never shell-interpreted here"、cmd.exe 不使用 `CommandLineToArgvW` 规则、内联引号/`/s`/环境变量/stdin 全失败）**已被 10 组探针完全证实**，其中：

- 去掉 `/s` 是**必须的**：`['/d','/s','/c', path]` 在路径含空格时 exit 1，stderr 为 `'C:\Users\John' 不是内部或外部命令`；
- `['/d','/q','/c', path]` 与 `['/d','/c', path]` 行为完全一致（`/q` 只管回显，不影响路径解析）。

**但 plan 的双路径设计有一个实测漏洞**（详见 B8）：绝对路径主形态在路径含 `&`、`(`、`)`、`^`、`,`、`;` 时全部失败——这是 cmd 的 `/c` 引号保留规则（「引号内必须是无特殊字符的可执行文件名」）决定的，与 `%` 无关。而兜底形态（spawn cwd 改为脚本目录 + argv 用裸文件名）在 space / `%` / `x%TEMP%y` / `&` / `( )` / `^` / `,;` / `!` 下**全部成功**。

**判定：架构成立；建议把兜底形态设为唯一形态**，取消 `%` 特判。理由：单一代码路径、无字符集白名单需要维护、探针证明它严格更强。代价是脚本首行必须 `cd /d <workdir>`，且 `%CD%` 在首行会短暂显示 scratch 目录（可在 `cmdDescription()` 里写清）。

### 1.3 沙箱二态 —— 成立，且是本次设计里最干净的一处

`planCmdLaunch` 的四分支（无沙箱/无策略 → direct；`danger-full-access` → direct；`unconfined` → direct；否则 confine）与「无 fail 分支」的论证成立：bash 的 `planLaunch` 之所以有 `fail`，是因为 MSYS2 在受限令牌下起不来；cmd 没有这个约束，所以「不可能因沙箱原因无法启动」是对的。

`CmdExecutor.sandboxMode` getter 的设计尤其正确：

```ts
override get sandboxMode(): SandboxMode | undefined {
  const mode = this.sandboxPolicy?.defaultMode
  if (this.sandbox === undefined || mode === undefined) return undefined
  if (mode === 'danger-full-access') return mode
  return this.confinedPolicy === 'unconfined' ? undefined : mode
}
```

「只有在下次启动真的会受限时才上报 mode」——否则工具会给模型提供一个「点了也没用」的升级选项。这一点比现有 bash 实现更严谨，建议实现时照抄。

**注意一个语义后果**（plan §4.5 已述但值得强调）：Windows 上 bash 会话在 `escalate` 下实际走 direct（MSYS 起不来），而 cmd 会话会真的受限。因此**切到 cmd 方言会让沙箱从「名义受限、实际直跑」变成「真的受限」**，这是行为变化而非 bug，应在发布说明里写清，否则用户会以为插件变严格了。

### 1.4 工具层重写 —— 成立，但移植表低估了工作量

官方 `dsh-tool-bash` 的运行时导出只有 `{ Config, apply, inject, name }`（已用 `import` 实测），工具名与审批 `toolName` 都硬编码在 `apply` 内部，因此**必须 `defineTool` 重写**——这个判断成立。

`defineTool` 的 `parameters` 是「逐属性 spec 映射」而非 JSON-Schema 对象，`output.schema` 支持 `oneOf`（官方自己就用了三分支 `oneOf`），plan §5.4 的写法与之兼容。

**但 §4.4 的「可原样移植函数表」不完整**（详见 B7）：`startJob`、`waitOnJob`、`approveBashEscalation` 三个都是 `apply()` 内部的闭包（`dsh-tool-bash/lib/index.js:390`、`:425`、`:361`），不在顶层；表里写的 `canonicalResult` 根本不存在，真名是 `canonicalBashResult`（`:295`）。由于一个都不导出，"可移植"只能是**逐字复制**，470 行的估计需要上调到约 530 行。

### 1.5 装配点（`src/replace.ts`）—— **架构放错位置，必须修正**

这是本次评审发现的两个架构级问题之一。

plan §5.6 的 diff 把方言闸门改成三分支：

```diff
-  if (snapshot.dialect !== 'bash') {
+  if (snapshot.dialect === 'pwsh') {
+  if (snapshot.dialect === 'cmd') {
+    return installCmdSession(ctx, agent, agentCtx, snapshot)
```

而现有 `src/replace.ts` 的真实顺序是：

| 行 | 内容 |
| --- | --- |
| `:83` | 方言闸门 `if (snapshot.dialect !== 'bash') return skip(...)` |
| `:85` | `const agentCtx = agent.ctx` |
| `:98-102` | preset 守卫：`VARIANT_ID` → skip；`MINIMAL_ID && minimalMode !== 'oneshot'` → skip |
| `:104-105` | `optional<ToolRuntime>(agentCtx, 'tools')` / `optional<SystemPrompt>(agentCtx, 'systemPrompt')` |

两个后果：

1. **编译错误**：闸门在 `:83` 引用 `agentCtx`，而它到 `:85` 才声明 → TS2448。
2. **语义回归**：闸门在 preset 守卫**之前**，一旦改成 `cmd` 分支就直接返回，`VARIANT_ID` / `MINIMAL_ID` 的让位语义被完全绕过。于是「`minimal` 预设 + cmd 方言」的会话会同时拿到持久终端（pwsh）和 `cmd` 工具，并且 `deny: ['pwsh']` 会把持久终端的工具也一起隐藏——直接违反 G8「与 minimal 零干扰」。

**修法**：闸门保持原位但只做「是否进入本插件」的判定，`installCmdSession` 的调用点移到 preset 守卫**之后**，与 bash 路径共用同一段守卫代码；`agentCtx` 的读取提前到闸门之前。

### 1.6 提示词面（`tool:cmd` 段落）—— 结论可行，但理由错误

plan §5.4 末尾断言：

> 提示词段落**不在这里注册**：工具插件挂在 `agentCtx.isolate('shell')` 的子 ctx 上，而段落对 agent 的可见性由 agent 层决定。

**这个理由是错的**，已用项目 TypeScript + 运行时实测证伪：`isolate()` 只做 `this.extend({ [symbols.isolate]: shadow })`，`extend` 用 `Object.create(parent)`，scope 标记是**自有 symbol 属性、沿原型链继承**，因此 `scopeOf(agentCtx.isolate('shell')) === scopeOf(agentCtx)`；而注册层由 `scopeOf(ctx)` 决定。**结论**：官方 `ToolBash` 在 `shellCtx` 上注册的 `tool:bash` 段落**是可见的**，因此 `ToolCmd` 完全可以在自己 `apply()` 里注册 `tool:cmd`。

两个方案都可行，但 plan 必须改成正确的理由：

- 方案 A（plan 的选择）：在 `installCmdSession` 里用 `agentCtx` 注册 —— 好处是与「压空 `tool:pwsh`/`tool:bash`」同层同生命周期；
- 方案 B（官方做法）：在 `ToolCmd.apply()` 里注册 —— 好处是与工具定义内聚。

**唯一硬约束**：`NamedEntries` 在同一层内遇到重名会抛错，所以两处**不能都注册**。

---

## 2. 功能可实现性（G1–G8）

| 目标 | 判定 | 说明 |
| --- | --- | --- |
| **G1** 设置行第三选项 + 新会话得到 `cmd` 工具 | **可实现，但当前方案跑不通** | 依赖 B2（根 `ctx` 取服务）与 B1（闸门位置）修正，否则 `installCmdSession` 会在 `restrict` 处抛错回滚，每次 cmd 会话都落空 |
| **G2** 参数契约与结果三分支与官方同构 | **可实现** | `parameters` 逐属性 spec + `output.schema` 三分支 `oneOf` 均与 `defineTool` 契约兼容（已 tsc 验证）；但需补齐 B6 的四个守卫，否则行为与官方不一致 |
| **G3** 真实 cmd 语义 | **可实现（有 2 处已知偏差）** | 探针已验证 `^` 续行、`&`/`&&`/`||`、管道、重定向、`if/else`、`for /l`、`call :lbl`、`exit /b N` 全部在一次性 `.cmd` 中正常。偏差：① `/q` 会压过脚本内的 `@echo on`，脚本无法重新开启回显；② `%~dp0`/`%0` 指向内部脚本（plan D5 已如实披露，做法正确） |
| **G4** 非 ASCII 正确 | **可实现** | UTF-8 无 BOM + `chcp 65001>nul` 实测输出 `e4b8ade69687e6b58be8af950d0a`（正确 UTF-8）；宿主固定按 UTF-8 解码（`dsh-subprocess-local/lib/output.js:232`）与该方案匹配。注意 CRLF 并非必需（见 P1-1） |
| **G5** 沙箱默认受限 + 逃生 | **可实现，但需一个实测门槛** | `windows-acl` 探针即 `cmd /c exit 0`，说明 cmd 能在受限令牌下启动；**未验证的是**：受限下 `chcp 65001` 是否生效、脚本文件是否可读（ACL 只限写，理论上可读）、`TMP`/`TEMP` 被 runner 重写后是否有影响。plan 已把它列为 T-SBX-ENC，正确；建议升格为**开工门槛**（见 §7） |
| **G6** 后台作业 | **可实现** | `JobKindMap { bash: 'bash' }` → `cmd: 'cmd'` 声明合并 tsc 验证通过（与 `dsh-tool-pwsh` 同款做法）；`processJob` 是模块级函数，可复制 |
| **G7** 新增 skip 原因 | **可实现** | `src/diag.ts` 的 `SkipReason` 为开放联合，加三值无冲突 |
| **G8** 与 bash/minimal/confinedPolicy 零干扰 | **当前方案不成立** | B1（绕过 preset 守卫）+ B2（污染全局层）都会破坏零干扰；修完即成立 |

---

## 3. 阻塞缺陷（开工前必须修正）

> 标记：**[编译]** = 直接编译不过；**[安全]** = 静默错误行为；**[架构]** = 放错层/放错位置；**[功能]** = 功能不成立。

### B1 [架构][编译] 方言闸门位置错误，且引用未声明变量

- 位置：plan §5.6（diff 新增行 `:1133-1136`）
- 现象：`installCmdSession(ctx, agent, agentCtx, snapshot)` 在 `src/replace.ts:83` 被调用，而 `agentCtx` 在 `:85` 才声明 → TS2448；同时该分支位于 preset 守卫（`:98-102`）之前，绕过 `VARIANT_ID` / `MINIMAL_ID` 让位逻辑。
- 后果：编译失败；即使绕过编译，`minimal` 预设 + cmd 方言会同时挂载持久终端与 `cmd` 工具，`deny:['pwsh']` 还会误伤持久终端工具 → 违反 G8。
- 修法：`agentCtx` 读取提前；`installCmdSession` 调用点移到 preset 守卫之后，与 bash 共用守卫段。

### B2 [架构][功能] `installCmdSession` 用根 `ctx` 取 `tools`/`systemPrompt`

- 位置：plan §5.6 `:1149-1150`
  ```ts
  const tools = optional<ToolRegistry>(ctx, 'tools')
  const systemPrompt = optional<SystemPromptService>(ctx, 'systemPrompt')
  ```
  对照现有实现（`src/replace.ts:104-105`）用的是 **`agentCtx`**，而函数签名里明明已经收到了 `agentCtx` 参数。
- 后果（两种都不可接受）：
  1. `tools.restrict()` 在无作用域 ctx 上调用会**抛错**（`dsh-tools` 明确「calling ctx 未作用域化则抛错」）→ 每次 cmd 安装都在 try 里回滚 → **G1 完全不成立**；
  2. 即使不抛错，`systemPrompt.section()` 会落到 **global 层** → `tool:pwsh` 段落对**所有**会话被压空（包括 pwsh 会话）→ 污染全局。
- 附带：该代码块用的类型名 `ToolRegistry` / `SystemPromptService` 在仓库与依赖里都不存在——现有实现导入的是 `ToolRuntime`（`@deepseek-ai/dsh-tools`）与 `SystemPrompt`（`@deepseek-ai/dsh-system-prompt`），见 `src/replace.ts:4-5`。照抄会得到 TS2305。
- 修法：两行都改为 `agentCtx`，并改用 `ToolRuntime` / `SystemPrompt`。

### B3 [安全] `...policy` 展开，升级审批静默失效

- 位置：plan §5.4 `:1032-1039`
  ```ts
  const request = { command: args.command, ..., dshEnv: ctx.shellEnv.collect(exec), ...policy }
  ```
  官方写法是 `...(policy !== undefined ? { sandboxPolicy: policy } : {})`。
- 后果：`SandboxPolicy` 是 `{ mode, workspaceRoot, sessionId? }`，展开后 `mode` 被塞成请求的顶层字段，`request.sandboxPolicy` 仍为 `undefined`。`CmdExecutor.resolve()` 的 `spec.sandboxPolicy ?? this.sandboxPolicy?.resolve()` 会**回落到常设受限策略** → 用户批准了 `danger-full-access`，命令**仍按受限执行**。而且因为对象展开会绕过 TS 多余属性检查，**这个错误编译不报错**（已用 tsc 验证：显式写 `mode:` 才报 TS2353）。
- 修法：`...(policy !== undefined ? { sandboxPolicy: policy } : {})`。并在测试矩阵加一条「批准升级后，结果 `sandbox.mode` 必须等于批准的模式」。

### B4 [编译][功能] `attached` 作用域错误 + `stopped` 语义错位

- 位置：plan §5.4 `:1043-1057`
  ```ts
  if (registry !== undefined && promoteOnTimeout) {
    const attached = startJob(...)          // 块内
    ...
  }
  const stopped = attached?.stopped()        // 块外 → TS2304
  ```
- 附带问题：官方 `waitOnJob` **自己返回完整的 foreground 结果**（含 `stopped`），plan 把它改成返回 `promoted | undefined` 再在外面补 `stopped`，逻辑与官方不再同构。
- 修法：`let attached: Attached | undefined` 提到函数顶部；`stopped` 的组装交回 `waitOnJob`，与官方逐字一致。

### B5 [编译] `static inject = ['subprocess'] as const` 不合法

- 位置：plan §5.3
- 现象：基类 `static inject` 是可变 `string[]`，`as const` 得到 `readonly ["subprocess"]` → TS2417「Class static side incorrectly extends base class static side」。现有 `src/executor.ts` 写的是 `static inject = ['subprocess']`（无 `as const`）。
- 修法：去掉 `as const`。

### B6 [功能] 后台作业缺四个守卫，与官方契约不一致

- 位置：plan §5.4 `:1041-1053`
- 缺失（官方 `execute` 都有）：
  1. `if (!backgroundEnabled) throw new Error(...)`；
  2. `if (jobs === undefined) throw new Error(...)`；
  3. `if (exec.signal.aborted) throw toolAborted()`；
  4. `try { attached = startJob(...) } catch (error) { ctx.logger.warn(...) }` —— 官方允许「转后台失败就退回前台」，plan 无 try/catch，一次作业注册异常就会让整次工具调用失败。
- 后果：违反 G2「结果三分支与官方同构」；`promoteOnTimeout` 路径在作业服务缺失时会静默退化为前台，模型无感知。

### B7 [功能] 移植表遗漏 3 个闭包、1 个名字写错

- 位置：plan §4.4 表格
- 事实：`startJob`（`dsh-tool-bash/lib/index.js:390`）、`waitOnJob`（`:425`）、`approveBashEscalation`（`:361-374`）都是 `apply()` 内部闭包；`canonicalResult` 不存在，真名 `canonicalBashResult`（`:295`）。官方模块**只导出** `{ Config, apply, inject, name }`，其余全部要逐字复制。
- 后果：470 行的估计偏低；`approveCmdEscalation` 若不复制，升级链会缺少「composition 守卫 + toolName」。
- 修法：表格补三行并标注「闭包，需重写」；`canonicalResult` → `canonicalBashResult`。

### B8 [功能] 传输层兜底未接线，且触发条件既错又太窄

- 位置：plan §5.1 `:483-486`（`cmdArgv`）、§5.3 `:754`、`:766`（调用点）
- 事实：
  - `cmdArgv()` 在路径含 `%` 时返回 `basename(scriptPath)`，但两处调用点都是 `cmdArgv(this.cmdPath, script.path)`，**没有把 spawn cwd 改成脚本目录**，`materializeCmd(..., { codePage })` 也**没有传 `chdir`** → 裸文件名在用户的 workdir 下找不到 → 兜底路径本身是坏的。
  - 触发条件写错：探针证明孤立 `%`、不配对 `%` 都**正常**，只有「配对的、指向真实环境变量的 `%NAME%`」才失败。
  - 触发条件太窄：路径含 `&`、`(`、`)`、`^`、`,`、`;` 时绝对路径形态**必然失败**，而 plan 完全没有覆盖。
- 修法（推荐）：**取消双路径，统一用兜底形态**——`executeArgv` 传 `{ ...spec, workdir: scratch }`，脚本首行 `cd /d <真实 workdir>`，argv 固定用裸文件名。探针证明该形态对全部危险字符安全，且跨盘符正常。

### B9 [功能] 审批请求的 `toolName` 未改

- 位置：plan §5.4 `approveCmdEscalation`（`:1028` 调用）
- 事实：官方 `approveBashEscalation` 的 ingredients 里硬编码 `toolName: "bash"`（`dsh-tool-bash/lib/index.js:368`）。plan 全文**没有出现 `toolName`**。
- 后果：cmd 的升级审批对话框/审计记录会显示「bash」——对一个自称「契约与官方一致」的工具是明确缺陷，也影响审批界面的文案。
- 修法：`toolName: 'cmd'`。

### B10 [范围] C6 改名波及面被严重低估

- 位置：plan §10 C6（`bashPath` → `executable`）
- 事实：`bashPath` 出现在 **11 个源文件**：`src/config.ts:35/98/119/210`、`src/discover.ts:115/121/149/208/233`、`src/executor.ts:53/93/153/243`、`src/index.ts:97/162`、`src/paths.ts:52`、`src/preset.ts:63/110/228/283`、`src/pty.ts`（PTY 后端 Config）、`src/routes.ts` 与客户端。其中 `src/preset.ts:110` 把它写进**生成出来的 preset 行**（`PTY_ROW_ID` 的 config：`{ backendType, bashPath, confinedPolicy, loginShell, pythonUtf8 }`），即这个键同时是**用户可见的 preset 配置键**与 **PTY 后端的 config schema 键**。
- 后果：一次纯装饰性重命名，却会同时动到正在稳定工作的持久终端路径与预设 YAML 契约，回归面与收益完全不成比例；且 plan §3.3 声称「`cordis.patch.yml` 不改」，改名后需要迁移逻辑才能兑现。
- 修法：**移出本次范围**；若一定要改，单独开一个 patch，并在 preset spec 上保留 `bashPath` 别名至少一个版本。

---

## 4. 事实性修订（不影响架构，但会被实现者当真的错误断言）

| # | plan 原文 | 实测/源码事实 | 建议 |
| --- | --- | --- | --- |
| P1-1 | G4 / §4.2.2：「UTF-8 无 BOM + **CRLF**」，暗示 CRLF 必需 | **LF-only 脚本完全正常**（含括号多行块、`for /l`） | 保留 CRLF（无害且更贴近真实 `.cmd`），但把「必须」改为「为兼容旧式工具链而统一使用」 |
| P1-2 | §4.2.3 `%` 触发条件 | 孤立 `%`、不配对 `%` 均正常；只有配对且指向真实环境变量的 `%NAME%` 失败；另有 `& ( ) ^ , ;` 一整类未覆盖 | 见 B8，直接取消该触发条件 |
| P1-3 | G3「真实 cmd 语义」 | `/q` **会压过脚本内的 `@echo on`**，脚本无法重新开启回显 | 在 `cmdDescription()` 与 §4.2.2 如实写「回显不可恢复」 |
| P1-4 | §4.9 / §4.5 的 denial 判定 | `matchesSignature` 依赖 provider 提供的 signature 文本；zh-CN 下 cmd 自身诊断是 **GBK 中文**，任何匹配英文 `is not recognized as an internal or external command` 的设计在本机永不命中 | 确认 `windows-acl` 提供的 signature 与语言无关；把「zh-CN 下 denial 判定」列入 T-SBX |
| P1-5 | §5.4 `:1041` 作业接线「与官方 `:714-734` 逐字一致」 | 官方那段里的 `ctx.fiber.state === 2` 是 **ACTIVE**（`FiberState.ACTIVE = 2`），不是 disposed（`DISPOSED = 4`） | 照抄即可，但加注释防止后人「修正」成 4 |
| P1-6 | §5.3 `onStarted` 登记脚本 | `executeArgv` 在**准备阶段超时**时会**跳过** `onStarted`（`if (!preparationTimedOut) onStarted?.(proc)`） | 存在脚本泄漏路径：`confine()` 超时 → `scripts` map 从未登记 → `onProcessDone` 无从 dispose。建议在 `executeArgv` 之前先登记，或在 `finally` 里兜底 dispose |
| P1-7 | §5.4 `order: getSectionOrder('TOOL_PWSH') ?? TOOL_PWSH_ORDER` | `getSectionOrder` 返回 `number`（非 `number \| undefined`），`?? 1010` 是死代码 | 保留无害，但去掉会误导人的 fallback 注释 |
| P1-8 | §5.4 段落注册理由（见 §1.6） | `isolate()` 保留 scope key，`shellCtx` 上注册的段落**对 agent 可见** | 改写成正确理由（二选一实现位置均可） |

---

## 5. 建议（非阻塞，但能显著降低实现与维护成本）

1. **传输层单路径化**（见 B8）：取消主形态，统一「scratch 为 cwd + 裸文件名 + 脚本内 `cd /d`」。少一条分支、少一类字符集判断、少一个只在罕见环境下才被触发的 bug。
2. **把 T-SBX-ENC 升格为开工门槛**：在动手写 `tool.ts` 之前，先用 30 行探针脚本确认「受限令牌下 `chcp 65001` 生效 + scratch 脚本可读」。若失败，`cmdConfinedPolicy` 的默认值必须改成 `'unconfined'` 并调整 §4.5 的表述——这会影响 G5 的卖点，越早知道越好。
3. **`InstallResult` 增加 `cmdPath` 字段**：`src/index.ts:162` 现在写的是 `installed session=${id} bash=${result.bashPath}`，cmd 分支需要对称的日志与字段（plan §5.7 提到了 index.ts 分支，但没说 `InstallResult` 的形状）。
4. **测试矩阵补 4 条**：
   - T-QUOTE 增补「路径含 `&`/`(`/`)`/`^`」与「配对 `%NAME%`」；
   - T-SBX 增补「批准 `danger-full-access` 后结果 `sandbox.mode` 必须等于批准值」（防 B3 复发）；
   - T-LIFE 增补「`confine()` 准备阶段超时后脚本被清理」（防 P1-6）；
   - T-ENC 增补「zh-CN 下 denial 判定命中」。
5. **工作量修正**：新增约 1900 行（`src/cmd/tool.ts` 约 530 行、`script.ts` 约 120 行、`executor.ts` 约 250 行、`discover.ts` 约 60 行、接线与客户端约 300 行、测试约 600 行），改动约 400 行。里程碑 M0–M4 建议加半天给传输层单路径化与沙箱门槛验证。

---

## 6. 残留风险（修完上述缺陷后仍然存在，需在文档中如实记录）

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| `restrict` 无法隐藏**作用域内注册**的工具 | `tools.restrict` 的语义是「限制 global 工具」，作用域内注册的工具仍可见。若某个自定义预设在自己的 agent realm 里重挂 `tool-bash`/`tool-pwsh`，cmd 会话会同时看到两个 shell 工具 | 已用 `deny: [...继承可见项]` 覆盖 global 层；作用域内重挂属于预设作者的选择，文档说明即可（plan §3.2 已引该教训，但结论应写成「无法完全隐藏」而非「已解决」） |
| 受限沙箱下的编码 | 见 §5 建议 2 | 开工门槛实测 |
| `type <gbk 文件>` 透传乱码 | cmd 按活动 CP 转码，UTF-8 源幸免、GBK 源在 65001 下退化为 U+FFFD | plan N4 已如实列为非目标，正确 |
| `/q` 不可恢复 | 见 P1-3 | 描述里写清 |
| `cmd.exe` 被杀进程树 | 依赖 `dsh-subprocess-local` 的 `terminateOwnedJob()` → `terminateJob(api, job, 1)` | plan D10 已正确判定「不需要自己实现 Job Object」 |

---

## 7. 开工前 checklist

- [ ] 修 B1（闸门位置 + `agentCtx` 声明顺序）
- [ ] 修 B2（`installCmdSession` 内 `ctx` → `agentCtx`）
- [ ] 修 B3（`...policy` → `sandboxPolicy: policy`）
- [ ] 修 B4（`attached` 提升作用域；`stopped` 交回 `waitOnJob`）
- [ ] 修 B5（去掉 `as const`）
- [ ] 修 B6（补四个后台守卫）
- [ ] 修 B7（移植表补 3 个闭包 + 改 `canonicalBashResult` 名）
- [ ] 修 B8（传输层单路径化或正确接线兜底）
- [ ] 修 B9（`toolName: 'cmd'`）
- [ ] 决定 B10（建议：C6 移出本次范围）
- [ ] 改 P1-1…P1-8 的表述
- [ ] 实测 T-SBX-ENC 门槛，据此确认 `cmdConfinedPolicy` 默认值
- [ ] 更新 §6 工作量与 §9 里程碑

---

## 附：本次评审的验证方法

- **源码核对**：逐条打开 plan 引用的 `dsh-*` 包（`node_modules/@deepseek-ai/`）与仓库自身 `src/`，核对行号、签名、导出面。
- **编译级验证**：把 plan §5 的代码骨架按原样放进项目 TypeScript 做内存编译（不落盘），得到 B1/B4/B5 的确定性编译错误与 B3 的「能编译但语义错」结论。
- **进程级探针**：10 组真实 `cmd.exe` 调用，覆盖 argv 形态（含 `/s`、预加引号）、路径字符集（空格 `% & ( ) ^ , ; !`）、退出码传播、BOM、编码（CP936 / CP65001）、语法广度（`^` 续行 / 管道 / 重定向 / `if` / `for` / `call`）、`/q` 与 `@echo on` 的相互作用、以及 `spawn` cwd 不存在时的报错归因。
- **未验证项**：受限令牌下的 `chcp` 与脚本可读性（Windows ACL 沙箱需要真实 harness 会话，列为开工门槛）。
