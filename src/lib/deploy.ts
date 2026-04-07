import { db } from "./db";

/**
 * Deploy using Puter.js — free, unlimited hosting, no backend needed.
 * Files are written to Puter's cloud filesystem, then hosted as a static site.
 * Each deploy gets a URL like: https://<subdomain>.puter.site
 */

// Old Supabase deploy (commented out — CORS + Cloudflare WAF issues)
// const SUPABASE_URL = "https://efbajxuvfxrvniuyohho.supabase.co";
// const SUPABASE_KEY = "...";
// const DEPLOY_API = "https://the3rdacademy.com/api/deploy-site";

declare const puter: any;

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
  [key: string]: unknown;
}

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

  if (typeof puter === "undefined") {
    return { success: false, url: "", slug, fileCount: 0, error: "Puter.js not loaded" };
  }

  try {
    // Use a consistent directory name based on the slug
    const dirName = `pipilot-${slug}`;

    // Create (or recreate) the directory for the site
    try {
      // Delete existing dir to do a clean deploy
      await puter.fs.delete(dirName, { recursive: true });
    } catch (_) {
      // Directory doesn't exist yet — that's fine
    }

    await puter.fs.mkdir(dirName);

    // Write all project files into the Puter directory
    for (const file of files) {
      const filePath = file.id; // e.g. "index.html", "css/style.css"

      // Create subdirectories if needed (e.g. "css/style.css" → create "css/")
      const parts = filePath.split("/");
      if (parts.length > 1) {
        let currentDir = dirName;
        for (let i = 0; i < parts.length - 1; i++) {
          currentDir += "/" + parts[i];
          try {
            await puter.fs.mkdir(currentDir);
          } catch (_) {
            // Subdirectory already exists
          }
        }
      }

      await puter.fs.write(`${dirName}/${filePath}`, file.content || "");
    }

    // Deploy the site — try update first, then create
    let site;
    try {
      site = await puter.hosting.update(slug, dirName);
    } catch (updateErr: any) {
      // Site doesn't exist — try to create it
      try {
        site = await puter.hosting.create(slug, dirName);
      } catch (createErr: any) {
        // If subdomain is taken, return the error clearly so the AI can retry with a unique slug
        const errBody = createErr?.response?.data ?? createErr;
        const code = errBody?.error?.code ?? errBody?.code ?? "";
        const message = errBody?.error?.message ?? errBody?.message ?? String(createErr);

        if (code === "already_in_use" || message.includes("already in use")) {
          return {
            success: false,
            url: "",
            slug,
            fileCount: files.length,
            error: `Subdomain "${slug}" is already taken. Please retry with a more unique slug — append a timestamp or random suffix, e.g. "${slug}-${Date.now().toString(36)}"`,
          };
        }
        throw createErr;
      }
    }

    const url = `https://${site.subdomain}.puter.site`;
    return { success: true, url, slug: site.subdomain, fileCount: files.length };
  } catch (err: any) {
    const errBody = err?.response?.data ?? err;
    const message = errBody?.error?.message ?? errBody?.message ?? err?.message ?? String(err);
    return {
      success: false,
      url: "",
      slug,
      fileCount: files.length,
      error: `Deploy failed: ${message}`,
    };
  }
}

export function getSiteUrl(slug: string): string {
  return `https://${slugify(slug)}.puter.site`;
}

export function getRawSiteUrl(slug: string): string {
  return `https://${slugify(slug)}.puter.site`;
}
