import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Mock /v1/models endpoint for Claude Agent SDK compatibility.
 *
 * The Agent SDK validates models by calling /v1/models before using them.
 * This endpoint returns the models the SDK expects to find.
 * The actual inference is handled by Kilo Gateway via /api/messages.
 *
 * Deploy this to the3rdacademy.com alongside completions.ts
 */

const MODELS = [
  {
    type: "model",
    id: "claude-sonnet-4-6",
    display_name: "Claude Sonnet 4.6",
    created_at: "2025-05-14T00:00:00Z",
  },
  {
    type: "model",
    id: "claude-sonnet-4-20250514",
    display_name: "Claude Sonnet 4",
    created_at: "2025-05-14T00:00:00Z",
  },
  {
    type: "model",
    id: "claude-opus-4-20250514",
    display_name: "Claude Opus 4",
    created_at: "2025-05-14T00:00:00Z",
  },
  {
    type: "model",
    id: "claude-haiku-4-5-20251001",
    display_name: "Claude Haiku 4.5",
    created_at: "2025-10-01T00:00:00Z",
  },
  {
    type: "model",
    id: "kilo-auto/free",
    display_name: "Kilo Auto",
    created_at: "2025-01-01T00:00:00Z",
  },
];

export default function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-auth-token, anthropic-beta");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Return model list in Anthropic format
  return res.status(200).json({
    data: MODELS,
    has_more: false,
    first_id: MODELS[0].id,
    last_id: MODELS[MODELS.length - 1].id,
  });
}
