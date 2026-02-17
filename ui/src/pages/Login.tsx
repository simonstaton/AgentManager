import { Alert, Button, PasswordField } from "@fanvue/ui";
import { type FormEvent, useState } from "react";
import { useAuth } from "../auth";

export function Login() {
  const { login } = useAuth();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError("");
    try {
      await login(key.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Swarm</h1>
          <p className="text-sm text-zinc-500 mt-1">Enter your access key to continue</p>
        </div>

        <PasswordField
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Access key"
          autoFocus
          size="40"
          fullWidth
        />

        {error && <Alert variant="error">{error}</Alert>}

        <Button
          type="submit"
          disabled={loading || !key.trim()}
          loading={loading}
          variant="primary"
          size="40"
          className="w-full"
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
