/**
 * a0 LLM client — free, no-API-key conversational LLM at api.a0.dev.
 *
 * We use it for small "smart" UX touches like:
 *  - Generating a clean folder name from a user prompt (workspace creation)
 *  - Summarizing a fresh chat into a short title (session naming)
 *
 * For anything heavier the PiPilot Agent is the right tool.
 */

const A0_LLM_URL = "https://api.a0.dev/ai/llm";

export interface A0Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Send a chat completion request to a0. Returns the raw `completion` string.
 * Throws on network or HTTP errors so callers can fall back gracefully.
 */
export async function callA0LLM(messages: A0Message[], opts: { signal?: AbortSignal } = {}): Promise<string> {
  const res = await fetch(A0_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`a0 LLM ${res.status}`);
  const data = await res.json();
  return typeof data?.completion === "string" ? data.completion : "";
}

/**
 * Take a free-form user prompt describing a project they want to build and
 * derive a short, filesystem-safe folder name. The LLM is instructed to
 * return ONLY the slug — no quotes, no markdown, no explanation.
 *
 * Falls back to a 4-word slug of the prompt if a0 is unreachable.
 */
export async function generateProjectFolderName(prompt: string): Promise<string> {
  const trimmed = prompt.trim().slice(0, 800);
  if (!trimmed) return "ai-project";
  try {
    const completion = await callA0LLM([
      {
        role: "system",
        content:
          "You generate short, descriptive project folder names from user prompts. " +
          "Rules:\n" +
          "- Return ONLY the folder name. No quotes, no markdown, no explanation.\n" +
          "- 2 to 4 lowercase words, joined by hyphens.\n" +
          "- Filesystem safe — only [a-z0-9-]. No spaces, no slashes.\n" +
          "- Max 30 characters.\n" +
          "- Be specific and memorable. Avoid generic names like 'my-app' or 'project'.\n" +
          "Examples:\n" +
          "  Prompt: 'A landing page for a synthwave music label'\n" +
          "  → synthwave-label-site\n" +
          "  Prompt: 'Todo app with offline sync'\n" +
          "  → offline-todo\n" +
          "  Prompt: 'Personal portfolio with case studies'\n" +
          "  → portfolio-cases",
      },
      { role: "user", content: trimmed },
    ]);
    return sanitizeFolderName(completion) || fallbackSlug(trimmed);
  } catch {
    return fallbackSlug(trimmed);
  }
}

/**
 * Generate a short title for a chat session from its first message(s).
 * Returns 2-5 words, no punctuation.
 */
export async function generateChatTitle(firstUserMessage: string): Promise<string> {
  const trimmed = firstUserMessage.trim().slice(0, 1000);
  if (!trimmed) return "New chat";
  try {
    const completion = await callA0LLM([
      {
        role: "system",
        content:
          "You generate short titles for chat conversations. " +
          "Rules:\n" +
          "- Return ONLY the title. No quotes, no markdown, no explanation.\n" +
          "- 2 to 5 words.\n" +
          "- Title case (first letter of each significant word capitalized).\n" +
          "- No trailing punctuation.\n" +
          "- Capture the essence of what the user wants to do.\n" +
          "Examples:\n" +
          "  Message: 'help me fix this typescript error in my react component'\n" +
          "  → Fix React TS Error\n" +
          "  Message: 'build me a landing page for a coffee shop'\n" +
          "  → Coffee Shop Landing\n" +
          "  Message: 'explain how websockets work'\n" +
          "  → WebSocket Explanation",
      },
      { role: "user", content: trimmed },
    ]);
    return sanitizeTitle(completion) || fallbackTitle(trimmed);
  } catch {
    return fallbackTitle(trimmed);
  }
}

// ── Helpers ──

function sanitizeFolderName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")     // strip surrounding quotes
    .replace(/[^a-z0-9\s-]+/g, "")        // drop disallowed chars
    .replace(/\s+/g, "-")                  // spaces → hyphens
    .replace(/-+/g, "-")                   // collapse hyphens
    .replace(/^-+|-+$/g, "")               // trim hyphens
    .slice(0, 30);
}

function sanitizeTitle(s: string): string {
  return s
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .slice(0, 60);
}

function fallbackSlug(prompt: string): string {
  return (
    prompt
      .replace(/[^a-zA-Z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join(" ")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .slice(0, 30) || "ai-project"
  );
}

function fallbackTitle(prompt: string): string {
  const words = prompt
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
  return words
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || "New chat";
}
