import { SupportErrorState } from "../features/support/support-error-state";

export default function NotFound() {
  return <SupportErrorState code="404" />;
}
