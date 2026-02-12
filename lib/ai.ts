import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";

// Default model - uses Vercel AI Gateway format: provider/model
const MODEL = process.env.AI_MODEL || "anthropic/claude-haiku-4.5";

export async function summarizeQuestion(originalMessage: string): Promise<string> {
  const { text } = await generateText({
    model: gateway.languageModel(MODEL),
    prompt: `Extract the topic of this Slack message in 2-3 words. Output ONLY the topic, nothing else.

Examples:
- "hey can you review the PR I tagged you on?" → "PR review"
- "what's the latest here?" → "status update"
- "can I get edit access to that exec summary doc?" → "doc access"
- "want me to delete it?" → "follow-up"
- "can we get a tax call set up?" → "tax call"
- "lol what was claude's answer to that question?" → "claude response"

If the message is vague or you can't determine a specific topic, use a generic label like "follow-up" or "open question". NEVER explain your reasoning. Output ONLY 2-3 lowercase words.

Message: "${originalMessage}"`,
  });

  const cleaned = text.trim().toLowerCase().replace(/[.,"'!?]/g, "");
  // If the model returned something too long, it probably over-explained — use fallback
  if (cleaned.split(" ").length > 5) return "follow-up";
  return cleaned;
}

export type ResponseClassification = "answer" | "non-committal";
export type UserMessageClassification = "follow-up" | "self-resolved";

export async function classifyResponse(
  originalQuestion: string,
  response: string
): Promise<ResponseClassification> {
  const { text } = await generateText({
    model: gateway.languageModel(MODEL),
    prompt: `You are analyzing a Slack conversation. Someone asked a question and received a response.
Determine if the response is a substantive answer OR a non-committal acknowledgment.

Non-committal examples: "looking into it", "will check", "let me get back to you", "checking now", "one sec", "on it"
Answer examples:
- Actual information, solutions, explanations
- "yes", "no", direct responses to the question
- Agreement with a plan: "agree", "sounds good", "will do"
- Closure responses: "thanks for...", "perfect", "got it, I'll..."
- Any response that indicates the conversation can move forward
- Links/URLs (sharing a resource IS a valid answer)
- Messages containing hyperlinks to docs, files, or websites

If the response contains acknowledgment WITH a next action or agreement, classify as "answer".
Only classify as "non-committal" if the person is purely deferring without substance.

Original question: "${originalQuestion}"

Response received: "${response}"

Reply with ONLY one word: "answer" or "non-committal"`,
  });

  const cleaned = text.toLowerCase().trim();
  return cleaned.includes("non-committal") ? "non-committal" : "answer";
}

export async function classifyUserMessage(
  originalQuestion: string,
  newMessage: string
): Promise<UserMessageClassification> {
  const { text } = await generateText({
    model: gateway.languageModel(MODEL),
    prompt: `You are analyzing a Slack conversation. Someone asked a question earlier and is now sending another message in the same thread.
Determine if their new message is:
- A FOLLOW-UP: they're still waiting for an answer (e.g., "bump", "any update?", "following up", "would love an update", "hey X, checking in on this")
- SELF-RESOLVED: they figured it out themselves or no longer need help (e.g., "nvm", "figured it out", "never mind", "all good", "resolved this", "closing the loop - we went with X")

Original question: "${originalQuestion}"

New message: "${newMessage}"

Reply with ONLY one word: "follow-up" or "self-resolved"`,
  });

  const cleaned = text.toLowerCase().trim();
  return cleaned.includes("self-resolved") ? "self-resolved" : "follow-up";
}
