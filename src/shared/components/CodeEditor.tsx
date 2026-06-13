import { useEffect } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { useSettingsStore } from "../../store/useSettingsStore";
import type { Lang } from "../../core/i18n";

// Custom theme matching the NexusShield dark design tokens.
const nexusDarkTheme: monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: "8ea2ff" },
    { token: "string.value.json", foreground: "7fe7cf" },
    { token: "number", foreground: "f0b86e" },
    { token: "keyword.json", foreground: "c98bff" },
  ],
  colors: {
    "editor.background": "#0D0F14",
    "editor.foreground": "#E6E9F2",
    "editorLineNumber.foreground": "#3A4150",
    "editor.lineHighlightBackground": "#161A22",
    "editor.selectionBackground": "#5B6AF033",
    "editorCursor.foreground": "#5B6AF0",
    "editorIndentGuide.background": "#1C2230",
  },
};

// Self-host Monaco's workers so the editor works fully offline in the
// packaged desktop app (no CDN dependency).
let configured = false;
function configureMonaco() {
  if (configured) return;
  configured = true;
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === "json") return new jsonWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });
  monaco.editor.defineTheme("nexus-dark", nexusDarkTheme);
}

// Self-contained loading label so the editor doesn't show Russian in other UIs.
const LOADING_TEXT: Record<Lang, string> = {
  en: "Loading editor\u2026",
  ru: "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440\u0430\u2026",
  fa: "\u062f\u0631 \u062d\u0627\u0644 \u0628\u0627\u0631\u06af\u0630\u0627\u0631\u06cc \u0648\u06cc\u0631\u0627\u06cc\u0634\u06af\u0631\u2026",
  zh: "\u6b63\u5728\u52a0\u8f7d\u7f16\u8f91\u5668\u2026",
};

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontSize: 12.5,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorSmoothCaretAnimation: "on",
  cursorBlinking: "smooth",
  roundedSelection: true,
  padding: { top: 14, bottom: 14 },
  tabSize: 2,
  renderLineHighlight: "all",
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  automaticLayout: true,
};

export function CodeEditor({
  value,
  onChange,
  language = "json",
  readOnly = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: string;
  readOnly?: boolean;
}) {
  const lang = useSettingsStore((s) => s.app.language);

  useEffect(() => {
    configureMonaco();
  }, []);

  const handleMount: OnMount = (_editor, m) => {
    m.editor.setTheme("nexus-dark");
  };

  const options = { ...EDITOR_OPTIONS, readOnly };
  const loadingNode = (
    <div className="grid h-full place-items-center text-xs text-text-faint">
      {LOADING_TEXT[lang] ?? LOADING_TEXT.en}
    </div>
  );

  return (
    <Editor
      value={value}
      language={language}
      theme="nexus-dark"
      onMount={handleMount}
      onChange={(v) => onChange?.(v ?? "")}
      options={options}
      loading={loadingNode}
    />
  );
}
