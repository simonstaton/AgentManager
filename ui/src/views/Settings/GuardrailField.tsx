"use client";

import { TextField } from "@fanvue/ui";

export function GuardrailField({
  label,
  labelHint,
  value,
  onChange,
  hint,
}: {
  label: string;
  labelHint?: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <div>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: TextField component doesn't support htmlFor pattern */}
      <label className="text-sm text-zinc-400 mb-1 block">
        {label}
        {labelHint != null && <span className="text-xs text-zinc-400 ml-2">({labelHint})</span>}
      </label>
      <TextField
        type="number"
        value={value.toString()}
        onChange={(e) => onChange(Number(e.target.value))}
        size="40"
        fullWidth
      />
      <p className="text-xs text-zinc-400 mt-1">{hint}</p>
    </div>
  );
}
