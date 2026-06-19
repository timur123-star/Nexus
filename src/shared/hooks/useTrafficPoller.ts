import { useEffect } from "react";
import { getTraffic } from "../../core/ipc";
import { getCore } from "../../core/proxy";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";

/** While connected, poll the Clash API once per second and feed the live graph. */
export function useTrafficPoller(): void {
  const status = useConnectionStore((s) => s.status);
  const activeCore = useConnectionStore((s) => s.activeCore);
  const pushTraffic = useConnectionStore((s) => s.pushTraffic);

  useEffect(() => {
    if (status !== "connected") return;
    // Only sing-box exposes the Clash API; polling any other core just spins on
    // failed requests, so skip it entirely and leave the graph at zero.
    if (!activeCore || !getCore(activeCore).providesClashApi) return;
    const { clashApiPort, clashSecret } = useSettingsStore.getState().proxy;
    let stop = false;

    const tick = async () => {
      if (stop) return;
      try {
        const t = await getTraffic(clashApiPort, clashSecret);
        if (!stop) pushTraffic(t);
      } catch {
        /* core may be briefly unavailable; ignore */
      }
    };

    const id = setInterval(tick, 1000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [status, activeCore, pushTraffic]);
}
