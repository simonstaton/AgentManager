import type { FC, ReactNode } from "react";

export interface ErrorCardProps {
  /** Primary error message */
  message: string;
  /** Optional actionable suggestion shown in a "Next step" section */
  suggestion?: string;
  /** Optional partial work branch name */
  partialBranch?: string;
  /** Number of files in the partial work branch */
  partialFileCount?: number;
  /** URL to the partial work branch (e.g. GitHub tree link) */
  partialBranchUrl?: string;
  /** Called when the user clicks "Retry" */
  onRetry?: () => void;
  /** Label for the retry button (default: "Retry") */
  retryLabel?: string;
  /** Optional extra actions rendered alongside the retry button */
  actions?: ReactNode;
  /** Whether the retry action is in progress */
  retrying?: boolean;
}

/**
 * Reusable error display card for workflow failures.
 * Shows error message, optional suggestion ("Next step"), optional partial
 * work branch info, and an optional retry button.
 */
export const ErrorCard: FC<ErrorCardProps> = ({
  message,
  suggestion,
  partialBranch,
  partialFileCount,
  partialBranchUrl,
  onRetry,
  retryLabel = "Retry",
  actions,
  retrying = false,
}) => {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 space-y-3"
    >
      {/* Error icon + message */}
      <div className="flex items-start gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className="text-red-400 shrink-0 mt-0.5"
        >
          <path d="M8 3L14 13H2L8 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 7v3M8 11.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-red-300">What happened</p>
          <p className="text-sm text-zinc-400 mt-1">{message}</p>
        </div>
      </div>

      {/* Suggestion — "Next step" section */}
      {suggestion && (
        <div className="pt-2 border-t border-red-900/30">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">Next step</p>
          <p className="text-xs text-zinc-400">{suggestion}</p>
        </div>
      )}

      {/* Partial work branch */}
      {partialBranch && (
        <div className="pt-2 border-t border-red-900/30 flex items-center justify-between">
          <div>
            {partialFileCount !== undefined && (
              <p className="text-zinc-500 text-xs mb-0.5">Partial work ({partialFileCount} files):</p>
            )}
            <code className="text-xs font-mono text-emerald-400">{partialBranch}</code>
          </div>
          {partialBranchUrl && (
            <a
              href={partialBranchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors ml-3 shrink-0"
              aria-label={`View branch ${partialBranch} on GitHub`}
            >
              View branch
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M5 2H10V7M10 2L4 8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          )}
        </div>
      )}

      {/* Action row */}
      {(onRetry || actions) && (
        <div className="pt-2 border-t border-red-900/30 flex items-center gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              aria-busy={retrying}
              aria-label={retrying ? "Retry in progress" : retryLabel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-red-700 hover:bg-red-600 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {retrying ? (
                <>
                  <span
                    className="inline-block w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin"
                    aria-hidden="true"
                  />
                  <span>Retrying…</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M1.5 6a4.5 4.5 0 107-.5M7 3.5l1 2-2 .5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{retryLabel}</span>
                </>
              )}
            </button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
};
