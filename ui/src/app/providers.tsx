"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AuthProvider } from "../auth";
import { ToastProvider } from "../components/Toast";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
          <div className="text-center max-w-md px-6">
            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-sm text-zinc-400 mb-4">{this.state.error?.message || "An unexpected error occurred."}</p>
            <button
              type="button"
              className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = "/";
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
