import { NextResponse } from "next/server";
import { AGENT_KINDS } from "@certus/shared";
import { getAgentDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { kind: string } },
) {
  const kind = params.kind;
  if (!AGENT_KINDS.includes(kind as (typeof AGENT_KINDS)[number])) {
    return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  }
  const detail = getAgentDetail(kind as (typeof AGENT_KINDS)[number]);
  if (!detail) {
    return NextResponse.json({ error: "engine data unavailable" }, { status: 503 });
  }
  return NextResponse.json(detail);
}
