require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
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

app.get('/api/athletes', async function(req, res) {
  try {
    var r = await supabase.from('athletes').select('*').eq('active', true).order('last_name');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/flags', async function(req, res) {
  try {
    var r = await supabase.from('athlete_flags')
      .select('*, athletes(first_name, last_name)')
      .eq('resolved', false).order('created_at', { ascending: false });
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

app.get('/api/loads/recent', async function(req, res) {
  try {
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    var r = await supabase.from('load_records')
      .select('*, athletes(first_name, last_name)')
      .gte('session_date', weekAgo).order('session_date', { ascending: false }).limit(20);
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/sprints/recent', async function(req, res) {
  try {
    var yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    var r = await supabase.from('sprint_records')
      .select('*, athletes(first_name, last_name)')
      .gte('session_date', yearAgo).order('session_date', { ascending: false }).limit(50);
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/analysis', async function(req, res) {
  try {
    var aid = req.query.athlete_id || null;
    var q = supabase.from('session_asymmetry')
      .select('*, athletes(first_name, last_name)')
      .order('session_date', { ascending: false }).limit(200);
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

app.get('/api/assessments/:athleteId/current', async function(req, res) {
  try {
    var r = await supabase.from('athlete_current_assessment')
      .select('*').eq('athlete_id', req.params.athleteId).maybeSingle();
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

app.get('/api/programs', async function(req, res) {
  try {
    var aid = req.query.athlete_id || null;
    if (aid) {
      var r = await supabase.from('athlete_programs')
        .select('*, programs(*)').eq('athlete_id', aid).eq('active', true);
      if (r.error) throw r.error;
      res.json(r.data);
    } else {
      var r = await supabase.from('programs').select('*').order('created_at', { ascending: false });
      if (r.error) throw r.error;
      res.json(r.data);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/programs', async function(req, res) {
  try {
    var r = await supabase.from('programs').insert(req.body).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/programs/:id/assign', async function(req, res) {
  try {
    var r = await supabase.from('athlete_programs').upsert({
      athlete_id: req.body.athlete_id, program_id: req.params.id, active: true,
    }, { onConflict: 'athlete_id,program_id' });
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/programs/:id/days', async function(req, res) {
  try {
    var r = await supabase.from('program_days')
      .select('*, workout_blocks(*, workout_exercises(*, workout_progressions(*)))')
      .eq('program_id', req.params.id).order('day_order');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/programs/:id/build', async function(req, res) {
  try {
    var programId = req.params.id;
    var warmupTemplateId = req.body.warmup_template_id || null;
    var block1TemplateId = req.body.block1_template_id || null;
    var wedBlock1Id = req.body.wed_block1_id || null;

    var days = [
      { name: 'Monday', order: 1 },
      { name: 'Wednesday', order: 2 },
      { name: 'Friday', order: 3 },
      { name: 'Conditioning', order: 4 }
    ];

    for (var d = 0; d < days.length; d++) {
      var day = days[d];
      var dayR = await supabase.from('program_days').insert({
        program_id: programId, day_name: day.name, day_order: day.order, day_type: 'strength'
      }).select();
      if (dayR.error) { console.error('Day error:', dayR.error.message); continue; }
      var dayId = dayR.data[0].id;

      if (day.name === 'Monday') {
        if (warmupTemplateId) await insertBlockFromTemplate(dayId, warmupTemplateId, 'Warmup', 0, 'warmup');
        if (block1TemplateId) await insertBlockFromTemplate(dayId, block1TemplateId, '1', 1, 'superset');
        await insertStandardBlocks(dayId, 2);
      } else if (day.name === 'Wednesday') {
        if (warmupTemplateId) await insertBlockFromTemplate(dayId, warmupTemplateId, 'Warmup', 0, 'warmup');
        if (wedBlock1Id) await insertBlockFromTemplate(dayId, wedBlock1Id, '1', 1, 'superset');
        await insertStandardBlocks(dayId, 2);
      } else if (day.name === 'Friday') {
        if (warmupTemplateId) await insertBlockFromTemplate(dayId, warmupTemplateId, 'Warmup', 0, 'warmup');
        if (block1TemplateId) await insertBlockFromTemplate(dayId, block1TemplateId, '1', 1, 'superset');
        await insertStandardBlocks(dayId, 2);
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function insertBlockFromTemplate(dayId, templateId, label, order, type) {
  try {
    var blockR = await supabase.from('workout_blocks').insert({
      day_id: dayId, block_label: label, block_order: order, block_type: type
    }).select();
    if (blockR.error) { console.error('Block insert error:', blockR.error.message); return; }
    var blockId = blockR.data[0].id;

    var exR = await supabase.from('block_template_exercises')
      .select('*').eq('template_id', templateId).order('exercise_order');
    if (exR.error || !exR.data.length) return;

    for (var i = 0; i < exR.data.length; i++) {
      var ex = exR.data[i];
      var exIns = await supabase.from('workout_exercises').insert({
        block_id: blockId,
        exercise_name: ex.exercise_name,
        exercise_order: ex.exercise_order,
        sets: ex.sets,
        tempo: ex.tempo,
        rest: ex.rest,
        notes: ex.notes,
      }).select();
      if (exIns.error) continue;
      if (exIns.data[0] && ex.default_reps) {
        for (var w = 1; w <= 4; w++) {
          await supabase.from('workout_progressions').insert({
            workout_exercise_id: exIns.data[0].id,
            week_number: w,
            reps: ex.default_reps,
          });
        }
      }
    }
  } catch (e) { console.error('insertBlockFromTemplate error:', e.message); }
}

async function insertStandardBlocks(dayId, startOrder) {
  try {
    var posteriorBlock = await supabase.from('workout_blocks').insert({
      day_id: dayId, block_label: String(startOrder), block_order: startOrder, block_type: 'superset'
    }).select();
    if (!posteriorBlock.error) {
      var blockId = posteriorBlock.data[0].id;
      var stdExercises = [
        { name: 'iso dynamic kickstand hinge', order: 1, sets: 2, tempo: '', rest: ':60', reps: ':10+8e' },
        { name: 'ring row iso holds', order: 2, sets: 2, tempo: '5 sec', rest: ':60', reps: '8' },
        { name: '45 degree torsion', order: 3, sets: 2, tempo: '', rest: ':60', reps: 'x20e' },
      ];
      for (var i = 0; i < stdExercises.length; i++) {
        var ex = stdExercises[i];
        var exIns = await supabase.from('workout_exercises').insert({
          block_id: blockId, exercise_name: ex.name,
          exercise_order: ex.order, sets: ex.sets, tempo: ex.tempo, rest: ex.rest,
        }).select();
        if (!exIns.error && exIns.data[0]) {
          for (var w = 1; w <= 4; w++) {
            await supabase.from('workout_progressions').insert({
              workout_exercise_id: exIns.data[0].id, week_number: w, reps: ex.reps,
            });
          }
        }
      }
    }

    var coreBlock = await supabase.from('workout_blocks').insert({
      day_id: dayId, block_label: String(startOrder + 1), block_order: startOrder + 1, block_type: 'superset'
    }).select();
    if (!coreBlock.error) {
      var blockId = coreBlock.data[0].id;
      var coreExercises = [
        { name: 'birddog row', order: 1, sets: 2, tempo: '', rest: ':60', reps: '8e' },
        { name: 'GHR iso at top', order: 2, sets: 2, tempo: '', rest: ':60', reps: ':30' },
        { name: 'HF crunch', order: 3, sets: 2, tempo: '', rest: ':60', reps: '8e' },
      ];
      for (var i = 0; i < coreExercises.length; i++) {
        var ex = coreExercises[i];
        var exIns = await supabase.from('workout_exercises').insert({
          block_id: blockId, exercise_name: ex.name,
          exercise_order: ex.order, sets: ex.sets, tempo: ex.tempo, rest: ex.rest,
        }).select();
        if (!exIns.error && exIns.data[0]) {
          for (var w = 1; w <= 4; w++) {
            await supabase.from('workout_progressions').insert({
              workout_exercise_id: exIns.data[0].id, week_number: w, reps: ex.reps,
            });
          }
        }
      }
    }
  } catch (e) { console.error('insertStandardBlocks error:', e.message); }
}

app.get('/api/suggest/:athleteId', async function(req, res) {
  try {
    var assessment = await supabase.from('athlete_current_assessment')
      .select('*').eq('athlete_id', req.params.athleteId).maybeSingle();
    if (assessment.error) throw assessment.error;
    var a = assessment.data;
    if (!a) { res.json({ track: null, pathway: null }); return; }

    var track = a.recommended_track || 'hip_ir';
    var trackWord = track.replace('hip_', '').replace('_', ' ');
    var wedTrackWord = trackWord === 'ir' ? 'add' : 'ir';

    var templates = await supabase.from('block_templates')
      .select('*, block_template_exercises(*)').order('name');
    if (templates.error) throw templates.error;

    var warmups = templates.data.filter(function(t) {
      return t.template_type === 'warmup' && t.name.toLowerCase().includes(trackWord);
    });
    var block1 = templates.data.filter(function(t) {
      return t.template_type === 'block' && t.name.toLowerCase().includes(trackWord);
    });
    var wedBlocks = templates.data.filter(function(t) {
      return t.template_type === 'block' && t.name.toLowerCase().includes(wedTrackWord);
    });
    var wedBlock1Id = wedBlocks.length ? wedBlocks[0].id : null;

    res.json({
      track: track,
      pathway: a.prescribed_pathway,
      phase: a.current_phase,
      warmup_suggestions: warmups,
      block1_suggestions: block1,
      wed_block1_id: wedBlock1Id,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
          .ilike('last_name', parts.slice(1).join(' ') + '%').limit(1);
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

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('AMS running on port ' + PORT);
  console.log('Supabase: ' + (process.env.SUPABASE_URL ? 'connected' : 'NOT SET'));
});
