"use client";

import { SupportErrorState } from "../features/support/support-error-state";

export default function GlobalError({
  error,
  retry,
}: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return (
    <html lang="zh-CN">
      <body>
        <SupportErrorState
          code="error"
          retry={retry}
          {...(error.digest === undefined ? {} : { requestId: error.digest })}
        />
      </body>
    </html>
  );
}
