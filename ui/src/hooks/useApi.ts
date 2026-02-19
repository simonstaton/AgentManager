"use client";

import { useMemo } from "react";
import { createApi } from "../api";
import { useAuth } from "../auth";

export function useApi() {
  const { authFetch } = useAuth();
  return useMemo(() => createApi(authFetch), [authFetch]);
}
