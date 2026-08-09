"use client";

import { SupportErrorState } from "../features/support/support-error-state";

export default function ErrorPage({
  error,
  retry,
}: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return (
    <SupportErrorState
      code="error"
      retry={retry}
      {...(error.digest === undefined ? {} : { requestId: error.digest })}
    />
  );
}
