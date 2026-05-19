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

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/athletes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('athletes').select('*').eq('active', true).order('last_name');
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/flags', async (req, res) => {
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

app.get('/api/loads/recent', async (req, res) => {
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

app.get('/api/sprints/recent', async (req, res) => {
  try {
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('sprint_records')
      .select('*, athletes(first_name, last_name)')
      .gte('session_date', monthAgo)
      .order('session_date', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/flags/:id/resolve', async (req, res) => {
  try {
    const { error } = await supabase
      .from('athlete_flags')
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: 'coach' })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/import/1080', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);
    let saved = 0, skipped = 0;
    const cache = {};
    function excelDateToISO(serial) {
      return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0];
    }
    for (const row of rows) {
      const clientName = row['Client'];
      if (!clientName) continue;
      if (!cache[clientName]) {
        const parts = clientName.trim().split(/\s+/);
        const { data } = await supabase.from('athletes').select('id')
          .ilike('first_name', `${parts[0]}%`)
          .ilike('last_name', `${parts.slice(1).join(' ')}%`)
          .limit(1);
        cache[clientName] = data?.[0] ?? null;
      }
      const athlete = cache[clientName];
      if (!athlete) { skipped++; continue; }
      const sessionDate = row['SessionTime'] ? excelDateToISO(row['SessionTime']) : new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('sprint_records').insert({
        athlete_id: athlete.id, source: '1080motion', session_date: sessionDate,
        source_file: req.file.originalname,
        exercise: row['Exercise'] ?? null, exercise_type: row['ExerciseType'] ?? null,
        set_number: row['SetNumber'] ?? null, rep_number: row['RepNumber'] ?? null,
        direction: row['Direction'] ?? null, side: row['Side'] ?? null,
        concentric_load_kg: row['Concentric Load [kg]'] ?? null,
        eccentric_load_kg: row['Eccentric Load [kg]'] ?? null,
        distance_m: row['Distance [m]'] ?? null, time_s: row['Time [s]'] ?? null,
        avg_speed_ms: row['AvgSpeed [m/s]'] ?? null, peak_velocity_ms: row['PeakSpeed [m/s]'] ?? null,
        avg_acceleration_ms2: row['AvgAcceleration [m/s2]'] ?? null,
        peak_acceleration_ms2: row['PeakAcceleration [m/s2]'] ?? null,
        avg_force_n: row['AvgForce [N]'] ?? null, peak_force_n: row['PeakForce [N]'] ?? null,
        avg_power_w: row['AvgPower [W]'] ?? null, peak_power_w: row['PeakPower [W]'] ?? null,
        bodyweight_kg: row['Client Weight [kg]'] ?? null, raw_payload: row,
      });
      if (error) console.error('Row error:', error.message); else saved++;
    }
    fs.unlinkSync(req.file.path);
    res.json({ saved, skipped, total: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AMS Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;min-height:100vh}
.topbar{background:#0f172a;color:white;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:16px;font-weight:600;letter-spacing:.02em}
.topbar span{font-size:12px;color:#94a3b8}
.nav{display:flex;gap:4px;padding:16px 24px 0;border-bottom:1px solid #e2e8f0;background:white}
.nav-btn{padding:8px 16px;font-size:13px;cursor:pointer;border:none;background:transparent;color:#64748b;border-bottom:2px solid transparent;margin-bottom:-1px;font-family:inherit}
.nav-btn.active{color:#0f172a;border-bottom-color:#2563eb;font-weight:500}
.nav-btn:hover:not(.active){color:#0f172a}
.content{padding:24px;max-width:1200px;margin:0 auto}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.metric{background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px}
.metric-label{font-size:12px;color:#64748b;margin-bottom:4px}
.metric-val{font-size:26px;font-weight:600;color:#0f172a}
.card{background:white;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:16px}
.card-title{font-size:14px;font-weight:600;margin-bottom:14px;color:#0f172a}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:11px;font-weight:500;color:#64748b;padding:6px 10px;border-bottom:1px solid #e2e8f0;text-transform:uppercase;letter-spacing:.04em}
td{padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#0f172a}
tr:last-child td{border-bottom:none}
tr:hover td{background:#f8fafc}
.badge{display:inline-block;font-size:11px;font-weight:500;padding:2px 8px;border-radius:20px}
.badge-red{background:#fee2e2;color:#991b1b}
.badge-amber{background:#fef3c7;color:#92400e}
.badge-green{background:#dcfce7;color:#166534}
.badge-blue{background:#dbeafe;color:#1e40af}
.badge-gray{background:#f1f5f9;color:#475569}
.flag-row{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid #f1f5f9}
.flag-row:last-child{border-bottom:none}
.flag-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.flag-body{flex:1}
.flag-name{font-size:13px;font-weight:500}
.flag-msg{font-size:12px;color:#64748b;margin-top:2px}
.flag-time{font-size:11px;color:#94a3b8;margin-top:2px}
.resolve-btn{font-size:11px;padding:3px 10px;border:1px solid #e2e8f0;border-radius:5px;cursor:pointer;background:white;color:#64748b;font-family:inherit}
.resolve-btn:hover{background:#f1f5f9}
.athlete-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.athlete-card{background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px}
.athlete-avatar{width:40px;height:40px;border-radius:50%;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#1e40af;margin-bottom:10px}
.athlete-name{font-size:14px;font-weight:600}
.athlete-meta{font-size:12px;color:#64748b;margin-top:2px}
.upload-area{border:2px dashed #e2e8f0;border-radius:10px;padding:32px;text-align:center;margin-bottom:16px}
.upload-area p{color:#64748b;font-size:13px;margin-bottom:12px}
.btn{background:#2563eb;color:white;border:none;padding:9px 20px;border-radius:7px;cursor:pointer;font-size:13px;font-family:inherit}
.btn:hover{background:#1d4ed8}
.page{display:none}
.page.active{display:block}
.empty{text-align:center;padding:32px;color:#94a3b8;font-size:13px}
.loading{text-align:center;padding:32px;color:#94a3b8;font-size:13px}
#import-result{margin-top:12px;padding:12px 16px;border-radius:7px;display:none;font-size:13px}
.success-msg{background:#f0fdf4;border:1px solid #86efac;color:#166534}
.error-msg{background:#fef2f2;border:1px solid #fca5a5;color:#991b1b}
</style>
</head>
<body>
<div class="topbar">
  <h1>Athlete Management System</h1>
  <span id="last-updated">Loading...</span>
</div>
<div class="nav">
  <button class="nav-btn active" onclick="showPage('dashboard',this)">Dashboard</button>
  <button class="nav-btn" onclick="showPage('roster',this)">Roster</button>
  <button class="nav-btn" onclick="showPage('flags',this)">Flags</button>
  <button class="nav-btn" onclick="showPage('loads',this)">Load Records</button>
  <button class="nav-btn" onclick="showPage('sprints',this)">1080 Motion</button>
  <button class="nav-btn" onclick="showPage('import',this)">Import Data</button>
</div>
<div class="content">
  <div class="page active" id="page-dashboard">
    <div class="metric-grid" id="metrics"><div class="loading">Loading...</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card"><div class="card-title">Active Flags</div><div id="dash-flags"><div class="loading">Loading...</div></div></div>
      <div class="card"><div class="card-title">Recent Sessions</div><div id="dash-loads"><div class="loading">Loading...</div></div></div>
    </div>
  </div>
  <div class="page" id="page-roster">
    <div class="athlete-grid" id="roster-grid"><div class="loading">Loading...</div></div>
  </div>
  <div class="page" id="page-flags">
    <div class="card"><div class="card-title">Unresolved Flags</div><div id="flags-list"><div class="loading">Loading...</div></div></div>
  </div>
  <div class="page" id="page-loads">
    <div class="card">
      <div class="card-title">Recent Load Records (last 7 days)</div>
      <table><thead><tr><th>Athlete</th><th>Date</th><th>Type</th><th>RPE</th><th>Session Load</th><th>Distance</th><th>Source</th></tr></thead><tbody id="loads-tbody"></tbody></table>
      <div class="empty" id="loads-empty" style="display:none">No load records in the last 7 days.</div>
    </div>
  </div>
  <div class="page" id="page-sprints">
    <div class="card">
      <div class="card-title">1080 Motion - Recent Sessions</div>
      <table><thead><tr><th>Athlete</th><th>Date</th><th>Exercise</th><th>Set</th><th>Rep</th><th>Side</th><th>Peak Velocity</th><th>Peak Force</th><th>Peak Power</th><th>Load kg</th></tr></thead><tbody id="sprints-tbody"></tbody></table>
      <div class="empty" id="sprints-empty" style="display:none">No 1080 data in the last 30 days.</div>
    </div>
  </div>
  <div class="page" id="page-import">
    <div class="card">
      <div class="card-title">Import 1080 Motion Data</div>
      <div class="upload-area">
        <p>Upload an Excel export from your 1080 Sprint or Quantum software.<br>Athletes must exist in the database first.</p>
        <input type="file" id="import-file" accept=".xlsx,.csv" style="margin-bottom:12px"><br>
        <button class="btn" onclick="doImport()">Upload and Import</button>
      </div>
      <div id="import-result"></div>
    </div>
  </div>
</div>
<script>
let allAthletes=[];
function showPage(name,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='roster')loadRoster();
  if(name==='flags')loadFlags();
  if(name==='loads')loadLoads();
  if(name==='sprints')loadSprints();
}
function badge(text,color){return '<span class="badge badge-'+color+'">'+text+'</span>';}
function loadBadge(s){const m={High:'red',Low:'green',Normal:'blue',Injured:'amber',Unavailable:'gray'};return badge(s,m[s]||'gray');}
function timeAgo(iso){const h=Math.floor((Date.now()-new Date(iso))/3600000);if(h<1)return 'just now';if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago';}
function metric(label,val,style){return '<div class="metric"><div class="metric-label">'+label+'</div><div class="metric-val"'+(style?' style="'+style+'"':'')+'>'+val+'</div></div>';}

async function loadDashboard(){
  const [athletes,flags,loads]=await Promise.all([
    fetch('/api/athletes').then(r=>r.json()),
    fetch('/api/flags').then(r=>r.json()),
    fetch('/api/loads/recent').then(r=>r.json()),
  ]);
  allAthletes=athletes;
  const high=athletes.filter(a=>a.load_status==='High').length;
  const injured=athletes.filter(a=>a.load_status==='Injured').length;
  const criticals=flags.filter(f=>f.severity==='critical').length;
  document.getElementById('metrics').innerHTML=
    metric('Total Athletes',athletes.length)+
    metric('High Load',high,high>0?'color:#991b1b':'')+
    metric('Injured',injured,injured>0?'color:#92400e':'')+
    metric('Active Flags',flags.length,flags.length>0?'color:#991b1b':'')+
    metric('Critical',criticals,criticals>0?'color:#991b1b':'')+
    metric('Sessions (7d)',loads.length);
  const df=document.getElementById('dash-flags');
  if(!flags.length){df.innerHTML='<div class="empty">No active flags</div>';}
  else{df.innerHTML=flags.slice(0,5).map(f=>{
    const name=f.athletes?f.athletes.first_name+' '+f.athletes.last_name:'Unknown';
    const icon=f.severity==='critical'?'🔴':f.severity==='warning'?'🟡':'🔵';
    return '<div class="flag-row"><div class="flag-icon">'+icon+'</div><div class="flag-body"><div class="flag-name">'+name+'</div><div class="flag-msg">'+f.message+'</div><div class="flag-time">'+timeAgo(f.created_at)+'</div></div></div>';
  }).join('');}
  const dl=document.getElementById('dash-loads');
  if(!loads.length){dl.innerHTML='<div class="empty">No sessions this week</div>';}
  else{dl.innerHTML='<table><thead><tr><th>Athlete</th><th>Date</th><th>Type</th><th>RPE</th></tr></thead><tbody>'+
    loads.slice(0,8).map(l=>{
      const name=l.athletes?l.athletes.first_name+' '+l.athletes.last_name:'Unknown';
      const rc=l.rpe>=9?'red':l.rpe>=7?'amber':'green';
      return '<tr><td>'+name+'</td><td>'+l.session_date+'</td><td>'+(l.session_type||'-')+'</td><td>'+(l.rpe?badge('RPE '+l.rpe,rc):'-')+'</td></tr>';
    }).join('')+'</tbody></table>';}
  document.getElementById('last-updated').textContent='Updated '+new Date().toLocaleTimeString();
}

async function loadDashboard(){
  const [athletes,flags,loads]=await Promise.all([
    fetch('/api/athletes').then(r=>r.json()).catch(()=>[]),
    fetch('/api/flags').then(r=>r.json()).catch(()=>[]),
    fetch('/api/loads/recent').then(r=>r.json()).catch(()=>[]),
  ]);
async function loadFlags(){
  const el=document.getElementById('flags-list');
  const flags=await fetch('/api/flags').then(r=>r.json());
  if(!flags.length){el.innerHTML='<div class="empty">No active flags</div>';return;}
  el.innerHTML=flags.map(f=>{
    const name=f.athletes?f.athletes.first_name+' '+f.athletes.last_name:'Unknown';
    const icon=f.severity==='critical'?'🔴':f.severity==='warning'?'🟡':'🔵';
    const sc=f.severity==='critical'?'red':f.severity==='warning'?'amber':'blue';
    return '<div class="flag-row" id="flag-'+f.id+'"><div class="flag-icon">'+icon+'</div><div class="flag-body"><div class="flag-name">'+name+' '+badge(f.severity,sc)+'</div><div class="flag-msg">'+f.message+'</div><div class="flag-time">'+timeAgo(f.created_at)+' · '+(f.source||'')+'</div></div><button class="resolve-btn" onclick="resolveFlag(\''+f.id+'\')">Resolve</button></div>';
  }).join('');
}

async function resolveFlag(id){
  await fetch('/api/flags/'+id+'/resolve',{method:'PATCH'});
  document.getElementById('flag-'+id).style.display='none';
}

async function loadLoads(){
  const data=await fetch('/api/loads/recent').then(r=>r.json());
  const tbody=document.getElementById('loads-tbody');
  const empty=document.getElementById('loads-empty');
  if(!data.length){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  tbody.innerHTML=data.map(l=>{
    const name=l.athletes?l.athletes.first_name+' '+l.athletes.last_name:'Unknown';
    const rc=l.rpe>=9?'red':l.rpe>=7?'amber':'green';
    return '<tr><td>'+name+'</td><td>'+l.session_date+'</td><td>'+(l.session_type||'-')+'</td><td>'+(l.rpe?badge('RPE '+parseFloat(l.rpe).toFixed(1),rc):'-')+'</td><td>'+(l.session_load?Math.round(l.session_load)+' AU':'-')+'</td><td>'+(l.total_distance_m?Math.round(l.total_distance_m)+' m':'-')+'</td><td>'+badge(l.source,'gray')+'</td></tr>';
  }).join('');
}

async function loadSprints(){
  const data=await fetch('/api/sprints/recent').then(r=>r.json());
  const tbody=document.getElementById('sprints-tbody');
  const empty=document.getElementById('sprints-empty');
  if(!data.length){tbody.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  tbody.innerHTML=data.map(s=>{
    const name=s.athletes?s.athletes.first_name+' '+s.athletes.last_name:'Unknown';
    return '<tr><td>'+name+'</td><td>'+s.session_date+'</td><td>'+(s.exercise||'-')+'</td><td>'+(s.set_number??'-')+'</td><td>'+(s.rep_number??'-')+'</td><td>'+(s.side||'-')+'</td><td>'+(s.peak_velocity_ms?parseFloat(s.peak_velocity_ms).toFixed(2)+' m/s':'-')+'</td><td>'+(s.peak_force_n?Math.round(s.peak_force_n)+' N':'-')+'</td><td>'+(s.peak_power_w?Math.round(s.peak_power_w)+' W':'-')+'</td><td>'+(s.concentric_load_kg??'-')+'</td></tr>';
  }).join('');
}

async function doImport(){
  const fi=document.getElementById('import-file');
  if(!fi.files.length){alert('Please select a file first.');return;}
  const fd=new FormData();
  fd.append('file',fi.files[0]);
  const result=document.getElementById('import-result');
  result.style.display='block';result.className='';result.textContent='Importing...';
  try{
    const res=await fetch('/import/1080',{method:'POST',body:fd});
    const data=await res.json();
    if(data.error){result.className='error-msg';result.textContent='Error: '+data.error;}
    else{result.className='success-msg';result.textContent=data.saved+' records imported. '+data.skipped+' skipped.';}
  }catch(err){result.className='error-msg';result.textContent='Upload failed: '+err.message;}
}

loadDashboard();
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('AMS backend running on port ' + PORT);
  console.log('Supabase URL: ' + (process.env.SUPABASE_URL ? 'connected' : 'NOT SET'));
});
