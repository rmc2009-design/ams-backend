/**
 * index.js — AMS Backend entry point
 * Starts the Express server + cron scheduler
 */

require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { syncAll } = require('./src/jobs/syncAll');
const { handle1080Webhook, watch1080Folder } = require('./src/integrations/1080motion');

const app = express();
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Webhooks ──────────────────────────────────────────────────────────────────
app.post('/webhooks/1080motion', handle1080Webhook);

// Add Whoop OAuth callback here when implementing athlete linking:
// app.get('/auth/whoop/callback', require('./src/integrations/whoop').oauthCallback);

// ── Scheduled jobs ────────────────────────────────────────────────────────────
const SYNC_CRON = process.env.SYNC_CRON || '0 */6 * * *'; // every 6 hours
cron.schedule(SYNC_CRON, () => {
  console.log(`[cron] Running sync: ${new Date().toISOString()}`);
  syncAll().catch(console.error);
});

// ── 1080 Motion watch folder ──────────────────────────────────────────────────
if (process.env['1080_WATCH_FOLDER']) {
  watch1080Folder(process.env['1080_WATCH_FOLDER']);
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AMS backend running on port ${PORT}`);
  console.log(`Sync schedule: ${SYNC_CRON}`);
  // Run an initial sync on startup
  syncAll().catch(console.error);
});
