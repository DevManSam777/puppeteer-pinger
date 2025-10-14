require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse URLs from environment variable (comma-separated)
const APPS = process.env.PING_URLS
  ? process.env.PING_URLS.split(',').map(url => url.trim())
  : [process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'];

const INTERVAL_MS = (process.env.PING_INTERVAL_MIN || 10) * 60 * 1000;
const TIMEOUT_MS = 120000; // 2 minutes per page
const PAGE_WAIT_SEC = parseInt(process.env.PAGE_WAIT_SEC || 120); // Time to keep all tabs open

let lastRunTime = null;
let lastRunStatus = 'Not started yet';

// Discord webhook setup
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

if (DISCORD_WEBHOOK) {
  console.log(`🔔 Discord notifications enabled`);
} else {
  console.log(`🔔 Discord notifications disabled (no webhook URL)`);
}

async function sendDiscordNotification(title, description, fields, color) {
  if (!DISCORD_WEBHOOK) return;

  try {
    const embed = {
      title: title,
      description: description,
      color: color, // Red: 15548997, Green: 5763719, Orange: 16744192
      fields: fields || [],
      timestamp: new Date().toISOString()
    };

    const response = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] })
    });

    if (response.ok) {
      console.log(`🔔 Discord notification sent: ${title}`);
    } else {
      console.error(`❌ Discord notification failed: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Discord notification error:', error.message);
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'alive',
    lastRun: lastRunTime,
    lastStatus: lastRunStatus,
    nextRun: lastRunTime ? new Date(lastRunTime.getTime() + INTERVAL_MS) : 'Soon',
    apps: APPS
  });
});

// Manual trigger endpoint (optional, for testing)
app.get('/ping-now', async (req, res) => {
  res.send('Triggering ping cycle...');
  pingApps().catch(err => console.error('Manual ping failed:', err));
});

async function pingApps() {
  lastRunTime = new Date();
  console.log(`\n🚀 Starting ping cycle at ${lastRunTime.toISOString()}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    console.log(`📡 Opening ${APPS.length} apps in parallel tabs...`);

    // Open all apps in parallel tabs
    const pagePromises = APPS.map(async (url) => {
      try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        console.log(`📡 Loading: ${url}`);
        const startTime = Date.now();

        await page.goto(url, {
          waitUntil: 'load',
          timeout: TIMEOUT_MS
        });

        const duration = Date.now() - startTime;
        console.log(`✅ Loaded: ${url} (${duration}ms)`);

        return { url, status: 'success', duration, page };
      } catch (error) {
        console.error(`❌ Failed: ${url} - ${error.message}`);
        return { url, status: 'failed', error: error.message, page: null };
      }
    });

    const results = await Promise.all(pagePromises);

    console.log(`⏳ Keeping all tabs open for ${PAGE_WAIT_SEC}s to ensure full spin-up...`);
    await new Promise(resolve => setTimeout(resolve, PAGE_WAIT_SEC * 1000));

    await browser.close();

    const successCount = results.filter(r => r.status === 'success').length;
    const failedApps = results.filter(r => r.status === 'failed');
    lastRunStatus = `${successCount}/${APPS.length} apps pinged successfully`;
    console.log(`\n✨ Cycle complete: ${lastRunStatus}\n`);

    // Send Discord notification if any apps failed
    if (failedApps.length > 0) {
      const fields = failedApps.map(r => ({
        name: r.url,
        value: `❌ ${r.error}`,
        inline: false
      }));

      await sendDiscordNotification(
        '⚠️ Puppeteer Pinger Alert',
        `**${failedApps.length} app(s) failed to respond**\n\nStatus: ${lastRunStatus}`,
        fields,
        15548997 // Red color
      );
    }

  } catch (error) {
    lastRunStatus = `Failed: ${error.message}`;
    console.error('💥 Critical error during ping cycle:', error);

    // Send Discord notification for critical errors
    await sendDiscordNotification(
      '🚨 Critical Ping Cycle Failure',
      `**The entire ping cycle failed**\n\nError: ${error.message}`,
      [],
      15548997 // Red color
    );

    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }
  }
}

// Start the Express server
app.listen(PORT, () => {
  console.log(`🎯 Keeper app listening on port ${PORT}`);
  console.log(`📋 Monitoring ${APPS.length} apps:`);
  APPS.forEach(url => console.log(`   - ${url}`));
  console.log(`⏰ Ping interval: ${INTERVAL_MS / 60000} minutes\n`);

  // Run first ping after 30 seconds (give app time to fully start)
  setTimeout(() => {
    pingApps().catch(err => console.error('Initial ping failed:', err));
  }, 30000);

  // Then run every INTERVAL_MS
  setInterval(() => {
    pingApps().catch(err => console.error('Scheduled ping failed:', err));
  }, INTERVAL_MS);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  process.exit(0);
});
