require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// Parse URLs from environment variable (comma-separated)
const APPS = process.env.PING_URLS
  ? process.env.PING_URLS.split(",").map((url) => url.trim())
  : [process.env.RENDER_EXTERNAL_URL || "http://localhost:3000"];

const INTERVAL_MS = (process.env.PING_INTERVAL_MIN || 10) * 60 * 1000;
const TIMEOUT_MS = 120000; // 2 minutes per page
const PAGE_WAIT_SEC = parseInt(process.env.PAGE_WAIT_SEC || 180); // Time to keep all tabs open
const HTTP_TIMEOUT_MS = parseInt(process.env.HTTP_TIMEOUT_SEC || 30) * 1000; // HTTP request timeout
const HTTP_TO_BROWSER_DELAY_SEC = parseInt(process.env.HTTP_TO_BROWSER_DELAY_SEC || 10); // Delay between HTTP and browser launch

let lastRunTime = null;
let lastRunStatus = "Not started yet";
let lastResults = []; // Store detailed results for JSON response

// Discord webhook setup
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

if (DISCORD_WEBHOOK) {
  console.log(`Discord notifications enabled`);
} else {
  console.log(`Discord notifications disabled (no webhook URL)`);
}

async function sendDiscordNotification(title, description, fields, color) {
  if (!DISCORD_WEBHOOK) return;

  try {
    const embed = {
      title: title,
      description: description,
      color: color, // Red: 15548997, Green: 5763719, Orange: 16744192
      fields: fields || [],
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (response.ok) {
      console.log(`🔔 Discord notification sent: ${title}`);
    } else {
      console.error(`❌ Discord notification failed: ${response.status}`);
    }
  } catch (error) {
    console.error("❌ Discord notification error:", error.message);
  }
}

// HTTP ping function - single request, no retries
async function httpPing(url) {
  try {
    console.log(`HTTP ping: ${url}`);
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    const statusCode = response.status;

    if (statusCode >= 200 && statusCode < 300) {
      console.log(`✅ HTTP success: ${url} (${duration}ms, HTTP ${statusCode})`);
      return {
        success: true,
        statusCode,
        duration,
        timestamp: new Date().toISOString()
      };
    } else {
      console.log(`⚠️ HTTP status ${statusCode}: ${url}`);
      return {
        success: false,
        statusCode,
        duration,
        timestamp: new Date().toISOString(),
        error: `HTTP ${statusCode}`
      };
    }
  } catch (error) {
    console.error(`❌ HTTP error: ${url} - ${error.message}`);
    return {
      success: false,
      statusCode: null,
      duration: null,
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
}

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "alive",
    lastRun: lastRunTime,
    lastStatus: lastRunStatus,
    nextRun: lastRunTime
      ? new Date(lastRunTime.getTime() + INTERVAL_MS)
      : "Soon",
    apps: APPS,
    results: lastResults, // Show detailed HTTP and Puppeteer results
  });
});

// Manual trigger endpoint (optional, for testing)
app.get("/ping-now", async (req, res) => {
  res.send("Triggering ping cycle...");
  pingApps().catch((err) => console.error("Manual ping failed:", err));
});

