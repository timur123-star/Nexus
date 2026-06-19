/**
 * IProxyCore — abstraction over the underlying proxy engine.
 *
 * Both sing-box and Xray-core take a JSON config and run a local inbound. By
 * funnelling every engine through this interface the rest of the app (stores,
 * UI) never needs to know which core is active; switching cores is a one-line
 * change in settings.
 */
import type { GenOptions } from "../singbox/configGen";
import type { CoreKind, Protocol, ServerProfile } from "../types";

export interface IProxyCore {
  /** Stable identifier persisted in settings and sent to the Rust supervisor. */
  readonly kind: CoreKind;
  /** Human-friendly name for the UI. */
  readonly label: string;
  /**
   * Whether this core exposes the Clash API that powers the live traffic
   * counters / speed graph. Only sing-box does; Xray uses its own (unpolled)
   * API and the dedicated engines (Juicity / Naïve) have no stats API at all.
   * The UI uses this to gate the traffic poller and explain the flat graph.
   */
  readonly providesClashApi: boolean;
  /** Whether this core can run the given protocol. */
  supports(protocol: Protocol): boolean;
  /** Build a runnable config object for the given server + options. */
  generateConfig(server: ServerProfile, opts: GenOptions): object;
}

export type { CoreKind } from "../types";
