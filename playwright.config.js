const fs = require("fs");
const { defineConfig } = require("@playwright/test");

// Playwright's bundled builds need glibc. On musl systems (Alpine) use the
// distro Chromium when it is installed; `npm run test:browser` still works
// everywhere else with the downloaded browser.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
	|| (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

module.exports = defineConfig({
	testDir: "./tests/browser",
	testMatch: "**/*.pw.js",
	timeout: 30000,
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:4173",
		launchOptions: {
			executablePath,
			args: ["--disable-gpu"],
		},
		viewport: { width: 450, height: 900 },
		hasTouch: true,
		isMobile: true,
		deviceScaleFactor: 1,
	},
	webServer: {
		command: "python3 -m http.server 4173 --bind 127.0.0.1",
		url: "http://127.0.0.1:4173/index.html",
		reuseExistingServer: !process.env.CI,
		timeout: 30000,
	},
});
