import { useState, useRef } from "react";
import { Upload, FolderOpen, X, CheckCircle2, Loader2 } from "lucide-react";
import { importFromZip, importFromFolder } from "@/lib/importFiles";

interface ImportDialogProps {
  projectId: string;
  onClose: () => void;
  onImported?: (count: number) => void;
}

type Status = "idle" | "importing" | "done" | "error";

export function ImportDialog({
  projectId,
  onClose,
  onImported,
}: ImportDialogProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [importedCount, setImportedCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleZipChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("importing");
    setErrorMessage("");
    try {
      const count = await importFromZip(file, projectId);
      setImportedCount(count);
      setStatus("done");
      onImported?.(count);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Import failed");
      setStatus("error");
    }
  };

  const handleFolderChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setStatus("importing");
    setErrorMessage("");
    try {
      const count = await importFromFolder(files, projectId);
      setImportedCount(count);
      setStatus("done");
      onImported?.(count);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Import failed");
      setStatus("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.6)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-lg border shadow-2xl"
        style={{
          width: 420,
          background: "hsl(220 13% 16%)",
          borderColor: "hsl(220 13% 25%)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "hsl(220 13% 22%)" }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: "hsl(220 14% 85%)" }}
          >
            Import Files
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 transition-colors"
            style={{
              color: "hsl(220 14% 55%)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "hsl(220 13% 22%)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "transparent")
            }
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-5">
          {status === "idle" && (
            <div className="flex flex-col gap-3">
              {/* ZIP Upload */}
              <button
                onClick={() => zipInputRef.current?.click()}
                className="flex items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors"
                style={{
                  background: "hsl(220 13% 19%)",
                  borderColor: "hsl(220 13% 28%)",
                  cursor: "pointer",
                  color: "hsl(220 14% 80%)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.borderColor =
                    "hsl(210 100% 50%)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.borderColor =
                    "hsl(220 13% 28%)")
                }
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded"
                  style={{ background: "hsl(220 13% 24%)" }}
                >
                  <Upload size={18} style={{ color: "hsl(210 100% 65%)" }} />
                </div>
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: "hsl(220 14% 85%)" }}
                  >
                    Upload ZIP
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "hsl(220 14% 50%)" }}
                  >
                    Import files from a .zip archive
                  </div>
                </div>
              </button>
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip"
                onChange={handleZipChange}
                className="hidden"
              />

              {/* Folder Upload */}
              <button
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors"
                style={{
                  background: "hsl(220 13% 19%)",
                  borderColor: "hsl(220 13% 28%)",
                  cursor: "pointer",
                  color: "hsl(220 14% 80%)",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.borderColor =
                    "hsl(210 100% 50%)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.borderColor =
                    "hsl(220 13% 28%)")
                }
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded"
                  style={{ background: "hsl(220 13% 24%)" }}
                >
                  <FolderOpen
                    size={18}
                    style={{ color: "hsl(38 92% 60%)" }}
                  />
                </div>
                <div>
                  <div
                    className="text-sm font-medium"
                    style={{ color: "hsl(220 14% 85%)" }}
                  >
                    Upload Folder
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "hsl(220 14% 50%)" }}
                  >
                    Import an entire folder from your computer
                  </div>
                </div>
              </button>
              <input
                ref={folderInputRef}
                type="file"
                /* @ts-expect-error webkitdirectory is non-standard */
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleFolderChange}
                className="hidden"
              />
            </div>
          )}

          {status === "importing" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2
                size={28}
                className="animate-spin"
                style={{ color: "hsl(210 100% 65%)" }}
              />
              <div
                className="text-sm"
                style={{ color: "hsl(220 14% 70%)" }}
              >
                Importing files...
              </div>
            </div>
          )}

          {status === "done" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2
                size={28}
                style={{ color: "hsl(142 71% 55%)" }}
              />
              <div
                className="text-sm font-medium"
                style={{ color: "hsl(220 14% 85%)" }}
              >
                Imported {importedCount} file{importedCount !== 1 ? "s" : ""}{" "}
                successfully
              </div>
              <button
                onClick={onClose}
                className="mt-2 rounded px-4 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: "hsl(210 100% 50%)",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "hsl(210 100% 45%)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "hsl(210 100% 50%)")
                }
              >
                Done
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <X size={28} style={{ color: "hsl(0 84% 60%)" }} />
              <div
                className="text-sm font-medium"
                style={{ color: "hsl(0 84% 70%)" }}
              >
                {errorMessage}
              </div>
              <button
                onClick={() => setStatus("idle")}
                className="mt-2 rounded px-4 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: "hsl(220 13% 25%)",
                  color: "hsl(220 14% 80%)",
                  border: "none",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "hsl(220 13% 30%)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background =
                    "hsl(220 13% 25%)")
                }
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
