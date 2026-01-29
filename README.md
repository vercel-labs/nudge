# Nudge

A personal Slack agent that reminds you to follow up on unanswered questions.

## How it works

1. **Polls** your Slack messages hourly for questions you've asked (messages with `?`)
2. **Tracks** questions that don't have substantive answers yet
3. **Reminds** you via DM at 8am PT and 4pm PT with a digest of pending follow-ups
4. **Uses AI** to distinguish real answers from non-committal responses ("looking into it", "will check", etc.)

## Features

- Detects questions in channels, DMs, and threads
- Understands conversation context (thread replies, DM flow)
- `/followups` command to see pending items with dismiss buttons
- AI-powered classification using Vercel AI Gateway

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Add the following **Bot Token Scopes**:
   - `chat:write` - Send reminder DMs
   - `commands` - Handle `/followups` command
3. Add the following **User Token Scopes**:
   - `search:read` - Search your messages
   - `channels:history` - Read channel messages
   - `channels:read` - Access channel info
   - `groups:history` - Read private channel messages
   - `groups:read` - Access private channel info
   - `im:history` - Read DM messages
   - `im:read` - Access DM info
   - `mpim:history` - Read group DM messages
   - `mpim:read` - Access group DM info
4. Install the app to your workspace
5. Add a Slash Command:
   - Command: `/followups`
   - Request URL: `https://your-app.vercel.app/api/slack/commands`
6. Enable Interactivity:
   - Request URL: `https://your-app.vercel.app/api/slack/interactions`

### 2. Create Upstash Redis

1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a new Redis database
3. Copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

### 3. Get your Slack User ID

1. In Slack, click your profile picture
2. Click "Profile"
3. Click the three dots menu → "Copy member ID"

### 4. Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fnudge&env=SLACK_BOT_TOKEN,SLACK_USER_TOKEN,SLACK_SIGNING_SECRET,SLACK_USER_ID,UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN,CRON_SECRET&envDescription=Slack%20and%20Redis%20credentials%20for%20Nudge)

Set these environment variables:

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot token starting with `xoxb-` |
| `SLACK_USER_TOKEN` | User token starting with `xoxp-` |
| `SLACK_SIGNING_SECRET` | From Slack app settings |
| `SLACK_USER_ID` | Your Slack member ID |
| `UPSTASH_REDIS_REST_URL` | From Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | From Upstash console |
| `CRON_SECRET` | Any random string for cron auth |
| `AI_GATEWAY_API_KEY` | (Optional) Vercel AI Gateway key |
| `AI_GATEWAY_URL` | (Optional) AI Gateway URL |

### 5. Update Slack App URLs

After deploying, update your Slack app with your Vercel URL:
- Slash Command: `https://your-app.vercel.app/api/slack/commands`
- Interactivity: `https://your-app.vercel.app/api/slack/interactions`

## Usage

- Questions you ask are automatically tracked
- You'll receive DM reminders at 8am PT and 4pm PT
- Use `/followups` to see all pending items
- Click "Dismiss" to remove items you no longer need to track

## Tech Stack

- [Next.js](https://nextjs.org) App Router
- [Vercel AI SDK](https://sdk.vercel.ai) with AI Gateway
- [Upstash Redis](https://upstash.com)
- [Slack Web API](https://api.slack.com)
