import { db } from "./db";

const SUPABASE_URL = "https://efbajxuvfxrvniuyohho.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmYmFqeHV2Znhydm5pdXlvaGhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNTUxMTMsImV4cCI6MjA5MDYzMTExM30.lSahWo-oGDeUg-jVbCf3ZjLzVRuZC4tu-CKw0aT2pyI";
const DEPLOY_URL = `${SUPABASE_URL}/functions/v1/deploy-site`;
const SERVE_URL = `${SUPABASE_URL}/functions/v1/serve-site`;

const headers = {
  Authorization: `Bearer ${SUPABASE_KEY}`,
  apikey: SUPABASE_KEY,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

export interface DeployResult {
  success: boolean;
  url: string;
  slug: string;
  fileCount: number;
  error?: string;
}

/**
 * Deploy the current project's files to the hosting service.
 * 1. Register the site (JSON POST with slug + name)
 * 2. Upload all files (multipart form-data)
 * 3. Return the live URL
 */
export async function deploySite(
  projectId: string,
  projectName: string
): Promise<DeployResult> {
  const slug = slugify(projectName || projectId);

  // Get all files for this project
  const files = await db.files
    .where("projectId")
    .equals(projectId)
    .and((f) => f.type === "file" && !!f.content)
    .toArray();

  if (files.length === 0) {
    return { success: false, url: "", slug, fileCount: 0, error: "No files to deploy" };
  }

  // Step 1: Register the site
  try {
    const registerRes = await fetch(DEPLOY_URL, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name: projectName }),
    });

    if (!registerRes.ok) {
      const text = await registerRes.text();
      // Ignore "already exists" errors — just proceed to upload
      if (!text.includes("already") && !text.includes("exists")) {
        console.warn("Site registration response:", registerRes.status, text);
      }
    }
  } catch (err) {
    console.warn("Site registration failed (may already exist):", err);
  }

  // Step 2: Upload files as multipart form-data
  const formData = new FormData();
  formData.append("slug", slug);

  for (const file of files) {
    // Use the file path as the key (e.g., "index.html", "css/style.css")
    const blob = new Blob([file.content || ""], { type: getMimeType(file.name) });
    formData.append(file.id, blob, file.id);
  }

  const uploadRes = await fetch(DEPLOY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`,
      apikey: SUPABASE_KEY,
      // Don't set Content-Type — browser sets multipart boundary automatically
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    return {
      success: false,
      url: "",
      slug,
      fileCount: files.length,
      error: `Upload failed (${uploadRes.status}): ${errText.slice(0, 200)}`,
    };
  }

  const SITE_DOMAIN = "https://pipilot.dev";
  const proxyUrl = `${SITE_DOMAIN}/site-proxy.html?slug=${encodeURIComponent(slug)}`;
  const rawUrl = `${SERVE_URL}/${slug}`;
  return { success: true, url: proxyUrl, rawUrl, slug, fileCount: files.length };
}

/**
 * Get the live proxy URL for a deployed site.
 */
export function getSiteUrl(slug: string): string {
  return `https://pipilot.dev/site-proxy.html?slug=${encodeURIComponent(slug)}`;
}

/**
 * Get the raw serve URL (returns text/plain).
 */
export function getRawSiteUrl(slug: string): string {
  return `${SERVE_URL}/${slug}`;
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    ico: "image/x-icon",
    txt: "text/plain",
    md: "text/markdown",
  };
  return mimeMap[ext || ""] || "application/octet-stream";
}
