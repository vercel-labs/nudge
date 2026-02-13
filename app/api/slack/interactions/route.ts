import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifySlackRequest, createSlackClient } from "@/lib/slack";
import { updateFollowUp, removeFollowUp } from "@/lib/redis";
import { getUser } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleInteraction(payload: any) {
  const action = payload.actions?.[0];
  if (!action) return;

  const actionValue = JSON.parse(action.value || "{}");
  const { userId, channel, threadTs } = actionValue;
  const responseUrl = payload.response_url;

  const user = userId ? await getUser(userId) : null;

  if (action.action_id === "followup_bumped") {
    await updateFollowUp(userId, channel, threadTs, {
      lastActivityAt: Date.now(),
      lastRemindedAt: Date.now(),
    });

    if (responseUrl) {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replace_original: true,
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: "✓ Got it - I'll remind you again in 24h if still unresolved." } },
          ],
        }),
      });
    }
  } else if (action.action_id === "followup_resolved") {
    await removeFollowUp(userId, channel, threadTs);

    if (responseUrl) {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replace_original: true,
          blocks: [
            { type: "section", text: { type: "mrkdwn", text: "✓ Marked as resolved." } },
          ],
        }),
      });
    }
  } else if (action.action_id.startsWith("dismiss_followup_")) {
    if (!userId || !channel || !threadTs) return;

    await removeFollowUp(userId, channel, threadTs);

    // Filter out the dismissed item from the blocks
    const messageBlocks = payload.message?.blocks || [];
    const updatedBlocks = messageBlocks.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (block: any) => {
        if (!block.accessory?.value) return true;
        try {
          const val = JSON.parse(block.accessory.value);
          return val.threadTs !== threadTs;
        } catch {
          return true;
        }
      }
    );

    // Count only follow-up items (blocks with dismiss buttons)
    const remaining = updatedBlocks.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (block: any) => block.accessory?.action_id?.startsWith("dismiss_followup_")
    ).length;

    // Update the header count
    if (updatedBlocks.length > 0 && updatedBlocks[0].text?.text) {
      updatedBlocks[0].text.text = remaining > 0
        ? `*You have ${remaining} pending follow-up${remaining > 1 ? "s" : ""}:*`
        : "*All caught up!*";
    }

    const finalBlocks = remaining > 0 ? updatedBlocks : [
      { type: "section", text: { type: "mrkdwn", text: "*All caught up!* No pending follow-ups." } }
    ];

    if (responseUrl) {
      await fetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace_original: true, blocks: finalBlocks }),
      });
    }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  if (!verifySlackRequest(signature, timestamp, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(body);
  const payload = JSON.parse(params.get("payload") || "{}");

  if (payload.type === "block_actions") {
    // Return 200 immediately, process in background to avoid Slack retries
    waitUntil(handleInteraction(payload));
  }

  return NextResponse.json({ ok: true });
}
