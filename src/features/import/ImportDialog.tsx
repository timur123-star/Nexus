import { useEffect, useRef, useState } from "react";
import { X, Link2, Rss, ClipboardPaste, FileUp, QrCode, Camera } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { detectFormat } from "../../core/parser";
import { decodeQrFromImage, decodeQrFromClipboard } from "../../core/qr";
import { cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import type { MessageKey } from "../../core/i18n";

type Tab = "link" | "subscription";
type ResultKind = "ok" | "err";

const FORMAT_KEY: Record<ReturnType<typeof detectFormat>, MessageKey> = {
  "share-link": "import.fmt.shareLink",
  "base64-subscription": "import.fmt.base64",
  "link-list": "import.fmt.linkList",
  json: "import.fmt.json",
  unknown: "import.fmt.unknown",
};

// True for Ctrl+Enter (Win/Linux) or Cmd+Enter (macOS) inside a field.
function isSubmitChord(e: React.KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.key === "Enter";
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { addFromBlob, addSubscription } = useServerStore();
  const t = useT();
  const [tab, setTab] = useState<Tab>("link");
  const [text, setText] = useState("");
  const [subName, setSubName] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [interval, setIntervalH] = useState(12);
  const [result, setResult] = useState<string | null>(null);
  const [resultKind, setResultKind] = useState<ResultKind>("ok");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const format = detectFormat(text);

  // Close on Escape, like every other modal expectation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const showResult = (msg: string, kind: ResultKind = "ok") => {
    setResult(msg);
    setResultKind(kind);
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setResult(null);
  };

  async function pasteClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      showResult(t("import.clipboardFail"), "err");
    }
  }

  function importDecoded(decoded: string | null) {
    if (!decoded) {
      showResult(t("import.qrFail"), "err");
      return;
    }
    const { added, errors } = addFromBlob(decoded);
    if (added > 0) showResult(t("import.qrAdded", { count: added }), "ok");
    else showResult(t("import.qrParseFail", { errors }), "err");
  }

  async function onQrFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    importDecoded(await decodeQrFromImage(file).catch(() => null));
  }

  async function onQrClipboard() {
    importDecoded(await decodeQrFromClipboard().catch(() => null));
  }

  function handleImportLinks() {
    if (!text.trim()) return;
    const { added, errors } = addFromBlob(text);
    showResult(
      t("import.added", { count: added }) + (errors ? t("import.addedErrors", { errors }) : ""),
      added > 0 ? "ok" : "err",
    );
    if (added > 0) setText("");
  }

  async function handleAddSubscription() {
    if (!subUrl.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const sub = await addSubscription(subName || subUrl, subUrl, interval);
      if (sub.status === "error") {
        showResult(t("import.errorPrefix", { msg: sub.lastError ?? "" }), "err");
      } else {
        const count = sub.serverCount ?? 0;
        showResult(t("import.added", { count }), count > 0 ? "ok" : "err");
        if (count > 0) {
          setSubUrl("");
          setSubName("");
        }
      }
    } catch (e) {
      showResult(t("import.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-elev animate-fade-in flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-text">{t("import.title")}</h2>
          <button onClick={onClose} className="text-text-faint hover:text-text">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-btn bg-bg/50 p-1">
          <TabBtn active={tab === "link"} onClick={() => switchTab("link")} icon={Link2}>
            {t("import.tabLink")}
          </TabBtn>
          <TabBtn active={tab === "subscription"} onClick={() => switchTab("subscription")} icon={Rss}>
            {t("import.tabSubscription")}
          </TabBtn>
        </div>

        {tab === "link" ? (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (isSubmitChord(e)) {
                  e.preventDefault();
                  handleImportLinks();
                }
              }}
              rows={6}
              placeholder="vless://\u2026 / vmess://\u2026 / trojan://\u2026 / ss://\u2026"
              className="w-full resize-none rounded-btn border border-border bg-bg/40 p-3 font-mono text-xs text-text outline-none focus:border-indigo"
            />
            <div className="mt-2 flex flex-col gap-2">
              <span className="text-xs text-text-faint">
                {t("import.formatLabel")} <span className="text-text-dim">{t(FORMAT_KEY[format])}</span>
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  onClick={pasteClipboard}
                  className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
                >
                  <ClipboardPaste size={14} /> {t("import.fromClipboard")}
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
                >
                  <QrCode size={14} /> {t("import.qrFromFile")}
                </button>
                <button
                  onClick={onQrClipboard}
                  className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
                >
                  <Camera size={14} /> {t("import.qrFromClipboard")}
                </button>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onQrFile} />
            <button
              onClick={handleImportLinks}
              disabled={!text.trim()}
              className="mt-4 w-full rounded-btn bg-indigo py-2.5 text-sm font-medium text-white hover:bg-indigo-soft disabled:opacity-50"
            >
              {t("import.importBtn")}
            </button>
          </>
        ) : (
          <>
            <Field label={t("import.fieldName")}>
              <input
                autoFocus
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                onKeyDown={(e) => {
                  if (isSubmitChord(e) || e.key === "Enter") {
                    e.preventDefault();
                    handleAddSubscription();
                  }
                }}
                placeholder={t("import.subNamePlaceholder")}
                className="ns-input"
              />
            </Field>
            <Field label={t("import.fieldUrl")}>
              <input
                value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (isSubmitChord(e) || e.key === "Enter") {
                    e.preventDefault();
                    handleAddSubscription();
                  }
                }}
                placeholder="https://example.com/sub"
                className="ns-input font-mono"
              />
            </Field>
            <Field label={t("import.fieldInterval")}>
              <input
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setIntervalH(Math.max(1, Number(e.target.value) || 1))}
                className="ns-input w-28"
              />
            </Field>
            <button
              onClick={handleAddSubscription}
              disabled={!subUrl.trim() || busy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-btn bg-indigo py-2.5 text-sm font-medium text-white hover:bg-indigo-soft disabled:opacity-50"
            >
              <FileUp size={16} />
              {busy ? t("import.loading") : t("import.addAndUpdate")}
            </button>
          </>
        )}

        {result && (
          <p
            className={cn(
              "mt-3 rounded-btn px-3 py-2 text-center text-xs",
              resultKind === "err" ? "bg-bad/10 text-bad" : "bg-ok/10 text-ok",
            )}
          >
            {result}
          </p>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
        active ? "bg-indigo text-white" : "text-text-dim hover:text-text",
      )}
    >
      <Icon size={14} /> {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-text-dim">{label}</span>
      {children}
    </label>
  );
}
