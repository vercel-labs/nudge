# Nudge

a personal slack agent that reminds you to follow up on unanswered questions.

## how it works

1. **polls** your slack messages hourly for questions you've asked (messages with `?`)
2. **tracks** questions that don't have substantive answers yet
3. **reminds** you via DM at 8am PT and 4pm PT with a digest of pending follow-ups
4. **uses AI** to distinguish real answers from non-committal responses ("looking into it", "will check", etc.)

## add to slack

click the button below to add Nudge to your Slack workspace:

[![Add to Slack](https://platform.slack-edge.com/img/add_to_slack.png)](https://nudge-lzrcbvdir.labs.vercel.dev/api/slack/oauth)

that's it! your questions will be tracked automatically.

## usage

- questions you ask are automatically tracked
- you'll receive DM reminders at 8am PT and 4pm PT
- use `/followups` anytime to see pending items
- click "Dismiss" to remove items you no longer need to track

## features

- detects questions in channels, DMs, and threads
- understands conversation context (thread replies, DM flow)
- `/followups` command to see pending items with dismiss buttons
- AI-powered classification using Vercel AI Gateway

## tech stack

- [Next.js](https://nextjs.org) app router
- [Vercel AI SDK](https://sdk.vercel.ai) with AI Gateway
- [Upstash Redis](https://upstash.com)
- [Slack Web API](https://api.slack.com)

---

this is v1 — built in a day with [Claude Code](https://claude.ai/code). feedback and contributions welcome!