async function pingApps() {
  lastRunTime = new Date();
  console.log(`\n🔄 Starting ping cycle at ${lastRunTime.toISOString()}`);

  // First, do HTTP pings for all apps (in parallel)
  console.log(`\n📡 Sending HTTP requests to ${APPS.length} apps in parallel...`);
  const httpPromises = APPS.map(async (url) => {
    const httpResult = await httpPing(url);
    return {
      url,
      http: httpResult
    };
  });
  const httpResults = await Promise.all(httpPromises);

  // Wait before launching browser
  console.log(`\n⏳ Waiting ${HTTP_TO_BROWSER_DELAY_SEC}s before launching browser...`);
  await new Promise(resolve => setTimeout(resolve, HTTP_TO_BROWSER_DELAY_SEC * 1000));

  let browser;
  try {
    console.log(`\n🌐 Opening ${APPS.length} apps in browser (staggered to reduce memory spike)...`);
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });

    // Open tabs one at a time with delay to reduce memory spike
    const results = [];
    for (let i = 0; i < APPS.length; i++) {
      const url = APPS[i];
      try {
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        );

        console.log(`Loading browser: ${url}`);
        const startTime = Date.now();

        const response = await page.goto(url, {
          waitUntil: "load",
          timeout: TIMEOUT_MS,
        });

        const httpStatus = response.status();
        const duration = Date.now() - startTime;

        // Check for successful HTTP status (200-299)
        if (httpStatus < 200 || httpStatus >= 300) {
          console.error(`❌ Browser failed: ${url} - HTTP ${httpStatus}`);
          results.push({
            url,
            puppeteer: {
              success: false,
              statusCode: httpStatus,
              duration,
              timestamp: new Date().toISOString(),
              error: `HTTP ${httpStatus}`
            },
            page,
          });
        } else {
          console.log(`✅ Browser loaded: ${url} (${duration}ms, HTTP ${httpStatus})`);
          results.push({
            url,
            puppeteer: {
              success: true,
              statusCode: httpStatus,
              duration,
              timestamp: new Date().toISOString()
            },
            page
          });
        }

        // Small delay before next tab (except on last one)
        if (i < APPS.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`❌ Browser failed: ${url} - ${error.message}`);
        results.push({
          url,
          puppeteer: {
            success: false,
            statusCode: null,
            duration: null,
            timestamp: new Date().toISOString(),
            error: error.message
          },
          page: null,
        });
      }
    }

    // Merge HTTP and Puppeteer results
    lastResults = httpResults.map((httpResult, index) => ({
      url: httpResult.url,
      http: httpResult.http,
      puppeteer: results[index]?.puppeteer || { success: false, error: "No browser result" }
    }));

    console.log(
      `Keeping all tabs open for ${PAGE_WAIT_SEC}s to ensure full spin-up...`
    );
    await new Promise((resolve) => setTimeout(resolve, PAGE_WAIT_SEC * 1000));

    await browser.close();

    const httpSuccessCount = lastResults.filter((r) => r.http.success).length;
    const puppeteerSuccessCount = lastResults.filter((r) => r.puppeteer.success).length;
    lastRunStatus = `HTTP: ${httpSuccessCount}/${APPS.length}, Browser: ${puppeteerSuccessCount}/${APPS.length} successful`;
    console.log(`\n✅ Cycle complete: ${lastRunStatus}\n`);

    // Send Discord notification if any apps failed
    const failedApps = lastResults.filter((r) => !r.http.success || !r.puppeteer.success);
    if (failedApps.length > 0) {
      const fields = failedApps.map((r) => ({
        name: r.url,
        value: `HTTP: ${r.http.success ? '✅' : '❌'} (${r.http.statusCode || 'N/A'})\nBrowser: ${r.puppeteer.success ? '✅' : '❌'} (${r.puppeteer.statusCode || 'N/A'})`,
        inline: false,
      }));

      await sendDiscordNotification(
        "⚠️ Puppeteer Pinger Alert",
        `**${failedApps.length} app(s) had failures**\n\nStatus: ${lastRunStatus}`,
        fields,
        15548997 // Red color
      );
    }
  } catch (error) {
    lastRunStatus = `Failed: ${error.message}`;
    console.error("💥 Critical error during ping cycle:", error);

    // Send Discord notification for critical errors
    await sendDiscordNotification(
      "🚨 Critical Ping Cycle Failure",
      `**The entire ping cycle failed**\n\nError: ${error.message}`,
      [],
      15548997 // Red color
    );

    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error("Error closing browser:", closeError);
      }
    }
  }
}

// Start the Express server
app.listen(PORT, () => {
  console.log(`Keeper app listening on port ${PORT}`);
  console.log(`Monitoring ${APPS.length} apps:`);
  APPS.forEach((url) => console.log(`   - ${url}`));
  console.log(`Ping interval: ${INTERVAL_MS / 60000} minutes\n`);

  // Run first ping after 30 seconds (give app time to fully start)
  setTimeout(() => {
    pingApps().catch((err) => console.error("Initial ping failed:", err));
  }, 30000);

  // Then run every INTERVAL_MS
  setInterval(() => {
    pingApps().catch((err) => console.error("Scheduled ping failed:", err));
  }, INTERVAL_MS);
});
`
`