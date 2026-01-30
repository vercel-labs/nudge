import { NextRequest, NextResponse } from "next/server";
import { clearUserFollowUps } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await req.json();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const deleted = await clearUserFollowUps(userId);
  return NextResponse.json({ ok: true, deleted });
}
