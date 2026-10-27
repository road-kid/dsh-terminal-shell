window.__ModuleLoader__.load({ id: "dsh-terminal-shell", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  GENERAL_ITEM_ID: () => GENERAL_ITEM_ID,
  GENERAL_ITEM_ORDER: () => GENERAL_ITEM_ORDER,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/styles.ts
var PLUGIN_ID = "dsh-terminal-shell";
var STYLE_TAG_ID = "dsh-terminal-shell/row.css";
var CSS = `
.tterm-group{display:flex;flex-direction:column}
.tterm-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.tterm-row:last-child{border-bottom:none}
.tterm-text{display:flex;flex-direction:column;gap:4px;flex:1 1 0;min-width:0}
.tterm-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.tterm-field-label{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.tterm-description{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.tterm-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.tterm-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.tterm-dialect{display:inline-flex;flex:none}
.tterm-selector{box-sizing:border-box;display:inline-flex;align-items:center;gap:12px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.tterm-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.tterm-selector:disabled{cursor:not-allowed;opacity:.4}
.tterm-selector-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.tterm-chevron{flex:none}
.tterm-path-control{display:flex;align-items:center;gap:8px;flex:0 1 auto;width:auto;min-width:0;max-width:min(440px,46%)}
.tterm-row--path .tterm-text{flex:0 1 34%;min-width:0}
.tterm-row--path .tterm-path-control{flex:1 1 auto;max-width:none;min-width:0}
.tterm-path-input{flex:1;min-width:0}
.tterm-path-selector{display:flex;flex:1;min-width:0}
.tterm-path-selector .tterm-selector{width:100%}
.tterm-path-selector .tterm-selector-value{text-overflow:clip}
.tterm-code-page-input{flex:none;width:120px}
`.trim();
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`) !== null) return;
  const style = document.createElement("style");
  style.setAttribute("data-plugin", PLUGIN_ID);
  style.setAttribute("data-plugin-css", STYLE_TAG_ID);
  style.textContent = CSS;
  document.head.append(style);
}
injectStyles();

// src/client/locales.ts
var LOCALE_NAMESPACE = "terminal-shell";
var zh = {
  "row.title": "\u7EC8\u7AEF Shell",
  "row.description": "\u9009\u62E9\u667A\u80FD\u4F53\u5DE5\u5177\u8C03\u7528\u7EC8\u7AEF\u4F7F\u7528\u7684 shell\u3002\u6539\u52A8\u540E\u4EC5\u5728\u65B0\u4F1A\u8BDD\u751F\u6548\u3002",
  "row.dialect.label": "\u7EC8\u7AEF\u7C7B\u578B",
  "row.dialect.pwsh": "powershell",
  "row.dialect.bash": "bash",
  "row.dialect.cmd": "cmd",
  "row.path.label": "Git Bash \u8DEF\u5F84",
  "row.path.placeholder": "\u4F8B\u5982 C:/Program Files/Git/bin/bash.exe",
  "row.path.none": "\u5C1A\u672A\u9009\u62E9",
  "row.path.missing": "\u9009\u62E9 Git Bash \u540E\u4F1A\u81EA\u52A8\u626B\u63CF\u672C\u673A\uFF1B\u4E5F\u53EF\u4EE5\u76F4\u63A5\u586B\u5165 bash.exe \u7684\u5B8C\u6574\u8DEF\u5F84\u3002",
  "row.confined.label": "\u6C99\u7BB1\u7B56\u7565",
  "row.confined.description": "\u9009\u62E9\u5F53 Windows \u6C99\u7BB1\u5C06\u547D\u4EE4\u964D\u4E3A\u4F4E\u5B8C\u6574\u6027\uFF0C{shell} \u542F\u52A8\u53D7\u9650\u65F6\u7684\u884C\u4E3A\u6A21\u5F0F",
  "row.confined.unconfined": "\u7ED5\u8FC7\u6C99\u7BB1",
  "row.confined.escalate": "\u7533\u8BF7\u6743\u9650",
  "row.minimal.label": "\u6781\u7B80\u6A21\u5F0F",
  "row.minimal.description": "\u9009\u62E9\u300C\u6781\u7B80\u6A21\u5F0F\u300D\u9884\u8BBE\u4E0B pwsh \u6301\u4E45\u7EC8\u7AEF\u7684\u884C\u4E3A\u6A21\u5F0F\uFF0C\u6DFB\u52A0\u65B0\u9884\u8BBE\u4F7F\u7528\u6301\u4E45 bash \u53D8\u4F53",
  "row.minimal.leave": "\u4FDD\u6301 pwsh",
  "row.minimal.oneshot": "\u5355\u6B21 bash",
  "row.minimal.variant": "\u6DFB\u52A0\u65B0\u9884\u8BBE",
  "row.minimal.cmdDescription": "\u9009\u62E9\u300C\u6781\u7B80\u6A21\u5F0F\u300D\u9884\u8BBE\u4E0B pwsh \u6301\u4E45\u7EC8\u7AEF\u7684\u884C\u4E3A\u6A21\u5F0F",
  "row.minimal.oneshotCmd": "\u5355\u6B21 cmd",
  "row.minimal.variantReady": "\u5DF2\u5728\u9884\u8BBE\u5217\u8868\u4E2D\u6DFB\u52A0\u300C{id}\u300D\uFF0C\u65B0\u5EFA\u4F1A\u8BDD\u65F6\u53EF\u9009\u3002",
  "row.minimal.variantRetained": "\u4ECD\u6709 {count} \u4E2A\u4F1A\u8BDD\u5728\u4F7F\u7528\u300C{id}\u300D\uFF0C\u56E0\u6B64\u6CA1\u6709\u79FB\u9664\u5B83\uFF1B\u8FD9\u4E9B\u4F1A\u8BDD\u4ECD\u7136\u53EF\u4EE5\u6253\u5F00\u3002",
  "row.minimal.variantFailed": "\u53D8\u4F53\u6CE8\u518C\u5931\u8D25\uFF1A{reason}",
  "row.cmdPath.label": "cmd.exe \u8DEF\u5F84",
  "row.cmdPath.description": "\u7559\u7A7A\u5219\u81EA\u52A8\u4F7F\u7528\u7CFB\u7EDF cmd.exe\uFF08%ComSpec%\uFF09\u3002",
  "row.cmdPath.placeholder": "\u4F8B\u5982 C:/Windows/System32/cmd.exe",
  "row.cmdPath.invalid": "\u8FD9\u91CC\u8981\u586B cmd.exe \u7684\u5B8C\u6574\u8DEF\u5F84\uFF0C\u4E0D\u80FD\u662F bash \u6216\u5176\u5B83\u7A0B\u5E8F\u3002",
  "row.cmdCodePage.label": "\u63A7\u5236\u53F0\u4EE3\u7801\u9875",
  "row.cmdCodePage.description": "\u8DDF\u968F Harness \u7684\u89E3\u7801\u65B9\u5F0F\uFF0C\u6267\u884C\u524D\u7528 chcp \u5207\u5230\u8BE5\u4EE3\u7801\u9875\uFF0C\u9ED8\u8BA4 65001\uFF08UTF-8\uFF09\u3002",
  "row.discovering": "\u6B63\u5728\u626B\u63CF\u2026",
  "row.foundNone": "\u6CA1\u6709\u627E\u5230\u53EF\u7528\u7684\u7EC8\u7AEF\u7A0B\u5E8F\uFF0C\u8BF7\u76F4\u63A5\u586B\u5165\u5B8C\u6574\u8DEF\u5F84\u3002",
  "row.notSupported": "\u5F53\u524D DSH \u7248\u672C\u4E0D\u652F\u6301\u81EA\u52A8\u5207\u6362\uFF1A{reason}",
  "row.saveFailed": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}",
  "row.requestFailed": "\u8BF7\u6C42\u5931\u8D25\uFF1A{detail}",
  "row.rejected": "\u5BBF\u4E3B\u62D2\u7EDD\u4E86\u8FD9\u6B21\u4FDD\u5B58\uFF08\u7248\u672C\u51B2\u7A81\u6216\u5B57\u6BB5\u4E0D\u53EF\u7F16\u8F91\uFF09\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
  "row.unavailable": "\u5BBF\u4E3B\u8BBE\u7F6E\u670D\u52A1\u4E0D\u53EF\u7528\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u3002"
};
var en = {
  "row.title": "Terminal shell",
  "row.description": "The shell the agent's tool calls run in. Changes apply to new sessions only.",
  "row.dialect.label": "Terminal kind",
  "row.dialect.pwsh": "powershell",
  "row.dialect.bash": "bash",
  "row.dialect.cmd": "cmd",
  "row.path.label": "Git Bash path",
  "row.path.placeholder": "e.g. C:/Program Files/Git/bin/bash.exe",
  "row.path.none": "Not chosen",
  "row.path.missing": "Choosing Git Bash scans this machine; you can also type the full path to bash.exe.",
  "row.confined.label": "Sandbox policy",
  "row.confined.description": "What {shell} does when the Windows sandbox would drop its command to low integrity",
  "row.confined.unconfined": "Bypass the sandbox",
  "row.confined.escalate": "Request permission",
  "row.minimal.label": "Minimal mode",
  "row.minimal.description": 'How the "minimal" preset treats its persistent pwsh terminal; a new preset runs a persistent bash variant',
  "row.minimal.leave": "Keep pwsh",
  "row.minimal.oneshot": "One-shot bash",
  "row.minimal.variant": "Add a new preset",
  "row.minimal.cmdDescription": 'How the "minimal" preset treats its persistent pwsh terminal',
  "row.minimal.oneshotCmd": "One-shot cmd",
  "row.minimal.variantReady": 'Added "{id}" to the preset list; pick it when creating a session.',
  "row.minimal.variantRetained": '{count} session(s) still use "{id}", so it stays registered; they can still be reopened.',
  "row.minimal.variantFailed": "Could not add the variant: {reason}",
  "row.cmdPath.label": "cmd.exe path",
  "row.cmdPath.description": "Leave empty to use the system cmd.exe (%ComSpec%).",
  "row.cmdPath.placeholder": "e.g. C:/Windows/System32/cmd.exe",
  "row.cmdPath.invalid": "Enter the full path to cmd.exe; bash or another program is not accepted.",
  "row.cmdCodePage.label": "Console code page",
  "row.cmdCodePage.description": "Follows the Harness decoding: switches to this code page with chcp before running; defaults to 65001 (UTF-8).",
  "row.discovering": "Scanning\u2026",
  "row.foundNone": "No usable terminal found. Type the full path.",
  "row.notSupported": "Not supported by this DSH version: {reason}",
  "row.saveFailed": "Save failed: {message}",
  "row.requestFailed": "Request failed: {detail}",
  "row.rejected": "The host rejected this save (version conflict or a non-editable field). Refresh and retry.",
  "row.unavailable": "The host settings service is unavailable, so changes cannot be saved."
};

// src/client/row.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/shared/protocol.ts
var SETTINGS_NAMESPACE = "terminal-shell";
var ROUTE_STATE = "/api/dsh-terminal-shell/state";
var ROUTE_DISCOVER = "/api/dsh-terminal-shell/discover";

// src/client/api.ts
var RouteError = class extends Error {
  detail;
  constructor(detail) {
    super(detail);
    this.name = "RouteError";
    this.detail = detail;
  }
};
async function post(path, body, signal) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    ...signal === void 0 ? {} : { signal }
  });
  if (!response.ok) throw new RouteError(`HTTP ${String(response.status)}`);
  const payload = await response.json();
  if (payload !== null && typeof payload === "object" && payload.ok === false) {
    const message = payload.error;
    throw new RouteError(typeof message === "string" ? message : "no detail");
  }
  return payload;
}
function fetchState(signal) {
  return post(ROUTE_STATE, {}, signal);
}
function fetchCandidates(dialect, saved, signal) {
  const body = { dialect };
  if (saved !== void 0 && saved !== "") body.path = saved;
  return post(ROUTE_DISCOVER, body, signal);
}

// src/client/store.ts
var DEFAULT_CMD_CODE_PAGE = 65001;
var DISCOVERY_RETRY_MS = 120;
var INITIAL_ROW_STATE = {
  status: "loading",
  platform: "",
  dialect: "pwsh",
  confinedPolicy: "unconfined",
  minimalMode: "oneshot",
  variant: { status: "absent", id: "minimal-gitbash", refs: 0 },
  bashPath: "",
  savedCandidates: [],
  scanned: [],
  cmdScanned: [],
  cmdPath: "",
  cmdCodePage: DEFAULT_CMD_CODE_PAGE,
  cmdConfinedPolicy: "escalate",
  writable: false,
  settingsAvailable: false,
  supported: false,
  discovering: false,
  saving: false
};
function shallowEqual(left, right) {
  if (Object.is(left, right)) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.is(Reflect.get(left, key), Reflect.get(right, key)));
}
function createStore(initial) {
  let state = initial;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState(patch) {
      const next = { ...state, ...patch };
      if (shallowEqual(state, next)) return;
      state = next;
      for (const listener of [...listeners]) listener();
    }
  };
}
function pathKey(path) {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}
function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}
function looksLikeCmd(path) {
  const trimmed = path.trim();
  if (trimmed === "") return true;
  const base = trimmed.replace(/[\\/]+$/, "").slice(Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/")) + 1);
  return base.toLowerCase() === "cmd.exe";
}
function knownPaths(state) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const candidate of [state.bashPath, ...state.scanned, ...state.savedCandidates]) {
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    const key = pathKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
function knownCmdPaths(state) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const candidate of [looksLikeCmd(state.cmdPath) ? state.cmdPath : "", ...state.cmdScanned]) {
    const trimmed = candidate.trim();
    if (trimmed === "") continue;
    const key = pathKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function requestError(translate, error) {
  return translate("row.requestFailed", { detail: messageOf(error) });
}
function normalizeConfinedPolicy(value) {
  return value === "escalate" ? "escalate" : "unconfined";
}
function normalizeDialect(value) {
  return value === "bash" || value === "cmd" ? value : "pwsh";
}
function normalizeCmdConfinedPolicy(value) {
  return value === "unconfined" ? "unconfined" : "escalate";
}
function normalizeCodePage(value) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CMD_CODE_PAGE;
}
function normalizeMinimalMode(value) {
  return value === "leave" || value === "variant" ? value : "oneshot";
}
function createRowController(scope, translate) {
  const store = createStore(INITIAL_ROW_STATE);
  let settingsReady = false;
  const syncSettings = () => {
    if (scope === void 0) return;
    const snapshot = scope.getSnapshot();
    const value = snapshot.value;
    if (value !== void 0) settingsReady = true;
    const previous = store.getState();
    const keepOptimistic = previous.saving || previous.discovering;
    const incomingBash = value?.bashPath ?? "";
    const incomingCmd = looksLikeCmd(value?.cmdPath ?? "") ? value?.cmdPath ?? "" : "";
    store.setState({
      writable: snapshot.writable && snapshot.status === "ready",
      ...value === void 0 ? {} : {
        dialect: normalizeDialect(value.dialect),
        confinedPolicy: normalizeConfinedPolicy(value.confinedPolicy),
        minimalMode: normalizeMinimalMode(value.minimalMode),
        bashPath: keepOptimistic && incomingBash === "" ? previous.bashPath : incomingBash,
        savedCandidates: value.bashCandidates ?? [],
        cmdPath: keepOptimistic && incomingCmd === "" ? previous.cmdPath : incomingCmd,
        cmdCodePage: normalizeCodePage(value.cmdCodePage),
        cmdConfinedPolicy: normalizeCmdConfinedPolicy(value.cmdConfinedPolicy)
      }
    });
  };
  const write = (ops, keepError = false) => {
    const form = scope;
    if (form === void 0) {
      store.setState({ saving: false, error: translate("row.unavailable") });
      return;
    }
    const attempt = (isRetry) => {
      store.setState({ saving: true });
      void form.mutate(ops).then((accepted) => {
        if (accepted === false && !isRetry) {
          attempt(true);
          return;
        }
        store.setState({
          saving: false,
          ...accepted === false ? { error: translate("row.rejected") } : keepError ? {} : { error: void 0 }
        });
      }).catch((error) => {
        store.setState({ saving: false, error: translate("row.saveFailed", { message: messageOf(error) }) });
      });
    };
    attempt(false);
  };
  const setDialect = (dialect) => {
    store.setState({ dialect, error: void 0, notice: void 0 });
    const form = scope;
    if (form === void 0) {
      store.setState({ error: translate("row.unavailable") });
      return;
    }
    const persist = (isRetry) => {
      store.setState({ saving: true });
      void form.mutate([{ op: "set", path: ["dialect"], value: dialect }]).then((accepted) => {
        if (accepted === false && !isRetry) {
          persist(true);
          return;
        }
        store.setState({
          saving: false,
          ...accepted === false ? { error: translate("row.rejected") } : { error: void 0 }
        });
        if (dialect !== "pwsh") {
          discover(dialect, { keepError: accepted === false });
        }
      }).catch((error) => {
        store.setState({ saving: false, error: translate("row.saveFailed", { message: messageOf(error) }) });
      });
    };
    persist(false);
  };
  const setConfinedPolicy = (policy) => {
    store.setState({ confinedPolicy: policy, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["confinedPolicy"], value: policy }]);
  };
  const setMinimalMode = (mode) => {
    store.setState({ minimalMode: mode, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["minimalMode"], value: mode }]);
  };
  const setBashPath = (path) => {
    const trimmed = path.trim();
    store.setState({ bashPath: trimmed, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["bashPath"], value: trimmed }]);
  };
  const setCmdPath = (path) => {
    const trimmed = path.trim();
    if (!looksLikeCmd(trimmed)) {
      store.setState({ error: translate("row.cmdPath.invalid"), notice: void 0 });
      return;
    }
    store.setState({ cmdPath: trimmed, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["cmdPath"], value: trimmed }]);
  };
  const setCmdCodePage = (codePage) => {
    const next = normalizeCodePage(codePage);
    store.setState({ cmdCodePage: next, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["cmdCodePage"], value: next }]);
  };
  const setCmdConfinedPolicy = (policy) => {
    store.setState({ cmdConfinedPolicy: policy, error: void 0, notice: void 0 });
    write([{ op: "set", path: ["cmdConfinedPolicy"], value: policy }]);
  };
  const discover = (dialectArg, options) => {
    const dialect = dialectArg ?? store.getState().dialect;
    if (dialect === "pwsh") return;
    const isCmd = dialect === "cmd";
    const keepError = options?.keepError === true;
    const current = isCmd ? store.getState().cmdPath : store.getState().bashPath;
    store.setState({ discovering: true, ...keepError ? {} : { error: void 0 }, notice: void 0 });
    const run = (allowRetry) => {
      void fetchCandidates(dialect, current).then((view) => {
        const usable = [];
        for (const candidate of view.candidates) {
          if (!candidate.valid) continue;
          if (usable.some((path) => samePath(path, candidate.path))) continue;
          usable.push(candidate.path);
        }
        if (usable.length === 0) {
          store.setState({
            discovering: false,
            ...isCmd ? { cmdScanned: [] } : { scanned: [] },
            notice: translate("row.foundNone")
          });
          return;
        }
        const trimmed = current.trim();
        const picked = trimmed.length > 0 && usable.some((path) => samePath(path, trimmed)) ? trimmed : usable[0];
        if (isCmd) {
          store.setState({ discovering: false, cmdScanned: usable, cmdPath: picked, notice: void 0 });
          write([{ op: "set", path: ["cmdPath"], value: picked }], keepError);
          return;
        }
        store.setState({ discovering: false, scanned: usable, bashPath: picked, notice: void 0 });
        write(
          [
            { op: "set", path: ["bashPath"], value: picked },
            { op: "set", path: ["bashCandidates"], value: usable }
          ],
          keepError
        );
      }).catch((error) => {
        if (allowRetry) {
          setTimeout(() => {
            run(false);
          }, DISCOVERY_RETRY_MS);
          return;
        }
        store.setState({ discovering: false, error: requestError(translate, error) });
      });
    };
    run(true);
  };
  const start = () => {
    let active = true;
    const disposers = [];
    if (scope !== void 0) {
      syncSettings();
      disposers.push(scope.subscribe(syncSettings));
    }
    void fetchState().then((state) => {
      if (!active) return;
      store.setState({
        platform: state.platform,
        settingsAvailable: state.settingsAvailable,
        supported: state.capability.supported,
        ...state.capability.reason === void 0 ? {} : { unsupportedReason: state.capability.reason },
        // The form's value wins whenever it has arrived; `/state` is the
        // fallback for the brief window before the describe mirror loads.
        // `/state` carries only the cmd path (code page and policy have no
        // wire field), so the other two keep their defaults until the form
        // delivers them — which is the same value the schema defaults to.
        ...settingsReady ? {} : {
          dialect: normalizeDialect(state.dialect),
          bashPath: state.bashPath ?? "",
          cmdPath: looksLikeCmd(state.cmdPath ?? "") ? state.cmdPath ?? "" : "",
          minimalMode: normalizeMinimalMode(state.minimalMode)
        },
        // The variant lifecycle is Host-owned: never cached across a mount.
        // A Host that predates the field has none, so keep the empty state
        // rather than letting the row render against undefined.
        ...state.variant === void 0 ? {} : { variant: state.variant },
        status: state.platform === "win32" ? "ready" : "hidden"
      });
    }).catch((error) => {
      if (!active) return;
      store.setState({
        status: "ready",
        supported: false,
        error: requestError(translate, error)
      });
    });
    return () => {
      active = false;
      for (const dispose of disposers) dispose();
    };
  };
  return {
    store,
    start,
    setDialect,
    setConfinedPolicy,
    setMinimalMode,
    setBashPath,
    setCmdPath,
    setCmdCodePage,
    setCmdConfinedPolicy,
    discover
  };
}

// src/client/row.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var PATH_CONTROL_ID = "dsh-terminal-shell-path";
var CMD_PATH_CONTROL_ID = "dsh-terminal-shell-cmd-path";
var CODE_PAGE_CONTROL_ID = "dsh-terminal-shell-cmd-codepage";
function useStoreState(controller) {
  return (0, import_react.useSyncExternalStore)(controller.store.subscribe, controller.store.getState);
}
function Selector(props) {
  const [open, setOpen] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_dsh_client_ui_primitives.Menu,
    {
      open,
      onClose: () => setOpen(false),
      items: props.items,
      selectedId: props.selectedId,
      onSelect: (id) => {
        setOpen(false);
        props.onSelect(id);
      },
      align: "end",
      portal: true,
      className: props.className,
      anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "tterm-selector",
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-label": props.label,
          disabled: props.disabled,
          onClick: () => setOpen((current) => !current),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "tterm-selector-value", children: props.value }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { className: "tterm-chevron" })
          ]
        }
      )
    }
  );
}
function PathRow(props) {
  const items = props.paths.map((path) => ({ id: path, label: path }));
  const trimmed = props.selected.trim();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row tterm-row--path", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "tterm-field-label", htmlFor: props.paths.length > 1 ? void 0 : props.inputId, children: props.label }),
      props.description === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: props.description }),
      props.hint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", children: props.hint }),
      props.notice === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "status", children: props.notice })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-path-control", children: props.paths.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      Selector,
      {
        className: "tterm-path-selector",
        label: props.label,
        value: trimmed === "" ? props.noneLabel : props.selected,
        items,
        selectedId: props.selected,
        disabled: props.disabled,
        onSelect: (path) => {
          if (path !== props.selected) props.onPick(path);
        }
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Input,
      {
        id: props.inputId,
        className: "tterm-path-input",
        "aria-label": props.label,
        placeholder: props.placeholder,
        value: props.draft,
        disabled: props.disabled,
        onChange: (event) => props.onDraftChange(event.target.value),
        onBlur: props.onCommit,
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.onCommit();
          }
        }
      }
    ) })
  ] });
}
function parseCodePage(text) {
  const raw = text.trim();
  if (!/^\d+$/.test(raw)) return void 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return void 0;
  return parsed;
}
function TerminalToolRow({ t, form }) {
  const [controller] = (0, import_react.useState)(() => createRowController(form, t));
  const state = useStoreState(controller);
  const [draft, setDraft] = (0, import_react.useState)(state.bashPath);
  const [cmdDraft, setCmdDraft] = (0, import_react.useState)(state.cmdPath);
  const [codePageDraft, setCodePageDraft] = (0, import_react.useState)(String(state.cmdCodePage));
  (0, import_react.useEffect)(() => controller.start(), [controller]);
  (0, import_react.useEffect)(() => {
    setDraft(state.bashPath);
  }, [state.bashPath]);
  (0, import_react.useEffect)(() => {
    setCmdDraft(state.cmdPath);
  }, [state.cmdPath]);
  (0, import_react.useEffect)(() => {
    setCodePageDraft(String(state.cmdCodePage));
  }, [state.cmdCodePage]);
  if (state.status !== "ready") return null;
  const controlsEnabled = state.writable && state.supported && !state.saving && !state.discovering;
  const dialect = state.dialect;
  const bashPath = state.bashPath.trim();
  const cmdPath = state.cmdPath.trim();
  const paths = knownPaths(state);
  const cmdPaths = knownCmdPaths(state);
  const commitPath = () => {
    const next = draft.trim();
    if (next === bashPath) return;
    controller.setBashPath(next);
  };
  const commitCmdPath = () => {
    const next = cmdDraft.trim();
    if (next === cmdPath) return;
    controller.setCmdPath(next);
  };
  const commitCodePage = () => {
    const parsed = parseCodePage(codePageDraft);
    if (parsed === void 0) {
      setCodePageDraft(String(state.cmdCodePage));
      return;
    }
    if (parsed === state.cmdCodePage) return;
    controller.setCmdCodePage(parsed);
  };
  const dialectItems = [
    { id: "pwsh", label: t("row.dialect.pwsh") },
    { id: "bash", label: t("row.dialect.bash") },
    { id: "cmd", label: t("row.dialect.cmd") }
  ];
  const confinedItems = [
    { id: "unconfined", label: t("row.confined.unconfined") },
    { id: "escalate", label: t("row.confined.escalate") }
  ];
  const minimalItems = [
    { id: "leave", label: t("row.minimal.leave") },
    { id: "oneshot", label: t("row.minimal.oneshot") },
    { id: "variant", label: t("row.minimal.variant") }
  ];
  const cmdMinimalItems = [
    { id: "leave", label: t("row.minimal.leave") },
    { id: "oneshot", label: t("row.minimal.oneshotCmd") }
  ];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-group", "data-dsh-terminal-shell": "row", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-title", children: t("row.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.description") }),
        state.supported ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", children: t("row.notSupported", { reason: state.unsupportedReason ?? "" }) }),
        state.settingsAvailable ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", children: t("row.unavailable") }),
        state.notice === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "status", children: state.notice }),
        state.error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-error", role: "alert", children: state.error })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Selector,
        {
          className: "tterm-dialect",
          label: t("row.dialect.label"),
          value: t(`row.dialect.${dialect}`),
          items: dialectItems,
          selectedId: dialect,
          disabled: !controlsEnabled,
          onSelect: (id) => {
            const next = normalizeDialect(id);
            if (next !== dialect) controller.setDialect(next);
          }
        }
      )
    ] }),
    dialect === "bash" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        PathRow,
        {
          label: t("row.path.label"),
          hint: state.discovering ? t("row.discovering") : bashPath === "" ? t("row.path.missing") : void 0,
          inputId: PATH_CONTROL_ID,
          placeholder: t("row.path.placeholder"),
          noneLabel: t("row.path.none"),
          paths,
          selected: bashPath,
          draft,
          disabled: !controlsEnabled,
          onDraftChange: setDraft,
          onCommit: commitPath,
          onPick: controller.setBashPath
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.confined.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.confined.description", { shell: "bash" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Selector,
          {
            className: "tterm-dialect",
            label: t("row.confined.label"),
            value: t(`row.confined.${state.confinedPolicy}`),
            items: confinedItems,
            selectedId: state.confinedPolicy,
            disabled: !controlsEnabled,
            onSelect: (id) => {
              const next = id === "escalate" ? "escalate" : "unconfined";
              if (next !== state.confinedPolicy) controller.setConfinedPolicy(next);
            }
          }
        )
      ] }),
      state.supported ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.minimal.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.minimal.description") }),
          state.variant?.status === "registered" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "note", children: t("row.minimal.variantReady", { id: state.variant.id }) }) : state.variant?.status === "retained" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "note", children: t("row.minimal.variantRetained", {
            id: state.variant.id,
            count: String(state.variant.refs)
          }) }) : state.variant?.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-error", role: "alert", children: t("row.minimal.variantFailed", { reason: state.variant.reason ?? "" }) }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Selector,
          {
            className: "tterm-dialect",
            label: t("row.minimal.label"),
            value: t(`row.minimal.${state.minimalMode}`),
            items: minimalItems,
            selectedId: state.minimalMode,
            disabled: !controlsEnabled,
            onSelect: (id) => {
              const next = id === "leave" ? "leave" : id === "variant" ? "variant" : "oneshot";
              if (next !== state.minimalMode) controller.setMinimalMode(next);
            }
          }
        )
      ] }) : null
    ] }) : null,
    dialect === "cmd" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        PathRow,
        {
          label: t("row.cmdPath.label"),
          description: t("row.cmdPath.description"),
          hint: state.discovering ? t("row.discovering") : void 0,
          inputId: CMD_PATH_CONTROL_ID,
          placeholder: t("row.cmdPath.placeholder"),
          noneLabel: t("row.path.none"),
          paths: cmdPaths,
          selected: cmdPath,
          draft: cmdDraft,
          disabled: !controlsEnabled,
          onDraftChange: setCmdDraft,
          onCommit: commitCmdPath,
          onPick: controller.setCmdPath
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.confined.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.confined.description", { shell: "cmd" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Selector,
          {
            className: "tterm-dialect",
            label: t("row.confined.label"),
            value: t(`row.confined.${state.cmdConfinedPolicy}`),
            items: confinedItems,
            selectedId: state.cmdConfinedPolicy,
            disabled: !controlsEnabled,
            onSelect: (id) => {
              const next = id === "unconfined" ? "unconfined" : "escalate";
              if (next !== state.cmdConfinedPolicy) controller.setCmdConfinedPolicy(next);
            }
          }
        )
      ] }),
      state.supported ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.minimal.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.minimal.cmdDescription") }),
          state.variant?.status === "registered" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-hint", role: "note", children: t("row.minimal.variantReady", { id: state.variant.id }) }) : state.variant?.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-error", role: "alert", children: t("row.minimal.variantFailed", { reason: state.variant.reason ?? "" }) }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          Selector,
          {
            className: "tterm-dialect",
            label: t("row.minimal.label"),
            value: state.minimalMode === "oneshot" ? t("row.minimal.oneshotCmd") : t(`row.minimal.${state.minimalMode}`),
            items: cmdMinimalItems,
            selectedId: state.minimalMode,
            disabled: !controlsEnabled,
            onSelect: (id) => {
              const next = id === "leave" ? "leave" : "oneshot";
              if (next !== state.minimalMode) controller.setMinimalMode(next);
            }
          }
        )
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "tterm-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-field-label", children: t("row.cmdCodePage.label") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "tterm-description", children: t("row.cmdCodePage.description") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Input,
          {
            id: CODE_PAGE_CONTROL_ID,
            className: "tterm-code-page-input",
            type: "text",
            inputMode: "numeric",
            spellCheck: false,
            autoComplete: "off",
            "aria-label": t("row.cmdCodePage.label"),
            placeholder: "65001",
            value: codePageDraft,
            disabled: !controlsEnabled,
            onChange: (event) => setCodePageDraft(event.target.value),
            onBlur: commitCodePage,
            onKeyDown: (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitCodePage();
              }
            }
          }
        )
      ] })
    ] }) : null
  ] });
}

// src/client/index.ts
var GENERAL_ITEM_ID = "terminal-shell";
var GENERAL_ITEM_ORDER = 60;
var inject = ["slots", "locale"];
var unseat;
var seatedForm;
function service(ctx, name) {
  const found = ctx.get(name);
  return found === void 0 || found === null ? void 0 : found;
}
function nativeForm(ctx) {
  const forms = service(ctx, "configForms");
  if (forms === void 0) return void 0;
  try {
    return forms.get(SETTINGS_NAMESPACE);
  } catch {
    return void 0;
  }
}
function seatRow(ctx, slots, t, form) {
  if (unseat !== void 0 && seatedForm === form) return;
  unseat?.();
  unseat = void 0;
  seatedForm = form;
  ctx.effect(() => {
    let dispose;
    const off = slots.inject("settings.general.item", () => {
      dispose = slots.register(
        {
          name: "settings.general.item",
          id: GENERAL_ITEM_ID,
          order: GENERAL_ITEM_ORDER,
          locale: LOCALE_NAMESPACE,
          inject: () => ({ t, form })
        },
        TerminalToolRow
      );
      unseat = () => {
        const current = dispose;
        dispose = void 0;
        unseat = void 0;
        current?.();
      };
    });
    return () => {
      unseat = void 0;
      seatedForm = void 0;
      const current = dispose;
      dispose = void 0;
      current?.();
      off();
    };
  }, "terminal-shell: settings row");
}
function apply(ctx) {
  const locale = service(ctx, "locale");
  const slots = service(ctx, "slots");
  if (slots === void 0) return;
  if (locale !== void 0) {
    ctx.effect(() => {
      try {
        return locale.register(LOCALE_NAMESPACE, { zh, en });
      } catch {
        return void 0;
      }
    }, "terminal-shell: locale");
  }
  const t = locale?.bind(LOCALE_NAMESPACE) ?? ((key) => key);
  const form = nativeForm(ctx);
  seatRow(ctx, slots, t, form);
  if (form === void 0) {
    ctx.inject(["configForms"], (scoped) => {
      const late = nativeForm(scoped);
      if (late === void 0) return;
      seatRow(scoped, slots, t, late);
    });
  }
}
return module.exports; } });
//# sourceMappingURL=client.js.map
