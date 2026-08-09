import { SupportErrorState } from "../../features/support/support-error-state";

export default function ForbiddenPage() {
  return <SupportErrorState code="403" />;
}
