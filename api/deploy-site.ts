import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Deploy Site Proxy — Vercel Serverless Function
 *
 * Proxies deploy requests from PiPilot IDE to Supabase Edge Function.
 * Solves CORS (browser can't call Supabase directly from localhost).
 *
 * Frontend sends base64-encoded files, this decodes and forwards
 * as proper FormData to Supabase (server-to-server).
 */

const SUPABASE_URL = "https://efbajxuvfxrvniuyohho.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmYmFqeHV2Znhydm5pdXlvaGhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNTUxMTMsImV4cCI6MjA5MDYzMTExM30.lSahWo-oGDeUg-jVbCf3ZjLzVRuZC4tu-CKw0aT2pyI";
const DEPLOY_FUNCTION = `${SUPABASE_URL}/functions/v1/deploy-site`;

const MIME_MAP: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css",
  js: "application/javascript", mjs: "application/javascript",
  json: "application/json", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", ico: "image/x-icon", txt: "text/plain",
  md: "text/markdown", xml: "application/xml",
};

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return MIME_MAP[ext] || "application/octet-stream";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { slug, name, files } = req.body;

    if (!slug || !files || typeof files !== "object") {
      return res.status(400).json({ error: "Missing required fields: slug, files" });
    }

    const fileCount = Object.keys(files).length;
    console.log(`[deploy] slug=${slug}, files=${fileCount}`);

    // Step 1: Register site (ignore errors — may already exist)
    try {
      await fetch(DEPLOY_FUNCTION, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slug, name: name || slug }),
      });
    } catch (_) {}

    // Step 2: Build proper FormData with decoded files
    // Using Node.js native FormData (available in Node 18+)
    const formData = new FormData();
    formData.append("slug", slug);

    for (const [filePath, fileContent] of Object.entries(files)) {
      let decoded: string;
      try {
        decoded = Buffer.from(fileContent as string, "base64").toString("utf-8");
      } catch {
        decoded = fileContent as string;
      }
      const mime = getMimeType(filePath);
      const blob = new Blob([decoded], { type: mime });
      formData.append(filePath, blob, filePath);
    }

    // Step 3: Forward to Supabase (server-to-server, no CORS issues)
    const supabaseRes = await fetch(DEPLOY_FUNCTION, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        // Don't set Content-Type — fetch sets multipart boundary automatically
      },
      body: formData,
    });

    const responseText = await supabaseRes.text();
    let responseBody: Record<string, unknown>;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = { message: responseText };
    }

    responseBody.slug = slug;
    responseBody.url = `https://pipilot.dev/site-proxy.html?slug=${encodeURIComponent(slug)}`;
    responseBody.fileCount = fileCount;

    console.log(`[deploy] ${supabaseRes.ok ? "OK" : "FAIL"} status=${supabaseRes.status} slug=${slug}`);

    return res.status(supabaseRes.ok ? 200 : supabaseRes.status).json(responseBody);
  } catch (err: any) {
    console.error("[deploy] Error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
