// Must be first import — patches fetch/EventSource for Electron production mode
import "./lib/desktop-fetch";

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
