import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * GET /v1/models/:id — Individual model lookup for Claude Agent SDK.
 * Returns model info for any requested model ID.
 */

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-auth-token, anthropic-beta");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { id } = req.query;
  const modelId = Array.isArray(id) ? id[0] : id;

  // Return model info for any requested model — the Praxis API handles routing
  return res.status(200).json({
    type: "model",
    id: modelId,
    display_name: modelId,
    created_at: "2025-05-14T00:00:00Z",
  });
}
