import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { useSettingsStore } from "../../store/useSettingsStore";
import { toast } from "../../store/useToastStore";
import { downloadBackup, parseBackup, applyBackup } from "../../core/backup";
import type { Lang } from "../../core/i18n";

// Inline 4-language strings so the global dictionary (and its i18n parity test)
// stays untouched.
const BACKUP_STRINGS: Record<
  Lang,
  {
    title: string;
    intro: string;
    export: string;
    import: string;
    exported: string;
    imported: string;
    failed: string;
  }
> = {
  en: {
    title: "Backup & restore",
    intro:
      "Save all settings, servers and subscriptions to a file, or restore everything from a previously exported file.",
    export: "Export to file",
    import: "Import from file",
    exported: "Backup exported",
    imported: "Restored {s} servers and {n} subscriptions",
    failed: "Import failed",
  },
  ru: {
    title: "Резервная копия",
    intro:
      "Сохраните все настройки, серверы и подписки в файл или восстановите всё из ранее сохранённого файла.",
    export: "Экспорт в файл",
    import: "Импорт из файла",
    exported: "Копия сохранена",
    imported: "Восстановлено серверов: {s}, подписок: {n}",
    failed: "Не удалось импортировать",
  },
  fa: {
    title: "پشتیبان‌گیری و بازیابی",
    intro:
      "همه تنظیمات، سرورها و اشتراک‌ها را در یک فایل ذخیره کنید یا از یک فایل قبلی بازیابی کنید.",
    export: "خروجی به فایل",
    import: "ورود از فایل",
    exported: "پشتیبان ذخیره شد",
    imported: "{s} سرور و {n} اشتراک بازیابی شد",
    failed: "ورود ناموفق بود",
  },
  zh: {
    title: "备份与恢复",
    intro: "将所有设置、服务器和订阅保存到文件，或从之前导出的文件中恢复。",
    export: "导出到文件",
    import: "从文件导入",
    exported: "备份已导出",
    imported: "已恢复 {s} 个服务器、{n} 个订阅",
    failed: "导入失败",
  },
};

export function BackupSection() {
  const lang = useSettingsStore((s) => s.app.language);
  const bs = BACKUP_STRINGS[lang] ?? BACKUP_STRINGS.en;
  const inputRef = useRef<HTMLInputElement>(null);

  const onExport = () => {
    try {
      downloadBackup();
      toast.success(bs.exported);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const res = applyBackup(parseBackup(text));
      toast.success(
        bs.imported.replace("{s}", String(res.servers)).replace("{n}", String(res.subscriptions)),
      );
    } catch (err) {
      toast.error(`${bs.failed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <section className="glass rounded-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-text">{bs.title}</h3>
      <div className="space-y-3">
        <p className="text-[11px] text-text-faint">{bs.intro}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-1.5 rounded-btn border border-border px-3 py-2 text-sm text-text-dim transition-colors hover:border-indigo/40 hover:text-text"
          >
            <Download size={15} /> {bs.export}
          </button>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-btn border border-border px-3 py-2 text-sm text-text-dim transition-colors hover:border-indigo/40 hover:text-text"
          >
            <Upload size={15} /> {bs.import}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onFile}
          />
        </div>
      </div>
    </section>
  );
}
