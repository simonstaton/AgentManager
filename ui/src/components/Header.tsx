import { Button, Count } from "@fanvue/ui";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

interface HeaderProps {
  agentCount: number;
}

export function Header({ agentCount }: HeaderProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="text-lg font-semibold tracking-tight hover:text-white transition-colors"
        >
          Swarm
        </button>
        {agentCount > 0 && <Count value={agentCount} variant="default" />}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant={location.pathname === "/settings" ? "secondary" : "tertiary"}
          size="32"
          onClick={() => navigate("/settings")}
        >
          Settings
        </Button>
        <Button variant="tertiary" size="32" onClick={logout}>
          Logout
        </Button>
      </div>
    </header>
  );
}
