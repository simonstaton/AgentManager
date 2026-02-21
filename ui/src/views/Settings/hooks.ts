"use client";

import { useEffect, useRef, useState } from "react";

export function useFileEditor() {
  const [content, setContent] = useState("");
  const savedContentRef = useRef("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty = content !== savedContentRef.current;

  useEffect(
    () => () => {
      if (messageTimeoutRef.current != null) clearTimeout(messageTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const setLoaded = (text: string) => {
    setContent(text);
    savedContentRef.current = text;
    setMessage("");
  };

  const scheduleClearMessage = (timeoutMs: number) => {
    if (messageTimeoutRef.current != null) clearTimeout(messageTimeoutRef.current);
    messageTimeoutRef.current = setTimeout(() => {
      messageTimeoutRef.current = null;
      setMessage("");
    }, timeoutMs);
  };

  const markSaved = (msg = "Saved", timeout = 2000) => {
    savedContentRef.current = content;
    setMessage(msg);
    scheduleClearMessage(timeout);
  };

  const confirmDiscard = () => !isDirty || confirm("You have unsaved changes. Discard them?");

  const flashMessage = (msg: string, timeout = 3000) => {
    setMessage(msg);
    scheduleClearMessage(timeout);
  };

  return {
    content,
    setContent,
    saving,
    setSaving,
    message,
    setMessage,
    isDirty,
    setLoaded,
    markSaved,
    confirmDiscard,
    flashMessage,
  };
}

export function useFolderToggle(initial: Set<string> = new Set()) {
  const [expanded, setExpanded] = useState(initial);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return { expanded, setExpanded, toggle };
}
