import type { Dictionary } from './types.ts'

/**
 * Row copy.
 *
 * The namespace is the profile entry id (`terminal-shell`) so `label:()=>t('row.title')`
 * and the row body resolve through the same dictionary the slot declares.
 *
 * Wording follows the official General-section rows: a short noun-phrase title,
 * one factual sentence of description, no marketing language, and no promise the
 * plugin cannot keep. The description says *what the setting changes* and *when*
 * it takes effect, because that is the only thing a user needs to decide.
 */
export const LOCALE_NAMESPACE = 'terminal-shell'

export const zh: Dictionary = {
  'row.title': '终端工具',
  'row.description': '模型执行命令时使用的终端；改动只影响新会话。',
  'row.dialect.label': '终端类型',
  'row.dialect.pwsh': 'PowerShell（pwsh）',
  'row.dialect.bash': 'Git Bash（bash）',
  'row.dialect.cmd': '命令提示符（cmd）',
  'row.path.label': 'Git Bash 路径',
  'row.path.placeholder': '例如 C:/Program Files/Git/bin/bash.exe',
  'row.path.none': '尚未选择',
  'row.path.missing': '点「自动发现」扫描本机，或直接填入 bash.exe 的完整路径。',
  'row.confined.label': '受限沙箱时',
  'row.confined.description':
    'Windows 沙箱会把命令降到低完整性，Git Bash 无法在其中启动；这里决定此时怎么办。',
  'row.confined.unconfined': '直接启动（不经沙箱）',
  'row.confined.escalate': '受限执行，失败后升级',
  'row.confined.fail': '报告错误',
  'row.confined.unconfinedNotice': '注意：选它之后，模型执行的命令不受文件沙箱限制。',
  'row.minimal.label': '极简模式',
  'row.minimal.description':
    '只影响使用官方「极简模式」预设的会话：保持官方的持久终端，或让本插件的 bash 接手。',
  'row.minimal.leave': '保持官方持久终端',
  'row.minimal.oneshot': '换成一次性 bash',
  'row.minimal.variant': '添加 Git Bash 变体',
  'row.minimal.variantReady': '已在预设列表中添加「{id}」，新建会话时可选。',
  'row.minimal.variantRetained': '仍有 {count} 个会话在使用「{id}」，因此没有移除它；这些会话仍然可以打开。',
  'row.minimal.variantFailed': '变体注册失败：{reason}',
  'row.cmdPath.label': 'cmd.exe 路径',
  'row.cmdPath.description': '留空则自动使用系统 cmd.exe（%ComSpec%）。',
  'row.cmdPath.placeholder': '例如 C:/Windows/System32/cmd.exe',
  'row.cmd.limits':
    'cmd 的限制：每次执行都是一段独立的批处理脚本；变量按 %VAR% 展开；脚本里的 %~dp0 指向本插件的内部脚本，而不是你的工作目录；命令回显无法关闭或恢复；非 ASCII 输出取决于下方代码页。',
  'row.cmdCodePage.label': '控制台代码页',
  'row.cmdCodePage.description':
    '执行前先用 chcp 切到该代码页，默认 65001（UTF-8）；纯 ASCII 的命令不需要改。',
  'row.cmdConfinedPolicy.label': '受限沙箱时',
  'row.cmdConfinedPolicy.description': 'Windows 沙箱会把 cmd.exe 降到低完整性；这里决定此时怎么办。',
  'row.cmdConfinedPolicy.escalate': '受限执行，失败后升级',
  'row.cmdConfinedPolicy.unconfined': '直接启动（不经沙箱）',
  'row.cmdConfinedPolicy.unconfinedNotice': '注意：选它之后，模型执行的命令不受文件沙箱限制。',
  'row.discover': '自动发现',
  'row.discovering': '正在扫描…',
  'row.foundNone': '没有找到 Git Bash，请直接填入 bash.exe 的完整路径。',
  'row.notSupported': '当前 DSH 版本不支持自动切换：{reason}',
  'row.saveFailed': '保存失败：{message}',
  'row.requestFailed': '请求失败：{detail}',
  'row.rejected': '宿主拒绝了这次保存（版本冲突或字段不可编辑），请刷新后重试。',
  'row.unavailable': '宿主设置服务不可用，无法保存。',
}

