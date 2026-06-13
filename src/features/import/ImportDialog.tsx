import { useRef, useState } from "react";
import { X, Link2, Rss, ClipboardPaste, FileUp, QrCode, Camera } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { detectFormat } from "../../core/parser";
import { decodeQrFromImage, decodeQrFromClipboard } from "../../core/qr";
import { cn } from "../../shared/lib/utils";
import { useT } from "../../core/i18n/useT";
import type { MessageKey } from "../../core/i18n";

type Tab = "link" | "subscription";

const FORMAT_KEY: Record<ReturnType<typeof detectFormat>, MessageKey> = {
  "share-link": "import.fmt.shareLink",
  "base64-subscription": "import.fmt.base64",
  "link-list": "import.fmt.linkList",
  json: "import.fmt.json",
  unknown: "import.fmt.unknown",
};

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { addFromBlob, addSubscription } = useServerStore();
  const t = useT();
  const [tab, setTab] = useState<Tab>("link");
  const [text, setText] = useState("");
  const [subName, setSubName] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [interval, setIntervalH] = useState(12);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const format = detectFormat(text);

  async function pasteClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      setResult(t("import.clipboardFail"));
    }
  }

  function importDecoded(decoded: string | null) {
    if (!decoded) {
      setResult(t("import.qrFail"));
      return;
    }
    const { added, errors } = addFromBlob(decoded);
    setResult(
      added > 0
        ? t("import.qrAdded", { count: added })
        : t("import.qrParseFail", { errors }),
    );
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
    setResult(t("import.added", { count: added }) + (errors ? t("import.addedErrors", { errors }) : ""));
    if (added > 0) setText("");
  }

  async function handleAddSubscription() {
    if (!subUrl.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      await addSubscription(subName || subUrl, subUrl, interval);
      setResult(t("import.subAdded"));
      setSubUrl("");
      setSubName("");
    } catch (e) {
      setResult(t("import.errorPrefix", { msg: e instanceof Error ? e.message : String(e) }));
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
          <TabBtn active={tab === "link"} onClick={() => setTab("link")} icon={Link2}>
            {t("import.tabLink")}
          </TabBtn>
          <TabBtn active={tab === "subscription"} onClick={() => setTab("subscription")} icon={Rss}>
            {t("import.tabSubscription")}
          </TabBtn>
        </div>

        {tab === "link" ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
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
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                placeholder={t("import.subNamePlaceholder")}
                className="ns-input"
              />
            </Field>
            <Field label={t("import.fieldUrl")}>
              <input
                value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)}
                placeholder="https://example.com/sub"
                className="ns-input font-mono"
              />
            </Field>
            <Field label={t("import.fieldInterval")}>
              <input
                type="number"
                min={1}
                value={interval}
                onChange={(e) => setIntervalH(Number(e.target.value))}
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
          <p className="mt-3 rounded-btn bg-surface/60 px-3 py-2 text-center text-xs text-text-dim">
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
