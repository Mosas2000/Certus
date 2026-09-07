import { notFound } from "next/navigation";
import { AGENT_KINDS } from "@certus/shared";
import { AgentDetailBody } from "@/components/agent-detail-body";
import { PanelErrorBoundary } from "@/components/panel-error-boundary";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: {
  params: { kind: string };
}) {
  if (!AGENT_KINDS.includes(params.kind as (typeof AGENT_KINDS)[number])) {
    notFound();
  }
  return (
    <PanelErrorBoundary label={`agent ${params.kind}`}>
      <AgentDetailBody kind={params.kind} />
    </PanelErrorBoundary>
  );
}
