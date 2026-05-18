/**
 * index.js — AMS Backend entry point
 * Starts the Express server + cron scheduler
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { syncAll } = require('./src/jobs/syncAll');

const app = express();
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Webhooks ──────────────────────────────────────────────────────────────────


// Add Whoop OAuth callback here when implementing athlete linking:
// app.get('/auth/whoop/callback', require('./src/integrations/whoop').oauthCallback);

// ── Scheduled jobs ────────────────────────────────────────────────────────────
const SYNC_CRON = process.env.SYNC_CRON || '0 */6 * * *'; // every 6 hours
cron.schedule(SYNC_CRON, () => {
  console.log(`[cron] Running sync: ${new Date().toISOString()}`);
  syncAll().catch(console.error);
});

// ── 1080 Motion watch folder ──────────────────────────────────────────────────

}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AMS backend running on port ${PORT}`);
  console.log(`Sync schedule: ${SYNC_CRON}`);
  // Run an initial sync on startup
  syncAll().catch(console.error);
});
