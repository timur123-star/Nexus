import { useEffect } from "react";
import { pingServer } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";

/** How often the tunnel health is actively probed while connected. */
const PROBE_INTERVAL_MS = 6000;

/**
 * Active connection watchdog.
 *
 * While connected, periodically probes the active server's endpoint. A live
 * tunnel keeps the server reachable; a silently-dead one (core process still
 * running but the endpoint gone, DPI-blocked, or the route collapsed) starts
 * failing these probes. Sustained failures are reported to the connection
 * store, which then auto-reconnects and fails over to the best server — instead
 * of leaving the user stranded on a tunnel that quietly stopped passing traffic
 * but never hard-crashed.
 *
 * This complements the Rust-side process watcher (which only catches actual
 * process exits) and the OS/DPI reality that a "running" core is not always a
 * working one.
 */
export function useHealthMonitor(): void {
  const status = useConnectionStore((s) => s.status);
  const activeServer = useConnectionStore((s) => s.activeServer);
  const reportHealthProbe = useConnectionStore((s) => s.reportHealthProbe);

  useEffect(() => {
    if (status !== "connected" || !activeServer) return;
    let stop = false;

    const probe = async () => {
      if (stop) return;
      // pingServer is a direct TCP latency probe; -1 means unreachable.
      const ms = await pingServer(activeServer.address, activeServer.port);
      if (!stop) reportHealthProbe(ms >= 0);
    };

    const id = setInterval(probe, PROBE_INTERVAL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [status, activeServer, reportHealthProbe]);
}
