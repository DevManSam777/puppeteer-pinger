# Puppeteer Pinger

Keeps your Render.com apps alive by visiting them with a real browser at configurable intervals. This generates actual external HTTP traffic that prevents Render's free tier apps from spinning down.

## How It Works

1. Runs on Render as a Docker web service
2. At your configured interval (default 10 minutes), launches Puppeteer browser
3. Opens all apps in separate browser tabs simultaneously
4. Keeps all tabs open for 3 minutes (configurable)
5. These are real browser visits that keep apps active

### Why Use a Real Browser vs Simple HTTP Pings?

Unlike services like UptimeRobot or cron-job.org that send quick HTTP requests, Puppeteer:
- **Actually visits the page** like a real user, not just a quick GET request
- **Executes JavaScript** - fully loads your React/Vue/Node app
- **Stays on the page** for minutes, not milliseconds
- **Keeps connections alive** - generates sustained server activity
- **Opens multiple tabs** - keeps all apps warm simultaneously

Simple HTTP pings send a request and disconnect immediately. This app maintains an active browser session for several minutes, ensuring apps are fully loaded and warmed up before closing.

## Setup

### 1. Local Testing (Optional)

Copy the example environment file and configure it:
```bash
cp .env.example .env
```

Then edit `.env` with your configuration:
```
PING_URLS=http://localhost:3000, https://your-app.onrender.com
PING_INTERVAL_MIN=5
PAGE_WAIT_SEC=180
DISCORD_WEBHOOK=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
```

Run the app:
```bash
npm install
npm start
```

Visit `http://localhost:3000` to see status or `/ping-now` to trigger a test cycle.

### 2. Deploy to Render

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Create Web Service on Render:**
   - Go to [Render Dashboard](https://dashboard.render.com/)
   - Click "New +" → "Web Service"
   - Connect your GitHub repo
   - Configure:
     - **Name:** `puppeteer-pinger`
     - **Environment:** `Docker`
     - **Instance Type:** `Free`
     - **Auto-Deploy:** `Yes`

3. **Add Environment Variables:**
   After deployment, add these in the Render dashboard (Environment tab):

   - `PING_URLS` - Your deployed URL and any other apps (comma-separated)
   - `PING_INTERVAL_MIN` - How often to ping (e.g., 10 for 10 minutes)
   - `PAGE_WAIT_SEC` - How long to keep tabs open (e.g., 180 for 3 minutes)
   - `DISCORD_WEBHOOK` - Discord webhook URL for notifications (optional)

   Example:
   ```
   PING_URLS=https://puppeteer-pinger.onrender.com, https://your-other-app.onrender.com
   PING_INTERVAL_MIN=10
   PAGE_WAIT_SEC=180
   DISCORD_WEBHOOK=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
   ```

## Endpoints

- `GET /` - Health check, shows last run time and status
- `GET /ping-now` - Manually trigger a ping cycle (for testing)

## Features

- Configurable ping interval (default: 10 minutes)
- Configurable list of URLs to monitor
- Opens all apps in parallel tabs for efficiency
- Configurable wait time to ensure full spin-up
- First ping starts 30 seconds after deployment
- Detailed logging with timestamps and durations
- Error handling for individual app failures
- Discord notifications when apps fail (optional)
- Docker container with all Chrome dependencies
- Works around Render's inactivity spin down

## Configuration

All configuration is done via environment variables in Render.

### Required Variables

- `PING_URLS` - Comma-separated list of URLs to ping (spaces after commas are fine)
  - Example: `https://app1.onrender.com, https://app2.onrender.com, https://app3.onrender.com`
- `PING_INTERVAL_MIN` - How often to ping in minutes (default: 10)
- `PAGE_WAIT_SEC` - Seconds to keep all tabs open (default: 120, ensures full spin-up)

### Discord Notifications (Optional)

Get notified in Discord when apps fail to respond:

- `DISCORD_WEBHOOK` - Discord webhook URL

**How to get a Discord webhook:**
1. Open Discord and create a server (or use existing)
2. Right-click a channel → Edit Channel → Integrations
3. Click Webhooks → New Webhook → Copy Webhook URL

If webhook is not set, the app works normally without notifications.

## How It Keeps Apps Alive

When Render apps on the free tier have no external traffic for 15 minutes, they spin down. This app:
1. Pings itself (external traffic)
2. Uses Puppeteer to visit other apps (real HTTP requests)
3. Runs at your configured interval (default 10 minutes, before 15-minute timeout)
4. Keeps all apps active and responsive

## Troubleshooting

**Apps still spinning down:**
- Check Render logs to ensure pings run every 10 minutes
- Verify all URLs are correct and accessible
- Make sure the app is pinging itself

**Puppeteer errors:**
- Dockerfile includes all Chrome dependencies
- Render automatically detects Dockerfile and builds correctly
- Check logs for specific error messages

**Timeout errors:**
- Increase `TIMEOUT_MS` in index.js
- Some apps may take longer to wake up from sleep

## Tech Stack

- Node.js 18
- Express
- Puppeteer (headless Chrome)
- Docker

## License
[LICENSE](LICENSE)

Copyright (c) 2025 DevManSam