export const en: Dictionary = {
  'row.title': 'Terminal tool',
  'row.description': 'The terminal the model runs commands in; changes apply to new sessions only.',
  'row.dialect.label': 'Terminal kind',
  'row.dialect.pwsh': 'PowerShell (pwsh)',
  'row.dialect.bash': 'Git Bash (bash)',
  'row.dialect.cmd': 'Command Prompt (cmd)',
  'row.path.label': 'Git Bash path',
  'row.path.placeholder': 'e.g. C:/Program Files/Git/bin/bash.exe',
  'row.path.none': 'Not chosen',
  'row.path.missing': 'Choose "Auto-detect" to scan this machine, or type the full path to bash.exe.',
  'row.confined.label': 'Under a confined sandbox',
  'row.confined.description':
    'The Windows sandbox drops commands to low integrity, where Git Bash cannot start; this decides what happens then.',
  'row.confined.unconfined': 'Run directly (no sandbox)',
  'row.confined.escalate': 'Confined, escalate on failure',
  'row.confined.fail': 'Report an error',
  'row.confined.unconfinedNotice': 'Note: with this choice, commands the model runs are not file-sandboxed.',
  'row.minimal.label': 'Minimal mode',
  'row.minimal.description':
    'Only affects sessions using the official "minimal" preset: keep its persistent terminal, or hand them to this plugin\'s bash.',
  'row.minimal.leave': 'Keep the official persistent terminal',
  'row.minimal.oneshot': 'Replace with a one-shot bash',
  'row.minimal.variant': 'Add a Git Bash variant',
  'row.minimal.variantReady': 'Added "{id}" to the preset list; pick it when creating a session.',
  'row.minimal.variantRetained':
    '{count} session(s) still use "{id}", so it stays registered; they can still be reopened.',
  'row.minimal.variantFailed': 'Could not add the variant: {reason}',
  'row.cmdPath.label': 'cmd.exe path',
  'row.cmdPath.description': 'Leave empty to use the system cmd.exe (%ComSpec%).',
  'row.cmdPath.placeholder': 'e.g. C:/Windows/System32/cmd.exe',
  'row.cmd.limits':
    'cmd limits: every call is a separate batch script; variables expand as %VAR%; %~dp0 inside the script points at this plugin\'s internal script, not your working directory; command echo cannot be turned off or restored; non-ASCII output depends on the code page below.',
  'row.cmdCodePage.label': 'Console code page',
  'row.cmdCodePage.description':
    'Switches to this code page with chcp before running; defaults to 65001 (UTF-8). Pure-ASCII commands need no change.',
  'row.cmdConfinedPolicy.label': 'Under a confined sandbox',
  'row.cmdConfinedPolicy.description':
    'The Windows sandbox drops cmd.exe to low integrity; this decides what happens then.',
  'row.cmdConfinedPolicy.escalate': 'Confined, escalate on failure',
  'row.cmdConfinedPolicy.unconfined': 'Run directly (no sandbox)',
  'row.cmdConfinedPolicy.unconfinedNotice': 'Note: with this choice, commands the model runs are not file-sandboxed.',
  'row.discover': 'Auto-detect',
  'row.discovering': 'Scanning…',
  'row.foundNone': 'No Git Bash found. Type the full path to bash.exe.',
  'row.notSupported': 'Not supported by this DSH version: {reason}',
  'row.saveFailed': 'Save failed: {message}',
  'row.requestFailed': 'Request failed: {detail}',
  'row.rejected': 'The host rejected this save (version conflict or a non-editable field). Refresh and retry.',
  'row.unavailable': 'The host settings service is unavailable, so changes cannot be saved.',
}
