import { NextRequest, NextResponse } from "next/server";
import { slackBot, getThreadLink, escapeSlackText, TRACKED_USER_ID } from "@/lib/slack";
import { getAllPendingFollowUps } from "@/lib/redis";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const followUps = await getAllPendingFollowUps();

  if (followUps.length === 0) {
    return NextResponse.json({ ok: true, message: "No pending follow-ups" });
  }

  // Sort by createdAt (oldest first)
  followUps.sort((a, b) => a.createdAt - b.createdAt);

  // Build a digest message
  const lines = followUps.map((f, i) => {
    const link = getThreadLink(f.channel, f.threadTs, f.parentThreadTs);
    const hoursAgo = Math.round((Date.now() - f.createdAt) / (1000 * 60 * 60));
    const preview = escapeSlackText(
      f.originalMessage.length > 50
        ? f.originalMessage.slice(0, 50) + "..."
        : f.originalMessage
    );
    return `${i + 1}. <${link}|${preview}> _(${hoursAgo}h ago)_`;
  });

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*You have ${followUps.length} pending follow-up${followUps.length > 1 ? "s" : ""}:*`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.join("\n"),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Use `/followups` to see full list with dismiss buttons",
        },
      ],
    },
  ];

  try {
    await slackBot.chat.postMessage({
      channel: TRACKED_USER_ID,
      text: `You have ${followUps.length} pending follow-up${followUps.length > 1 ? "s" : ""}`,
      blocks,
    });

    return NextResponse.json({
      ok: true,
      sent: followUps.length,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: String(error),
    }, { status: 500 });
  }
}
