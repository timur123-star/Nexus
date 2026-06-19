import type { CoreKind, IProxyCore } from "./types";
import { singboxCore } from "./singboxCore";
import { xrayCore } from "./xrayCore";
import { juicityCore } from "./juicityCore";
import { naiveCore } from "./naiveCore";

export type { IProxyCore, CoreKind } from "./types";

const CORES: Record<CoreKind, IProxyCore> = {
  "sing-box": singboxCore,
  xray: xrayCore,
  juicity: juicityCore,
  naive: naiveCore,
};

/** Resolve a core implementation, defaulting to sing-box for unknown values. */
export function getCore(kind: CoreKind | undefined | null): IProxyCore {
  if (kind && kind in CORES) return CORES[kind];
  return singboxCore;
}

// sing-box / xray first so they win as the universal fallback for shared
// protocols; juicity / naive are single-protocol cores selected only for their
// own protocol.
export const ALL_CORES: IProxyCore[] = [singboxCore, xrayCore, juicityCore, naiveCore];
