"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../auth";
import { Login } from "../../views/Login";

export default function LoginPage() {
  const { token } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (token) router.replace("/");
  }, [token, router]);

  if (token) return null;

  return <Login />;
}
