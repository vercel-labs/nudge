import { NextRequest, NextResponse } from "next/server";
import { slackUser, TRACKED_USER_ID } from "@/lib/slack";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchResult = await slackUser.search.messages({
      query: `from:<@${TRACKED_USER_ID}> ?`,
      sort: "timestamp",
      sort_dir: "desc",
      count: 20,
    });

    const matches = searchResult.messages?.matches || [];

    return NextResponse.json({
      ok: true,
      count: matches.length,
      messages: matches.map(m => {
        const match = m as Record<string, unknown>;
        const channel = match.channel as Record<string, unknown>;
        // Check for thread_ts in permalink to detect in-thread messages
        const permalink = match.permalink as string;
        const threadTsFromPermalink = permalink?.match(/thread_ts=([0-9.]+)/)?.[1] || null;
        return {
          ts: match.ts,
          text: (match.text as string)?.substring(0, 80),
          channel_id: channel?.id,
          channel_name: channel?.name,
          thread_ts_field: match.thread_ts || null,
          thread_ts_from_permalink: threadTsFromPermalink,
          permalink: match.permalink,
          // Show raw keys for debugging
          keys: Object.keys(match).slice(0, 15),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
