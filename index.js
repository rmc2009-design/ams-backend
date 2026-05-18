require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const upload = multer({ dest: '/tmp/uploads/' });

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/athletes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athletes').select('*');
    if (error) throw error;
    res.json({ count: data.length, athletes: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/flags', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('athlete_flags')
      .select('*, athletes(first_name, last_name)')
      .eq('resolved', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ count: data.length, flags: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/upload', (req, res) => {
  res.send(`
    <html>
    <head><title>1080 Motion Import</title>
    <style>
      body { font-family: sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; }
      h2 { margin-bottom: 8px; }
      p { color: #666; margin-bottom: 24px; }
      input[type=file] { display: block; margin-bottom: 16px; }
      button { background: #2563eb; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 15px; }
      button:hover { background: #1d4ed8; }
      #result { margin-top: 24px; padding: 16px; border-radius: 6px; display: none; }
      .success { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
      .error { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
    </style>
    </head>
    <body>
      <h2>1080 Motion Import</h2>
      <p>Upload an Excel export from your 1080 Sprint or Quantum software.</p>
      <form id="form">
        <input type="file" id="file" accept=".xlsx,.csv" required>
        <button type="submit">Upload and Import</button>
      </form>
      <div id="result"></div>
      <script>
        document.getElementById('form').onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData();
          fd.append('file', document.getElementById('file').files[0]);
          const btn = e.target.querySelector('button');
          btn.textContent = 'Importing...';
          btn.disabled = true;
          try {
            const res = await fetch('/import/1080', { method: 'POST', body: fd });
            const data = await res.json();
            const el = document.getElementById('result');
            el.style.display = 'block';
            if (data.error) {
              el.className = 'error';
              el.textContent = 'Error: ' + data.error;
            } else {
              el.className = 'success';
              el.textContent = data.saved + ' records imported. ' + data.skipped + ' skipped.';
            }
          } catch(err) {
            const el = document.getElementById('result');
            el.style.display = 'block';
            el.className = 'error';
            el.textContent = 'Upload failed: ' + err.message;
          }
          btn.textContent = 'Upload and Import';
          btn.disabled = false;
        };
      </script>
    </body>
    </html>
  `);
});

app.post('/import/1080', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    let saved = 0;
    let skipped = 0;
    const cache = {};

    function excelDateToISO(serial) {
      const date = new Date((serial - 25569) * 86400 * 1000);
      return date.toISOString().split('T')[0];
    }

    for (const row of rows) {
      const clientName = row['Client'];
      if (!clientName) continue;
      if (!cache[clientName]) {
        const parts = clientName.trim().split(/\s+/);
        const { data } = await supabase
          .from('athletes')
          .select('id')
          .ilike('first_name', `${parts[0]}%`)
          .ilike('last_name', `${parts.slice(1).join(' ')}%`)
          .limit(1);
        cache[clientName] = data?.[0] ?? null;
      }
      const athlete = cache[clientName];
      if (!athlete) { skipped++; continue; }

      const sessionDate = row['SessionTime']
        ? excelDateToISO(row['SessionTime'])
        : new Date().toISOString().split('T')[0];

      const { error } = await supabase.from('sprint_records').insert({
        athlete_id:            athlete.id,
        source:                '1080motion',
        session_date:          sessionDate,
        source_file:           req.file.originalname,
        exercise:              row['Exercise'] ?? null,
        exercise_type:         row['ExerciseType'] ?? null,
        set_number:            row['SetNumber'] ?? null,
        rep_number:            row['RepNumber'] ?? null,
        direction:             row['Direction'] ?? null,
        side:                  row['Side'] ?? null,
        concentric_load_kg:    row['Concentric Load [kg]'] ?? null,
        eccentric_load_kg:     row['Eccentric Load [kg]'] ?? null,
        distance_m:            row['Distance [m]'] ?? null,
        time_s:                row['Time [s]'] ?? null,
        avg_speed_ms:          row['AvgSpeed [m/s]'] ?? null,
        peak_velocity_ms:      row['PeakSpeed [m/s]'] ?? null,
        avg_acceleration_ms2:  row['AvgAcceleration [m/s2]'] ?? null,
        peak_acceleration_ms2: row['PeakAcceleration [m/s2]'] ?? null,
        avg_force_n:           row['AvgForce [N]'] ?? null,
        peak_force_n:          row['PeakForce [N]'] ?? null,
        avg_power_w:           row['AvgPower [W]'] ?? null,
        peak_power_w:          row['PeakPower [W]'] ?? null,
        bodyweight_kg:         row['Client Weight [kg]'] ?? null,
        raw_payload:           row,
      });

      if (error) console.error('Row error:', error.message);
      else saved++;
    }

    fs.unlinkSync(req.file.path);
    res.json({ saved, skipped, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AMS backend running on port ${PORT}`);
  console.log(`Supabase URL: ${process.env.SUPABASE_URL ? 'connected' : 'NOT SET'}`);
});
