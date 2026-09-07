import { NextResponse } from "next/server";
import { getArena } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ agents: getArena() });
}
