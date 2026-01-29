import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest, getThreadLink, escapeSlackText } from "@/lib/slack";
import { getAllPendingFollowUps } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  // Verify request is from Slack
  if (!verifySlackRequest(signature, timestamp, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse form data
  const params = new URLSearchParams(body);
  const command = params.get("command");

  if (command === "/followups") {
    const followUps = await getAllPendingFollowUps();

    if (followUps.length === 0) {
      return NextResponse.json({
        response_type: "ephemeral",
        text: "No pending follow-ups. You're all caught up!",
      });
    }

    // Sort by createdAt (oldest first)
    followUps.sort((a, b) => a.createdAt - b.createdAt);

    // Build blocks with dismiss buttons for each item
    const blocks: object[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Pending follow-ups (${followUps.length}):*`,
        },
      },
    ];

    followUps.forEach((f, i) => {
      const link = getThreadLink(f.channel, f.threadTs, f.parentThreadTs);
      const hoursAgo = Math.round((Date.now() - f.createdAt) / (1000 * 60 * 60));
      const rawPreview =
        f.originalMessage.length > 40
          ? f.originalMessage.slice(0, 40) + "..."
          : f.originalMessage;
      const preview = escapeSlackText(rawPreview);

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${i + 1}. <${link}|${preview}> _(${hoursAgo}h ago)_`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Dismiss", emoji: true },
          action_id: `dismiss_followup_${i}`,
          value: JSON.stringify({ channel: f.channel, threadTs: f.threadTs }),
        },
      });
    });

    return NextResponse.json({
      response_type: "ephemeral",
      blocks,
    });
  }

  return NextResponse.json({ ok: true });
}
