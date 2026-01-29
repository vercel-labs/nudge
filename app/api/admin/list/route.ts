import { NextRequest, NextResponse } from "next/server";
import { getAllPendingFollowUps } from "@/lib/redis";
import { getThreadLink } from "@/lib/slack";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const followUps = await getAllPendingFollowUps();

  return NextResponse.json({
    ok: true,
    count: followUps.length,
    followUps: followUps.map(f => ({
      channel: f.channel,
      threadTs: f.threadTs,
      parentThreadTs: f.parentThreadTs || null,
      link: getThreadLink(f.channel, f.threadTs, f.parentThreadTs),
      message: f.originalMessage.substring(0, 100),
      createdAt: new Date(f.createdAt).toISOString(),
    })),
  });
}
