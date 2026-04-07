import { manifest as wordCounterManifest, code as wordCounterCode } from "./word-counter";
import { manifest as bookmarksManifest, code as bookmarksCode } from "./bookmarks";
import { manifest as todoFinderManifest, code as todoFinderCode } from "./todo-finder";
import { manifest as markdownManifest, code as markdownCode } from "./markdown-preview";
import { manifest as promptManifest, code as promptCode } from "./prompt-templates";
import { manifest as snippetsManifest, code as snippetsCode } from "./snippets";
import type { ExtensionBundle } from "../types";

export const BUILTIN_EXTENSIONS: ExtensionBundle[] = [
  { manifest: wordCounterManifest, code: wordCounterCode },
  { manifest: bookmarksManifest, code: bookmarksCode },
  { manifest: todoFinderManifest, code: todoFinderCode },
  { manifest: markdownManifest, code: markdownCode },
  { manifest: promptManifest, code: promptCode },
  { manifest: snippetsManifest, code: snippetsCode },
];
