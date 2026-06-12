import type { CoreKind, IProxyCore } from "./types";
import { singboxCore } from "./singboxCore";
import { xrayCore } from "./xrayCore";

export type { IProxyCore, CoreKind } from "./types";

const CORES: Record<CoreKind, IProxyCore> = {
  "sing-box": singboxCore,
  xray: xrayCore,
};

/** Resolve a core implementation, defaulting to sing-box for unknown values. */
export function getCore(kind: CoreKind | undefined | null): IProxyCore {
  if (kind && kind in CORES) return CORES[kind];
  return singboxCore;
}

export const ALL_CORES: IProxyCore[] = [singboxCore, xrayCore];
