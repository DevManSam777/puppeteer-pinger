# Puppeteer Pinger

Keeps your Render.com apps alive by visiting them with a real browser every 10 minutes. This generates actual external HTTP traffic that prevents Render's free tier apps from spinning down.

## How It Works

1. Runs on Render as a Docker web service
2. Every 10 minutes, launches Puppeteer browser
3. Visits each app URL (including itself!)
4. These are real external requests that keep apps active

## Setup

### 1. Local Testing (Optional)

```bash
npm install
npm start
```

Visit `http://localhost:3000/ping-now` to trigger a test cycle.

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
   - Optional: Email variables (`SMTP_USER`, `SMTP_PASS`, `NOTIFY_EMAIL`)

   Example:
   ```
   PING_URLS=https://puppeteer-pinger.onrender.com,https://your-other-app.onrender.com
   PING_INTERVAL_MIN=10
   ```

## Endpoints

- `GET /` - Health check, shows last run time and status
- `GET /ping-now` - Manually trigger a ping cycle (for testing)

## Features

- Visits all apps every 10 minutes
- First ping starts 30 seconds after deployment
- Detailed logging with timestamps and durations
- Error handling for individual app failures
- Email alerts when apps fail (optional)
- Docker container with all Chrome dependencies
- Works around Render's inactivity spin-down

## Configuration

All configuration is done via environment variables in Render.

### Required Variables

- `PING_URLS` - Comma-separated list of URLs to ping (e.g., `https://app1.onrender.com,https://app2.onrender.com`)
- `PING_INTERVAL_MIN` - How often to ping in minutes (default: 10)

### Email Notifications (Optional)

Get notified when apps fail to respond:

- `SMTP_USER` - Your Gmail address
- `SMTP_PASS` - Gmail app password (generate at https://myaccount.google.com/apppasswords)
- `NOTIFY_EMAIL` - Email to receive alerts

If email variables are not set, the app works normally without alerts.

## How It Keeps Apps Alive

When Render apps on the free tier have no external traffic for 15 minutes, they spin down. This app:
1. Pings itself (external traffic)
2. Uses Puppeteer to visit other apps (real HTTP requests)
3. Runs every 10 minutes (before 15-minute timeout)
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

MIT
