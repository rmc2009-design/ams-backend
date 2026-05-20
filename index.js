require('dotenv').config();
const express = require('express');
const multer = require('multer');
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

// ── Athletes ──────────────────────────────────────────────────────────────────
app.get('/api/athletes', async function(req, res) {
  try {
    var r = await supabase.from('athletes').select('*').eq('active', true).order('last_name');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/athletes/:id', async function(req, res) {
  try {
    var r = await supabase.from('athletes').update(req.body).eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Flags ─────────────────────────────────────────────────────────────────────
app.get('/api/flags', async function(req, res) {
  try {
    var r = await supabase.from('athlete_flags')
      .select('*, athletes(first_name, last_name)')
      .eq('resolved', false)
      .order('created_at', { ascending: false });
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/flags/:id/resolve', async function(req, res) {
  try {
    var r = await supabase.from('athlete_flags')
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: 'coach' })
      .eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Load records ──────────────────────────────────────────────────────────────
app.get('/api/loads/recent', async function(req, res) {
  try {
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    var r = await supabase.from('load_records')
      .select('*, athletes(first_name, last_name)')
      .gte('session_date', weekAgo)
      .order('session_date', { ascending: false })
      .limit(20);
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sprints ───────────────────────────────────────────────────────────────────
app.get('/api/sprints/recent', async function(req, res) {
  try {
    var yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    var r = await supabase.from('sprint_records')
      .select('*, athletes(first_name, last_name)')
      .gte('session_date', yearAgo)
      .order('session_date', { ascending: false })
      .limit(50);
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Analysis ──────────────────────────────────────────────────────────────────
app.get('/api/analysis', async function(req, res) {
  try {
    var aid = req.query.athlete_id || null;
    var q = supabase.from('session_asymmetry')
      .select('*, athletes(first_name, last_name)')
      .order('session_date', { ascending: false })
      .limit(200);
    if (aid) q = q.eq('athlete_id', aid);
    var r = await q;
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/norms', async function(req, res) {
  try {
    var aid = req.query.athlete_id || null;
    var q = supabase.from('athlete_norms').select('*, athletes(first_name, last_name)');
    if (aid) q = q.eq('athlete_id', aid);
    var r = await q;
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Assessments ───────────────────────────────────────────────────────────────
app.get('/api/assessments/:athleteId', async function(req, res) {
  try {
    var r = await supabase.from('athlete_assessments')
      .select('*')
      .eq('athlete_id', req.params.athleteId)
      .order('assessment_date', { ascending: false })
      .limit(10);
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/assessments', async function(req, res) {
  try {
    var r = await supabase.from('athlete_assessments').insert(req.body).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/assessments/:athleteId/current', async function(req, res) {
  try {
    var r = await supabase.from('athlete_current_assessment')
      .select('*')
      .eq('athlete_id', req.params.athleteId)
      .maybeSingle();
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Athlete Needs ─────────────────────────────────────────────────────────────
app.get('/api/needs/:athleteId', async function(req, res) {
  try {
    var r = await supabase.from('athlete_needs')
      .select('*')
      .eq('athlete_id', req.params.athleteId)
      .order('assessment_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/needs', async function(req, res) {
  try {
    var r = await supabase.from('athlete_needs')
      .upsert(req.body, { onConflict: 'athlete_id,assessment_date' })
      .select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Phase Assignments ─────────────────────────────────────────────────────────
app.get('/api/phases/:athleteId', async function(req, res) {
  try {
    var r = await supabase.from('athlete_phase_assignments')
      .select('*, periodization_phases(*)')
      .eq('athlete_id', req.params.athleteId)
      .order('created_at', { ascending: false });
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/phases', async function(req, res) {
  try {
    var r = await supabase.from('athlete_phase_assignments').insert(req.body).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/phases/:id/gate', async function(req, res) {
  try {
    var r = await supabase.from('athlete_phase_assignments')
      .update({ gate_achieved: true, gate_achieved_date: new Date().toISOString().split('T')[0] })
      .eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Programs ──────────────────────────────────────────────────────────────────
app.get('/api/programs', async function(req, res) {
  try {
    var aid = req.query.athlete_id || null;
    if (aid) {
      var r = await supabase.from('athlete_programs')
        .select('*, programs(*)')
        .eq('athlete_id', aid)
        .eq('active', true);
      if (r.error) throw r.error;
      res.json(r.data);
    } else {
      var r = await supabase.from('programs').select('*').order('created_at', { ascending: false });
      if (r.error) throw r.error;
      res.json(r.data);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/programs/:id/days', async function(req, res) {
  try {
    var r = await supabase.from('program_days')
      .select('*, workout_blocks(*, workout_exercises(*, workout_progressions(*)))')
      .eq('program_id', req.params.id)
      .order('day_order');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Block Templates ───────────────────────────────────────────────────────────
app.get('/api/templates', async function(req, res) {
  try {
    var r = await supabase.from('block_templates')
      .select('*, block_template_exercises(*)')
      .order('template_type')
      .order('name');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Exercise Library ──────────────────────────────────────────────────────────
app.get('/api/exercises', async function(req, res) {
  try {
    var cat = req.query.category || null;
    var q = supabase.from('exercises').select('*').order('category').order('name');
    if (cat) q = q.eq('category', cat);
    var r = await q;
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Reanalyze ─────────────────────────────────────────────────────────────────
app.get('/api/reanalyze', async function(req, res) {
  try {
    var analysis = require('./src/services/analysis');
    var athleteId = req.query.athlete_id || null;
    if (athleteId) {
      await analysis.updateAsymmetryForAthlete(athleteId);
      res.json({ done: true, athlete_id: athleteId });
    } else {
      var result = await supabase.from('athletes').select('id').eq('active', true);
      if (result.error) throw result.error;
      res.json({ started: true, athletes: result.data.length });
      for (var i = 0; i < result.data.length; i++) {
        try { await analysis.updateAsymmetryForAthlete(result.data[i].id); }
        catch (e) { console.error('Reanalyze error:', e.message); }
      }
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Import 1080 ───────────────────────────────────────────────────────────────
app.post('/import/1080', upload.single('file'), async function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    var wb = XLSX.readFile(req.file.path);
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws);
    var saved = 0, skipped = 0;
    var cache = {};
    var affected = {};

    function excelDateToISO(serial) {
      return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var clientName = row['Client'];
      if (!clientName) continue;
      if (!cache[clientName]) {
        var parts = clientName.trim().split(/\s+/);
        var lk = await supabase.from('athletes').select('id')
          .ilike('first_name', parts[0] + '%')
          .ilike('last_name', parts.slice(1).join(' ') + '%')
          .limit(1);
        cache[clientName] = (lk.data && lk.data[0]) ? lk.data[0] : null;
      }
      var athlete = cache[clientName];
      if (!athlete) { skipped++; continue; }
      var sessionDate = row['SessionTime'] ? excelDateToISO(row['SessionTime']) : new Date().toISOString().split('T')[0];
      var ins = await supabase.from('sprint_records').insert({
        athlete_id: athlete.id, source: '1080motion', session_date: sessionDate,
        source_file: req.file.originalname,
        exercise: row['Exercise'] || null, exercise_type: row['ExerciseType'] || null,
        set_number: row['SetNumber'] || null, rep_number: row['RepNumber'] || null,
        direction: row['Direction'] || null, side: row['Side'] || null,
        concentric_load_kg: row['Concentric Load [kg]'] || null,
        eccentric_load_kg: row['Eccentric Load [kg]'] || null,
        distance_m: row['Distance [m]'] || null, time_s: row['Time [s]'] || null,
        avg_speed_ms: row['AvgSpeed [m/s]'] || null, peak_velocity_ms: row['PeakSpeed [m/s]'] || null,
        avg_force_n: row['AvgForce [N]'] || null, peak_force_n: row['PeakForce [N]'] || null,
        avg_power_w: row['AvgPower [W]'] || null, peak_power_w: row['PeakPower [W]'] || null,
        bodyweight_kg: row['Client Weight [kg]'] || null, raw_payload: row,
      });
      if (ins.error) console.error('Row error:', ins.error.message);
      else { saved++; affected[athlete.id] = true; }
    }

    fs.unlinkSync(req.file.path);
    var ids = Object.keys(affected);
    for (var k = 0; k < ids.length; k++) {
      try {
        var analysis = require('./src/services/analysis');
        await analysis.updateAsymmetryForAthlete(ids[k]);
      } catch (e) { console.error('Analysis error:', e.message); }
    }
    res.json({ saved: saved, skipped: skipped, total: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Dashboard HTML ────────────────────────────────────────────────────────────
app.get('/', function(req, res) {
  res.send('<html><head><meta charset="UTF-8"><title>AMS</title>'
  + '<style>'
  + '* { box-sizing:border-box; margin:0; padding:0; }'
  + 'body { font-family:Arial,sans-serif; background:#f8fafc; }'
  + '.top { background:#0f172a; color:white; padding:14px 24px; display:flex; justify-content:space-between; align-items:center; }'
  + '.top h1 { font-size:15px; }'
  + '.nav { background:white; border-bottom:1px solid #e2e8f0; padding:0 16px; display:flex; flex-wrap:wrap; }'
  + '.nav button { padding:10px 12px; font-size:12px; border:none; background:none; cursor:pointer; color:#64748b; border-bottom:2px solid transparent; margin-bottom:-1px; }'
  + '.nav button.on { color:#0f172a; border-bottom-color:#2563eb; font-weight:700; }'
  + '.wrap { padding:24px; max-width:1300px; margin:0 auto; }'
  + '.metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:24px; }'
  + '.metric { background:white; border:1px solid #e2e8f0; border-radius:8px; padding:16px; }'
  + '.metric-label { font-size:12px; color:#64748b; margin-bottom:4px; }'
  + '.metric-val { font-size:26px; font-weight:700; }'
  + '.card { background:white; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:16px; }'
  + '.card h3 { font-size:14px; margin-bottom:16px; }'
  + 'table { width:100%; border-collapse:collapse; font-size:12px; }'
  + 'th { text-align:left; font-size:11px; color:#64748b; padding:6px 8px; border-bottom:1px solid #e2e8f0; text-transform:uppercase; }'
  + 'td { padding:8px 8px; border-bottom:1px solid #f1f5f9; }'
  + 'tr:last-child td { border-bottom:none; }'
  + '.b { display:inline-block; font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; }'
  + '.r { background:#fee2e2; color:#991b1b; } .a { background:#fef3c7; color:#92400e; }'
  + '.g { background:#dcfce7; color:#166534; } .bl { background:#dbeafe; color:#1e40af; } .gr { background:#f1f5f9; color:#475569; }'
  + '.teal { background:#ccfbf1; color:#0f766e; } .purple { background:#ede9fe; color:#6d28d9; }'
  + '.tl { display:inline-block; width:12px; height:12px; border-radius:50%; vertical-align:middle; margin-right:4px; }'
  + '.tl-red { background:#ef4444; } .tl-yellow { background:#f59e0b; } .tl-green { background:#22c55e; } .tl-gray { background:#cbd5e1; }'
  + '.fi { padding:10px 0; border-bottom:1px solid #f1f5f9; }'
  + '.fn { font-size:13px; font-weight:600; } .fm { font-size:12px; color:#64748b; } .ft { font-size:11px; color:#94a3b8; }'
  + '.ag { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }'
  + '.ac { background:white; border:1px solid #e2e8f0; border-radius:8px; padding:14px; cursor:pointer; }'
  + '.ac:hover { border-color:#2563eb; }'
  + '.av { width:38px; height:38px; border-radius:50%; background:#dbeafe; color:#1e40af; display:flex; align-items:center; justify-content:center; font-weight:700; margin-bottom:8px; }'
  + '.pg { display:none; } .pg.on { display:block; }'
  + '.two { display:grid; grid-template-columns:1fr 1fr; gap:16px; }'
  + '.three { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; }'
  + '.ub { border:2px dashed #e2e8f0; border-radius:8px; padding:28px; text-align:center; margin-bottom:16px; }'
  + '.ub p { color:#64748b; font-size:13px; margin-bottom:14px; }'
  + '.btn { background:#2563eb; color:white; border:none; padding:9px 18px; border-radius:6px; cursor:pointer; font-size:13px; }'
  + '.btn-sm { background:#2563eb; color:white; border:none; padding:5px 12px; border-radius:5px; cursor:pointer; font-size:12px; }'
  + '.btn-outline { background:white; color:#374151; border:1px solid #e2e8f0; padding:9px 18px; border-radius:6px; cursor:pointer; font-size:13px; }'
  + '.mt { margin-top:12px; padding:12px; border-radius:6px; display:none; font-size:13px; }'
  + '.ok { background:#f0fdf4; border:1px solid #86efac; color:#166534; }'
  + '.er { background:#fef2f2; border:1px solid #fca5a5; color:#991b1b; }'
  + '.em { text-align:center; padding:28px; color:#94a3b8; font-size:13px; }'
  + '.rb { font-size:11px; padding:3px 10px; border:1px solid #e2e8f0; border-radius:5px; cursor:pointer; background:white; float:right; }'
  + '.sel { padding:7px 12px; font-size:13px; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:16px; background:white; }'
  + '.inp { padding:7px 12px; font-size:13px; border:1px solid #e2e8f0; border-radius:6px; width:100%; background:white; }'
  + '.form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }'
  + '.form-group { display:flex; flex-direction:column; gap:4px; }'
  + '.form-group label { font-size:12px; color:#64748b; font-weight:500; }'
  + '.pathway-box { padding:16px; border-radius:8px; margin-top:16px; border:2px solid; }'
  + '.pathway-eccentric { background:#fef3c7; border-color:#f59e0b; }'
  + '.pathway-flywheel { background:#ede9fe; border-color:#8b5cf6; }'
  + '.pathway-force { background:#dbeafe; border-color:#3b82f6; }'
  + '.pathway-speed { background:#dcfce7; border-color:#22c55e; }'
  + '.pathway-timing { background:#ccfbf1; border-color:#14b8a6; }'
  + '.pathway-dual { background:#fee2e2; border-color:#ef4444; }'
  + '.pathway-peak { background:#f0fdf4; border-color:#16a34a; }'
  + '.pathway-title { font-size:14px; font-weight:700; margin-bottom:4px; }'
  + '.pathway-desc { font-size:12px; color:#374151; }'
  + '.gate-item { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:13px; }'
  + '.gate-pass { color:#166534; } .gate-fail { color:#991b1b; } .gate-pending { color:#92400e; }'
  + '.day-header { font-weight:700; font-size:14px; padding:8px 0 6px; border-bottom:2px solid #2563eb; margin-bottom:12px; }'
  + '.block-label { font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.06em; margin:12px 0 4px; }'
  + '.prog-item { padding:10px 12px; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:8px; cursor:pointer; }'
  + '.prog-item:hover { background:#f8fafc; border-color:#2563eb; }'
  + '.cb-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px; margin-bottom:16px; }'
  + '.cb-item { display:flex; align-items:center; gap:8px; padding:8px 12px; border:1px solid #e2e8f0; border-radius:6px; cursor:pointer; font-size:13px; }'
  + '.cb-item:hover { background:#f8fafc; }'
  + '.cb-item input { cursor:pointer; }'
  + '</style></head><body>'

  + '<div class="top"><h1>Athlete Management System</h1><span id="upd" style="font-size:12px;color:#94a3b8">Loading...</span></div>'
  + '<div class="nav">'
  + '<button class="on" onclick="sp(\'d\',this)">Dashboard</button>'
  + '<button onclick="sp(\'r\',this)">Roster</button>'
  + '<button onclick="sp(\'f\',this)">Flags</button>'
  + '<button onclick="sp(\'l\',this)">Load Records</button>'
  + '<button onclick="sp(\'s\',this)">1080 Motion</button>'
  + '<button onclick="sp(\'an\',this)">Analysis</button>'
  + '<button onclick="sp(\'as\',this)">Assessments</button>'
  + '<button onclick="sp(\'w\',this)">Workouts</button>'
  + '<button onclick="sp(\'i\',this)">Import</button>'
  + '</div>'
  + '<div class="wrap">'

  // Dashboard
  + '<div class="pg on" id="pd">'
  + '<div class="metrics" id="mg"><div class="em">Loading...</div></div>'
  + '<div class="two">'
  + '<div class="card"><h3>Active Flags</h3><div id="df"><div class="em">Loading...</div></div></div>'
  + '<div class="card"><h3>Recent Sessions</h3><div id="dl"><div class="em">Loading...</div></div></div>'
  + '</div></div>'

  // Roster
  + '<div class="pg" id="pr">'
  + '<div class="ag" id="rg"><div class="em">Loading...</div></div>'
  + '</div>'

  // Flags
  + '<div class="pg" id="pf"><div class="card"><h3>Unresolved Flags</h3><div id="fl"><div class="em">Loading...</div></div></div></div>'

  // Load Records
  + '<div class="pg" id="pl"><div class="card"><h3>Load Records - Last 7 Days</h3><div id="lc"><div class="em">Loading...</div></div></div></div>'

  // 1080 Motion
  + '<div class="pg" id="ps"><div class="card"><h3>1080 Motion - Last 12 Months</h3><div id="sc"><div class="em">Loading...</div></div></div></div>'

  // Analysis
  + '<div class="pg" id="pan">'
  + '<div class="card"><h3>Split Squat L/R Asymmetry</h3>'
  + '<select id="an-athlete" class="sel" onchange="la()"><option value="">All athletes</option></select>'
  + '<div id="an-content"><div class="em">Loading...</div></div>'
  + '</div>'
  + '<div class="card" id="norm-card" style="display:none"><h3>Athlete Norms</h3><div id="norm-content"></div></div>'
  + '</div>'

  // Assessments
  + '<div class="pg" id="pas">'
  + '<div class="two">'
  + '<div class="card"><h3>Athlete Assessment</h3>'
  + '<select id="as-athlete" class="sel" onchange="loadAssessment()"><option value="">Select athlete...</option></select>'
  + '<div id="as-current"><div class="em">Select an athlete to view their assessment.</div></div>'
  + '</div>'
  + '<div class="card"><h3>Enter New Assessment</h3>'
  + '<div id="as-form">'
  + '<div class="form-row">'
  + '<div class="form-group"><label>Assessment Date</label><input type="date" id="as-date" class="inp"></div>'
  + '<div class="form-group"><label>Bodyweight (kg)</label><input type="number" id="as-bw" class="inp" placeholder="e.g. 95"></div>'
  + '</div>'
  + '<div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;margin:12px 0 8px">Force Plate (Hawkin)</div>'
  + '<div class="form-row">'
  + '<div class="form-group"><label>Braking Net Impulse</label><input type="number" id="as-bni" class="inp" placeholder="threshold: 1.5" step="0.01"></div>'
  + '<div class="form-group"><label>Propulsive Net Impulse</label><input type="number" id="as-pni" class="inp" placeholder="threshold: 2.8" step="0.01"></div>'
  + '</div>'
  + '<div class="form-row">'
  + '<div class="form-group"><label>Peak Eccentric Speed (m/s)</label><input type="number" id="as-pes" class="inp" placeholder="threshold: 1.5" step="0.01"></div>'
  + '<div class="form-group"><label>Takeoff Velocity (m/s)</label><input type="number" id="as-tv" class="inp" placeholder="threshold: 2.75" step="0.01"></div>'
  + '</div>'
  + '<div class="form-row">'
  + '<div class="form-group"><label>P1 Impulse</label><input type="number" id="as-p1" class="inp" placeholder="phase 1 impulse" step="0.001"></div>'
  + '<div class="form-group"><label>P2 Impulse</label><input type="number" id="as-p2" class="inp" placeholder="phase 2 impulse" step="0.001"></div>'
  + '</div>'
  + '<div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;margin:12px 0 8px">Force Frame</div>'
  + '<div class="form-row">'
  + '<div class="form-group"><label>IR Force (N)</label><input type="number" id="as-ir-ff" class="inp" placeholder="threshold: 200N"></div>'
  + '<div class="form-group"><label>IR Asymmetry (%)</label><input type="number" id="as-ir-asym" class="inp" placeholder="threshold: 10%"></div>'
  + '</div>'
  + '<div class="form-row">'
  + '<div class="form-group"><label>ADD Straight Left (N)</label><input type="number" id="as-add-sl" class="inp" placeholder="threshold: 200N"></div>'
  + '<div class="form-group"><label>ADD Straight Right (N)</label><input type="number" id="as-add-sr" class="inp" placeholder="threshold: 200N"></div>'
  + '</div>'
  + '<div class="form-row">'
  + '<div class="form-group"><label>ADD Bent Total (N)</label><input type="number" id="as-add-bt" class="inp" placeholder="threshold: 400N"></div>'
  + '<div class="form-group"><label>ADD ROM Pass</label>'
  + '<select id="as-add-rom" class="sel" style="margin-bottom:0">'
  + '<option value="">Select...</option><option value="true">Pass</option><option value="false">Fail</option>'
  + '</select></div>'
  + '</div>'
  + '<div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;margin:12px 0 8px">ROM</div>'
  + '<div class="form-row">'
  + '<div class="form-group"><label>IR ROM Left (degrees)</label><input type="number" id="as-ir-rom-l" class="inp" placeholder="threshold: 35"></div>'
  + '<div class="form-group"><label>IR ROM Right (degrees)</label><input type="number" id="as-ir-rom-r" class="inp" placeholder="threshold: 35"></div>'
  + '</div>'
  + '<div class="form-group" style="margin-bottom:12px"><label>Notes</label><input type="text" id="as-notes" class="inp" placeholder="Additional findings..."></div>'
  + '<button class="btn" onclick="saveAssessment()">Save Assessment</button>'
  + '<div id="as-result" class="mt"></div>'
  + '</div></div>'
  + '</div>'
  + '</div>'

  // Workouts
  + '<div class="pg" id="pw">'
  + '<div class="two">'
  + '<div class="card"><h3>Programs</h3>'
  + '<select id="w-athlete" class="sel" onchange="loadPrograms()"><option value="">Select athlete...</option></select>'
  + '<div id="programs-list"><div class="em">Select an athlete to see their programs.</div></div>'
  + '</div>'
  + '<div class="card" id="program-detail" style="display:none">'
  + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
  + '<h3 id="program-title" style="margin-bottom:0">Program</h3>'
  + '<select id="week-select" class="sel" style="margin-bottom:0" onchange="reloadWeek()">'
  + '<option value="1">Week 1</option><option value="2">Week 2</option>'
  + '<option value="3">Week 3</option><option value="4">Week 4</option>'
  + '</select>'
  + '</div>'
  + '<div id="program-days"></div>'
  + '</div>'
  + '</div>'
  + '</div>'

  // Import
  + '<div class="pg" id="pi">'
  + '<div class="card"><h3>Import 1080 Motion Data</h3>'
  + '<div class="ub"><p>Upload an Excel export from your 1080 Sprint or Quantum. Athletes must already be in the database.</p>'
  + '<input type="file" id="if2" accept=".xlsx,.csv" style="margin-bottom:14px"><br>'
  + '<button class="btn" onclick="di()">Upload and Import</button></div>'
  + '<div id="im" class="mt"></div>'
  + '</div>'
  + '</div>'

  + '</div>'
  + '<script>'
  + 'var allAthletes=[];var currentProgramId=null;'

  + 'function sp(n,b){'
  + '  var ps=document.querySelectorAll(".pg");for(var i=0;i<ps.length;i++)ps[i].classList.remove("on");'
  + '  var bs=document.querySelectorAll(".nav button");for(var i=0;i<bs.length;i++)bs[i].classList.remove("on");'
  + '  document.getElementById("p"+n).classList.add("on");b.classList.add("on");'
  + '  if(n=="r")lr();if(n=="f")lf();if(n=="l")ll();if(n=="s")ls();'
  + '  if(n=="an")initAnalysis();if(n=="w")initWorkouts();if(n=="as")initAssessments();'
  + '}'

  + 'function bx(t,c){return\'<span class="b \'+c+\'">\'+t+"</span>";}'
  + 'function lb(s){if(s=="High")return bx(s,"r");if(s=="Low")return bx(s,"g");if(s=="Injured")return bx(s,"a");return bx(s,"bl");}'
  + 'function ta(iso){var h=Math.floor((Date.now()-new Date(iso))/3600000);if(h<1)return"just now";if(h<24)return h+"h ago";return Math.floor(h/24)+"d ago";}'
  + 'function tlDot(c){var cl=c=="red"?"tl-red":c=="yellow"?"tl-yellow":c=="green"?"tl-green":"tl-gray";return\'<span class="tl \'+cl+\'"></span>\';}'

  + 'function pathwayBox(pathway){'
  + '  var map={'
  + '    eccentric_progression:{cls:"pathway-eccentric",label:"Eccentric Progression",desc:"RBNI < 1.5, low eccentric speed. Eccentric motor learning → strength → power."},'
  + '    flywheel:{cls:"pathway-flywheel",label:"Flywheel",desc:"RBNI < 1.5, adequate eccentric speed >= 1.5 m/s. Flywheel for eccentric speed development."},'
  + '    dual_deficit:{cls:"pathway-dual",label:"Dual Deficit",desc:"Both RBNI < 1.5 and RPNI < 2.8. Overloaded eccentric + isokinetic concentric on 1080."},'
  + '    force_isometrics:{cls:"pathway-force",label:"Force Development",desc:"RPNI < 2.8, takeoff velocity < 2.75 m/s. Overcoming isometrics + isokinetics 0.25-0.5 m/s."},'
  + '    speed_power:{cls:"pathway-speed",label:"Speed Power",desc:"RPNI < 2.8, takeoff velocity >= 2.75 m/s. Overcoming iso potentiator + power 0.75-1.1 m/s + plyo."},'
  + '    timing:{cls:"pathway-timing",label:"Timing",desc:"P1/P2 ratio >= 1.3. Flywheel + low position isometrics + triple extension sequencing."},'
  + '    peak_power:{cls:"pathway-peak",label:"Peak Power",desc:"Both impulses adequate. Eccentric speed overload + contrast methods + concentric power conversion."}'
  + '  };'
  + '  var p=map[pathway]||{cls:"pathway-force",label:pathway,desc:""};'
  + '  return\'<div class="pathway-box \'+p.cls+\'"><div class="pathway-title">\'+p.label+\'</div><div class="pathway-desc">\'+p.desc+"</div></div>";'
  + '}'

  // Dashboard
  + 'function ld(){'
  + '  fetch("/api/athletes").then(function(r){return r.json();}).then(function(at){'
  + '    allAthletes=at;'
  + '    fetch("/api/flags").then(function(r){return r.json();}).then(function(fl){'
  + '      fetch("/api/loads/recent").then(function(r){return r.json();}).then(function(lo){'
  + '        var hi=0,inj=0,cr=0;'
  + '        for(var i=0;i<at.length;i++){if(at[i].load_status=="High")hi++;if(at[i].load_status=="Injured")inj++;}'
  + '        for(var i=0;i<fl.length;i++){if(fl[i].severity=="critical")cr++;}'
  + '        var mg=document.getElementById("mg");mg.innerHTML="";'
  + '        var data=[["Total Athletes",at.length,null],["High Load",hi,hi>0?"#991b1b":null],["Injured",inj,inj>0?"#92400e":null],["Active Flags",fl.length,fl.length>0?"#991b1b":null],["Critical",cr,cr>0?"#991b1b":null],["Sessions (7d)",lo.length,null]];'
  + '        for(var i=0;i<data.length;i++){var d=document.createElement("div");d.className="metric";d.innerHTML=\'<div class="metric-label">\'+data[i][0]+\'</div><div class="metric-val"\'+(data[i][2]?\' style="color:\'+data[i][2]+\'"\':"")+">"+data[i][1]+"</div>";mg.appendChild(d);}'
  + '        var df=document.getElementById("df");'
  + '        if(!fl.length){df.innerHTML=\'<div class="em">No active flags</div>\';}else{'
  + '          var h="";for(var i=0;i<Math.min(fl.length,5);i++){var f=fl[i];var nm=f.athletes?f.athletes.first_name+" "+f.athletes.last_name:"Unknown";var sc=f.severity=="critical"?"r":f.severity=="warning"?"a":"bl";h+=\'<div class="fi"><div class="fn">\'+nm+" "+bx(f.severity,sc)+\'</div><div class="fm">\'+f.message+\'</div><div class="ft">\'+ta(f.created_at)+"</div></div>";}'
  + '          df.innerHTML=h;}'
  + '        var dl=document.getElementById("dl");'
  + '        if(!lo.length){dl.innerHTML=\'<div class="em">No sessions this week</div>\';}else{'
  + '          var h=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Type</th><th>RPE</th></tr></thead><tbody>\';'
  + '          for(var i=0;i<Math.min(lo.length,8);i++){var l=lo[i];var nm=l.athletes?l.athletes.first_name+" "+l.athletes.last_name:"Unknown";var rc=l.rpe>=9?"r":l.rpe>=7?"a":"g";h+="<tr><td>"+nm+"</td><td>"+l.session_date+"</td><td>"+(l.session_type||"-")+"</td><td>"+(l.rpe?bx("RPE "+l.rpe,rc):"-")+"</td></tr>";}'
  + '          dl.innerHTML=h+"</tbody></table>";}'
  + '        document.getElementById("upd").textContent="Updated "+new Date().toLocaleTimeString();'
  + '      });});});'
  + '}'

  // Roster
  + 'function lr(){'
  + '  fetch("/api/athletes").then(function(r){return r.json();}).then(function(at){'
  + '    var el=document.getElementById("rg");if(!at.length){el.innerHTML=\'<div class="em">No athletes.</div>\';return;}'
  + '    var h="";for(var i=0;i<at.length;i++){var a=at[i];var ini=a.first_name[0]+a.last_name[0];h+=\'<div class="ac" onclick="viewAthlete(\\"\'+a.id+\'\\")"><div class="av">\'+ini+\'</div><div style="font-weight:600;font-size:14px">\'+a.first_name+" "+a.last_name+\'</div><div style="font-size:12px;color:#64748b;margin-top:2px">\'+( a.sport||"")+(a.position?" - "+a.position:"")+\'</div><div style="margin-top:8px">\'+lb(a.load_status)+"</div></div>";}'
  + '    el.innerHTML=h;});'
  + '}'

  + 'function viewAthlete(id){'
  + '  document.querySelectorAll(".nav button")'  sp("as", document.querySelectorAll(".nav button")[7]);'
  + '  document.getElementById("as-athlete").value=id;'
  + '  loadAssessment();'
  + '}'

  // Flags
  + 'function lf(){'
  + '  fetch("/api/flags").then(function(r){return r.json();}).then(function(fl){'
  + '    var el=document.getElementById("fl");if(!fl.length){el.innerHTML=\'<div class="em">No active flags</div>\';return;}'
  + '    var h="";for(var i=0;i<fl.length;i++){var f=fl[i];var nm=f.athletes?f.athletes.first_name+" "+f.athletes.last_name:"Unknown";var sc=f.severity=="critical"?"r":f.severity=="warning"?"a":"bl";h+=\'<div class="fi" id="fg\'+f.id+\'"><span class="rb" onclick="rf(\\"\'+f.id+\'\\")">Resolve</span><div class="fn">\'+nm+" "+bx(f.severity,sc)+\'</div><div class="fm">\'+f.message+\'</div><div class="ft">\'+ta(f.created_at)+"</div></div>";}'
  + '    el.innerHTML=h;});'
  + '}'
  + 'function rf(id){fetch("/api/flags/"+id+"/resolve",{method:"PATCH"}).then(function(){var e=document.getElementById("fg"+id);if(e)e.style.display="none";});}'

  // Load Records
  + 'function ll(){'
  + '  fetch("/api/loads/recent").then(function(r){return r.json();}).then(function(data){'
  + '    var el=document.getElementById("lc");if(!data.length){el.innerHTML=\'<div class="em">No load records in the last 7 days.</div>\';return;}'
  + '    var h=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Type</th><th>RPE</th><th>Load</th><th>Distance</th><th>Source</th></tr></thead><tbody>\';'
  + '    for(var i=0;i<data.length;i++){var l=data[i];var nm=l.athletes?l.athletes.first_name+" "+l.athletes.last_name:"Unknown";var rc=l.rpe>=9?"r":l.rpe>=7?"a":"g";h+="<tr><td>"+nm+"</td><td>"+l.session_date+"</td><td>"+(l.session_type||"-")+"</td><td>"+(l.rpe?bx("RPE "+parseFloat(l.rpe).toFixed(1),rc):"-")+"</td><td>"+(l.session_load?Math.round(l.session_load)+" AU":"-")+"</td><td>"+(l.total_distance_m?Math.round(l.total_distance_m)+" m":"-")+"</td><td>"+bx(l.source,"gr")+"</td></tr>";}'
  + '    el.innerHTML=h+"</tbody></table>";});'
  + '}'

  // 1080 Motion
  + 'function ls(){'
  + '  fetch("/api/sprints/recent").then(function(r){return r.json();}).then(function(data){'
  + '    var el=document.getElementById("sc");if(!data.length){el.innerHTML=\'<div class="em">No 1080 data in last 12 months.</div>\';return;}'
  + '    var h=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Exercise</th><th>Set</th><th>Rep</th><th>Side</th><th>Direction</th><th>Peak Force</th><th>Peak Power</th></tr></thead><tbody>\';'
  + '    for(var i=0;i<data.length;i++){var s=data[i];var nm=s.athletes?s.athletes.first_name+" "+s.athletes.last_name:"Unknown";h+="<tr><td>"+nm+"</td><td>"+s.session_date+"</td><td>"+(s.exercise||"-")+"</td><td>"+(s.set_number||"-")+"</td><td>"+(s.rep_number||"-")+"</td><td>"+(s.side||"-")+"</td><td>"+(s.direction||"-")+"</td><td>"+(s.peak_force_n?Math.round(s.peak_force_n)+" N":"-")+"</td><td>"+(s.peak_power_w?Math.round(s.peak_power_w)+" W":"-")+"</td></tr>";}'
  + '    el.innerHTML=h+"</tbody></table>";});'
  + '}'

  // Analysis
  + 'function initAnalysis(){'
  + '  var sel=document.getElementById("an-athlete");'
  + '  sel.innerHTML="<option value=\\"\\">All athletes</option>";'
  + '  for(var i=0;i<allAthletes.length;i++){sel.innerHTML+=\'<option value="\'+allAthletes[i].id+\'">\'+allAthletes[i].first_name+" "+allAthletes[i].last_name+"</option>";}'
  + '  la();'
  + '}'
  + 'function la(){'
  + '  var aid=document.getElementById("an-athlete").value;'
  + '  fetch("/api/analysis"+(aid?"?athlete_id="+aid:"")).then(function(r){return r.json();}).then(function(data){'
  + '    var el=document.getElementById("an-content");'
  + '    if(!data.length){el.innerHTML=\'<div class="em">No analysis data yet.</div>\';return;}'
  + '    var h=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Exercise</th><th>Direction</th><th>Left Peak</th><th>Right Peak</th><th>Asymmetry</th><th>Flag</th><th>vs Norm</th></tr></thead><tbody>\';'
  + '    for(var i=0;i<data.length;i++){var d=data[i];var nm=d.athletes?d.athletes.first_name+" "+d.athletes.last_name:"Unknown";var abs=Math.abs(d.asymmetry_pct);var sign=d.asymmetry_pct>=0?"L":"R";var nt=d.sd_from_norm!=null?(Math.abs(d.sd_from_norm).toFixed(1)+" SD"):(d.session_count_at_calc<5?"Building ("+d.session_count_at_calc+"/5)":"Pop. threshold");h+="<tr><td>"+nm+"</td><td>"+d.session_date+"</td><td>"+(d.exercise||"-")+"</td><td>"+(d.direction||"-")+"</td><td>"+(d.left_peak_force_n?Math.round(d.left_peak_force_n)+" N":"-")+"</td><td>"+(d.right_peak_force_n?Math.round(d.right_peak_force_n)+" N":"-")+"</td><td>"+abs.toFixed(1)+"% "+sign+"</td><td>"+tlDot(d.flag_color)+d.flag_color+"</td><td style=\\"font-size:11px;color:#64748b\\">"+nt+"</td></tr>";}'
  + '    el.innerHTML=h+"</tbody></table>";'
  + '  });'
  + '  if(aid){document.getElementById("norm-card").style.display="block";fetch("/api/norms?athlete_id="+aid).then(function(r){return r.json();}).then(function(norms){var nc=document.getElementById("norm-content");if(!norms.length){nc.innerHTML=\'<div class="em">No norms yet. Need 5+ sessions.</div>\';return;}var h="";for(var i=0;i<norms.length;i++){var n=norms[i];h+=\'<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;display:flex;gap:16px;font-size:13px"><strong style="min-width:120px">\'+n.exercise+\'</strong><span style="color:#64748b;min-width:100px">\'+n.direction+\'</span><span>Mean: <strong>\'+parseFloat(n.mean).toFixed(1)+\'%</strong></span><span>SD: <strong>\'+parseFloat(n.std_dev).toFixed(1)+\'%</strong></span><span style="color:#64748b">Based on \'+n.session_count+\' sessions</span></div>\';}nc.innerHTML=h;});}else{document.getElementById("norm-card").style.display="none";}'
  + '}'

  // Assessments
  + 'function initAssessments(){'
  + '  var sel=document.getElementById("as-athlete");'
  + '  sel.innerHTML="<option value=\\"\\">Select athlete...</option>";'
  + '  for(var i=0;i<allAthletes.length;i++){sel.innerHTML+=\'<option value="\'+allAthletes[i].id+\'">\'+allAthletes[i].first_name+" "+allAthletes[i].last_name+"</option>";}'
  + '  document.getElementById("as-date").value=new Date().toISOString().split("T")[0];'
  + '}'

  + 'function loadAssessment(){'
  + '  var aid=document.getElementById("as-athlete").value;'
  + '  var el=document.getElementById("as-current");'
  + '  if(!aid){el.innerHTML=\'<div class="em">Select an athlete to view their assessment.</div>\';return;}'
  + '  fetch("/api/assessments/"+aid+"/current").then(function(r){return r.json();}).then(function(a){'
  + '    if(!a){el.innerHTML=\'<div class="em">No assessment on file. Enter one using the form.</div>\';return;}'
  + '    var h=\'<div style="font-size:12px;color:#64748b;margin-bottom:12px">Last assessed: \'+a.assessment_date+\'</div>\';'
  + '    if(a.prescribed_pathway){h+=pathwayBox(a.prescribed_pathway);}'
  + '    h+=\'<div style="margin-top:16px"><div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">Viability</div>\';'
  + '    h+=\'<div class="gate-item">\'+( a.ir_viable_absolute?"<span class=\'gate-pass\'>Pass</span>":"<span class=\'gate-fail\'>Fail</span>")+\' Hip IR Viable</div>\';'
  + '    h+=\'<div class="gate-item">\'+( a.add_viable_absolute?"<span class=\'gate-pass\'>Pass</span>":"<span class=\'gate-fail\'>Fail</span>")+\' Hip ADD Viable</div>\';'
  + '    h+=\'<div class="gate-item">\'+( a.recommended_track?"<span class=\'gate-pass\'>\'+a.recommended_track.replace(/_/g," ").toUpperCase()+"</span>":" - ")+\' Recommended Track</div>\';'
  + '    h+=\'</div>\';'
  + '    if(a.braking_net_impulse){h+=\'<div style="margin-top:16px"><div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">Force Plate</div>\';'
  + '    h+=\'<div class="gate-item">\'+( a.braking_net_impulse>=1.5?"<span class=\'gate-pass\'>":"<span class=\'gate-fail\'>")+a.braking_net_impulse.toFixed(2)+"</span> Braking Net Impulse (threshold: 1.5)</div>";'
  + '    h+=\'<div class="gate-item">\'+( a.propulsive_net_impulse>=2.8?"<span class=\'gate-pass\'>":"<span class=\'gate-fail\'>")+a.propulsive_net_impulse.toFixed(2)+"</span> Propulsive Net Impulse (threshold: 2.8)</div>";'
  + '    if(a.peak_eccentric_speed){h+=\'<div class="gate-item">\'+( a.peak_eccentric_speed>=1.5?"<span class=\'gate-pass\'>":"<span class=\'gate-fail\'>")+a.peak_eccentric_speed.toFixed(2)+"</span> Peak Eccentric Speed (threshold: 1.5 m/s)</div>";}'
  + '    if(a.takeoff_velocity){h+=\'<div class="gate-item">\'+( a.takeoff_velocity>=2.75?"<span class=\'gate-pass\'>":"<span class=\'gate-fail\'>")+a.takeoff_velocity.toFixed(2)+"</span> Takeoff Velocity (threshold: 2.75 m/s)</div>";}'
  + '    if(a.p1_p2_ratio){h+=\'<div class="gate-item">\'+( a.p1_p2_ratio<1.3?"<span class=\'gate-pass\'>":"<span class=\'gate-fail\'>")+a.p1_p2_ratio.toFixed(3)+"</span> P1/P2 Ratio (timing issue if >= 1.3)</div>";}'
  + '    h+=\'</div>\';}'
  + '    el.innerHTML=h;'
  + '  });'
  + '}'

  + 'function saveAssessment(){'
  + '  var aid=document.getElementById("as-athlete").value;'
  + '  if(!aid){alert("Select an athlete first.");return;}'
  + '  var payload={'
  + '    athlete_id:aid,'
  + '    assessment_date:document.getElementById("as-date").value,'
  + '    bodyweight_kg:parseFloat(document.getElementById("as-bw").value)||null,'
  + '    braking_net_impulse:parseFloat(document.getElementById("as-bni").value)||null,'
  + '    propulsive_net_impulse:parseFloat(document.getElementById("as-pni").value)||null,'
  + '    peak_eccentric_speed:parseFloat(document.getElementById("as-pes").value)||null,'
  + '    takeoff_velocity:parseFloat(document.getElementById("as-tv").value)||null,'
  + '    p1_impulse:parseFloat(document.getElementById("as-p1").value)||null,'
  + '    p2_impulse:parseFloat(document.getElementById("as-p2").value)||null,'
  + '    ir_ff_force_n:parseFloat(document.getElementById("as-ir-ff").value)||null,'
  + '    ir_ff_asymmetry_pct:parseFloat(document.getElementById("as-ir-asym").value)||null,'
  + '    add_ff_straight_left:parseFloat(document.getElementById("as-add-sl").value)||null,'
  + '    add_ff_straight_right:parseFloat(document.getElementById("as-add-sr").value)||null,'
  + '    add_ff_bent_total:parseFloat(document.getElementById("as-add-bt").value)||null,'
  + '    add_rom_pass:document.getElementById("as-add-rom").value==="true"?true:document.getElementById("as-add-rom").value==="false"?false:null,'
  + '    ir_rom_degrees_left:parseFloat(document.getElementById("as-ir-rom-l").value)||null,'
  + '    ir_rom_degrees_right:parseFloat(document.getElementById("as-ir-rom-r").value)||null,'
  + '    notes:document.getElementById("as-notes").value||null'
  + '  };'
  + '  var m=document.getElementById("as-result");m.style.display="block";m.className="mt";m.textContent="Saving...";'
  + '  fetch("/api/assessments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})'
  + '    .then(function(r){return r.json();})'
  + '    .then(function(d){'
  + '      if(d.error){m.className="mt er";m.textContent="Error: "+d.error;}'
  + '      else{m.className="mt ok";m.textContent="Assessment saved. Pathway: "+(d.prescribed_pathway||"calculating...");loadAssessment();}'
  + '    }).catch(function(e){m.className="mt er";m.textContent="Failed: "+e.message;});'
  + '}'

  // Workouts
  + 'function initWorkouts(){'
  + '  var sel=document.getElementById("w-athlete");'
  + '  sel.innerHTML="<option value=\\"\\">Select athlete...</option>";'
  + '  for(var i=0;i<allAthletes.length;i++){sel.innerHTML+=\'<option value="\'+allAthletes[i].id+\'">\'+allAthletes[i].first_name+" "+allAthletes[i].last_name+"</option>";}'
  + '}'
  + 'function loadPrograms(){'
  + '  var aid=document.getElementById("w-athlete").value;'
  + '  var el=document.getElementById("programs-list");'
  + '  document.getElementById("program-detail").style.display="none";'
  + '  if(!aid){el.innerHTML=\'<div class="em">Select an athlete.</div>\';return;}'
  + '  fetch("/api/programs?athlete_id="+aid).then(function(r){return r.json();}).then(function(data){'
  + '    if(!data.length){el.innerHTML=\'<div class="em">No programs yet.</div>\';return;}'
  + '    var h="";for(var i=0;i<data.length;i++){var p=data[i].programs||data[i];h+=\'<div class="prog-item" onclick="loadProgramDetail(\\"\'+p.id+\'\\",\\"\'+p.name+\'\\")"><div style="font-weight:600;font-size:13px">\'+p.name+\'</div><div style="font-size:12px;color:#64748b">\'+( p.phase||"")+(p.weeks?" · "+p.weeks+" weeks":"")+\'</div></div>\';}'
  + '    el.innerHTML=h;});'
  + '}'
  + 'function loadProgramDetail(id,name){'
  + '  currentProgramId=id;'
  + '  document.getElementById("program-detail").style.display="block";'
  + '  document.getElementById("program-title").textContent=name;'
  + '  renderProgramDays(id);'
  + '}'
  + 'function reloadWeek(){if(currentProgramId)renderProgramDays(currentProgramId);}'
  + 'function renderProgramDays(id){'
  + '  var week=parseInt(document.getElementById("week-select").value)||1;'
  + '  fetch("/api/programs/"+id+"/days").then(function(r){return r.json();}).then(function(days){'
  + '    var h="";'
  + '    for(var d=0;d<days.length;d++){'
  + '      var day=days[d];h+=\'<div style="margin-bottom:24px"><div class="day-header">\'+day.day_name+\'</div>\';'
  + '      var blocks=day.workout_blocks||[];blocks.sort(function(a,b){return a.block_order-b.block_order;});'
  + '      for(var b=0;b<blocks.length;b++){'
  + '        var block=blocks[b];var exs=block.workout_exercises||[];exs.sort(function(a,b){return a.exercise_order-b.exercise_order;});'
  + '        if(!exs.length)continue;'
  + '        h+=\'<div class="block-label">Block \'+block.block_label+\'</div>\'+'
  + '          \'<table><thead><tr><th>Exercise</th><th>Sets</th><th>Tempo</th><th>Rest</th><th>Reps (Wk \'+week+\')</th><th>Weight</th></tr></thead><tbody>\';'
  + '        for(var e=0;e<exs.length;e++){var ex=exs[e];var prog=null;var progs=ex.workout_progressions||[];for(var p=0;p<progs.length;p++){if(progs[p].week_number==week){prog=progs[p];break;}}h+="<tr><td style=\\"font-weight:500\\">"+ex.exercise_name+"</td><td>"+(ex.sets||"-")+"</td><td>"+(ex.tempo||"-")+"</td><td>"+(ex.rest||"-")+"</td><td>"+(prog&&prog.reps?prog.reps:"-")+"</td><td>"+(prog&&prog.weight?prog.weight:"-")+"</td></tr>";}'
  + '        h+="</tbody></table>";'
  + '      }'
  + '      h+="</div>";'
  + '    }'
  + '    document.getElementById("program-days").innerHTML=h||\'<div class="em">No exercises found.</div>\';'
  + '  });'
  + '}'

  // Import
  + 'function di(){'
  + '  var fi=document.getElementById("if2");if(!fi.files.length){alert("Select a file first.");return;}'
  + '  var fd=new FormData();fd.append("file",fi.files[0]);'
  + '  var m=document.getElementById("im");m.style.display="block";m.className="mt";m.textContent="Importing...";'
  + '  fetch("/import/1080",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(d){'
  + '    if(d.error){m.className="mt er";m.textContent="Error: "+d.error;}'
  + '    else{m.className="mt ok";m.textContent=d.saved+" records imported. "+d.skipped+" skipped.";}'
  + '  }).catch(function(e){m.className="mt er";m.textContent="Failed: "+e.message;});'
  + '}'

  + 'ld();'
  + '<\/script></body></html>');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('AMS running on port ' + PORT);
  console.log('Supabase: ' + (process.env.SUPABASE_URL ? 'connected' : 'NOT SET'));
});
