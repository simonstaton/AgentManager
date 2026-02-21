"use client";

import { useCallback, useEffect, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  /** Optional custom body (e.g. list of consequences); when set, description is not rendered. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  /** When true, confirm button is disabled (e.g. while submitting). */
  confirmDisabled?: boolean;
}

/**
 * A reusable modal confirmation dialog with backdrop overlay.
 * Supports focus trap, Escape to close, and aria attributes.
 */
export function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the cancel button when dialog opens
  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  // Handle Escape key to close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }

      // Focus trap: Tab cycles between cancel and confirm buttons
      if (e.key === "Tab") {
        const focusableElements = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
        if (focusableElements.length === 0) return;

        const firstEl = focusableElements[0];
        const lastEl = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstEl) {
            e.preventDefault();
            lastEl.focus();
          }
        } else {
          if (document.activeElement === lastEl) {
            e.preventDefault();
            firstEl.focus();
          }
        }
      }
    },
    [onCancel],
  );

  if (!open) return null;

  const isDestructive = variant === "destructive";

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop intentionally handles click-outside-to-close */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl max-w-sm w-full mx-4 p-6"
      >
        <h2
          id="confirm-dialog-title"
          className={`text-base font-semibold ${isDestructive ? "text-red-400" : "text-zinc-100"}`}
        >
          {title}
        </h2>
        {children ? (
          <div id="confirm-dialog-description" className="mt-2">
            {children}
          </div>
        ) : (
          <p id="confirm-dialog-description" className="text-sm text-zinc-400 mt-2">
            {description}
          </p>
        )}
        <div className="flex gap-3 justify-end mt-6">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`px-4 py-2 text-sm font-semibold rounded transition-colors disabled:opacity-50 ${
              isDestructive ? "bg-red-700 hover:bg-red-600 text-white" : "bg-zinc-600 hover:bg-zinc-500 text-white"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
