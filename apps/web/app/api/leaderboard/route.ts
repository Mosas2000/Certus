import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const asset = new URL(request.url).searchParams.get("asset");
  const scope = asset === "BTC" || asset === "ETH" ? asset : "all";
  return NextResponse.json({ scope, rows: getLeaderboard(scope) });
}
