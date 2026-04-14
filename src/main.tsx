// Tauri fetch interceptor — must be first import so it patches window.fetch
// before any component makes API calls. No-op in web mode.
import "./lib/tauri-fetch";

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
