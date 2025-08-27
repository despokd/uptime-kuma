const { MonitorType } = require("./monitor-type");
const { chromium } = require("playwright-core");
const { UP, DOWN, log } = require("../../src/util");

/**
 * Get the current instance of the browser. If there isn't one, create it
 * @returns {Promise<Browser>} The browser
 */
async function getBrowser() {
    // For simplicity, create a new browser instance each time
    // In production, this could be optimized to reuse browsers
    return await chromium.launch({
        headless: true,
        args: [ "--no-sandbox", "--disable-setuid-sandbox" ]
    });
}

class NoindexMonitorType extends MonitorType {

    name = "noindex";

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, server) {
        const browser = await getBrowser();
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            // Prevent Local File Inclusion
            // Accept only http:// and https://
            let url = new URL(monitor.url);
            if (url.protocol !== "http:" && url.protocol !== "https:") {
                throw new Error("Invalid url protocol, only http and https are allowed.");
            }

            const res = await page.goto(monitor.url, {
                waitUntil: "networkidle",
                timeout: monitor.interval * 1000 * 0.8,
            });

            if (res.status() < 200 || res.status() >= 400) {
                throw new Error(`HTTP ${res.status()}`);
            }

            // Check for noindex directives
            const hasNoindexMeta = await this.checkNoindexMeta(page);
            const hasNoindexHeader = await this.checkNoindexHeader(res);

            if (hasNoindexMeta || hasNoindexHeader) {
                heartbeat.status = UP;
                heartbeat.msg = "Noindex directive found";
            } else {
                heartbeat.status = DOWN;
                heartbeat.msg = "No noindex directive found";
            }

            const timing = res.request().timing();
            heartbeat.ping = timing.responseEnd;

        } finally {
            await context.close();
            await browser.close();
        }
    }

    /**
     * Check for noindex meta tags in the page
     * @param {Page} page Playwright page object
     * @returns {Promise<boolean>} True if noindex meta tag found
     */
    async checkNoindexMeta(page) {
        try {
            // Check for robots meta tag with noindex
            const robotsMeta = await page.evaluate(() => {
                const metaTags = document.querySelectorAll("meta[name=\"robots\"], meta[name=\"ROBOTS\"], meta[name=\"googlebot\"]");
                for (const meta of metaTags) {
                    const content = meta.getAttribute("content");
                    if (content && content.toLowerCase().includes("noindex")) {
                        return true;
                    }
                }
                return false;
            });

            return robotsMeta;
        } catch (error) {
            log.error("NoindexMonitor", `Error checking meta tags: ${error.message}`);
            return false;
        }
    }

    /**
     * Check for noindex in X-Robots-Tag header
     * @param {Response} response Playwright response object
     * @returns {Promise<boolean>} True if noindex header found
     */
    async checkNoindexHeader(response) {
        try {
            const headers = response.headers();
            const robotsHeader = headers["x-robots-tag"];

            if (robotsHeader && robotsHeader.toLowerCase().includes("noindex")) {
                return true;
            }

            return false;
        } catch (error) {
            log.error("NoindexMonitor", `Error checking headers: ${error.message}`);
            return false;
        }
    }
}

module.exports = {
    NoindexMonitorType,
};
