import { createRoot } from "react-dom/client"
import { MapEditor } from "./MapEditor"

async function prepare(): Promise<void> {
  if (import.meta.env.VITE_MOCK_API === "true") {
    const { worker } = await import("./mocks/browser")
    await worker.start({
      onUnhandledRequest: "bypass", // let through any requests not covered by handlers
    })
  }
}

const root = document.getElementById("root")
if (!root) throw new Error("No #root element")

void prepare().then(() => {
  createRoot(root).render(<MapEditor />)
})
