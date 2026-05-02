import { createRoot } from "react-dom/client"
import { MapEditor } from "./MapEditor"

const root = document.getElementById("root")
if (!root) throw new Error("No #root element")
createRoot(root).render(<MapEditor />)
