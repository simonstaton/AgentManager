"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../auth";
import { KillSwitchProvider } from "../killSwitch";

export function ProtectedShell({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!token) router.replace("/login");
  }, [token, router]);

  if (!token) return null;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-zinc-800 focus:text-white focus:px-4 focus:py-2 focus:rounded"
      >
        Skip to main content
      </a>
      <KillSwitchProvider>
        <div className="flex-1 overflow-hidden">{children}</div>
      </KillSwitchProvider>
    </div>
  );
}
