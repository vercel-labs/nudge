import { NextRequest, NextResponse } from "next/server";
import { slackUser, TRACKED_USER_ID } from "@/lib/slack";
import { classifyResponse, classifyUserMessage } from "@/lib/ai";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channel = req.nextUrl.searchParams.get("channel");
  const messageTs = req.nextUrl.searchParams.get("ts");

  if (!channel || !messageTs) {
    return NextResponse.json({ error: "Missing channel or ts" }, { status: 400 });
  }

  const debug: Record<string, unknown> = {
    channel,
    messageTs,
    trackedUserId: TRACKED_USER_ID,
  };

  try {
    // Get channel info
    let channelInfo;
    try {
      channelInfo = await slackUser.conversations.info({ channel });
      const ch = channelInfo.channel as Record<string, unknown>;
      debug.channelInfo = {
        id: ch?.id,
        name: ch?.name,
        is_im: ch?.is_im,
        is_mpim: ch?.is_mpim,
        is_channel: ch?.is_channel,
      };
    } catch (e) {
      debug.channelInfoError = String(e);
    }

    const isDM = channel.startsWith("D");

    if (isDM) {
      // DM logic - check conversation flow
      const historyResult = await slackUser.conversations.history({
        channel,
        oldest: messageTs,
        limit: 30,
        inclusive: true,
      });

      const allMessages = (historyResult.messages || []).reverse();
      debug.dmMessages = allMessages.map(m => ({
        ts: m.ts,
        user: m.user,
        isTrackedUser: m.user === TRACKED_USER_ID,
        text: m.text?.substring(0, 80),
      }));

      const messagesAfterQuestion = allMessages.slice(1);
      debug.messagesAfterQuestion = messagesAfterQuestion.length;

      const classifications = [];
      for (const msg of messagesAfterQuestion) {
        if (msg.user !== TRACKED_USER_ID && msg.text) {
          const classification = await classifyResponse(
            allMessages[0]?.text || "",
            msg.text
          );
          classifications.push({
            type: "response",
            user: msg.user,
            text: msg.text.substring(0, 80),
            classification,
          });
          if (classification === "answer") break;
        } else if (msg.user === TRACKED_USER_ID && msg.text) {
          const classification = await classifyUserMessage(
            allMessages[0]?.text || "",
            msg.text
          );
          classifications.push({
            type: "self",
            text: msg.text.substring(0, 80),
            classification,
          });
          if (classification === "self-resolved") break;
        }
      }
      debug.classifications = classifications;
    } else {
      // Channel logic - check thread replies
      const repliesResult = await slackUser.conversations.replies({
        channel,
        ts: messageTs,
        limit: 50,
      });

      const allReplies = repliesResult.messages || [];
      debug.threadReplies = allReplies.map(m => ({
        ts: m.ts,
        user: m.user,
        isTrackedUser: m.user === TRACKED_USER_ID,
        text: m.text?.substring(0, 80),
      }));

      // First message is the parent, replies are the rest
      const replies = allReplies.slice(1);
      debug.replyCount = replies.length;

      if (replies.length > 0) {
        const lastReply = replies[replies.length - 1];
        debug.lastReply = {
          ts: lastReply.ts,
          user: lastReply.user,
          isTrackedUser: lastReply.user === TRACKED_USER_ID,
          text: lastReply.text?.substring(0, 80),
        };

        if (lastReply.user === TRACKED_USER_ID && lastReply.text) {
          const classification = await classifyUserMessage(
            allReplies[0]?.text || "",
            lastReply.text
          );
          debug.lastReplyClassification = { type: "self", classification };
        } else if (lastReply.text) {
          const classification = await classifyResponse(
            allReplies[0]?.text || "",
            lastReply.text
          );
          debug.lastReplyClassification = { type: "response", classification };
        }
      }
    }
  } catch (error) {
    debug.error = String(error);
  }

  return NextResponse.json(debug);
}
