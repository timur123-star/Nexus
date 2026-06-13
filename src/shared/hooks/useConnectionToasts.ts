import { useEffect, useRef } from "react";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useToastStore } from "../../store/useToastStore";
import { useT } from "../../core/i18n/useT";
import type { ConnectionStatus } from "../../core/types";

/**
 * Surfaces connection lifecycle changes as toasts. Mounted once near the app
 * root. Reuses the existing conn.* translations so it stays fully localized and
 * needs no new strings. The very first render is ignored so we don't toast the
 * initial "disconnected" state on launch.
 */
export function useConnectionToasts(): void {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const activeServer = useConnectionStore((s) => s.activeServer);
  const push = useToastStore((s) => s.push);
  const t = useT();
  const prev = useRef<ConnectionStatus | null>(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = status;
    // Skip initial mount and no-op re-renders.
    if (from === null || from === status) return;

    switch (status) {
      case "connected":
        push({
          kind: "success",
          message: activeServer
            ? `${t("conn.connected")} \u2014 ${activeServer.name}`
            : t("conn.connected"),
        });
        break;
      case "error":
        push({
          kind: "error",
          duration: 6000,
          message: error ? `${t("conn.error")}: ${error}` : `${t("conn.error")} ${t("conn.errorSuffix")}`,
        });
        break;
      case "reconnecting":
        push({ kind: "warning", message: t("conn.reconnecting") });
        break;
      case "disconnected":
        if (from === "connected" || from === "reconnecting") {
          push({ kind: "info", message: t("conn.disconnected") });
        }
        break;
    }
  }, [status, error, activeServer, push, t]);
}
