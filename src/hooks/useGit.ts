import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

import { useState, useCallback, useRef, useEffect } from "react";
import git from "isomorphic-git";
import LightningFS from "@isomorphic-git/lightning-fs";
import { db } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";

const REPO_DIR = "/repo";
const AUTHOR = { name: "PiPilot User", email: "user@pipilot.dev" };

export interface CommitObject {
  oid: string;
  message: string;
  author: {
    name: string;
    email: string;
    timestamp: number;
  };
}

export type FileStatus = "modified" | "added" | "deleted" | "unmodified" | "untracked" | "*modified" | "*added" | "*deleted";

function resolveStatus(row: [string, number, number, number]): { status: FileStatus; staged: boolean } {
  const [, head, workdir, stage] = row;

  // Determine if it's staged (stage differs from HEAD)
  const staged = stage !== head;
  // Determine if it has working dir changes (workdir differs from stage)
  const hasWorkdirChanges = workdir !== stage;

  // File status for display
  if (head === 0 && workdir === 2 && stage === 0) return { status: "untracked", staged: false };
  if (head === 0 && workdir === 2 && stage === 2) return { status: "added", staged: true };
  if (head === 0 && workdir === 2 && stage === 3) return { status: "added", staged: true };
  if (head === 1 && workdir === 2 && stage === 1) return { status: "unmodified", staged: false };
  if (head === 1 && workdir === 2 && stage === 2) return { status: "modified", staged: true };
  if (head === 1 && workdir === 2 && stage === 3) return { status: "modified", staged: true };
  if (head === 1 && workdir === 0 && stage === 0) return { status: "deleted", staged: true };
  if (head === 1 && workdir === 0 && stage === 1) return { status: "deleted", staged: false };
  if (head === 1 && workdir === 2 && stage === 0) return { status: "untracked", staged: false };

  // Fallback: if staged differs from head, it's staged
  if (head === 0 && stage > 0) return { status: "added", staged: true };
  if (head === 1 && stage === 0) return { status: "deleted", staged };
  if (hasWorkdirChanges && !staged) return { status: "modified", staged: false };
  if (staged) return { status: "modified", staged: true };

  return { status: "unmodified", staged: false };
}

