import { Component, type ReactNode } from "react";
import { Film, RefreshCw } from "lucide-react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        className="w-screen h-screen flex flex-col items-center justify-center gap-6"
        style={{ background: "var(--c-canvas)" }}
      >
        {/* Logo */}
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, oklch(0.68 0.22 285), oklch(0.60 0.20 310))",
            boxShadow: "0 8px 32px oklch(0.68 0.22 285 / 0.30)",
          }}
        >
          <Film className="w-6 h-6 text-white" />
        </div>

        <div className="text-center">
          <p className="text-base font-semibold mb-1" style={{ color: "var(--c-t1)" }}>
            页面出现了意外错误
          </p>
          <p className="text-sm" style={{ color: "var(--c-t4)" }}>
            请刷新页面重试，或联系支持团队
          </p>
        </div>

        {this.state.error && (
          <div
            className="max-w-md w-full mx-4 p-3 rounded-xl text-xs font-mono overflow-auto"
            style={{
              background: "var(--c-base)",
              border: "1px solid var(--c-bd1)",
              color: "var(--c-t3)",
              maxHeight: 120,
            }}
          >
            {this.state.error.message}
          </div>
        )}

        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{
            background: "oklch(0.68 0.22 285 / 0.15)",
            border: "1px solid oklch(0.68 0.22 285 / 0.35)",
            color: "oklch(0.78 0.18 285)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.22 285 / 0.25)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "oklch(0.68 0.22 285 / 0.15)";
          }}
        >
          <RefreshCw className="w-4 h-4" />
          刷新页面
        </button>
      </div>
    );
  }
}
