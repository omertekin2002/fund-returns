// End-to-end tests for the page: `npm run test:e2e`. They serve site/ on
// localhost with Python's http.server (as `npm run serve` does) and drive it
// in headless Chromium against the committed data/funds.json.
import { defineConfig, devices } from "@playwright/test";

const PORT = 8137;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `python3 -m http.server --directory site ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    // http.server logs every request to stderr; keep the test output readable.
    stderr: "ignore",
  },
});
