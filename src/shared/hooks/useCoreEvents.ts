import { useEffect } from "react";
import { onCoreLog, onCoreStatus, type CoreStatus } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";
import type { ConnectionStatus } from "../../core/types";

const STATUS_MAP: Record<CoreStatus, ConnectionStatus> = {
  stopped: "disconnected",
  starting: "connecting",
  running: "connected",
  error: "error",
};

/** Wire backend core events into the connection store + an in-memory log ring. */
export const coreLogRing: string[] = [];
const MAX_LOG = 500;

export function useCoreEvents(): void {
  const setStatus = useConnectionStore((s) => s.setStatus);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let alive = true;

    onCoreStatus((s) => setStatus(STATUS_MAP[s])).then((u) => {
      if (alive) unsubs.push(u);
      else u();
    });

    onCoreLog((line) => {
      coreLogRing.push(line);
      if (coreLogRing.length > MAX_LOG) coreLogRing.shift();
    }).then((u) => {
      if (alive) unsubs.push(u);
      else u();
    });

    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
  }, [setStatus]);
}
