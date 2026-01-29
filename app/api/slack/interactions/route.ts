import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest, slackBot } from "@/lib/slack";
import { updateFollowUp, removeFollowUp } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  // Verify request is from Slack
  if (!verifySlackRequest(signature, timestamp, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse the payload (Slack sends it as form-urlencoded)
  const params = new URLSearchParams(body);
  const payload = JSON.parse(params.get("payload") || "{}");

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action) return NextResponse.json({ ok: true });

    const { channel, threadTs } = JSON.parse(action.value || "{}");

    if (action.action_id === "followup_bumped") {
      // Reset the 24h clock
      await updateFollowUp(channel, threadTs, {
        lastActivityAt: Date.now(),
        lastRemindedAt: Date.now(),
      });

      // Update the message to confirm
      await slackBot.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: "Got it - I'll remind you again in 24h if still unresolved.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "✓ Got it - I'll remind you again in 24h if still unresolved.",
            },
          },
        ],
      });
    } else if (action.action_id === "followup_resolved") {
      // Remove from tracking
      await removeFollowUp(channel, threadTs);

      // Update the message to confirm
      await slackBot.chat.update({
        channel: payload.channel.id,
        ts: payload.message.ts,
        text: "Marked as resolved.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "✓ Marked as resolved.",
            },
          },
        ],
      });
    } else if (action.action_id.startsWith("dismiss_followup_")) {
      // Dismiss from /followups list
      await removeFollowUp(channel, threadTs);

      // Filter out the dismissed item from the blocks
      const updatedBlocks = payload.message.blocks.filter(
        (block: { accessory?: { value?: string } }) => {
          if (!block.accessory?.value) return true;
          try {
            const val = JSON.parse(block.accessory.value);
            return val.threadTs !== threadTs;
          } catch {
            return true;
          }
        }
      );

      // Update the header count
      if (updatedBlocks.length > 0 && updatedBlocks[0].text?.text) {
        const remaining = updatedBlocks.length - 1; // -1 for header
        updatedBlocks[0].text.text = remaining > 0
          ? `*Pending follow-ups (${remaining}):*`
          : "*All caught up!*";
      }

      // Use response_url to update the ephemeral message
      const responseUrl = payload.response_url;
      if (responseUrl) {
        await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            replace_original: true,
            blocks: updatedBlocks.length > 1 ? updatedBlocks : [
              { type: "section", text: { type: "mrkdwn", text: "*All caught up!* No pending follow-ups." } }
            ],
          }),
        });
      }

      return NextResponse.json({ ok: true });
    }
  }

  return NextResponse.json({ ok: true });
}
