import JSZip from "jszip";
import { saveAs } from "file-saver";
import { db } from "@/lib/db";

/**
 * Export all files for the active project as a downloadable ZIP.
 */
export async function exportProjectAsZip(
  projectName: string,
  projectId: string
): Promise<void> {
  const files = await db.files
    .where("projectId")
    .equals(projectId)
    .toArray();

  const zip = new JSZip();

  for (const file of files) {
    if (file.type !== "file") continue;
    zip.file(file.id, file.content ?? "");
  }

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `${projectName}.zip`);
}
