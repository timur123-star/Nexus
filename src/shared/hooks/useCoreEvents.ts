import { useEffect } from "react";
import { onCoreLog, onCoreStatus } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";

/** In-memory ring buffer of recent core log lines (consumed by the log viewer). */
export const coreLogRing: string[] = [];
const MAX_LOG = 500;

/** Wire backend core events into the connection store + the log ring. */
export function useCoreEvents(): void {
  const applyCoreStatus = useConnectionStore((s) => s.applyCoreStatus);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    let alive = true;

    onCoreStatus((s) => applyCoreStatus(s)).then((u) => {
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
  }, [applyCoreStatus]);
}
