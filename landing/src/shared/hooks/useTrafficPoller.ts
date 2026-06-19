import { useEffect } from "react";
import { getTraffic } from "../../core/ipc";
import { useConnectionStore } from "../../store/useConnectionStore";
import { useSettingsStore } from "../../store/useSettingsStore";

/** While connected, poll the Clash API once per second and feed the live graph. */
export function useTrafficPoller(): void {
  const status = useConnectionStore((s) => s.status);
  const pushTraffic = useConnectionStore((s) => s.pushTraffic);

  useEffect(() => {
    if (status !== "connected") return;
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
  }, [status, pushTraffic]);
}
