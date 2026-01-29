import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all followup keys
  const keys = await redis.zrange("followups", 0, -1);

  let deleted = 0;
  for (const key of keys) {
    await redis.del(key as string);
    deleted++;
  }

  // Clear the sorted set
  await redis.del("followups");

  return NextResponse.json({ ok: true, deleted });
}
