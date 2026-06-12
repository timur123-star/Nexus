import { useState } from "react";
import { X, Link2, Rss, ClipboardPaste, FileUp } from "lucide-react";
import { useServerStore } from "../../store/useServerStore";
import { detectFormat } from "../../core/parser";
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

  const format = detectFormat(text);

  async function pasteClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      setResult("Не удалось прочитать буфер обмена");
    }
  }

  function handleImportLinks() {
    if (!text.trim()) return;
    const { added, errors } = addFromBlob(text);
    setResult(`Добавлено: ${added}${errors ? `, ошибок: ${errors}` : ""}`);
    if (added > 0) setText("");
  }

  async function handleAddSubscription() {
    if (!subUrl.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      await addSubscription(subName || subUrl, subUrl, interval);
      setResult("Подписка добавлена и обновлена");
      setSubUrl("");
      setSubName("");
    } catch (e) {
      setResult(`Ошибка: ${e instanceof Error ? e.message : e}`);
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
          <h2 className="text-base font-semibold text-text">Добавить сервер</h2>
          <button onClick={onClose} className="text-text-faint hover:text-text">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-btn bg-bg/50 p-1">
          <TabBtn active={tab === "link"} onClick={() => setTab("link")} icon={Link2}>
            Ссылка / список
          </TabBtn>
          <TabBtn active={tab === "subscription"} onClick={() => setTab("subscription")} icon={Rss}>
            Подписка
          </TabBtn>
        </div>

        {tab === "link" ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="vless://… / vmess://… / trojan://… / ss://… (по одной на строку, или base64-подписка)"
              className="w-full resize-none rounded-btn border border-border bg-bg/40 p-3 font-mono text-xs text-text outline-none focus:border-indigo"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-text-faint">
                Формат: <span className="text-text-dim">{FORMAT_LABEL[format]}</span>
              </span>
              <button
                onClick={pasteClipboard}
                className="flex items-center gap-1 text-xs text-text-dim hover:text-text"
              >
                <ClipboardPaste size={14} /> Из буфера
              </button>
            </div>
            <button
              onClick={handleImportLinks}
              disabled={!text.trim()}
              className="mt-4 w-full rounded-btn bg-indigo py-2.5 text-sm font-medium text-white hover:bg-indigo-soft disabled:opacity-50"
            >
              Импортировать
            </button>
          </>
        ) : (
          <>
            <Field label="Название">
              <input
                value={subName}
                onChange={(e) => setSubName(e.target.value)}
                placeholder="Моя подписка"
                className="ns-input"
              />
            </Field>
            <Field label="URL подписки">
              <input
                value={subUrl}
                onChange={(e) => setSubUrl(e.target.value)}
                placeholder="https://example.com/sub"
                className="ns-input font-mono"
              />
            </Field>
            <Field label="Авто-обновление (часов)">
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
              {busy ? "Загрузка…" : "Добавить и обновить"}
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
  "share-link": "одна ссылка",
  "base64-subscription": "base64-подписка",
  "link-list": "список ссылок",
  json: "JSON-конфиг",
  unknown: "—",
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
