import { OwnerWorkflow, type OwnerWorkflowView } from "../../../../features/workflows/owner-workflow";
import { EmptyState } from "../../../../components/ui/empty-state";
import { serverApiRequest } from "../../../../lib/api/server-client";
export default async function CurrentWorkflowPage() { const response = await serverApiRequest<OwnerWorkflowView>("/owner/workflows/current"); return response.data ? <OwnerWorkflow workflow={response.data} /> : <EmptyState description="当前没有进行中的死亡确认或密码恢复流程。" title="没有活动工作流" />; }
