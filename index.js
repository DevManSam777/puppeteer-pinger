require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse URLs from environment variable (comma-separated)
const APPS = process.env.PING_URLS
  ? process.env.PING_URLS.split(',').map(url => url.trim())
  : [process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000'];

const INTERVAL_MS = (process.env.PING_INTERVAL_MIN || 10) * 60 * 1000;
const TIMEOUT_MS = 120000; // 2 minutes per page

let lastRunTime = null;
let lastRunStatus = 'Not started yet';

// Email setup
const EMAIL_ENABLED = process.env.SMTP_USER && process.env.SMTP_PASS && process.env.NOTIFY_EMAIL;
let transporter = null;

if (EMAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  console.log(`📧 Email notifications enabled`);
}

async function sendEmail(subject, htmlContent) {
  if (!EMAIL_ENABLED) return;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.NOTIFY_EMAIL,
      subject: subject,
      html: htmlContent
    });
    console.log(`📨 Email sent: ${subject}`);
  } catch (error) {
    console.error('❌ Email failed:', error.message);
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

    const page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const results = [];

    for (const url of APPS) {
      try {
        console.log(`📡 Pinging: ${url}`);
        const startTime = Date.now();

        await page.goto(url, {
          waitUntil: 'networkidle0',
          timeout: TIMEOUT_MS
        });

        const duration = Date.now() - startTime;
        console.log(`✅ Success: ${url} (${duration}ms)`);
        results.push({ url, status: 'success', duration });

      } catch (error) {
        console.error(`❌ Failed: ${url} - ${error.message}`);
        results.push({ url, status: 'failed', error: error.message });
      }
    }

    await browser.close();

    const successCount = results.filter(r => r.status === 'success').length;
    const failedApps = results.filter(r => r.status === 'failed');
    lastRunStatus = `${successCount}/${APPS.length} apps pinged successfully`;
    console.log(`\n✨ Cycle complete: ${lastRunStatus}\n`);

    // Send email if any apps failed
    if (failedApps.length > 0) {
      const failedList = failedApps.map(r => `<li><strong>${r.url}</strong><br>Error: ${r.error}</li>`).join('');
      const html = `
        <h2>⚠️ Puppeteer Pinger Alert</h2>
        <p><strong>${failedApps.length} app(s) failed to respond:</strong></p>
        <ul>${failedList}</ul>
        <p>Time: ${lastRunTime.toLocaleString()}</p>
        <p>Status: ${lastRunStatus}</p>
      `;
      await sendEmail(`⚠️ ${failedApps.length} App(s) Failed`, html);
    }

  } catch (error) {
    lastRunStatus = `Failed: ${error.message}`;
    console.error('💥 Critical error during ping cycle:', error);

    // Send email for critical errors
    const html = `
      <h2>🚨 Critical Error</h2>
      <p><strong>The ping cycle failed completely:</strong></p>
      <p>Error: ${error.message}</p>
      <p>Time: ${new Date().toLocaleString()}</p>
    `;
    await sendEmail('🚨 Critical Ping Cycle Failure', html);

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
