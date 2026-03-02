import { createSlackClient, getConversationLabel } from "@/lib/slack";
import { addFollowUp, isTracked, getUserFollowUps, removeFollowUp, updateFollowUp, FollowUp } from "@/lib/redis";
import { classifyResponse, classifyUserMessage, summarizeQuestion } from "@/lib/ai";
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
  resolved: number;
  errors: string[];
}

// Check if a channel is a DM or MPIM (group DM)
async function isDMOrMPIM(slackUser: ReturnType<typeof createSlackClient>, channel: string): Promise<boolean> {
  // D = direct message, G = legacy group DM
  if (channel.startsWith("D") || channel.startsWith("G")) return true;

  // C-prefixed channels might be MPIMs - check via API
  if (channel.startsWith("C")) {
    try {
      const info = await slackUser.conversations.info({ channel });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (info.channel as any)?.is_mpim === true || (info.channel as any)?.is_im === true;
    } catch {
      return false;
    }
  }

  return false;
}

// Re-check existing follow-ups to see if they've been answered
async function recheckFollowUp(
  user: NudgeUser,
  followUp: FollowUp
): Promise<boolean> {
  const slackUser = createSlackClient(user.userToken);
  const { channel, threadTs, parentThreadTs, originalMessage } = followUp;
  const isDM = await isDMOrMPIM(slackUser, channel);
  const isInsideThread = parentThreadTs && parentThreadTs !== threadTs;

  try {
    if (isInsideThread) {
      const repliesResult = await slackUser.conversations.replies({
        channel,
        ts: parentThreadTs,
        limit: 100,
      });

      const allReplies = repliesResult.messages || [];
      const messagesAfter = allReplies
        .filter((m: { ts?: string }) => m.ts && parseFloat(m.ts) > parseFloat(threadTs))
        .sort((a: { ts?: string }, b: { ts?: string }) => parseFloat(a.ts!) - parseFloat(b.ts!));

      for (const msg of messagesAfter) {
        if (msg.user !== user.slackUserId && msg.text) {
          const classification = await classifyResponse(originalMessage, msg.text);
          if (classification === "answer") return true;
        } else if (msg.user === user.slackUserId && msg.text) {
          const classification = await classifyUserMessage(originalMessage, msg.text);
          if (classification === "self-resolved") return true;
        }
      }
    } else if (isDM) {
      // For DMs and group DMs: simple logic - if anyone else responded after the question, it's answered
      const historyResult = await slackUser.conversations.history({
        channel,
        oldest: threadTs,
        limit: 50,
        inclusive: true,
      });

      const allMessages = (historyResult.messages || []).reverse();
      const messagesAfterQuestion = allMessages.slice(1);

      // Simple check: did anyone else respond?
      for (const msg of messagesAfterQuestion) {
        if (msg.user !== user.slackUserId) {
          // Someone else responded - consider it answered
          return true;
        }
      }
    } else {
      // Channel message - check thread replies first
      const repliesResult = await slackUser.conversations.replies({
        channel,
        ts: threadTs,
        limit: 50,
      });

      const replies = (repliesResult.messages || []).slice(1);

      for (const reply of replies) {
        if (reply.user !== user.slackUserId && reply.text) {
          const classification = await classifyResponse(originalMessage, reply.text);
          if (classification === "answer") return true;
        } else if (reply.user === user.slackUserId && reply.text) {
          const classification = await classifyUserMessage(originalMessage, reply.text);
          if (classification === "self-resolved") return true;
        }
      }

      // Also check channel conversation for non-threaded responses
      const historyResult = await slackUser.conversations.history({
        channel,
        oldest: threadTs,
        limit: 20,
        inclusive: true,
      });

      const channelMessages = (historyResult.messages || []).reverse();
      const messagesAfterQuestion = channelMessages.slice(1);

      for (const msg of messagesAfterQuestion) {
        // Skip messages that are thread replies (they have thread_ts different from ts)
        if (msg.thread_ts && msg.thread_ts !== msg.ts) continue;

        if (msg.user !== user.slackUserId && msg.text) {
          const classification = await classifyResponse(originalMessage, msg.text);
          if (classification === "answer") return true;
        } else if (msg.user === user.slackUserId && msg.text) {
          const classification = await classifyUserMessage(originalMessage, msg.text);
          if (classification === "self-resolved") return true;
        }
      }
    }
  } catch {
    // If we can't check, assume not answered
    return false;
  }

  return false;
}

export async function pollUserMessages(user: NudgeUser): Promise<PollStats> {
  const stats: PollStats = {
    messagesSearched: 0,
    questionsFound: 0,
    newTracked: 0,
    resolved: 0,
    errors: [],
  };

  const slackUser = createSlackClient(user.userToken);

  // First, re-check existing follow-ups for late answers
  try {
    const existingFollowUps = await getUserFollowUps(user.slackUserId);
    for (const followUp of existingFollowUps) {
      try {
        const isAnswered = await recheckFollowUp(user, followUp);
        if (isAnswered) {
          await removeFollowUp(user.slackUserId, followUp.channel, followUp.threadTs);
          stats.resolved++;
        }
      } catch (err) {
        stats.errors.push(`Recheck ${followUp.threadTs}: ${err}`);
      }
    }
  } catch (err) {
    stats.errors.push(`Recheck phase: ${err}`);
  }

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
      const isDM = await isDMOrMPIM(slackUser, channel);

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
          // For DMs/group DMs: simple logic - if anyone else responded after the question, it's answered
          const historyResult = await slackUser.conversations.history({
            channel,
            oldest: messageTs,
            limit: 50,
            inclusive: true,
          });

          // Messages come newest-first, reverse to get chronological order
          const allMessages = (historyResult.messages || []).reverse();
          const messagesAfterQuestion = allMessages.slice(1);

          // Simple check: did anyone else respond?
          for (const msg of messagesAfterQuestion) {
            if (msg.user !== user.slackUserId) {
              // Someone else responded - consider it answered
              hasAnswer = true;
              break;
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

  // Generate summaries for any follow-ups missing them
  try {
    const allFollowUps = await getUserFollowUps(user.slackUserId);
    const SUMMARY_VERSION = 3;
    const unsummarized = allFollowUps.filter(f => !f.summary || f.summaryVersion !== SUMMARY_VERSION);
    if (unsummarized.length > 0) {
      const slackUser = createSlackClient(user.userToken);
      await Promise.all(
        unsummarized.map(async (f) => {
          try {
            const [topic, label] = await Promise.all([
              summarizeQuestion(f.originalMessage),
              getConversationLabel(slackUser, f.channel),
            ]);
            await updateFollowUp(f.userId, f.channel, f.threadTs, {
              summary: `${label} - ${topic}`,
              summaryVersion: SUMMARY_VERSION,
            });
          } catch {
            // Non-critical, will retry next poll
          }
        })
      );
    }
  } catch {
    // Non-critical
  }

  return stats;
}
