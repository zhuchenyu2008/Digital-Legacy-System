import { ContactShell } from "../../../../components/layout/contact-shell";
import {
  ContactWorkflow,
  type ContactWorkflowView,
} from "../../../../features/workflows/contact-workflow";
import { serverApiRequest } from "../../../../lib/api/server-client";
import { requireContact } from "../../../../lib/auth/require-contact";

export default async function CurrentContactWorkflowPage() {
  await requireContact();
  const response = await serverApiRequest<ContactWorkflowView | null>("/contact/workflows/current");
  return (
    <ContactShell>
      <ContactWorkflow workflow={response.data ?? null} />
    </ContactShell>
  );
}
