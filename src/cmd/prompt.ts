/**
 * The model-facing prompt section for the `cmd` tool.
 *
 * It is registered exactly once, by `installCmdSession` in `src/replace.ts`, as
 * `systemPrompt.section({ name: 'tool:cmd', order: getSectionOrder('TOOL_PWSH'), text: CMD_PROMPT_SECTION })`.
 * It is deliberately NOT registered from `apply()`: `NamedEntries` throws on a
 * duplicate name in one scope, so a section may have exactly one registration
 * site, and keeping the text in its own module lets the tool plugin and the
 * session installer share it without importing each other.
 *
 * The section states the two facts a model cannot infer from the schema alone:
 * the dialect is `cmd.exe` (not POSIX, not PowerShell), and the text is run from
 * a one-shot batch file, so `%~dp0` / `%0` / `%1`..`%9` / `%*` refer to that
 * internal transport file rather than to anything the caller wrote.
 *
 * 关于传输层（这些事实决定了提示词为什么要那样写）：
 *
 * - 执行器用 `cmd.exe /d /q /c <脚本>` 跑一次性批处理文件。`/q` 关闭命令回显，
 *   所以模型看到的 stdout 只有命令自己的输出；命令回显一旦被 `/q` 关掉，在这一次
 *   调用里就按"不可恢复"处理（不要把回显当成可依赖的调试手段）。
 * - `%~dp0` / `%0` / `%1`..`%9` / `%*` 指向的是这个内部脚本及其参数，而不是调用者
 *   写的那行命令：`%~dp0` 是脚本所在目录（scratch 目录），`%0` 是脚本路径。所以
 *   提示词要求用 `%CD%` 取工作目录，而不是 `%~dp0`。
 *
 * @module dsh-terminal-shell/cmd/prompt
 */

/** Prompt-section text for the `cmd` tool (registered under `tool:cmd`). */
export const CMD_PROMPT_SECTION = [
  '## The `cmd` tool',
  '',
  '`cmd` runs a Windows `cmd.exe` command and returns stdout/stderr. Each call is a',
  'fresh shell.',
  '',
  '- The contract is cmd-dialect: native `C:\\...` paths, `%VAR%` for environment',
  '  variables (not `$env:VAR`), `/` switches (`dir /b`).',
  '- The command runs from a one-shot batch file, so `%VAR%` expands, `&`/`&&`/`||`',
  '  chain, pipes and redirection work, and `( )` blocks, `if`, `for`, `call :label`',
  '  and multi-line commands behave as in a `.cmd` file.',
  '- `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to the internal batch file, not to your',
  '  command; use `%CD%` for the working directory.',
  '- Nothing persists between calls. Use `workdir` instead of `cd`.',
].join('\n')
