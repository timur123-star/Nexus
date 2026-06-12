import { useRef, useState } from "react";
import { X, Link2, Rss, ClipboardPaste, FileUp, QrCode, Camera } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { detectFormat } from "../../core/parser";
import { decodeQrFromImage, decodeQrFromClipboard } from "../../core/qr";
import { cn } from "../../shared/lib/utils";

type Tab = "link" | "subscription";

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { addFromBlob, addSubscription } = useServerStore();
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
      setResult("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0431\u0443\u0444\u0435\u0440 \u043e\u0431\u043c\u0435\u043d\u0430");
    }
  }

  function importDecoded(decoded: string | null) {
    if (!decoded) {
      setResult("QR-\u043a\u043e\u0434 \u043d\u0435 \u0440\u0430\u0441\u043f\u043e\u0437\u043d\u0430\u043d");
      return;
    }
    const { added, errors } = addFromBlob(decoded);
    setResult(
      added > 0
        ? `\u0418\u0437 QR \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e: ${added}`
        : `\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u0442\u044c QR (\u043e\u0448\u0438\u0431\u043e\u043a: ${errors})`,
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
    setResult(`\u0414\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e: ${added}${errors ? `, \u043e\u0448\u0438\u0431\u043e\u043a: ${errors}` : ""}`);
    if (added > 0) setText("");
  }

  async function handleAddSubscription() {
    if (!subUrl.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      await addSubscription(subName || subUrl, subUrl, interval);
      setResult("\u041f\u043e\u0434\u043f\u0438\u0441\u043a\u0430 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0430 \u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430");
      setSubUrl("");
      setSubName("");
    } catch (e) {
      setResult(`\u041e\u0448\u0438\u0431\u043a\u0430: ${e instanceof Error ? e.message : e}`);
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
        className="glass-elev animate-fade-in w-full max-w-lg rounded-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-text">\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0441\u0435\u0440\u0432\u0435\u0440</h2>
          <button onClick={onClose} className="text-text-faint hover:text-text">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-btn bg-bg/50 p-1">
          <TabBtn active={tab === "link"} onClick={() => setTab("link")} icon={Link2}>
            \u0421\u0441\u044b\u043b\u043a\u0430 / \u0441\u043f\u0438\u0441\u043e\u043a
          </TabBtn>
          <TabBtn active={tab === "subscription"} onClick={() => setTab("subscription")} icon={Rss}>
            \u041f\u043e\u0434\u043f\u0438\u0441\u043a\u0430
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-text-faint">
                \u0424\u043e\u0440\u043c\u0430\u0442: <span className="text-text-dim">{FORMAT_LABEL[format]}</span>
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={pasteClipboard}
                  className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
                >
                  <ClipboardPaste size={14} /> \u0418\u0437 \u0431\u0443\u0444\u0435\u0440\u0430
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
                >
                  <QrCode size={14} /> QR \u0438\u0437 \u0444\u0430\u0439\u043b\u0430
                </button>
                <button
                  onClick={onQrClipboard}
                  className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
                >
                  <Camera size={14} /> QR \u0438\u0437 \u0431\u0443\u0444\u0435\u0440\u0430
                </button>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onQrFile} />
            <button
              onClick={handleImportLinks}
              disabled={!text.trim()}
              className="mt-4 w-full rounded-btn bg-indigo py-2.5 text-sm font-medium text-white hover:bg-indigo-soft disabled:opacity-50"
            >
              \u0418\u043c\u043f\u043e\u0440\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c
            </button>
          </>
        ) : (
          <>
            <Field label="\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435">
              <input
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                placeholder="\u041c\u043e\u044f \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0430"
                className="ns-input"
              />
            </Field>
            <Field label="URL \u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0438">
              <input
                value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)}
                placeholder="https://example.com/sub"
                className="ns-input font-mono"
              />
            </Field>
            <Field label="\u0410\u0432\u0442\u043e-\u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 (\u0447\u0430\u0441\u043e\u0432)">
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
              {busy ? "\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026" : "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0438 \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c"}
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

const FORMAT_LABEL: Record<ReturnType<typeof detectFormat>, string> = {
  "share-link": "\u043e\u0434\u043d\u0430 \u0441\u0441\u044b\u043b\u043a\u0430",
  "base64-subscription": "base64-\u043f\u043e\u0434\u043f\u0438\u0441\u043a\u0430",
  "link-list": "\u0441\u043f\u0438\u0441\u043e\u043a \u0441\u0441\u044b\u043b\u043e\u043a",
  json: "JSON-\u043a\u043e\u043d\u0444\u0438\u0433",
  unknown: "\u2014",
};

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
