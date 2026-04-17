// Must be first import — patches fetch/EventSource for Tauri desktop mode
import "./lib/tauri-fetch";

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
