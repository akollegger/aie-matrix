/**
 * Quick browser probe — navigates to the map editor dev server,
 * waits for the map to settle, collects console messages + errors,
 * and saves a screenshot. Run with: node probe.mjs
 */
import { chromium } from "@playwright/test"
import { fileURLToPath } from "node:url"
import path from "node:path"

const PROBE_URL = process.env.PROBE_URL ?? "http://localhost:5182/"
const WAIT_MS = parseInt(process.env.PROBE_WAIT ?? "8000", 10)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const page = await ctx.newPage()

const logs = []
const errors = []

page.on("console", msg => {
  logs.push({ type: msg.type(), text: msg.text() })
})
page.on("pageerror", err => {
  errors.push(err.message)
})

console.log(`Navigating to ${PROBE_URL} …`)
const response = await page.goto(PROBE_URL, { timeout: 30_000 }).catch(e => { errors.push(e.message); return null })
console.log(`HTTP status: ${response?.status() ?? "n/a"}`)

console.log(`Waiting ${WAIT_MS}ms for map to settle …`)
await page.waitForTimeout(WAIT_MS)

const screenshotPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "probe-screenshot.png")
await page.screenshot({ path: screenshotPath, fullPage: false })
console.log(`Screenshot saved: ${screenshotPath}`)

await browser.close()

console.log("\n=== Console messages ===")
for (const m of logs) console.log(`[${m.type}] ${m.text}`)

if (errors.length) {
  console.log("\n=== Page errors ===")
  for (const e of errors) console.log(e)
} else {
  console.log("\n✓ No page errors")
}
