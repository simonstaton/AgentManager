"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { createApi } from "../../api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Skeleton } from "../../components/Skeleton";

type SetupState =
  | { step: "idle" }
  | { step: "setup"; secret: string; uri: string }
  | { step: "verifying"; secret: string; uri: string };

export function SecurityPanel({ api }: { api: ReturnType<typeof createApi> }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupState>({ step: "idle" });
  const [codeInput, setCodeInput] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageVariant, setMessageVariant] = useState<"default" | "destructive">("default");
  const [busy, setBusy] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // QR code rendered via third-party CDN-free approach:
  // We use the Google Charts QR API as a fallback since there is no QR lib in dependencies.
  // The URI is always displayed as plain text so users can enter it manually.
  const qrUrl =
    setup.step !== "idle"
      ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setup.uri)}`
      : null;

  const flashMessage = useCallback((msg: string, variant: "default" | "destructive" = "default", ms = 4000) => {
    setMessage(msg);
    setMessageVariant(variant);
    if (messageTimeoutRef.current != null) clearTimeout(messageTimeoutRef.current);
    messageTimeoutRef.current = setTimeout(() => {
      messageTimeoutRef.current = null;
      setMessage("");
    }, ms);
  }, []);

  useEffect(
    () => () => {
      if (messageTimeoutRef.current != null) clearTimeout(messageTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    api
      .getTotpStatus()
      .then(({ enabled: e, enabledAt: ea }) => {
        setEnabled(e);
        setEnabledAt(ea);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[SecurityPanel] getTotpStatus failed", err);
        setLoading(false);
      });
  }, [api]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const { secret, uri } = await api.setupTotp();
      setSetup({ step: "setup", secret, uri });
      setCodeInput("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start setup";
      flashMessage(msg, "destructive");
    } finally {
      setBusy(false);
    }
  };

  const verifyAndEnable = async () => {
    if (setup.step === "idle") return;
    const code = codeInput.trim();
    if (!/^\d{6}$/.test(code)) {
      flashMessage("Enter the 6-digit code from your authenticator app", "destructive");
      return;
    }
    setBusy(true);
    try {
      const { enabledAt: ea } = await api.verifyTotp(setup.secret, code);
      setEnabled(true);
      setEnabledAt(ea);
      setSetup({ step: "idle" });
      setCodeInput("");
      flashMessage("Two-factor authentication enabled");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid code";
      flashMessage(msg, "destructive");
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = () => {
    if (!/^\d{6}$/.test(disableCode.trim())) {
      flashMessage("Enter the 6-digit code from your authenticator app", "destructive");
      return;
    }
    setShowDisableConfirm(true);
  };

  const doDisable = async () => {
    setShowDisableConfirm(false);
    setBusy(true);
    try {
      await api.disableTotp(disableCode.trim());
      setEnabled(false);
      setEnabledAt(null);
      setDisableCode("");
      flashMessage("Two-factor authentication disabled");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid code";
      flashMessage(msg, "destructive");
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setSetup({ step: "idle" });
    setCodeInput("");
    setMessage("");
  };

  if (loading) {
    return (
      <div className="max-w-lg space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider mb-1">Two-Factor Authentication</h2>
        <p className="text-sm text-zinc-400">
          Use an authenticator app (e.g. Google Authenticator, Authy) to generate time-based one-time passwords.
        </p>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-zinc-800 bg-zinc-900/50">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${enabled ? "bg-sky-400" : "bg-zinc-600"}`}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200">{enabled ? "Enabled" : "Disabled"}</p>
          {enabled && enabledAt && (
            <p className="text-xs text-zinc-500 mt-0.5">
              Active since {new Date(enabledAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </p>
          )}
        </div>
      </div>

      {/* ── Setup flow ── */}
      {!enabled && setup.step === "idle" && (
        <Button variant="default" onClick={startSetup} disabled={busy}>
          {busy ? "Loading…" : "Set up authenticator app"}
        </Button>
      )}

      {!enabled && setup.step !== "idle" && (
        <div className="space-y-4 p-4 rounded-lg border border-zinc-800 bg-zinc-900/30">
          <p className="text-sm text-zinc-300 font-medium">Scan the QR code with your authenticator app</p>

          {/* QR code */}
          {qrUrl && (
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt="TOTP QR code — scan with your authenticator app"
                width={200}
                height={200}
                className="rounded border border-zinc-700 bg-white p-1"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}

          {/* Manual entry */}
          <div>
            <p className="text-xs text-zinc-500 mb-1">Or enter the key manually:</p>
            <code className="block px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-xs font-mono text-zinc-300 break-all select-all">
              {setup.secret}
            </code>
          </div>

          {/* Verification */}
          <div className="space-y-2">
            <Label htmlFor="totp-verify-code" className="text-sm text-zinc-300">
              Enter the 6-digit code to confirm
            </Label>
            <div className="flex gap-2">
              <Input
                id="totp-verify-code"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="h-10 w-32 font-mono tracking-widest"
                onKeyDown={(e) => e.key === "Enter" && verifyAndEnable()}
              />
              <Button variant="default" onClick={verifyAndEnable} disabled={busy || codeInput.length !== 6}>
                {busy ? "Verifying…" : "Verify & Enable"}
              </Button>
              <Button variant="outline" onClick={cancelSetup} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Disable flow ── */}
      {enabled && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="totp-disable-code" className="text-sm text-zinc-300">
              Enter your authenticator code to disable 2FA
            </Label>
            <div className="flex gap-2">
              <Input
                id="totp-disable-code"
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="h-10 w-32 font-mono tracking-widest"
                onKeyDown={(e) => e.key === "Enter" && confirmDisable()}
              />
              <Button variant="destructive" onClick={confirmDisable} disabled={busy || disableCode.length !== 6}>
                Disable 2FA
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <Alert variant={messageVariant} className="text-sm">
          {message}
        </Alert>
      )}

      {/* Disable confirmation dialog */}
      <ConfirmDialog
        open={showDisableConfirm}
        title="Disable Two-Factor Authentication"
        description="This will remove the extra layer of security from your account. Are you sure?"
        confirmLabel="Disable 2FA"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={doDisable}
        onCancel={() => setShowDisableConfirm(false)}
      />
    </div>
  );
}
