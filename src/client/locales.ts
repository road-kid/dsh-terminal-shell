import type { Dictionary } from './types.ts'

/**
 * Row copy.
 *
 * The namespace is the profile entry id (`terminal-shell`) so `label:()=>t('row.title')`
 * and the row body resolve through the same dictionary the slot declares.
 *
 * Wording follows the official General-section rows: a short noun-phrase title,
 * one factual sentence per row, no marketing language, and no promise the plugin
 * cannot keep. The description says *what the setting changes* and *when* it takes
 * effect, because that is the only thing a user needs to decide. Option labels are
 * the plain names of the things being chosen, not sentences.
 */
export const LOCALE_NAMESPACE = 'terminal-shell'

export const zh: Dictionary = {
  'row.title': '终端 Shell',
  'row.description': '选择智能体工具调用终端使用的 shell。改动后仅在新会话生效。',
  'row.dialect.label': '终端类型',
  'row.dialect.pwsh': 'powershell',
  'row.dialect.bash': 'bash',
  'row.dialect.cmd': 'cmd',
  'row.path.label': 'Git Bash 路径',
  'row.path.placeholder': '例如 C:/Program Files/Git/bin/bash.exe',
  'row.path.none': '尚未选择',
  'row.path.missing': '选择 Git Bash 后会自动扫描本机；也可以直接填入 bash.exe 的完整路径。',
  'row.confined.label': '沙箱策略',
  'row.confined.description': '选择当 Windows 沙箱将命令降为低完整性，{shell} 启动受限时的行为模式',
  'row.confined.unconfined': '绕过沙箱',
  'row.confined.escalate': '申请权限',
  'row.minimal.label': '极简模式',
  'row.minimal.description': '选择「极简模式」预设下 pwsh 持久终端的行为模式，添加新预设使用持久 bash 变体',
  'row.minimal.leave': '保持 pwsh',
  'row.minimal.oneshot': '单次 bash',
  'row.minimal.variant': '添加新预设',
  'row.minimal.cmdDescription': '选择「极简模式」预设下 pwsh 持久终端的行为模式',
  'row.minimal.oneshotCmd': '单次 cmd',
  'row.minimal.variantReady': '已在预设列表中添加「{id}」，新建会话时可选。',
  'row.minimal.variantRetained': '仍有 {count} 个会话在使用「{id}」，因此没有移除它；这些会话仍然可以打开。',
  'row.minimal.variantFailed': '变体注册失败：{reason}',
  'row.cmdPath.label': 'cmd.exe 路径',
  'row.cmdPath.description': '留空则自动使用系统 cmd.exe（%ComSpec%）。',
  'row.cmdPath.placeholder': '例如 C:/Windows/System32/cmd.exe',
  'row.cmdPath.invalid': '这里要填 cmd.exe 的完整路径，不能是 bash 或其它程序。',
  'row.cmdCodePage.label': '控制台代码页',
  'row.cmdCodePage.description': '跟随 Harness 的解码方式，执行前用 chcp 切到该代码页，默认 65001（UTF-8）。',
  'row.discovering': '正在扫描…',
  'row.foundNone': '没有找到可用的终端程序，请直接填入完整路径。',
  'row.notSupported': '当前 DSH 版本不支持自动切换：{reason}',
  'row.saveFailed': '保存失败：{message}',
  'row.requestFailed': '请求失败：{detail}',
  'row.rejected': '宿主拒绝了这次保存（版本冲突或字段不可编辑），请刷新后重试。',
  'row.unavailable': '宿主设置服务不可用，无法保存。',
}

export const en: Dictionary = {
  'row.title': 'Terminal shell',
  'row.description': "The shell the agent's tool calls run in. Changes apply to new sessions only.",
  'row.dialect.label': 'Terminal kind',
  'row.dialect.pwsh': 'powershell',
  'row.dialect.bash': 'bash',
  'row.dialect.cmd': 'cmd',
  'row.path.label': 'Git Bash path',
  'row.path.placeholder': 'e.g. C:/Program Files/Git/bin/bash.exe',
  'row.path.none': 'Not chosen',
  'row.path.missing': 'Choosing Git Bash scans this machine; you can also type the full path to bash.exe.',
  'row.confined.label': 'Sandbox policy',
  'row.confined.description':
    'What {shell} does when the Windows sandbox would drop its command to low integrity',
  'row.confined.unconfined': 'Bypass the sandbox',
  'row.confined.escalate': 'Request permission',
  'row.minimal.label': 'Minimal mode',
  'row.minimal.description':
    'How the "minimal" preset treats its persistent pwsh terminal; a new preset runs a persistent bash variant',
  'row.minimal.leave': 'Keep pwsh',
  'row.minimal.oneshot': 'One-shot bash',
  'row.minimal.variant': 'Add a new preset',
  'row.minimal.cmdDescription': 'How the "minimal" preset treats its persistent pwsh terminal',
  'row.minimal.oneshotCmd': 'One-shot cmd',
  'row.minimal.variantReady': 'Added "{id}" to the preset list; pick it when creating a session.',
  'row.minimal.variantRetained':
    '{count} session(s) still use "{id}", so it stays registered; they can still be reopened.',
  'row.minimal.variantFailed': 'Could not add the variant: {reason}',
  'row.cmdPath.label': 'cmd.exe path',
  'row.cmdPath.description': 'Leave empty to use the system cmd.exe (%ComSpec%).',
  'row.cmdPath.placeholder': 'e.g. C:/Windows/System32/cmd.exe',
  'row.cmdPath.invalid': 'Enter the full path to cmd.exe; bash or another program is not accepted.',
  'row.cmdCodePage.label': 'Console code page',
  'row.cmdCodePage.description':
    'Follows the Harness decoding: switches to this code page with chcp before running; defaults to 65001 (UTF-8).',
  'row.discovering': 'Scanning…',
  'row.foundNone': 'No usable terminal found. Type the full path.',
  'row.notSupported': 'Not supported by this DSH version: {reason}',
  'row.saveFailed': 'Save failed: {message}',
  'row.requestFailed': 'Request failed: {detail}',
  'row.rejected': 'The host rejected this save (version conflict or a non-editable field). Refresh and retry.',
  'row.unavailable': 'The host settings service is unavailable, so changes cannot be saved.',
}