import { createSlackClient } from "@/lib/slack";
import { addFollowUp, isTracked } from "@/lib/redis";
import { classifyResponse, classifyUserMessage } from "@/lib/ai";
import { NudgeUser } from "@/lib/db";

// Check if a message is likely a real question (not a URL with query string, etc.)
function isLikelyQuestion(text: string): boolean {
  if (!text.includes("?")) return false;
  const withoutUrls = text.replace(/https?:\/\/[^\s]+/g, "");
  if (!withoutUrls.includes("?")) return false;
  if (text.trim().length < 5) return false;
  return true;
}

export interface PollStats {
  messagesSearched: number;
  questionsFound: number;
  newTracked: number;
  errors: string[];
}

export async function pollUserMessages(user: NudgeUser): Promise<PollStats> {
  const stats: PollStats = {
    messagesSearched: 0,
    questionsFound: 0,
    newTracked: 0,
    errors: [],
  };

  const slackUser = createSlackClient(user.userToken);

  try {
    const searchResult = await slackUser.search.messages({
      query: `from:<@${user.slackUserId}> ?`,
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
      const isDM = channel.startsWith("D") || channel.startsWith("G");

      const permalink = (match as { permalink?: string }).permalink || "";
      const threadTsMatch = permalink.match(/thread_ts=([0-9.]+)/);
      const parentThreadTs = threadTsMatch ? threadTsMatch[1] : undefined;

      const alreadyTracked = await isTracked(user.slackUserId, channel, messageTs);
      if (alreadyTracked) continue;

      if (!isLikelyQuestion(text)) continue;

      stats.questionsFound++;

      try {
        let hasAnswer = false;
        const isInsideThread = parentThreadTs && parentThreadTs !== messageTs;

        if (isInsideThread) {
          const repliesResult = await slackUser.conversations.replies({
            channel,
            ts: parentThreadTs,
            limit: 100,
          });

          const allReplies = repliesResult.messages || [];
          const messagesAfter = allReplies
            .filter((m: { ts?: string }) => m.ts && parseFloat(m.ts) > parseFloat(messageTs))
            .sort((a: { ts?: string }, b: { ts?: string }) => parseFloat(a.ts!) - parseFloat(b.ts!));

          for (const msg of messagesAfter) {
            if (msg.user !== user.slackUserId && msg.text) {
              const classification = await classifyResponse(text, msg.text);
              if (classification === "answer") {
                hasAnswer = true;
                break;
              }
            } else if (msg.user === user.slackUserId && msg.text) {
              const classification = await classifyUserMessage(text, msg.text);
              if (classification === "self-resolved") {
                hasAnswer = true;
                break;
              }
            }
          }
        } else if (isDM) {
          // For DMs/group DMs, check messages in a 48-hour window after the question
          // to catch responses that come in the conversation flow (not threads)
          const questionTime = parseFloat(messageTs);
          const windowEnd = questionTime + (48 * 60 * 60); // 48 hours later

          const historyResult = await slackUser.conversations.history({
            channel,
            oldest: messageTs,
            latest: String(windowEnd),
            limit: 50,
            inclusive: true,
          });

          // Messages come newest-first, reverse to get chronological order
          const allMessages = (historyResult.messages || []).reverse();
          const messagesAfterQuestion = allMessages.slice(1);

          for (const msg of messagesAfterQuestion) {
            if (msg.user !== user.slackUserId && msg.text) {
              const classification = await classifyResponse(text, msg.text);
              if (classification === "answer") {
                hasAnswer = true;
                break;
              }
            } else if (msg.user === user.slackUserId && msg.text) {
              const classification = await classifyUserMessage(text, msg.text);
              if (classification === "self-resolved") {
                hasAnswer = true;
                break;
              }
            }
          }

          if (!hasAnswer) {
            const repliesResult = await slackUser.conversations.replies({
              channel,
              ts: messageTs,
              limit: 50,
            });

            const replies = (repliesResult.messages || []).slice(1);

            for (const reply of replies) {
              if (reply.user !== user.slackUserId && reply.text) {
                const classification = await classifyResponse(text, reply.text);
                if (classification === "answer") {
                  hasAnswer = true;
                  break;
                }
              } else if (reply.user === user.slackUserId && reply.text) {
                const classification = await classifyUserMessage(text, reply.text);
                if (classification === "self-resolved") {
                  hasAnswer = true;
                  break;
                }
              }
            }
          }
        } else {
          const repliesResult = await slackUser.conversations.replies({
            channel,
            ts: messageTs,
            limit: 50,
          });

          const replies = (repliesResult.messages || []).slice(1);

          for (const reply of replies) {
            if (reply.user !== user.slackUserId && reply.text) {
              const classification = await classifyResponse(text, reply.text);
              if (classification === "answer") {
                hasAnswer = true;
                break;
              }
            } else if (reply.user === user.slackUserId && reply.text) {
              const classification = await classifyUserMessage(text, reply.text);
              if (classification === "self-resolved") {
                hasAnswer = true;
                break;
              }
            }
          }
        }

        if (!hasAnswer) {
          await addFollowUp({
            userId: user.slackUserId,
            channel,
            threadTs: messageTs,
            parentThreadTs,
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

  return stats;
}
