/**
 * Auto-seed missing config files into existing project workspaces.
 *
 * Detects the framework from package.json (Next.js, Vite, Express, plain
 * Node, or unknown) and writes missing files like jsconfig.json,
 * .gitignore, next-env.d.ts, vite-env.d.ts.
 *
 * NEVER overwrites existing files.
 */

import path from "path";
import fs from "fs";

export type DetectedFramework = "vite" | "nextjs" | "express" | "node" | "static" | "unknown";

export interface SeedReport {
  framework: DetectedFramework;
  added: string[];
  skipped: string[];
}

const STANDARD_GITIGNORE = `node_modules/
.next/
out/
dist/
build/
.cache/
.vite/
coverage/
.DS_Store
*.log
.env
.env.local
.env.*.local
.pipilot-tsconfig.json
`;

function readPackageJson(workDir: string): Record<string, any> | null {
  const pkgPath = path.join(workDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try { return JSON.parse(fs.readFileSync(pkgPath, "utf8")); }
  catch { return null; }
}

/** Detect framework from package.json deps + scripts + file structure */
export function detectFramework(workDir: string): DetectedFramework {
  const pkg = readPackageJson(workDir);
  if (!pkg) {
    // No package.json — check if it's just static HTML
    if (fs.existsSync(path.join(workDir, "index.html"))) return "static";
    return "unknown";
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};
  const scriptValues = Object.values(scripts).join(" ");

  if ("next" in deps || /\bnext\s+(dev|build|start)\b/.test(scriptValues)) {
    return "nextjs";
  }
  if ("vite" in deps || /\bvite\b/.test(scriptValues)) {
    return "vite";
  }
  if ("express" in deps) {
    return "express";
  }
  // Plain Node project (has package.json, no recognized framework)
  return "node";
}

function jsconfigForFramework(framework: DetectedFramework): string {
  let paths: Record<string, string[]>;
  let include: string[];

  switch (framework) {
    case "vite":
      paths = { "@/*": ["./src/*"] };
      include = ["src/**/*.js", "src/**/*.jsx", "src/**/*.mjs", "vite.config.js"];
      break;
    case "nextjs":
      paths = { "@/*": ["./*"] };
      include = ["next-env.d.ts", "**/*.js", "**/*.jsx", "**/*.mjs"];
      break;
    case "express":
    case "node":
    default:
      paths = {};
      include = ["**/*.js", "**/*.mjs"];
      break;
  }

  const compilerOptions: Record<string, unknown> = {
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "preserve",
    lib: ["dom", "dom.iterable", "esnext"],
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    isolatedModules: true,
    noEmit: true,
    baseUrl: ".",
  };
  if (Object.keys(paths).length > 0) compilerOptions.paths = paths;

  return JSON.stringify({
    compilerOptions,
    include,
    exclude: ["node_modules", "dist", "build", ".next", "out", ".pipilot-tsconfig.json"],
  }, null, 2);
}

const NEXT_ENV_DTS = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/building-your-application/configuring/typescript for more information.
`;

const VITE_ENV_DTS = `/// <reference types="vite/client" />
`;

/** Write a file only if it doesn't already exist. Returns true if written. */
function writeIfMissing(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) return false;
  try {
    // Ensure parent dir exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Seed missing config files into a project workspace.
 * Detects framework and writes the right files. Never overwrites.
 */
export function seedMissingConfigs(workDir: string): SeedReport {
  const framework = detectFramework(workDir);
  const added: string[] = [];
  const skipped: string[] = [];

  // Don't seed anything for unknown projects (might be a non-JS project we
  // shouldn't pollute)
  if (framework === "unknown") {
    return { framework, added, skipped };
  }

  // .gitignore — for any project type (skip if a tsconfig.json already
  // exists, since the project is presumed to manage its own config)
  const gitignorePath = path.join(workDir, ".gitignore");
  if (writeIfMissing(gitignorePath, STANDARD_GITIGNORE)) {
    added.push(".gitignore");
  } else if (fs.existsSync(gitignorePath)) {
    skipped.push(".gitignore");
  }

  // jsconfig.json — only if there's no tsconfig.json AND no jsconfig.json
  const tsconfigPath = path.join(workDir, "tsconfig.json");
  const jsconfigPath = path.join(workDir, "jsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    if (framework !== "static") {
      if (writeIfMissing(jsconfigPath, jsconfigForFramework(framework))) {
        added.push("jsconfig.json");
      } else if (fs.existsSync(jsconfigPath)) {
        skipped.push("jsconfig.json");
      }
    }
  } else {
    skipped.push("jsconfig.json (tsconfig.json present)");
  }

  // Framework-specific env declarations
  if (framework === "nextjs") {
    const nextEnvPath = path.join(workDir, "next-env.d.ts");
    if (writeIfMissing(nextEnvPath, NEXT_ENV_DTS)) {
      added.push("next-env.d.ts");
    } else if (fs.existsSync(nextEnvPath)) {
      skipped.push("next-env.d.ts");
    }
  }

  if (framework === "vite") {
    // Only add if there's a src/ folder (Vite convention)
    const srcDir = path.join(workDir, "src");
    if (fs.existsSync(srcDir)) {
      const viteEnvPath = path.join(srcDir, "vite-env.d.ts");
      if (writeIfMissing(viteEnvPath, VITE_ENV_DTS)) {
        added.push("src/vite-env.d.ts");
      } else if (fs.existsSync(viteEnvPath)) {
        skipped.push("src/vite-env.d.ts");
      }
    }
  }

  return { framework, added, skipped };
}
