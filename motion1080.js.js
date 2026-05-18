/**
 * 1080 Motion integration
 * 1080 Motion does not currently expose a public REST API.
 * Two supported approaches:
 *   A) CSV export — parse files dropped into a watch folder
 *   B) Webhook receiver — 1080 Sprint / 1080 Quantum can push data via webhook
 *
 * This file handles both.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── Approach A: CSV parsing ───────────────────────────────────────────────────

/**
 * Parse a 1080 Motion CSV export file.
 * Call this after an athlete session export lands in your watch folder.
 *
 * Expected 1080 Sprint CSV columns (may vary by firmware version):
 *   Date, Athlete, Set, Rep, Distance(m), Time(s), Velocity(m/s),
 *   Force(N), Power(W), Acceleration(m/s²), Load(kg)
 */
async function parseCSVExport(filePath) {
  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });

  let headers = null;
  for await (const line of rl) {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (!headers) { headers = cols; continue; }
    if (cols.length < 3) continue;

    const row = Object.fromEntries(headers.map((h, i) => [h, cols[i]]));
    records.push(normalizeCSVRow(row, path.basename(filePath)));
  }

  return records.filter(r => r.athlete_name); // drop blank rows
}

function normalizeCSVRow(row, filename) {
  return {
    source: '1080motion',
    filename,
    date: parseDate(row['Date'] ?? row['date']),
    athlete_name: row['Athlete'] ?? row['athlete'] ?? null,
    set_number: parseInt(row['Set']) || null,
    rep_number: parseInt(row['Rep']) || null,
    distance_m: parseFloat(row['Distance(m)'] ?? row['Distance']) || null,
    time_s: parseFloat(row['Time(s)'] ?? row['Time']) || null,
    peak_velocity_ms: parseFloat(row['Velocity(m/s)'] ?? row['Velocity']) || null,
    peak_force_n: parseFloat(row['Force(N)'] ?? row['Force']) || null,
    peak_power_w: parseFloat(row['Power(W)'] ?? row['Power']) || null,
    peak_acceleration_ms2: parseFloat(row['Acceleration(m/s²)'] ?? row['Acceleration']) || null,
    load_kg: parseFloat(row['Load(kg)'] ?? row['Load']) || null,
  };
}

function parseDate(str) {
  if (!str) return null;
  try { return new Date(str).toISOString().split('T')[0]; }
  catch { return null; }
}

// ── Approach B: Webhook receiver (Express route) ──────────────────────────────

/**
 * Mount this as an Express route:
 *   app.post('/webhooks/1080motion', handle1080Webhook)
 *
 * Configure the 1080 system to POST to https://your-server.com/webhooks/1080motion
 */
function handle1080Webhook(req, res) {
  try {
    const payload = req.body;
    // 1080 webhook shape varies by device model — log first, then map
    console.log('[1080motion webhook]', JSON.stringify(payload, null, 2));

    const normalized = {
      source: '1080motion_webhook',
      date: new Date().toISOString().split('T')[0],
      athlete_name: payload.athleteName ?? payload.athlete ?? null,
      peak_velocity_ms: payload.peakVelocity ?? payload.peak_velocity ?? null,
      peak_force_n: payload.peakForce ?? payload.peak_force ?? null,
      peak_power_w: payload.peakPower ?? payload.peak_power ?? null,
      load_kg: payload.load ?? null,
      raw: payload,
    };

    // Emit for the syncAll job to pick up
    require('../jobs/syncAll').ingestRecord('1080motion', normalized);

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[1080motion webhook error]', err);
    res.status(500).json({ error: err.message });
  }
}

// ── Watch folder helper ───────────────────────────────────────────────────────

/**
 * Watch a directory for new 1080 CSV exports and parse them automatically.
 * Call at startup: watch1080Folder('/path/to/1080-exports')
 */
function watch1080Folder(folderPath) {
  if (!fs.existsSync(folderPath)) {
    console.warn(`[1080motion] Watch folder not found: ${folderPath}`);
    return;
  }
  fs.watch(folderPath, async (event, filename) => {
    if (event === 'rename' && filename?.endsWith('.csv')) {
      const full = path.join(folderPath, filename);
      // Wait briefly for file write to complete
      setTimeout(async () => {
        try {
          const records = await parseCSVExport(full);
          console.log(`[1080motion] Parsed ${records.length} records from ${filename}`);
          records.forEach(r => require('../jobs/syncAll').ingestRecord('1080motion', r));
        } catch (err) {
          console.error(`[1080motion] Parse error for ${filename}:`, err.message);
        }
      }, 1000);
    }
  });
  console.log(`[1080motion] Watching ${folderPath} for CSV exports`);
}

module.exports = { parseCSVExport, handle1080Webhook, watch1080Folder };
