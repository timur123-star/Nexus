import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Changing this value resets the boundary (e.g. navigating to another screen). */
  resetKey?: unknown;
  /** Localized labels. */
  labels?: { title: string; body: string; retry: string };
}

interface State {
  error: Error | null;
}

/**
 * Catches render/runtime errors in the subtree and shows a recoverable fallback
 * instead of letting React unmount the whole tree (which previously left the
 * window blank — "содержимое пропадает"). The boundary auto-resets when
 * `resetKey` changes, so simply navigating to another screen clears it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    // Reset on navigation so a crashed screen doesn't stay broken forever.
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console + core log file so it's diagnosable from the field.
    // eslint-disable-next-line no-console
    console.error("[NexusShield] UI crash:", error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const l = this.props.labels ?? {
      title: "Something went wrong",
      body: "This screen hit an unexpected error. The app is still running — you can retry or switch screens.",
      retry: "Reload screen",
    };

    return (
      <div className="grid h-full w-full place-items-center p-6">
        <div className="glass flex max-w-md flex-col items-center gap-4 rounded-card p-7 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-btn bg-bad/15 text-bad">
            <TriangleAlert size={22} />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold text-text">{l.title}</h2>
            <p className="text-[13px] leading-relaxed text-text-dim">{l.body}</p>
          </div>
          <pre className="max-h-28 w-full overflow-auto rounded-btn bg-surface/60 px-3 py-2 text-left text-[11px] font-mono text-text-faint">
            {error.message || String(error)}
          </pre>
          <button
            onClick={this.reset}
            className="flex items-center gap-1.5 rounded-btn border border-indigo bg-indigo/10 px-4 py-2 text-xs font-medium text-indigo transition-colors hover:bg-indigo/20"
          >
            <RotateCcw size={14} /> {l.retry}
          </button>
        </div>
      </div>
    );
  }
}
