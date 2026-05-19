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

// ── API routes ────────────────────────────────────────────────────────────────

app.get('/api/athletes', async function(req, res) {
  try {
    const { data, error } = await supabase.from('athletes').select('*').eq('active', true).order('last_name');
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/flags', async function(req, res) {
  try {
    const { data, error } = await supabase
      .from('athlete_flags')
      .select('*, athletes(first_name, last_name)')
      .eq('resolved', false)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/loads/recent', async function(req, res) {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('load_records')
      .select('*, athletes(first_name, last_name)')
      .gte('session_date', weekAgo)
      .order('session_date', { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sprints/recent', async function(req, res) {
  try {
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('sprint_records')
      .select('*, athletes(first_name, last_name)')
      .gte('session_date', yearAgo)
      .order('session_date', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/flags/:id/resolve', async function(req, res) {
  try {
    const { error } = await supabase
      .from('athlete_flags')
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: 'coach' })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Analysis API ──────────────────────────────────────────────────────────────

app.get('/api/analysis', async function(req, res) {
  try {
    var athleteId = req.query.athlete_id || null;
    var query = supabase
      .from('session_asymmetry')
      .select('*, athletes(first_name, last_name)')
      .order('session_date', { ascending: false })
      .limit(200);
    if (athleteId) query = query.eq('athlete_id', athleteId);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/norms', async function(req, res) {
  try {
    var athleteId = req.query.athlete_id || null;
    var query = supabase
      .from('athlete_norms')
      .select('*, athletes(first_name, last_name)');
    if (athleteId) query = query.eq('athlete_id', athleteId);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 1080 import ───────────────────────────────────────────────────────────────

app.post('/import/1080', upload.single('file'), async function(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    var saved = 0, skipped = 0;
    var cache = {};
    var affectedAthletes = {};

    function excelDateToISO(serial) {
      return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var clientName = row['Client'];
      if (!clientName) continue;
      if (!cache[clientName]) {
        var parts = clientName.trim().split(/\s+/);
        var lookup = await supabase.from('athletes').select('id')
          .ilike('first_name', parts[0] + '%')
          .ilike('last_name', parts.slice(1).join(' ') + '%')
          .limit(1);
        cache[clientName] = (lookup.data && lookup.data[0]) ? lookup.data[0] : null;
      }
      var athlete = cache[clientName];
      if (!athlete) { skipped++; continue; }

      var sessionDate = row['SessionTime'] ? excelDateToISO(row['SessionTime']) : new Date().toISOString().split('T')[0];
      var result = await supabase.from('sprint_records').insert({
        athlete_id: athlete.id, source: '1080motion', session_date: sessionDate,
        source_file: req.file.originalname,
        exercise: row['Exercise'] || null,
        exercise_type: row['ExerciseType'] || null,
        set_number: row['SetNumber'] || null,
        rep_number: row['RepNumber'] || null,
        direction: row['Direction'] || null,
        side: row['Side'] || null,
        concentric_load_kg: row['Concentric Load [kg]'] || null,
        eccentric_load_kg: row['Eccentric Load [kg]'] || null,
        distance_m: row['Distance [m]'] || null,
        time_s: row['Time [s]'] || null,
        avg_speed_ms: row['AvgSpeed [m/s]'] || null,
        peak_velocity_ms: row['PeakSpeed [m/s]'] || null,
        avg_force_n: row['AvgForce [N]'] || null,
        peak_force_n: row['PeakForce [N]'] || null,
        avg_power_w: row['AvgPower [W]'] || null,
        peak_power_w: row['PeakPower [W]'] || null,
        bodyweight_kg: row['Client Weight [kg]'] || null,
        raw_payload: row,
      });
      if (result.error) console.error('Row error:', result.error.message);
      else { saved++; affectedAthletes[athlete.id] = true; }
    }

    fs.unlinkSync(req.file.path);

    // Run analysis for each affected athlete
    var athleteIds = Object.keys(affectedAthletes);
    for (var k = 0; k < athleteIds.length; k++) {
      try {
        var analysis = require('./src/services/analysis');
        await analysis.updateAsymmetryForAthlete(athleteIds[k]);
      } catch (e) {
        console.error('Analysis error for ' + athleteIds[k] + ':', e.message);
      }
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
  + '.nav { background:white; border-bottom:1px solid #e2e8f0; padding:0 24px; display:flex; }'
  + '.nav button { padding:12px 14px; font-size:13px; border:none; background:none; cursor:pointer; color:#64748b; border-bottom:2px solid transparent; margin-bottom:-1px; }'
  + '.nav button.on { color:#0f172a; border-bottom-color:#2563eb; font-weight:700; }'
  + '.wrap { padding:24px; max-width:1300px; margin:0 auto; }'
  + '.metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:24px; }'
  + '.metric { background:white; border:1px solid #e2e8f0; border-radius:8px; padding:16px; }'
  + '.metric-label { font-size:12px; color:#64748b; margin-bottom:4px; }'
  + '.metric-val { font-size:26px; font-weight:700; }'
  + '.card { background:white; border:1px solid #e2e8f0; border-radius:8px; padding:20px; margin-bottom:16px; }'
  + '.card h3 { font-size:14px; margin-bottom:16px; }'
  + 'table { width:100%; border-collapse:collapse; font-size:13px; }'
  + 'th { text-align:left; font-size:11px; color:#64748b; padding:6px 10px; border-bottom:1px solid #e2e8f0; text-transform:uppercase; }'
  + 'td { padding:9px 10px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }'
  + 'tr:last-child td { border-bottom:none; }'
  + '.b { display:inline-block; font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; }'
  + '.r { background:#fee2e2; color:#991b1b; } .a { background:#fef3c7; color:#92400e; }'
  + '.g { background:#dcfce7; color:#166534; } .bl { background:#dbeafe; color:#1e40af; } .gr { background:#f1f5f9; color:#475569; }'
  + '.tl { display:inline-block; width:14px; height:14px; border-radius:50%; vertical-align:middle; margin-right:5px; }'
  + '.tl-red { background:#ef4444; } .tl-yellow { background:#f59e0b; } .tl-green { background:#22c55e; } .tl-gray { background:#cbd5e1; }'
  + '.fi { padding:10px 0; border-bottom:1px solid #f1f5f9; }'
  + '.fn { font-size:13px; font-weight:600; } .fm { font-size:12px; color:#64748b; } .ft { font-size:11px; color:#94a3b8; }'
  + '.ag { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }'
  + '.ac { background:white; border:1px solid #e2e8f0; border-radius:8px; padding:14px; }'
  + '.av { width:38px; height:38px; border-radius:50%; background:#dbeafe; color:#1e40af; display:flex; align-items:center; justify-content:center; font-weight:700; margin-bottom:8px; }'
  + '.pg { display:none; } .pg.on { display:block; }'
  + '.two { display:grid; grid-template-columns:1fr 1fr; gap:16px; }'
  + '.ub { border:2px dashed #e2e8f0; border-radius:8px; padding:28px; text-align:center; }'
  + '.ub p { color:#64748b; font-size:13px; margin-bottom:14px; }'
  + '.btn { background:#2563eb; color:white; border:none; padding:9px 18px; border-radius:6px; cursor:pointer; font-size:13px; }'
  + '.mt { margin-top:12px; padding:12px; border-radius:6px; display:none; font-size:13px; }'
  + '.ok { background:#f0fdf4; border:1px solid #86efac; color:#166534; }'
  + '.er { background:#fef2f2; border:1px solid #fca5a5; color:#991b1b; }'
  + '.em { text-align:center; padding:28px; color:#94a3b8; font-size:13px; }'
  + '.rb { font-size:11px; padding:3px 10px; border:1px solid #e2e8f0; border-radius:5px; cursor:pointer; background:white; float:right; }'
  + '.sel { padding:7px 12px; font-size:13px; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:16px; }'
  + '.norm-row { display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:13px; }'
  + '.norm-row:last-child { border-bottom:none; }'
  + '.asym-bar { height:8px; border-radius:4px; display:inline-block; }'
  + '</style></head><body>'
  + '<div class="top"><h1>Athlete Management System</h1><span id="upd" style="font-size:12px;color:#94a3b8">Loading...</span></div>'
  + '<div class="nav">'
  + '<button class="on" onclick="sp(\'d\',this)">Dashboard</button>'
  + '<button onclick="sp(\'r\',this)">Roster</button>'
  + '<button onclick="sp(\'f\',this)">Flags</button>'
  + '<button onclick="sp(\'l\',this)">Load Records</button>'
  + '<button onclick="sp(\'s\',this)">1080 Motion</button>'
  + '<button onclick="sp(\'an\',this)">Analysis</button>'
  + '<button onclick="sp(\'i\',this)">Import Data</button>'
  + '</div>'
  + '<div class="wrap">'

  + '<div class="pg on" id="pd">'
  + '<div class="metrics" id="mg"><div class="em">Loading...</div></div>'
  + '<div class="two">'
  + '<div class="card"><h3>Active Flags</h3><div id="df"><div class="em">Loading...</div></div></div>'
  + '<div class="card"><h3>Recent Sessions</h3><div id="dl"><div class="em">Loading...</div></div></div>'
  + '</div></div>'

  + '<div class="pg" id="pr"><div class="ag" id="rg"><div class="em">Loading...</div></div></div>'

  + '<div class="pg" id="pf"><div class="card"><h3>Unresolved Flags</h3><div id="fl"><div class="em">Loading...</div></div></div></div>'

  + '<div class="pg" id="pl"><div class="card"><h3>Load Records - Last 7 Days</h3><div id="lc"><div class="em">Loading...</div></div></div></div>'

  + '<div class="pg" id="ps"><div class="card"><h3>1080 Motion - Last 12 Months</h3><div id="sc"><div class="em">Loading...</div></div></div></div>'

  + '<div class="pg" id="pan">'
  + '<div class="card">'
  + '<h3>Split Squat L/R Asymmetry Analysis</h3>'
  + '<select id="an-athlete" class="sel" onchange="la()"><option value="">All athletes</option></select>'
  + '<div id="an-content"><div class="em">Loading...</div></div>'
  + '</div>'
  + '<div class="card" id="norm-card" style="display:none">'
  + '<h3>Athlete Norms</h3>'
  + '<div id="norm-content"></div>'
  + '</div>'
  + '</div>'

  + '<div class="pg" id="pi"><div class="card"><h3>Import 1080 Motion Data</h3>'
  + '<div class="ub"><p>Upload an Excel export from your 1080 Sprint or Quantum.<br>Athletes must already be in the database.</p>'
  + '<input type="file" id="if2" accept=".xlsx,.csv" style="margin-bottom:14px"><br>'
  + '<button class="btn" onclick="di()">Upload and Import</button></div>'
  + '<div id="im" class="mt"></div></div></div>'

  + '</div>'
  + '<script>'
  + 'var allAthletes=[];'
  + 'function sp(n,b){'
  + '  var ps=document.querySelectorAll(".pg");for(var i=0;i<ps.length;i++)ps[i].classList.remove("on");'
  + '  var bs=document.querySelectorAll(".nav button");for(var i=0;i<bs.length;i++)bs[i].classList.remove("on");'
  + '  document.getElementById("p"+n).classList.add("on");b.classList.add("on");'
  + '  if(n=="r")lr();if(n=="f")lf();if(n=="l")ll();if(n=="s")ls();if(n=="an")initAnalysis();'
  + '}'
  + 'function bx(t,c){return\'<span class="b \'+c+\'">\'+t+"</span>";}'
  + 'function lb(s){if(s=="High")return bx(s,"r");if(s=="Low")return bx(s,"g");if(s=="Injured")return bx(s,"a");return bx(s,"bl");}'
  + 'function ta(iso){var h=Math.floor((Date.now()-new Date(iso))/3600000);if(h<1)return"just now";if(h<24)return h+"h ago";return Math.floor(h/24)+"d ago";}'
  + 'function tlDot(color){'
  + '  var cls=color==="red"?"tl-red":color==="yellow"?"tl-yellow":color==="green"?"tl-green":"tl-gray";'
  + '  return\'<span class="tl \'+cls+\'"></span>\';'
  + '}'
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
  + '          var h2="";for(var i=0;i<Math.min(fl.length,5);i++){var f=fl[i];var nm=f.athletes?f.athletes.first_name+" "+f.athletes.last_name:"Unknown";var sc=f.severity=="critical"?"r":f.severity=="warning"?"a":"bl";h2+=\'<div class="fi"><div class="fn">\'+nm+" "+bx(f.severity,sc)+\'</div><div class="fm">\'+f.message+\'</div><div class="ft">\'+ta(f.created_at)+"</div></div>";}'
  + '          df.innerHTML=h2;}'
  + '        var dl=document.getElementById("dl");'
  + '        if(!lo.length){dl.innerHTML=\'<div class="em">No sessions this week</div>\';}else{'
  + '          var h3=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Type</th><th>RPE</th></tr></thead><tbody>\';'
  + '          for(var i=0;i<Math.min(lo.length,8);i++){var l=lo[i];var nm=l.athletes?l.athletes.first_name+" "+l.athletes.last_name:"Unknown";var rc=l.rpe>=9?"r":l.rpe>=7?"a":"g";h3+="<tr><td>"+nm+"</td><td>"+l.session_date+"</td><td>"+(l.session_type||"-")+"</td><td>"+(l.rpe?bx("RPE "+l.rpe,rc):"-")+"</td></tr>";}'
  + '          dl.innerHTML=h3+"</tbody></table>";}'
  + '        document.getElementById("upd").textContent="Updated "+new Date().toLocaleTimeString();'
  + '      });});});'
  + '}'
  + 'function lr(){'
  + '  fetch("/api/athletes").then(function(r){return r.json();}).then(function(at){'
  + '    var el=document.getElementById("rg");if(!at.length){el.innerHTML=\'<div class="em">No athletes.</div>\';return;}'
  + '    var h="";for(var i=0;i<at.length;i++){var a=at[i];var ini=a.first_name[0]+a.last_name[0];h+=\'<div class="ac"><div class="av">\'+ini+\'</div><div style="font-weight:600;font-size:14px">\'+a.first_name+" "+a.last_name+\'</div><div style="font-size:12px;color:#64748b;margin-top:2px">\'+( a.sport||"")+(a.position?" - "+a.position:"")+\'</div><div style="margin-top:8px">\'+lb(a.load_status)+"</div></div>";}'
  + '    el.innerHTML=h;});'
  + '}'
  + 'function lf(){'
  + '  fetch("/api/flags").then(function(r){return r.json();}).then(function(fl){'
  + '    var el=document.getElementById("fl");if(!fl.length){el.innerHTML=\'<div class="em">No active flags</div>\';return;}'
  + '    var h="";for(var i=0;i<fl.length;i++){var f=fl[i];var nm=f.athletes?f.athletes.first_name+" "+f.athletes.last_name:"Unknown";var sc=f.severity=="critical"?"r":f.severity=="warning"?"a":"bl";h+=\'<div class="fi" id="fg\'+f.id+\'"><span class="rb" onclick="rf(\\"\'+f.id+\'\\")">Resolve</span><div class="fn">\'+nm+" "+bx(f.severity,sc)+\'</div><div class="fm">\'+f.message+\'</div><div class="ft">\'+ta(f.created_at)+"</div></div>";}'
  + '    el.innerHTML=h;});'
  + '}'
  + 'function rf(id){fetch("/api/flags/"+id+"/resolve",{method:"PATCH"}).then(function(){var e=document.getElementById("fg"+id);if(e)e.style.display="none";});}'
  + 'function ll(){'
  + '  fetch("/api/loads/recent").then(function(r){return r.json();}).then(function(data){'
  + '    var el=document.getElementById("lc");if(!data.length){el.innerHTML=\'<div class="em">No load records in the last 7 days.</div>\';return;}'
  + '    var h=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Type</th><th>RPE</th><th>Load</th><th>Distance</th><th>Source</th></tr></thead><tbody>\';'
  + '    for(var i=0;i<data.length;i++){var l=data[i];var nm=l.athletes?l.athletes.first_name+" "+l.athletes.last_name:"Unknown";var rc=l.rpe>=9?"r":l.rpe>=7?"a":"g";h+="<tr><td>"+nm+"</td><td>"+l.session_date+"</td><td>"+(l.session_type||"-")+"</td><td>"+(l.rpe?bx("RPE "+parseFloat(l.rpe).toFixed(1),rc):"-")+"</td><td>"+(l.session_load?Math.round(l.session_load)+" AU":"-")+"</td><td>"+(l.total_distance_m?Math.round(l.total_distance_m)+" m":"-")+"</td><td>"+bx(l.source,"gr")+"</td></tr>";}'
  + '    el.innerHTML=h+"</tbody></table>";});'
  + '}'
  + 'function ls(){'
  + '  fetch("/api/sprints/recent").then(function(r){return r.json();}).then(function(data){'
  + '    var el=document.getElementById("sc");if(!data.length){el.innerHTML=\'<div class="em">No 1080 data in last 12 months.</div>\';return;}'
  + '    var h=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Exercise</th><th>Set</th><th>Rep</th><th>Side</th><th>Direction</th><th>Peak Force</th><th>Peak Power</th></tr></thead><tbody>\';'
  + '    for(var i=0;i<data.length;i++){var s=data[i];var nm=s.athletes?s.athletes.first_name+" "+s.athletes.last_name:"Unknown";h+="<tr><td>"+nm+"</td><td>"+s.session_date+"</td><td>"+(s.exercise||"-")+"</td><td>"+(s.set_number||"-")+"</td><td>"+(s.rep_number||"-")+"</td><td>"+(s.side||"-")+"</td><td>"+(s.direction||"-")+"</td><td>"+(s.peak_force_n?Math.round(s.peak_force_n)+" N":"-")+"</td><td>"+(s.peak_power_w?Math.round(s.peak_power_w)+" W":"-")+"</td></tr>";}'
  + '    el.innerHTML=h+"</tbody></table>";});'
  + '}'

  + 'function initAnalysis(){'
  + '  var sel=document.getElementById("an-athlete");'
  + '  sel.innerHTML="<option value=\\"\\">All athletes</option>";'
  + '  for(var i=0;i<allAthletes.length;i++){sel.innerHTML+=\'<option value="\'+allAthletes[i].id+\'">\'+allAthletes[i].first_name+" "+allAthletes[i].last_name+"</option>";}'
  + '  la();'
  + '}'

  + 'function la(){'
  + '  var aid=document.getElementById("an-athlete").value;'
  + '  var url="/api/analysis"+(aid?"?athlete_id="+aid:"");'
  + '  fetch(url).then(function(r){return r.json();}).then(function(data){'
  + '    var el=document.getElementById("an-content");'
  + '    if(!data.length){el.innerHTML=\'<div class="em">No analysis data yet. Import 1080 session files to generate asymmetry analysis.</div>\';return;}'
  + '    var h=\'<table><thead><tr><th>Athlete</th><th>Date</th><th>Exercise</th><th>Direction</th><th>Left Peak (N)</th><th>Right Peak (N)</th><th>Asymmetry</th><th>Flag</th><th>vs Norm</th></tr></thead><tbody>\';'
  + '    for(var i=0;i<data.length;i++){'
  + '      var d=data[i];'
  + '      var nm=d.athletes?d.athletes.first_name+" "+d.athletes.last_name:"Unknown";'
  + '      var abs=Math.abs(d.asymmetry_pct);'
  + '      var sign=d.asymmetry_pct>=0?"L dominant":"R dominant";'
  + '      var normTxt=d.sd_from_norm!=null?(Math.abs(d.sd_from_norm).toFixed(1)+" SD from norm"):(d.session_count_at_calc<5?"Building norm ("+d.session_count_at_calc+"/5)":"Population threshold");'
  + '      h+="<tr>"'
  + '        +"<td>"+nm+"</td>"'
  + '        +"<td>"+d.session_date+"</td>"'
  + '        +"<td>"+(d.exercise||"-")+"</td>"'
  + '        +"<td>"+(d.direction||"-")+"</td>"'
  + '        +"<td>"+(d.left_peak_force_n?Math.round(d.left_peak_force_n)+" N":"-")+"</td>"'
  + '        +"<td>"+(d.right_peak_force_n?Math.round(d.right_peak_force_n)+" N":"-")+"</td>"'
  + '        +"<td>"+abs.toFixed(1)+"% "+sign+"</td>"'
  + '        +"<td>"+tlDot(d.flag_color)+d.flag_color+"</td>"'
  + '        +"<td style=\\"font-size:11px;color:#64748b\\">"+normTxt+"</td>"'
  + '        +"</tr>";'
  + '    }'
  + '    el.innerHTML=h+"</tbody></table>";'
  + '  });'
  + '  if(aid){'
  + '    document.getElementById("norm-card").style.display="block";'
  + '    fetch("/api/norms?athlete_id="+aid).then(function(r){return r.json();}).then(function(norms){'
  + '      var nc=document.getElementById("norm-content");'
  + '      if(!norms.length){nc.innerHTML=\'<div class="em">No norms established yet. Need 5+ sessions.</div>\';return;}'
  + '      var h="";'
  + '      for(var i=0;i<norms.length;i++){'
  + '        var n=norms[i];'
  + '        h+=\'<div class="norm-row">\'+'
  + '          \'<strong style="min-width:120px">\'+n.exercise+\'</strong>\'+'
  + '          \'<span style="min-width:100px;color:#64748b">\'+n.direction+\'</span>\'+'
  + '          \'<span>Mean: <strong>\'+parseFloat(n.mean).toFixed(1)+\'%</strong></span>\'+'
  + '          \'<span style="margin-left:16px">SD: <strong>\'+parseFloat(n.std_dev).toFixed(1)+\'%</strong></span>\'+'
  + '          \'<span style="margin-left:16px;color:#64748b">Based on \'+n.session_count+\' sessions</span>\'+'
  + '          \'</div>\';'
  + '      }'
  + '      nc.innerHTML=h;'
  + '    });'
  + '  } else { document.getElementById("norm-card").style.display="none"; }'
  + '}'

  + 'function di(){'
  + '  var fi=document.getElementById("if2");if(!fi.files.length){alert("Select a file first.");return;}'
  + '  var fd=new FormData();fd.append("file",fi.files[0]);'
  + '  var m=document.getElementById("im");m.style.display="block";m.className="mt";m.textContent="Importing and running analysis...";'
  + '  fetch("/import/1080",{method:"POST",body:fd}).then(function(r){return r.json();}).then(function(d){'
  + '    if(d.error){m.className="mt er";m.textContent="Error: "+d.error;}'
  + '    else{m.className="mt ok";m.textContent=d.saved+" records imported. "+d.skipped+" skipped. Analysis updated.";}'
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
