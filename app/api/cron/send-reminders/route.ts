import { NextRequest, NextResponse } from "next/server";
import { createSlackClient, getThreadLink, escapeSlackText } from "@/lib/slack";
import { getUserFollowUps } from "@/lib/redis";
import { getAllUsers } from "@/lib/db";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await getAllUsers();

  if (users.length === 0) {
    return NextResponse.json({ ok: true, message: "No users registered" });
  }

  const results = [];

  for (const user of users) {
    const followUps = await getUserFollowUps(user.slackUserId);

    if (followUps.length === 0) {
      results.push({ userId: user.slackUserId, sent: 0 });
      continue;
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
      const slackBot = createSlackClient(user.botToken);
      await slackBot.chat.postMessage({
        channel: user.slackUserId,
        text: `You have ${followUps.length} pending follow-up${followUps.length > 1 ? "s" : ""}`,
        blocks,
      });

      results.push({ userId: user.slackUserId, sent: followUps.length });
    } catch (error) {
      results.push({ userId: user.slackUserId, error: String(error) });
    }
  }

  return NextResponse.json({
    ok: true,
    usersNotified: results.filter(r => !("error" in r) && r.sent > 0).length,
    results,
  });
}
