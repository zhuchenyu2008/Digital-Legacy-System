import { policyConfig } from "../../config/policy";
import { LegalDocument } from "../../features/support/legal-document";

export default function PrivacyPage() {
  const policy = policyConfig();
  return (
    <main className="dls-policy-page">
      <LegalDocument kind="privacy" {...policy} />
    </main>
  );
}
