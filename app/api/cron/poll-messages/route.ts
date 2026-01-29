import { NextRequest, NextResponse } from "next/server";
import { slackUser, TRACKED_USER_ID } from "@/lib/slack";
import {
  addFollowUp,
  isTracked,
} from "@/lib/redis";
import { classifyResponse, classifyUserMessage } from "@/lib/ai";

// Check if a message is likely a real question (not a URL with query string, etc.)
function isLikelyQuestion(text: string): boolean {
  // Must contain a question mark
  if (!text.includes("?")) return false;

  // Filter out messages where ? is only in URLs
  const withoutUrls = text.replace(/https?:\/\/[^\s]+/g, "");
  if (!withoutUrls.includes("?")) return false;

  // Filter out messages that are just emoji reactions or very short
  if (text.trim().length < 5) return false;

  return true;
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = {
    messagesSearched: 0,
    questionsFound: 0,
    newTracked: 0,
    resolved: 0,
    errors: [] as string[],
  };

  try {
    // Search for recent messages from the user containing "?"
    const searchResult = await slackUser.search.messages({
      query: `from:<@${TRACKED_USER_ID}> ?`,
      sort: "timestamp",
      sort_dir: "desc",
      count: 50,
    });

    const matches = searchResult.messages?.matches || [];
    stats.messagesSearched = matches.length;

    for (const match of matches) {
      if (!match.ts || !match.text || !match.channel?.id) continue;

      const channel = match.channel.id;
      const messageTs = match.ts;
      const text = match.text;
      const isDM = channel.startsWith("D");

      // Extract thread_ts from permalink since search API doesn't include it directly
      const permalink = (match as { permalink?: string }).permalink || "";
      const threadTsMatch = permalink.match(/thread_ts=([0-9.]+)/);
      const parentThreadTs = threadTsMatch ? threadTsMatch[1] : undefined;
      const isInThread = !!parentThreadTs;

      // Skip if already tracked
      const alreadyTracked = await isTracked(channel, messageTs);
      if (alreadyTracked) continue;

      // Skip if not a real question
      if (!isLikelyQuestion(text)) continue;

      stats.questionsFound++;

      try {
        let hasAnswer = false;

        // Determine if this message is inside another thread vs being a thread parent
        const isInsideThread = parentThreadTs && parentThreadTs !== messageTs;

        if (isInsideThread) {
          // Message is INSIDE a thread - check for replies after this message in the parent thread
          const repliesResult = await slackUser.conversations.replies({
            channel,
            ts: parentThreadTs,
            limit: 100,
          });

          const allReplies = repliesResult.messages || [];
          const messagesAfter = allReplies
            .filter(m => m.ts && parseFloat(m.ts) > parseFloat(messageTs))
            .sort((a, b) => parseFloat(a.ts!) - parseFloat(b.ts!));

          // Check ALL replies after the question for answers
          for (const msg of messagesAfter) {
            if (msg.user !== TRACKED_USER_ID && msg.text) {
              const classification = await classifyResponse(text, msg.text);
              if (classification === "answer") {
                hasAnswer = true;
                break;
              }
            } else if (msg.user === TRACKED_USER_ID && msg.text) {
              const classification = await classifyUserMessage(text, msg.text);
              if (classification === "self-resolved") {
                hasAnswer = true;
                break;
              }
            }
          }
        } else {
          // Message is top-level or a thread parent - check for thread replies to this message
          const repliesResult = await slackUser.conversations.replies({
            channel,
            ts: messageTs,
            limit: 50,
          });

          const replies = (repliesResult.messages || []).slice(1); // Skip the parent message

          // Check ALL replies for answers
          for (const reply of replies) {
            if (reply.user !== TRACKED_USER_ID && reply.text) {
              const classification = await classifyResponse(text, reply.text);
              if (classification === "answer") {
                hasAnswer = true;
                break;
              }
            } else if (reply.user === TRACKED_USER_ID && reply.text) {
              const classification = await classifyUserMessage(text, reply.text);
              if (classification === "self-resolved") {
                hasAnswer = true;
                break;
              }
            }
          }

          // For DMs without thread replies, also check conversation flow
          if (!hasAnswer && isDM && replies.length === 0) {
            const historyResult = await slackUser.conversations.history({
              channel,
              oldest: messageTs,
              limit: 30,
              inclusive: true,
            });

            const allMessages = (historyResult.messages || []).reverse();
            const messagesAfterQuestion = allMessages.slice(1);

            for (const msg of messagesAfterQuestion) {
              if (msg.user !== TRACKED_USER_ID && msg.text) {
                const classification = await classifyResponse(text, msg.text);
                if (classification === "answer") {
                  hasAnswer = true;
                  break;
                }
              } else if (msg.user === TRACKED_USER_ID && msg.text) {
                const classification = await classifyUserMessage(text, msg.text);
                if (classification === "self-resolved") {
                  hasAnswer = true;
                  break;
                }
              }
            }
          }
        }

        // Track if no answer found
        if (!hasAnswer) {
          await addFollowUp({
            channel,
            threadTs: messageTs, // Use the message ts as the unique identifier
            parentThreadTs, // Store parent thread if in a thread (extracted from permalink)
            originalMessage: text,
            createdAt: parseFloat(messageTs) * 1000,
            lastRemindedAt: null,
            lastActivityAt: Date.now(),
          });
          stats.newTracked++;
        }
      } catch (replyError) {
        stats.errors.push(`Processing ${messageTs}: ${replyError}`);
      }
    }
  } catch (error) {
    stats.errors.push(`Search: ${error}`);
  }

  return NextResponse.json({
    ok: true,
    ...stats,
  });
}
