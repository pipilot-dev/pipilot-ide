import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/tauri-fetch";

createRoot(document.getElementById("root")!).render(<App />);