export function useGit() {
  const { activeProjectId } = useActiveProject();
  const [initialized, setInitialized] = useState(false);
  const [status, setStatus] = useState<Map<string, FileStatus>>(new Map());
  const [stagedFiles, setStagedFiles] = useState<string[]>([]);
  const [log, setLog] = useState<CommitObject[]>([]);
  const [currentBranch, setCurrentBranch] = useState("main");
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const fsRef = useRef<InstanceType<typeof LightningFS> | null>(null);

  const getFS = useCallback(() => {
    if (!fsRef.current) {
      fsRef.current = new LightningFS("pipilot-git");
    }
    return fsRef.current;
  }, []);

  // Sync Dexie files to LightningFS
  const syncFilesToLightningFS = useCallback(async () => {
    const fs = getFS();
    const pfs = fs.promises;

    // Get all files for this project from Dexie
    const dbFiles = await db.files
      .where("projectId")
      .equals(activeProjectId)
      .toArray();

    // Collect all directories and files from Dexie
    const dirsToCreate = new Set<string>();
    const filesToWrite: { path: string; content: string }[] = [];

    for (const f of dbFiles) {
      if (f.type === "folder") {
        dirsToCreate.add(`${REPO_DIR}/${f.id}`);
      } else {
        filesToWrite.push({
          path: `${REPO_DIR}/${f.id}`,
          content: f.content ?? "",
        });
        // Ensure parent directories exist
        const parts = f.id.split("/");
        parts.pop();
        let current = REPO_DIR;
        for (const part of parts) {
          current = `${current}/${part}`;
          dirsToCreate.add(current);
        }
      }
    }

    // Create directories sorted by depth
    const sortedDirs = Array.from(dirsToCreate).sort(
      (a, b) => a.split("/").length - b.split("/").length
    );

    for (const dir of sortedDirs) {
      try {
        await pfs.mkdir(dir);
      } catch {
        // Directory might already exist
      }
    }

    // Get existing files in the repo to detect deletions
    const existingFiles = new Set<string>();
    async function walkDir(dirPath: string) {
      try {
        const entries = await pfs.readdir(dirPath);
        for (const entry of entries) {
          if (entry === ".git") continue;
          const fullPath = `${dirPath}/${entry}`;
          try {
            const stat = await pfs.stat(fullPath);
            if (stat.isDirectory()) {
              await walkDir(fullPath);
            } else {
              existingFiles.add(fullPath);
            }
          } catch {
            // skip
          }
        }
      } catch {
        // skip
      }
    }
    await walkDir(REPO_DIR);

    // Write all files
    const currentFilePaths = new Set<string>();
    for (const f of filesToWrite) {
      currentFilePaths.add(f.path);
      try {
        await pfs.writeFile(f.path, f.content, "utf8");
      } catch {
        // If write fails, try creating parent dirs again
      }
    }

    // Delete files in LightningFS that no longer exist in Dexie
    for (const existingPath of existingFiles) {
      if (!currentFilePaths.has(existingPath)) {
        try {
          await pfs.unlink(existingPath);
        } catch {
          // ignore
        }
      }
    }
  }, [activeProjectId, getFS]);

  const initRepo = useCallback(async () => {
    setLoading(true);
    try {
      const fs = getFS();
      const pfs = fs.promises;

      // Ensure repo dir exists
      try {
        await pfs.mkdir(REPO_DIR);
      } catch {
        // already exists
      }

      // Initialize git
      await git.init({ fs, dir: REPO_DIR, defaultBranch: "main" });

      // Sync files from Dexie
      await syncFilesToLightningFS();

      // Stage all files
      await git.statusMatrix({ fs, dir: REPO_DIR }).then(async (matrix) => {
        for (const row of matrix) {
          const filepath = row[0] as string;
          await git.add({ fs, dir: REPO_DIR, filepath });
        }
      });

      // Initial commit
      await git.commit({
        fs,
        dir: REPO_DIR,
        message: "Initial commit",
        author: AUTHOR,
      });

      setInitialized(true);
      setCurrentBranch("main");
    } catch (err) {
      console.error("Git init failed:", err);
    } finally {
      setLoading(false);
    }
  }, [getFS, syncFilesToLightningFS]);

  const refreshStatus = useCallback(async () => {
    if (!initialized) return;
    setLoading(true);
    try {
      const fs = getFS();

      // Sync files from Dexie to LightningFS
      await syncFilesToLightningFS();

      // Get status matrix
      const matrix = await git.statusMatrix({ fs, dir: REPO_DIR });

      const newStatus = new Map<string, FileStatus>();
      const newStaged: string[] = [];

      for (const row of matrix) {
        const filepath = row[0] as string;
        const typedRow = row as [string, number, number, number];
        const { status: fileStatus, staged } = resolveStatus(typedRow);

        if (fileStatus !== "unmodified") {
          newStatus.set(filepath, fileStatus);
        }
        if (staged) {
          newStaged.push(filepath);
        }
      }

      setStatus(newStatus);
      setStagedFiles(newStaged);

      // Refresh branch info
      try {
        const branch = await git.currentBranch({ fs, dir: REPO_DIR });
        setCurrentBranch(branch ?? "main");
      } catch {
        // ignore
      }

      try {
        const branchList = await git.listBranches({ fs, dir: REPO_DIR });
        setBranches(branchList);
      } catch {
        // ignore
      }
    } catch (err) {
      console.error("Status refresh failed:", err);
    } finally {
      setLoading(false);
    }
  }, [initialized, getFS, syncFilesToLightningFS]);

  const stageFile = useCallback(
    async (filepath: string) => {
      if (!initialized) return;
      const fs = getFS();
      try {
        // Check if file exists in workdir
        try {
          await fs.promises.stat(`${REPO_DIR}/${filepath}`);
          await git.add({ fs, dir: REPO_DIR, filepath });
        } catch {
          // File was deleted
          await git.remove({ fs, dir: REPO_DIR, filepath });
        }
        await refreshStatus();
      } catch (err) {
        console.error("Stage failed:", err);
      }
    },
    [initialized, getFS, refreshStatus]
  );

  const unstageFile = useCallback(
    async (filepath: string) => {
      if (!initialized) return;
      const fs = getFS();
      try {
        // Reset the file in the index to HEAD
        await git.resetIndex({ fs, dir: REPO_DIR, filepath });
        await refreshStatus();
      } catch (err) {
        console.error("Unstage failed:", err);
      }
    },
    [initialized, getFS, refreshStatus]
  );

  const stageAll = useCallback(async () => {
    if (!initialized) return;
    const fs = getFS();
    try {
      // Sync first
      await syncFilesToLightningFS();

      const matrix = await git.statusMatrix({ fs, dir: REPO_DIR });
      for (const row of matrix) {
        const filepath = row[0] as string;
        const [, head, workdir] = row as [string, number, number, number];
        if (head !== workdir || head === 0) {
          if (workdir === 0) {
            await git.remove({ fs, dir: REPO_DIR, filepath });
          } else {
            await git.add({ fs, dir: REPO_DIR, filepath });
          }
        }
      }
      await refreshStatus();
    } catch (err) {
      console.error("Stage all failed:", err);
    }
  }, [initialized, getFS, syncFilesToLightningFS, refreshStatus]);

  const commit = useCallback(
    async (message: string) => {
      if (!initialized || !message.trim()) return;
      const fs = getFS();
      try {
        await git.commit({
          fs,
          dir: REPO_DIR,
          message: message.trim(),
          author: AUTHOR,
        });
        await refreshStatus();
        // Refresh log inline to avoid circular dependency
        try {
          const commits = await git.log({ fs, dir: REPO_DIR, depth: 50 });
          setLog(
            commits.map((c) => ({
              oid: c.oid,
              message: c.commit.message,
              author: {
                name: c.commit.author.name,
                email: c.commit.author.email,
                timestamp: c.commit.author.timestamp,
              },
            }))
          );
        } catch {
          // ignore log refresh failure
        }
      } catch (err) {
        console.error("Commit failed:", err);
      }
    },
    [initialized, getFS, refreshStatus]
  );

  const getLog = useCallback(async (): Promise<CommitObject[]> => {
    if (!initialized) return [];
    const fs = getFS();
    try {
      const commits = await git.log({ fs, dir: REPO_DIR, depth: 50 });
      const mapped: CommitObject[] = commits.map((c) => ({
        oid: c.oid,
        message: c.commit.message,
        author: {
          name: c.commit.author.name,
          email: c.commit.author.email,
          timestamp: c.commit.author.timestamp,
        },
      }));
      setLog(mapped);
      return mapped;
    } catch (err) {
      console.error("Log failed:", err);
      return [];
    }
  }, [initialized, getFS]);

  const createBranch = useCallback(
    async (name: string) => {
      if (!initialized) return;
      const fs = getFS();
      try {
        await git.branch({ fs, dir: REPO_DIR, ref: name });
        const branchList = await git.listBranches({ fs, dir: REPO_DIR });
        setBranches(branchList);
      } catch (err) {
        console.error("Create branch failed:", err);
      }
    },
    [initialized, getFS]
  );

  const checkoutBranch = useCallback(
    async (name: string) => {
      if (!initialized) return;
      const fs = getFS();
      try {
        await git.checkout({ fs, dir: REPO_DIR, ref: name });
        setCurrentBranch(name);
        await refreshStatus();
      } catch (err) {
        console.error("Checkout failed:", err);
      }
    },
    [initialized, getFS, refreshStatus]
  );

  const getDiff = useCallback(
    async (filepath: string): Promise<{ old: string; new: string }> => {
      if (!initialized) return { old: "", new: "" };
      const fs = getFS();
      try {
        // Get the new (working) version
        let newContent = "";
        try {
          const content = await fs.promises.readFile(
            `${REPO_DIR}/${filepath}`,
            "utf8"
          );
          newContent = typeof content === "string" ? content : new TextDecoder().decode(content as Uint8Array);
        } catch {
          // File deleted
        }

        // Get the old (HEAD) version
        let oldContent = "";
        try {
          const commitOid = await git.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" });
          const { blob } = await git.readBlob({
            fs,
            dir: REPO_DIR,
            oid: commitOid,
            filepath,
          });
          oldContent = new TextDecoder().decode(blob);
        } catch {
          // File is new
        }

        return { old: oldContent, new: newContent };
      } catch (err) {
        console.error("Diff failed:", err);
        return { old: "", new: "" };
      }
    },
    [initialized, getFS]
  );

  // Check if repo is already initialized on mount
  useEffect(() => {
    const fs = getFS();
    async function checkInit() {
      try {
        await git.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" });
        setInitialized(true);
      } catch {
        // Not initialized
      }
    }
    checkInit();
  }, [getFS]);

  const hasChanges = status.size > 0;

  return {
    initialized,
    status,
    stagedFiles,
    log,
    currentBranch,
    branches,
    hasChanges,
    loading,
    initRepo,
    refreshStatus,
    stageFile,
    unstageFile,
    stageAll,
    commit,
    getLog,
    createBranch,
    checkoutBranch,
    getDiff,
  };
}
