import type { InputHTMLAttributes, ReactNode } from "react";

export type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> &
  Readonly<{
    id: string;
    label: string;
    error?: string;
    hint?: ReactNode;
  }>;

export function Field({ error, hint, id, label, className = "", ...props }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={`dls-field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <div className="dls-field__hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
      <input
        aria-describedby={describedBy || undefined}
        aria-invalid={Boolean(error)}
        id={id}
        {...props}
      />
      {error ? (
        <div className="dls-field__error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
