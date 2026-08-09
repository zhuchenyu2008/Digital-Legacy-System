"use client";

import { useState } from "react";
import { Field } from "../../components/ui/field";

export function deathConfirmationText(ownerDisplayName: string): string {
  return `我确认${ownerDisplayName.normalize("NFC")}已经无法联络，且有很大可能已经离世或已确认离世`;
}

export function aliveConfirmationText(ownerDisplayName: string): string {
  return `我确认${ownerDisplayName.normalize("NFC")}仍然健在，并终止本次确认流程`;
}

export function exactConfirmationMatches(value: string, target: string): boolean {
  return value.normalize("NFC") === target.normalize("NFC");
}

export function blockConfirmationTransfer(event: Readonly<{ preventDefault: () => void }>): void {
  event.preventDefault();
}

export function ConfirmationText({
  id,
  target,
  value,
  onChange,
}: Readonly<{
  id: string;
  target: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  const [composing, setComposing] = useState(false);
  const [touched, setTouched] = useState(false);
  const matches = exactConfirmationMatches(value, target);
  return (
    <div className="dls-confirmation-text">
      <p>请逐字输入以下确认文字（不可粘贴、拖放或自动填充）：</p>
      <code>{target}</code>
      <Field
        autoComplete="off"
        data-1p-ignore="true"
        data-lpignore="true"
        {...(!composing && touched && value.length > 0 && !matches
          ? { error: "确认文字必须完全一致，不能增加首尾空格" }
          : {})}
        id={id}
        label="确认文字"
        name={`${id}-${target.length}`}
        onBlur={() => setTouched(true)}
        onChange={(event) => onChange(event.target.value)}
        onCompositionEnd={(event) => {
          setComposing(false);
          onChange(event.currentTarget.value);
        }}
        onCompositionStart={() => setComposing(true)}
        onDrop={blockConfirmationTransfer}
        onPaste={blockConfirmationTransfer}
        required
        spellCheck={false}
        value={value}
      />
      <span aria-live="polite" className="dls-sr-only" role="status">
        {composing ? "正在使用输入法输入" : matches ? "确认文字已完全匹配" : "确认文字尚未匹配"}
      </span>
    </div>
  );
}
