import { NextRequest, NextResponse } from "next/server";
import { verifySlackRequest, TRACKED_USER_ID } from "@/lib/slack";
import {
  addFollowUp,
  getFollowUp,
  updateFollowUp,
  removeFollowUp,
  isTracked,
} from "@/lib/redis";
import { classifyResponse, classifyUserMessage } from "@/lib/ai";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  // Verify request is from Slack
  if (!verifySlackRequest(signature, timestamp, body)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(body);

  // Handle Slack URL verification challenge
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Handle message events
  if (payload.type === "event_callback" && payload.event?.type === "message") {
    const event = payload.event;

    // Ignore bot messages, message edits, etc.
    if (event.subtype) {
      return NextResponse.json({ ok: true });
    }

    const channel = event.channel;
    const user = event.user;
    const text = event.text || "";
    const threadTs = event.thread_ts || event.ts; // Use thread_ts if in thread, else message ts
    const messageTs = event.ts;

    // Check if this is the tracked user's message
    if (user === TRACKED_USER_ID) {
      // Check if thread is already being tracked
      const tracked = await isTracked(channel, threadTs);

      if (tracked) {
        // User sent a message in a tracked thread
        const followUp = await getFollowUp(channel, threadTs);
        if (followUp) {
          const classification = await classifyUserMessage(
            followUp.originalMessage,
            text
          );

          if (classification === "self-resolved") {
            // User resolved it themselves - remove from tracking
            await removeFollowUp(channel, threadTs);
          } else {
            // User is following up - reset the clock
            await updateFollowUp(channel, threadTs, {
              lastActivityAt: Date.now(),
            });
          }
        }
      } else if (text.includes("?")) {
        // New question - start tracking
        await addFollowUp({
          channel,
          threadTs: messageTs, // Track by the message ts (becomes thread ts for replies)
          originalMessage: text,
          createdAt: Date.now(),
          lastRemindedAt: null,
          lastActivityAt: Date.now(),
        });
      }
    } else {
      // Someone else's message - check if it's a response to a tracked thread
      const tracked = await isTracked(channel, threadTs);

      if (tracked) {
        const followUp = await getFollowUp(channel, threadTs);
        if (followUp) {
          const classification = await classifyResponse(
            followUp.originalMessage,
            text
          );

          if (classification === "answer") {
            // Got a real answer - remove from tracking
            await removeFollowUp(channel, threadTs);
          } else {
            // Non-committal response - keep tracking but note the activity
            await updateFollowUp(channel, threadTs, {
              lastActivityAt: Date.now(),
            });
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
