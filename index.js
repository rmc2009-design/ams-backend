require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const app = express();
app.use(express.json());

// ============================================================
// PASSWORD PROTECTION (Cookie-based login)
// ============================================================
const crypto = require('crypto');
var AMS_USER = process.env.AMS_USERNAME || 'rmc35';
var AMS_PASS = process.env.AMS_PASSWORD || 'LCADetroit313!';
var SESSION_TOKEN = crypto.createHash('sha256').update(AMS_USER + ':' + AMS_PASS + ':ams-salt-2026').digest('hex');

function parseCookies(req) {
  var list = {};
  var rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach(function(cookie) {
    var parts = cookie.split('=');
    var key = parts.shift().trim();
    if (key) list[key] = decodeURIComponent(parts.join('='));
  });
  return list;
}

app.get('/login', function(req, res) {
  var err = req.query.error ? '<div style="color:#dc2626;font-size:13px;margin-bottom:12px">Invalid username or password.</div>' : '';
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AMS Login</title>' +
    '<style>body{font-family:Arial,sans-serif;background:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
    '.box{background:white;border-radius:10px;padding:32px;width:320px;box-shadow:0 10px 40px rgba(0,0,0,0.3)}' +
    'h1{font-size:18px;margin:0 0 20px;color:#0f172a}' +
    'input{width:100%;padding:10px 12px;margin-bottom:12px;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;box-sizing:border-box}' +
    'button{width:100%;padding:11px;background:#2563eb;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600}' +
    '</style></head><body><div class="box"><h1>Athlete Management System</h1>' + err +
    '<form method="POST" action="/login">' +
    '<input type="text" name="username" placeholder="Username" autofocus required>' +
    '<input type="password" name="password" placeholder="Password" required>' +
    '<button type="submit">Sign In</button>' +
    '</form></div></body></html>');
});

app.post('/login', express.urlencoded({ extended: true }), function(req, res) {
  if (req.body.username === AMS_USER && req.body.password === AMS_PASS) {
    res.setHeader('Set-Cookie', 'ams_session=' + SESSION_TOKEN + '; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax');
    return res.redirect('/');
  }
  return res.redirect('/login?error=1');
});

app.use(function(req, res, next) {
  if (req.path === '/login') return next();
  var cookies = parseCookies(req);
  if (cookies.ams_session === SESSION_TOKEN) return next();

  var wantsHtml = (req.headers.accept || '').includes('text/html');
  if (wantsHtml) return res.redirect('/login');
  return res.status(401).json({ error: 'Unauthorized' });
});


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

app.get('/api/programs/dashboard', async function(req, res) {
  try {
    var r = await supabase.from('athlete_programs')
      .select('athlete_id, program_id, programs(id,name,weeks,phase), athletes(first_name,last_name,position)')
      .eq('active', true);
    if (r.error) throw r.error;
    var results = r.data.map(function(row) {
      return {
        athlete_id: row.athlete_id,
        name: row.athletes ? row.athletes.first_name+' '+row.athletes.last_name : '',
        position: row.athletes ? row.athletes.position : '',
        program_name: row.programs ? row.programs.name : '',
        program_id: row.program_id,
        weeks: row.programs ? row.programs.weeks : null,
        phase: row.programs ? row.programs.phase : null,
      };
    });
    results.sort(function(a,b){ return a.name.localeCompare(b.name); });
    res.json(results);
  } catch(err) { res.status(500).json({ error: err.message }); }
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
    var buildPhase = parseInt(req.body.phase) || 1;

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
        await insertStandardBlocks(dayId, 2, buildPhase);
      } else if (day.name === 'Wednesday') {
        if (warmupTemplateId) await insertBlockFromTemplate(dayId, warmupTemplateId, 'Warmup', 0, 'warmup');
        if (wedBlock1Id) await insertBlockFromTemplate(dayId, wedBlock1Id, '1', 1, 'superset');
        if (buildPhase >= 2) {
          // Use dedicated Phase 2 Wednesday blocks
          var wed2 = await supabase.from('block_templates').select('id').eq('name','Phase 2 Wednesday Block 2').maybeSingle();
          var wed3 = await supabase.from('block_templates').select('id').eq('name','Phase 2 Wednesday Block 3').maybeSingle();
          if (wed2.data) await insertBlockFromTemplate(dayId, wed2.data.id, '2', 2, 'superset');
          if (wed3.data) await insertBlockFromTemplate(dayId, wed3.data.id, '3', 3, 'superset');
        } else {
          await insertStandardBlocks(dayId, 2, buildPhase);
        }
      } else if (day.name === 'Friday') {
        if (warmupTemplateId) await insertBlockFromTemplate(dayId, warmupTemplateId, 'Warmup', 0, 'warmup');
        var friId = req.body.fri_block1_id || block1TemplateId;
        if (friId) await insertBlockFromTemplate(dayId, friId, '1', 1, 'superset');
        await insertStandardBlocks(dayId, 2, buildPhase);
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

async function insertStandardBlocks(dayId, startOrder, phase) {
  try {
    phase = phase || 1;

    var block2Exercises = phase >= 2 ? [
      { name: 'GHR', order: 1, sets: 3, tempo: '3.0.1', rest: ':60', reps: '5' },
      { name: '1080 pulldown 1 up 2 down', order: 2, sets: 3, tempo: '2.1.1', rest: ':60', reps: '5e' },
      { name: 'front plank reach under row', order: 3, sets: 2, tempo: '', rest: ':60', reps: '8e' },
    ] : [
      { name: 'iso dynamic kickstand hinge', order: 1, sets: 2, tempo: '', rest: ':60', reps: ':10+8e' },
      { name: 'ring row iso holds', order: 2, sets: 2, tempo: '5 sec', rest: ':60', reps: '8' },
      { name: '45 degree torsion', order: 3, sets: 2, tempo: '', rest: ':60', reps: 'x20e' },
    ];

    var block3Exercises = phase >= 2 ? [
      { name: 'db 3 pt row heavy', order: 1, sets: 3, tempo: '', rest: ':60', reps: '8e' },
      { name: 'kickstand hinge', order: 2, sets: 3, tempo: '', rest: ':60', reps: '8e' },
      { name: 'Copp side plank straight', order: 3, sets: 2, tempo: '', rest: ':60', reps: ':30' },
      { name: 'HF crunch', order: 4, sets: 2, tempo: '', rest: ':60', reps: '8e' },
    ] : [
      { name: 'birddog row', order: 1, sets: 2, tempo: '', rest: ':60', reps: '8e' },
      { name: 'GHR iso at top', order: 2, sets: 2, tempo: '', rest: ':60', reps: ':30' },
      { name: 'HF crunch', order: 3, sets: 2, tempo: '', rest: ':60', reps: '8e' },
    ];

    var posteriorBlock = await supabase.from('workout_blocks').insert({
      day_id: dayId, block_label: String(startOrder), block_order: startOrder, block_type: 'superset'
    }).select();
    if (!posteriorBlock.error) {
      var blockId = posteriorBlock.data[0].id;
      for (var i = 0; i < block2Exercises.length; i++) {
        var ex = block2Exercises[i];
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
      for (var i = 0; i < block3Exercises.length; i++) {
        var ex = block3Exercises[i];
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
    var trackWord = track === 'foot_ankle' ? 'foot/ankle' : track.replace('hip_', '').replace('_', ' ');
    var wedTrackWord = track === 'foot_ankle' ? 'add' : (trackWord === 'ir' ? 'add' : 'ir');
    var friTrackWord = track === 'foot_ankle' ? 'ir' : trackWord;

    var templates = await supabase.from('block_templates')
      .select('*, block_template_exercises(*)').order('name');
    if (templates.error) throw templates.error;

    var warmups = templates.data.filter(function(t) {
      return t.template_type === 'warmup' && t.name.toLowerCase().includes(trackWord);
    });

    var block1 = [];
    var phase = a.current_phase || 1;
    var pathway = a.prescribed_pathway || null;

    if (phase >= 2 && pathway) {
      // Phase 2+ uses pathway-specific block templates
      var pathwayMap = {
        'flywheel': 'phase 2 flywheel block 1 mon',
        'eccentric_progression': 'phase 2 eccentric motor learning block 1 mon',
        'dual_deficit': 'phase 2 dual deficit block 1 mon',
        'force_isometrics': 'phase 2 force block 1 mon',
        'speed_power': 'phase 2 speed power block 1 mon',
        'timing': 'phase 2 flywheel block 1 mon',
        'peak_power': 'phase 2 speed power block 1 mon',
      };
      var pathwayKey = pathwayMap[pathway] || null;
      if (pathwayKey) {
        block1 = templates.data.filter(function(t) {
          return t.template_type === 'block' && t.name.toLowerCase() === pathwayKey;
        });
      }
    } else {
      // Phase 1 uses track-specific block templates
      block1 = templates.data.filter(function(t) {
        return t.template_type === 'block' && t.name.toLowerCase().includes(trackWord);
      });
    }
    var wedBlock1Id = null;
    if (phase >= 2 && pathway) {
      var flywheelPathways = ['flywheel', 'timing', 'peak_power'];
      var wedTplName = flywheelPathways.indexOf(pathway) >= 0
        ? 'phase 2 wednesday flywheel block 1'
        : 'phase 2 wednesday eccentric block 1';
      var wedTpl = templates.data.filter(function(t) {
        return t.name.toLowerCase() === wedTplName;
      });
      wedBlock1Id = wedTpl.length ? wedTpl[0].id : null;
    } else {
      var wedBlocks = templates.data.filter(function(t) {
        return t.template_type === 'block' && t.name.toLowerCase().includes('hip '+wedTrackWord);
      });
      wedBlock1Id = wedBlocks.length ? wedBlocks[0].id : null;
    }

    var friBlocks;
    if (phase >= 2 && pathway) {
      var pathwayFriMap = {
        'flywheel': 'phase 2 flywheel block 1 fri',
        'eccentric_progression': 'phase 2 eccentric motor learning block 1 fri',
        'dual_deficit': 'phase 2 eccentric motor learning block 1 fri',
        'force_isometrics': 'phase 2 eccentric motor learning block 1 fri',
        'speed_power': 'phase 2 eccentric motor learning block 1 fri',
        'timing': 'phase 2 flywheel block 1 fri',
        'peak_power': 'phase 2 flywheel block 1 fri',
      };
      var pathwayFriKey = pathwayFriMap[pathway] || null;
      friBlocks = pathwayFriKey ? templates.data.filter(function(t) {
        return t.template_type === 'block' && t.name.toLowerCase() === pathwayFriKey;
      }) : [];
      // For phase 2, always set fri block
      var friBlock1Id = friBlocks.length ? friBlocks[0].id : null;
    } else {
      friBlocks = templates.data.filter(function(t) {
        return t.template_type === 'block' && t.name.toLowerCase().includes('hip '+friTrackWord);
      });
      var friBlock1Id = track === 'foot_ankle' ? (friBlocks.length ? friBlocks[0].id : null) : null;
    }

    res.json({
      track: track,
      pathway: a.prescribed_pathway,
      phase: a.current_phase,
      warmup_suggestions: warmups,
      block1_suggestions: block1,
      wed_block1_id: wedBlock1Id,
      fri_block1_id: friBlock1Id,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get('/api/templates', async function(req, res) {
  try {
    var r = await supabase.from('block_templates')
      .select('*, block_template_exercises(*)')
      .order('template_type').order('name');
    if (r.error) throw r.error;
    // Sort exercises within each template
    r.data.forEach(function(t) {
      if (t.block_template_exercises) {
        t.block_template_exercises.sort(function(a,b){return a.exercise_order-b.exercise_order;});
      }
    });
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/templates', async function(req, res) {
  try {
    var t = req.body;
    var r = await supabase.from('block_templates').insert({
      name: t.name,
      template_type: t.template_type || 'block',
      focus_area: t.focus_area || null,
      notes: t.notes || null,
    }).select();
    if (r.error) throw r.error;
    var tid = r.data[0].id;
    if (t.exercises && t.exercises.length) {
      for (var i = 0; i < t.exercises.length; i++) {
        var ex = t.exercises[i];
        await supabase.from('block_template_exercises').insert({
          template_id: tid,
          exercise_name: ex.exercise_name,
          exercise_order: i + 1,
          sets: ex.sets || null,
          tempo: ex.tempo || null,
          rest: ex.rest || null,
          default_reps: ex.default_reps || null,
          notes: ex.notes || null,
        });
      }
    }
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/templates/:id', async function(req, res) {
  try {
    await supabase.from('block_template_exercises').delete().eq('template_id', req.params.id);
    var r = await supabase.from('block_templates').delete().eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.post('/api/programs/:id/copy', async function(req, res) {
  try {
    var sourceId = req.params.id;
    var targetAthleteId = req.body.athlete_id;
    var newName = req.body.name;

    // Get source program
    var progR = await supabase.from('programs').select('*').eq('id', sourceId).single();
    if (progR.error) throw progR.error;
    var srcProg = progR.data;

    // Create new program
    var newProgR = await supabase.from('programs').insert({
      name: newName || srcProg.name + ' (copy)',
      phase: srcProg.phase,
      weeks: srcProg.weeks,
      notes: srcProg.notes,
    }).select();
    if (newProgR.error) throw newProgR.error;
    var newProgId = newProgR.data[0].id;

    // Assign to athlete
    await supabase.from('athlete_programs').upsert({
      athlete_id: targetAthleteId,
      program_id: newProgId,
      active: true,
    }, { onConflict: 'athlete_id,program_id' });

    // Get source days with full exercise data
    var daysR = await supabase.from('program_days')
      .select('*, workout_blocks(*, workout_exercises(*, workout_progressions(*)))')
      .eq('program_id', sourceId).order('day_order');
    if (daysR.error) throw daysR.error;

    // Copy each day
    for (var d = 0; d < daysR.data.length; d++) {
      var day = daysR.data[d];
      var newDayR = await supabase.from('program_days').insert({
        program_id: newProgId,
        day_name: day.day_name,
        day_order: day.day_order,
        day_type: day.day_type,
      }).select();
      if (newDayR.error) continue;
      var newDayId = newDayR.data[0].id;

      var blocks = day.workout_blocks || [];
      blocks.sort(function(a,b){return a.block_order-b.block_order;});

      for (var b = 0; b < blocks.length; b++) {
        var block = blocks[b];
        var newBlockR = await supabase.from('workout_blocks').insert({
          day_id: newDayId,
          block_label: block.block_label,
          block_order: block.block_order,
          block_type: block.block_type,
        }).select();
        if (newBlockR.error) continue;
        var newBlockId = newBlockR.data[0].id;

        var exs = block.workout_exercises || [];
        exs.sort(function(a,b){return a.exercise_order-b.exercise_order;});

        for (var e = 0; e < exs.length; e++) {
          var ex = exs[e];
          var newExR = await supabase.from('workout_exercises').insert({
            block_id: newBlockId,
            exercise_name: ex.exercise_name,
            exercise_order: ex.exercise_order,
            sets: ex.sets,
            tempo: ex.tempo,
            rest: ex.rest,
            notes: ex.notes,
          }).select();
          if (newExR.error) continue;
          var newExId = newExR.data[0].id;

          var progs = ex.workout_progressions || [];
          for (var p = 0; p < progs.length; p++) {
            await supabase.from('workout_progressions').insert({
              workout_exercise_id: newExId,
              week_number: progs[p].week_number,
              reps: progs[p].reps,
              weight: progs[p].weight,
            });
          }
        }
      }
    }

    res.json({ ok: true, program_id: newProgId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.post('/api/workout-blocks/:id/swap', async function(req, res) {
  try {
    var blockId = req.params.id;
    var templateId = req.body.template_id;

    // Delete existing exercises and progressions
    var exR = await supabase.from('workout_exercises').select('id').eq('block_id', blockId);
    if (!exR.error && exR.data.length) {
      for (var i = 0; i < exR.data.length; i++) {
        await supabase.from('workout_progressions').delete().eq('workout_exercise_id', exR.data[i].id);
      }
      await supabase.from('workout_exercises').delete().eq('block_id', blockId);
    }

    // Insert new exercises from template
    var tplR = await supabase.from('block_template_exercises')
      .select('*').eq('template_id', templateId).order('exercise_order');
    if (tplR.error) throw tplR.error;

    for (var i = 0; i < tplR.data.length; i++) {
      var ex = tplR.data[i];
      var newEx = await supabase.from('workout_exercises').insert({
        block_id: blockId,
        exercise_name: ex.exercise_name,
        exercise_order: ex.exercise_order,
        sets: ex.sets,
        tempo: ex.tempo,
        rest: ex.rest,
        notes: ex.notes,
      }).select();
      if (newEx.error) continue;
      if (newEx.data[0] && ex.default_reps) {
        for (var w = 1; w <= 4; w++) {
          await supabase.from('workout_progressions').insert({
            workout_exercise_id: newEx.data[0].id,
            week_number: w,
            reps: ex.default_reps,
          });
        }
      }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get('/api/programs/:id/print', async function(req, res) {
  try {
    var programId = req.params.id;
    
    // Get days and blocks and exercises
    var daysR = await supabase.from('program_days')
      .select('*, workout_blocks(*, workout_exercises(*))')
      .eq('program_id', programId).order('day_order');
    if (daysR.error) throw daysR.error;

    // Get all exercise IDs
    var exIds = [];
    daysR.data.forEach(function(day) {
      (day.workout_blocks || []).forEach(function(block) {
        (block.workout_exercises || []).forEach(function(ex) {
          exIds.push(ex.id);
        });
      });
    });

    // Fetch all progressions for these exercises
    var progsR = await supabase.from('workout_progressions')
      .select('*')
      .in('workout_exercise_id', exIds);
    if (progsR.error) throw progsR.error;

    // Map progressions to exercises
    var progMap = {};
    progsR.data.forEach(function(p) {
      if (!progMap[p.workout_exercise_id]) progMap[p.workout_exercise_id] = [];
      progMap[p.workout_exercise_id].push(p);
    });

    // Attach progressions to exercises
    daysR.data.forEach(function(day) {
      (day.workout_blocks || []).forEach(function(block) {
        (block.workout_exercises || []).forEach(function(ex) {
          ex.workout_progressions = progMap[ex.id] || [];
        });
      });
    });

    res.json(daysR.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ============================================================
// CONDITIONING ROUTES
// ============================================================

app.get('/api/conditioning/squad', async function(req, res) {
  try {
    // Get latest test per athlete
    var r = await supabase.from('conditioning_tests')
      .select('*, athletes(first_name, last_name, position)')
      .order('test_date', { ascending: false });
    if (r.error) throw r.error;

    // Group by athlete, keep latest + all tests for trend
    var athleteMap = {};
    r.data.forEach(function(t) {
      if (!athleteMap[t.athlete_id]) {
        athleteMap[t.athlete_id] = { athlete: t.athletes, tests: [] };
      }
      athleteMap[t.athlete_id].tests.push(t);
    });

    var squad = Object.values(athleteMap).map(function(a) {
      var tests = a.tests.sort(function(x,y){ return new Date(x.test_date)-new Date(y.test_date); });
      var latest = tests[tests.length-1];
      var prev = tests.length > 1 ? tests[tests.length-2] : null;
      var delta = (prev && latest.vift && prev.vift) ? parseFloat((latest.vift - prev.vift).toFixed(1)) : null;
      return {
        athlete_id: latest.athlete_id,
        name: a.athlete ? a.athlete.first_name+' '+a.athlete.last_name : '',
        position: a.athlete ? a.athlete.position : '',
        latest_vift: latest.vift,
        latest_date: latest.test_date,
        test_number: latest.test_number,
        map_watts: latest.map_watts,
        peak_sprint_watts: latest.peak_sprint_watts,
        bike_asr: latest.bike_asr,
        delta: delta,
        tests: tests
      };
    });

    squad.sort(function(a,b){ return (b.latest_vift||0)-(a.latest_vift||0); });
    res.json(squad);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conditioning/dashboard', async function(req, res) {
  try {
    // Step 1: get all active assignments
    var assignR = await supabase.from('athlete_conditioning_programs')
      .select('athlete_id, program_id').eq('active', true);
    if (assignR.error) throw assignR.error;
    if (!assignR.data.length) { res.json([]); return; }

    var results = [];
    for (var i = 0; i < assignR.data.length; i++) {
      var row = assignR.data[i];

      // Get athlete
      var athR = await supabase.from('athletes').select('first_name,last_name,position').eq('id', row.athlete_id).single();
      // Get program
      var progR = await supabase.from('conditioning_programs').select('id,name,mode,weeks,start_date,current_week').eq('id', row.program_id).single();
      if (progR.error || !progR.data) continue;
      var prog = progR.data;

      var currentWeek = prog.current_week || 1;
      if (prog.start_date) {
        var start = new Date(prog.start_date);
        var now = new Date();
        var diffWeeks = Math.floor((now - start) / (7*24*60*60*1000));
        currentWeek = Math.min(Math.max(1, diffWeeks+1), prog.weeks);
      }

      // Get current week protocol name
      var wkR = await supabase.from('conditioning_program_weeks')
        .select('id,session_a_custom,session_a_protocol_id')
        .eq('program_id', prog.id).eq('week_number', currentWeek).maybeSingle();

      var nextSession = 'No session assigned';
      if (wkR.data) {
        if (wkR.data.session_a_custom) {
          nextSession = wkR.data.session_a_custom;
        } else if (wkR.data.session_a_protocol_id) {
          var protoR = await supabase.from('conditioning_protocols').select('name').eq('id', wkR.data.session_a_protocol_id).single();
          if (!protoR.error) nextSession = protoR.data.name;
        }
      }

      // Count logs
      var logR = await supabase.from('conditioning_session_logs')
        .select('id').eq('athlete_id', row.athlete_id).eq('program_id', prog.id).neq('status','skipped');
      var sessionsDone = logR.data ? logR.data.length : 0;

      results.push({
        athlete_id: row.athlete_id,
        name: athR.data ? athR.data.first_name+' '+athR.data.last_name : '',
        position: athR.data ? athR.data.position : '',
        program_name: prog.name,
        program_mode: prog.mode,
        current_week: currentWeek,
        total_weeks: prog.weeks,
        next_session: nextSession,
        sessions_logged: sessionsDone,
      });
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conditioning/workout-day', async function(req, res) {
  try {
    var athleteId = req.query.athlete_id;
    var weekNumber = parseInt(req.query.week) || 1;

    // Get athlete's active conditioning program
    var apR = await supabase.from('athlete_conditioning_programs')
      .select('program_id').eq('athlete_id', athleteId).eq('active', true)
      .order('created_at', { ascending: false }).limit(1).single();

    if (apR.error || !apR.data) { res.json({ session: null }); return; }

    var wkR = await supabase.from('conditioning_program_weeks')
      .select('*, session_a:conditioning_protocols!conditioning_program_weeks_session_a_protocol_id_fkey(*), session_b:conditioning_protocols!conditioning_program_weeks_session_b_protocol_id_fkey(*)')
      .eq('program_id', apR.data.program_id).eq('week_number', weekNumber).single();

    if (wkR.error || !wkR.data) { res.json({ session: null }); return; }

    res.json({
      session: {
        phase: wkR.data.phase,
        session_a: wkR.data.session_a_custom || (wkR.data.session_a ? wkR.data.session_a.name : null),
        session_a_detail: wkR.data.session_a ? (wkR.data.session_a.format||'')+(wkR.data.session_a.volume?' · '+wkR.data.session_a.volume:'') : null,
        session_b: wkR.data.session_b_custom || (wkR.data.session_b ? wkR.data.session_b.name : null),
        session_b_detail: wkR.data.session_b ? (wkR.data.session_b.format||'')+(wkR.data.session_b.volume?' · '+wkR.data.session_b.volume:'') : null,
        notes: wkR.data.notes,
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conditioning/:athleteId', async function(req, res) {
  try {
    var r = await supabase.from('conditioning_tests')
      .select('*')
      .eq('athlete_id', req.params.athleteId)
      .order('test_date', { ascending: false });
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});



app.post('/api/conditioning', async function(req, res) {
  try {
    var b = req.body;
    var bikeAsr = (b.peak_sprint_watts && b.map_watts) ? b.peak_sprint_watts - b.map_watts : null;
    var r = await supabase.from('conditioning_tests').insert({
      athlete_id: b.athlete_id,
      test_date: b.test_date,
      test_number: b.test_number || null,
      vift: b.vift || null,
      map_watts: b.map_watts || null,
      peak_sprint_watts: b.peak_sprint_watts || null,
      bike_asr: bikeAsr,
      notes: b.notes || null,
    }).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/conditioning/:id', async function(req, res) {
  try {
    var r = await supabase.from('conditioning_tests').delete().eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.get('/api/conditioning-protocols', async function(req, res) {
  try {
    var r = await supabase.from('conditioning_protocols')
      .select('*').order('category').order('name');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/conditioning-protocols', async function(req, res) {
  try {
    var b = req.body;
    var r = await supabase.from('conditioning_protocols').insert({
      name: b.name, category: b.category,
      format: b.format||null, intensity: b.intensity||null,
      volume: b.volume||null, notes: b.notes||null,
    }).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/conditioning-protocols/:id', async function(req, res) {
  try {
    var r = await supabase.from('conditioning_protocols').delete().eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ============================================================
// CONDITIONING PROGRAMS
// ============================================================

app.get('/api/conditioning-programs', async function(req, res) {
  try {
    var q = supabase.from('conditioning_programs').select('*').order('created_at', { ascending: false });
    if (req.query.template === 'true') q = q.eq('is_template', true);
    if (req.query.athlete_id) {
      var ap = await supabase.from('athlete_conditioning_programs')
        .select('program_id').eq('athlete_id', req.query.athlete_id).eq('active', true);
      if (ap.error) throw ap.error;
      var ids = ap.data.map(function(r){ return r.program_id; });
      if (!ids.length) { res.json([]); return; }
      q = q.in('id', ids);
    }
    var r = await q;
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/conditioning-programs', async function(req, res) {
  try {
    var b = req.body;
    var r = await supabase.from('conditioning_programs').insert({
      name: b.name,
      weeks: b.weeks || 4,
      mode: b.mode || 'assault_bike',
      is_template: b.is_template || false,
      notes: b.notes || null,
    }).select();
    if (r.error) throw r.error;
    var prog = r.data[0];

    // Auto-create week slots
    var weekRows = [];
    for (var w = 1; w <= prog.weeks; w++) {
      weekRows.push({ program_id: prog.id, week_number: w, phase: null });
    }
    await supabase.from('conditioning_program_weeks').insert(weekRows);

    res.json(prog);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conditioning-programs/:id/weeks', async function(req, res) {
  try {
    var r = await supabase.from('conditioning_program_weeks')
      .select('*, session_a:conditioning_protocols!conditioning_program_weeks_session_a_protocol_id_fkey(*), session_b:conditioning_protocols!conditioning_program_weeks_session_b_protocol_id_fkey(*)')
      .eq('program_id', req.params.id)
      .order('week_number');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/conditioning-program-weeks/:id', async function(req, res) {
  try {
    var b = req.body;
    var updates = {};
    if (b.phase !== undefined) updates.phase = b.phase;
    if (b.session_a_protocol_id !== undefined) updates.session_a_protocol_id = b.session_a_protocol_id;
    if (b.session_a_custom !== undefined) updates.session_a_custom = b.session_a_custom;
    if (b.session_b_protocol_id !== undefined) updates.session_b_protocol_id = b.session_b_protocol_id;
    if (b.session_b_custom !== undefined) updates.session_b_custom = b.session_b_custom;
    if (b.notes !== undefined) updates.notes = b.notes;
    var r = await supabase.from('conditioning_program_weeks').update(updates).eq('id', req.params.id).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/conditioning-programs/:id/assign', async function(req, res) {
  try {
    var r = await supabase.from('athlete_conditioning_programs').upsert({
      athlete_id: req.body.athlete_id,
      program_id: req.params.id,
      active: true,
    }, { onConflict: 'athlete_id,program_id' });
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/conditioning-programs/:id/copy', async function(req, res) {
  try {
    var srcId = req.params.id;
    var srcR = await supabase.from('conditioning_programs').select('*').eq('id', srcId).single();
    if (srcR.error) throw srcR.error;
    var src = srcR.data;

    var newR = await supabase.from('conditioning_programs').insert({
      name: req.body.name || src.name + ' (copy)',
      weeks: src.weeks, mode: src.mode,
      is_template: req.body.as_template || false,
      notes: src.notes,
    }).select();
    if (newR.error) throw newR.error;
    var newProg = newR.data[0];

    // Copy weeks
    var weeksR = await supabase.from('conditioning_program_weeks').select('*').eq('program_id', srcId).order('week_number');
    if (weeksR.error) throw weeksR.error;
    var newWeeks = weeksR.data.map(function(w) {
      return {
        program_id: newProg.id,
        week_number: w.week_number,
        phase: w.phase,
        session_a_protocol_id: w.session_a_protocol_id,
        session_a_custom: w.session_a_custom,
        session_b_protocol_id: w.session_b_protocol_id,
        session_b_custom: w.session_b_custom,
        notes: w.notes,
      };
    });
    if (newWeeks.length) await supabase.from('conditioning_program_weeks').insert(newWeeks);

    // Assign to athlete if provided
    if (req.body.athlete_id) {
      await supabase.from('athlete_conditioning_programs').upsert({
        athlete_id: req.body.athlete_id,
        program_id: newProg.id,
        active: true,
      }, { onConflict: 'athlete_id,program_id' });
    }

    res.json(newProg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/conditioning-programs/:id', async function(req, res) {
  try {
    await supabase.from('conditioning_program_weeks').delete().eq('program_id', req.params.id);
    await supabase.from('athlete_conditioning_programs').delete().eq('program_id', req.params.id);
    var r = await supabase.from('conditioning_programs').delete().eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.post('/api/conditioning-programs/:id/autofill', async function(req, res) {
  try {
    var progId = req.params.id;
    var progR = await supabase.from('conditioning_programs').select('*').eq('id', progId).single();
    if (progR.error) throw progR.error;
    var prog = progR.data;

    // Get all protocols
    var protsR = await supabase.from('conditioning_protocols').select('*');
    if (protsR.error) throw protsR.error;
    var prots = protsR.data;
    var byName = {};
    prots.forEach(function(p){ byName[p.name] = p.id; });

    // Template maps per mode
    var templates = {
      assault_bike: [
        {wk:1, phase:'Base', a:'Continuous aerobic 20 min', b:'Continuous aerobic 20 min', notes:'Conversational pace only'},
        {wk:2, phase:'Base', a:'Continuous aerobic 30 min', b:'Long intervals 3×8 min', notes:'Aerobic development'},
        {wk:3, phase:'Build', a:'OFF-ICE 30:30 × 10 reps × 2 sets', b:'Continuous aerobic 20 min', notes:'First 30:30 exposure'},
        {wk:4, phase:'Build', a:'OFF-ICE 30:30 × 12 reps × 2 sets', b:'OFF-ICE 30:15 × 10 reps × 2 sets', notes:'30:15 preview — test MAP'},
        {wk:5, phase:'July 1', a:'OFF-ICE 30:30 × 10 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'VIFT test before session'},
        {wk:6, phase:'July 2', a:'OFF-ICE 30:30 × 12 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'Volume step'},
        {wk:7, phase:'July 3', a:'OFF-ICE 30:30 × 14 reps × 2 sets', b:'OFF-ICE 30:15 × 10 reps × 2 sets', notes:'Peak off-ice volume'},
        {wk:8, phase:'July 4', a:'OFF-ICE 30:15 × 10 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'Retest MAP'},
        {wk:9, phase:'Sprint Intro', a:'Assault Bike 5 cal × 12 rounds', b:'Easy flush bike 15–20 min', notes:'Max effort each sprint — full rest'},
        {wk:10, phase:'Sprint Vol', a:'Assault Bike 6 cal × 14 rounds', b:'Easy flush bike 15–20 min', notes:'Add 1 cal and 2 rounds'},
        {wk:11, phase:'Sprint Vol', a:'Assault Bike 8 cal × 12 rounds', b:'Sled + 5 cal AMRAP circuit', notes:'Blue recovery between sprints'},
        {wk:12, phase:'Sprint Build', a:'Assault Bike 8 cal × 12 rounds', b:'Assault Bike 30 cal × 3 rounds', notes:'30 cal introduced — time each set'},
        {wk:13, phase:'Sprint Peak', a:'Assault Bike 10 cal × 12 rounds', b:'Assault Bike 30 cal × 3 rounds', notes:'Highest sprint volume week'},
        {wk:14, phase:'Sprint Peak', a:'Assault Bike 10 cal × 12 rounds', b:'Assault Bike 35 cal × 2 rounds', notes:'35 cal max effort — honest pace'},
        {wk:15, phase:'Complex', a:'Assault Bike 30/35 cal complex', b:'MB shuffle/slam circuit', notes:'Most complex session — gut check'},
        {wk:16, phase:'Complex', a:'Assault Bike 30/35 cal complex', b:'.5 mile repeats', notes:'Complex format + aerobic power'},
        {wk:17, phase:'Peak', a:'Assault Bike 35 cal × 2 rounds', b:'MB shuffle/slam circuit', notes:'Peak lactic output week'},
        {wk:18, phase:'Peak', a:'Assault Bike 30/35 cal complex', b:'Easy flush bike 15–20 min', notes:'Final complex session'},
        {wk:19, phase:'On-Ice', a:'ON-ICE Lactic Power', b:'Easy flush bike 15–20 min', notes:'Maximum lactic output — 2 days rest after'},
        {wk:20, phase:'Taper', a:'ON-ICE Taper 30:15 × 8 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'Volume -35% · intensity maintained · retest VIFT'},
      ],
      watt_bike: [
        {wk:1, phase:'Base', a:'Watt Bike Z2 Steady State', b:'Watt Bike Z2 Steady State', notes:'FTP test before Week 1'},
        {wk:2, phase:'Base', a:'Watt Bike Z2 Steady State', b:'Watt Bike Z3 Tempo', notes:'Aerobic + threshold intro'},
        {wk:3, phase:'Build', a:'Watt Bike 4×4 Intervals', b:'Watt Bike Z2 Steady State', notes:'First VO2max stimulus'},
        {wk:4, phase:'Build', a:'Watt Bike 4×4 Intervals', b:'Watt Bike 8×2 Intervals', notes:'Two interval formats'},
        {wk:5, phase:'MAP', a:'Watt Bike 30:30 × 10 × 2', b:'Watt Bike Z2 Steady State', notes:'MAP phase begins'},
        {wk:6, phase:'MAP', a:'Watt Bike 30:30 × 10 × 2', b:'Watt Bike 8×2 Intervals', notes:'Volume step'},
        {wk:7, phase:'MAP', a:'Watt Bike 30:15 × 10 × 2', b:'Watt Bike 4×4 Intervals', notes:'30:15 introduced'},
        {wk:8, phase:'MAP Peak', a:'Watt Bike 30:15 × 10 × 2', b:'Watt Bike Z3 Tempo', notes:'Retest FTP'},
        {wk:9, phase:'Sprint', a:'Watt Bike 6s Sprint × 8', b:'Watt Bike Z2 Steady State', notes:'Neuromuscular — full rest'},
        {wk:10, phase:'Sprint', a:'Watt Bike 6s Sprint × 8', b:'Watt Bike 30:30 × 10 × 2', notes:'Sprint + MAP combo'},
        {wk:11, phase:'Sprint Build', a:'Watt Bike Wingate 30s × 3', b:'Watt Bike 30:15 × 10 × 2', notes:'Anaerobic capacity'},
        {wk:12, phase:'Sprint Build', a:'Watt Bike Wingate 30s × 3', b:'Watt Bike 4×4 Intervals', notes:'Peak sprint volume'},
        {wk:13, phase:'Peak', a:'Watt Bike Tabata', b:'Watt Bike 30:15 × 10 × 2', notes:'Supramaximal + MAP'},
        {wk:14, phase:'Peak', a:'Watt Bike Tabata', b:'Watt Bike Wingate 30s × 3', notes:'Peak intensity week'},
        {wk:15, phase:'Taper', a:'Watt Bike 30:15 × 10 × 2', b:'Watt Bike Z2 Steady State', notes:'Volume -30% · intensity held'},
        {wk:16, phase:'Taper', a:'Watt Bike 4×4 Intervals', b:'Watt Bike Z2 Steady State', notes:'Maintain sharpness'},
      ],
      ski_erg: [
        {wk:1, phase:'Base', a:'Ski Erg Z2 Continuous', b:'Ski Erg Z2 Continuous', notes:'4-min test before Week 1'},
        {wk:2, phase:'Base', a:'Ski Erg Z2 Continuous', b:'Ski Erg 1000m × 4 Intervals', notes:'Threshold intro'},
        {wk:3, phase:'Build', a:'Ski Erg 500m × 6 Intervals', b:'Ski Erg Z2 Continuous', notes:'Pace work begins'},
        {wk:4, phase:'Build', a:'Ski Erg 500m × 6 Intervals', b:'Ski Erg 1000m × 4 Intervals', notes:'Volume build'},
        {wk:5, phase:'MAP', a:'Ski Erg 30:30 × 8 × 2', b:'Ski Erg Z2 Continuous', notes:'MAP phase'},
        {wk:6, phase:'MAP', a:'Ski Erg 30:30 × 8 × 2', b:'Ski Erg 500m × 6 Intervals', notes:'MAP + threshold combo'},
        {wk:7, phase:'MAP', a:'Ski Erg 20:10 × 10 × 2', b:'Ski Erg 1000m × 4 Intervals', notes:'20:10 introduced'},
        {wk:8, phase:'Peak', a:'Ski Erg 10s Pulls × 10', b:'Ski Erg 20:10 × 10 × 2', notes:'Peak power + MAP'},
        {wk:9, phase:'Taper', a:'Ski Erg 500m × 6 Intervals', b:'Ski Erg Z2 Continuous', notes:'Volume -30%'},
      ],
      running: [
        {wk:1, phase:'Base', a:'Running Z2 Easy', b:'Running Z2 Easy', notes:'1.5-mile test before Week 1'},
        {wk:2, phase:'Base', a:'Running Z2 Easy', b:'Running Tempo 20 min', notes:'Threshold intro'},
        {wk:3, phase:'Build', a:'Running 800m × 6', b:'Running Z2 Easy', notes:'VO2max pace work'},
        {wk:4, phase:'Build', a:'Running 800m × 6', b:'Running Tempo 20 min', notes:'Volume step'},
        {wk:5, phase:'Speed', a:'Running 400m × 10', b:'Running Z2 Easy', notes:'Speed endurance'},
        {wk:6, phase:'Speed', a:'Running 400m × 10', b:'Running Hill Repeats 8×', notes:'Power + speed'},
        {wk:7, phase:'Peak', a:'Running 200m × 12', b:'Running 800m × 6', notes:'Speed + VO2max combo'},
        {wk:8, phase:'Peak', a:'Running 400m × 10', b:'Running Tempo 20 min', notes:'Peak running week'},
        {wk:9, phase:'Taper', a:'Running 800m × 6', b:'Running Z2 Easy', notes:'Volume -30%'},
      ],
      slideboard: [
        {wk:1, phase:'Base', a:'Slideboard Continuous 20 min', b:'Slideboard Continuous 20 min', notes:'Foundation — hip ADD activation'},
        {wk:2, phase:'Base', a:'Slideboard Continuous 20 min', b:'Slideboard 30:30 × 10 × 2', notes:'First interval exposure'},
        {wk:3, phase:'Build', a:'Slideboard 30:30 × 10 × 2', b:'Slideboard Continuous 20 min', notes:'Interval focus'},
        {wk:4, phase:'Build', a:'Slideboard 30:30 × 10 × 2', b:'Slideboard 15:15 × 12 × 2', notes:'15:15 introduced'},
        {wk:5, phase:'Peak', a:'Slideboard 15:15 × 12 × 2', b:'Slideboard 30:30 × 10 × 2', notes:'Peak slideboard volume'},
        {wk:6, phase:'Peak', a:'Slideboard Lactic 45s × 6', b:'Slideboard 15:15 × 12 × 2', notes:'Lactic capacity'},
        {wk:7, phase:'Taper', a:'Slideboard 30:30 × 10 × 2', b:'Slideboard Continuous 20 min', notes:'Volume -30%'},
      ],
      on_ice: [
        {wk:1, phase:'July 1', a:'ON-ICE 30:30 × 10 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'VIFT test before session'},
        {wk:2, phase:'July 2', a:'ON-ICE 30:30 × 12 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'Volume step'},
        {wk:3, phase:'July 3', a:'ON-ICE Mixed 30:30+30:15', b:'Easy flush bike 15–20 min', notes:'30:15 intro'},
        {wk:4, phase:'July 4', a:'ON-ICE 30:15 × 10 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'Retest VIFT'},
        {wk:5, phase:'Aug 1', a:'ON-ICE 30:15 × 10 reps × 2 sets', b:'ON-ICE 30:30 × 10 reps × 2 sets', notes:'Both days on-ice'},
        {wk:6, phase:'Aug 2', a:'ON-ICE 30:15 × 12 reps × 2 sets', b:'ON-ICE 30:30 × 12 reps × 2 sets', notes:'Volume step'},
        {wk:7, phase:'Aug 3', a:'ON-ICE 30:15 × 12 reps × 2 sets', b:'ON-ICE 30:15 × 10 reps × 2 sets', notes:'Both days 30:15'},
        {wk:8, phase:'Aug Peak', a:'ON-ICE 30:15 × 12 reps × 3 sets', b:'ON-ICE 30:15 × 10 reps × 2 sets', notes:'Retest VIFT · peak load'},
        {wk:9, phase:'Taper', a:'ON-ICE Taper 30:15 × 8 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'Volume -35% · intensity held'},
      ],
      mixed: [
        {wk:1, phase:'Base', a:'Continuous aerobic 20 min', b:'Slideboard Continuous 20 min', notes:'Multi-modal base'},
        {wk:2, phase:'Base', a:'Mixed: Assault Bike + Slideboard', b:'Running Z2 Easy', notes:'Cross-modal aerobic'},
        {wk:3, phase:'Build', a:'OFF-ICE 30:30 × 10 reps × 2 sets', b:'Slideboard 30:30 × 10 × 2', notes:'MAP on two modalities'},
        {wk:4, phase:'Build', a:'Mixed: Ski Erg + Assault Bike', b:'Running 800m × 6', notes:'Full body MAP + running'},
        {wk:5, phase:'MAP', a:'OFF-ICE 30:30 × 12 reps × 2 sets', b:'Mixed: Run + Slideboard', notes:'Peak MAP volume'},
        {wk:6, phase:'MAP', a:'Watt Bike 30:30 × 10 × 2', b:'Slideboard 15:15 × 12 × 2', notes:'Watt bike + slideboard'},
        {wk:7, phase:'Sprint', a:'Assault Bike 8 cal × 12 rounds', b:'Mixed: Assault Bike + Slideboard', notes:'Sprint + aerobic combo'},
        {wk:8, phase:'Sprint', a:'Assault Bike 30 cal × 3 rounds', b:'Running 400m × 10', notes:'Lactic + speed endurance'},
        {wk:9, phase:'Peak', a:'Mixed: On-Ice + Bike Flush', b:'Assault Bike 35 cal × 2 rounds', notes:'On-ice + max sprint'},
        {wk:10, phase:'Taper', a:'ON-ICE Taper 30:15 × 8 reps × 2 sets', b:'Easy flush bike 15–20 min', notes:'Volume -35% · arrive fresh'},
      ],
    };

    var plan = templates[prog.mode] || [];
    var weeks = prog.weeks;

    // Pad or trim to match program length
    while (plan.length < weeks) {
      plan.push({ wk: plan.length+1, phase: 'Maintenance', a: null, b: null, notes: 'Coach to assign' });
    }
    plan = plan.slice(0, weeks);

    // Get existing week rows
    var wkR = await supabase.from('conditioning_program_weeks').select('id,week_number').eq('program_id', progId).order('week_number');
    if (wkR.error) throw wkR.error;

    // Update each week
    for (var i = 0; i < wkR.data.length; i++) {
      var wk = wkR.data[i];
      var tpl = plan.find(function(p){ return p.wk === wk.week_number; });
      if (!tpl) continue;
      await supabase.from('conditioning_program_weeks').update({
        phase: tpl.phase || null,
        session_a_protocol_id: tpl.a ? (byName[tpl.a] || null) : null,
        session_a_custom: null,
        session_b_protocol_id: tpl.b ? (byName[tpl.b] || null) : null,
        session_b_custom: null,
        notes: tpl.notes || null,
      }).eq('id', wk.id);
    }

    res.json({ ok: true, filled: plan.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// ============================================================
// CONDITIONING — ADVANCED ROUTES
// ============================================================

// Squad assign — assign one program to multiple athletes
app.post('/api/conditioning-programs/:id/squad-assign', async function(req, res) {
  try {
    var progId = req.params.id;
    var athleteIds = req.body.athlete_ids || [];
    var startDate = req.body.start_date || null;
    var startWeek = req.body.start_week || 1;

    if (startDate) {
      await supabase.from('conditioning_programs').update({ start_date: startDate, current_week: startWeek }).eq('id', progId);
    }

    var results = { assigned: [], errors: [] };
    for (var i = 0; i < athleteIds.length; i++) {
      var aid = athleteIds[i];
      var r1 = await supabase.from('athlete_conditioning_programs').upsert({
        athlete_id: aid, program_id: progId, active: true
      }, { onConflict: 'athlete_id,program_id' });
      var r2 = await supabase.from('conditioning_squad_assignments').upsert({
        program_id: progId, athlete_id: aid,
        assigned_date: startDate || new Date().toISOString().split('T')[0],
        start_week: startWeek,
      }, { onConflict: 'program_id,athlete_id' });
      if (r1.error || r2.error) results.errors.push(aid);
      else results.assigned.push(aid);
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get current week for athlete based on start_date
app.get('/api/conditioning-programs/:id/current-week', async function(req, res) {
  try {
    var progId = req.params.id;
    var athleteId = req.query.athlete_id;

    var progR = await supabase.from('conditioning_programs').select('*').eq('id', progId).single();
    if (progR.error) throw progR.error;
    var prog = progR.data;

    var currentWeek = prog.current_week || 1;
    if (prog.start_date) {
      var start = new Date(prog.start_date);
      var now = new Date();
      var diffMs = now - start;
      var diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
      currentWeek = Math.min(Math.max(1, diffWeeks + 1), prog.weeks);
    }

    // Get the week data
    var wkR = await supabase.from('conditioning_program_weeks')
      .select('*, session_a:conditioning_protocols!conditioning_program_weeks_session_a_protocol_id_fkey(*), session_b:conditioning_protocols!conditioning_program_weeks_session_b_protocol_id_fkey(*)')
      .eq('program_id', progId).eq('week_number', currentWeek).single();

    // Get completion logs for this week
    var logs = { a: null, b: null };
    if (wkR.data && athleteId) {
      var logR = await supabase.from('conditioning_session_logs')
        .select('*').eq('week_id', wkR.data.id).eq('athlete_id', athleteId);
      if (!logR.error) {
        logR.data.forEach(function(l) { logs[l.slot] = l; });
      }
    }

    res.json({ current_week: currentWeek, week_data: wkR.data || null, logs: logs, program: prog });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Log a completed session
app.post('/api/conditioning-logs', async function(req, res) {
  try {
    var b = req.body;
    var r = await supabase.from('conditioning_session_logs').insert({
      athlete_id: b.athlete_id,
      program_id: b.program_id || null,
      week_id: b.week_id || null,
      session_date: b.session_date || new Date().toISOString().split('T')[0],
      slot: b.slot || 'a',
      status: b.status || 'completed',
      rpe: b.rpe || null,
      actual_protocol: b.actual_protocol || null,
      notes: b.notes || null,
    }).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get logs for a program/athlete
app.get('/api/conditioning-logs', async function(req, res) {
  try {
    var q = supabase.from('conditioning_session_logs')
      .select('*, athletes(first_name, last_name)')
      .order('session_date', { ascending: false });
    if (req.query.athlete_id) q = q.eq('athlete_id', req.query.athlete_id);
    if (req.query.program_id) q = q.eq('program_id', req.query.program_id);
    if (req.query.week_id) q = q.eq('week_id', req.query.week_id);
    var r = await q;
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dashboard conditioning summary — current week status per athlete


// Print conditioning program
app.get('/api/conditioning-programs/:id/print', async function(req, res) {
  try {
    var progR = await supabase.from('conditioning_programs').select('*').eq('id', req.params.id).single();
    if (progR.error) throw progR.error;

    var weeksR = await supabase.from('conditioning_program_weeks')
      .select('*, session_a:conditioning_protocols!conditioning_program_weeks_session_a_protocol_id_fkey(*), session_b:conditioning_protocols!conditioning_program_weeks_session_b_protocol_id_fkey(*)')
      .eq('program_id', req.params.id).order('week_number');
    if (weeksR.error) throw weeksR.error;

    res.json({ program: progR.data, weeks: weeksR.data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Workout builder conditioning day — get protocol for athlete + week



// ============================================================
// ATHLETE MANAGEMENT
// ============================================================

app.post('/api/athletes', async function(req, res) {
  try {
    var b = req.body;
    var r = await supabase.from('athletes').insert({
      first_name: b.first_name,
      last_name: b.last_name,
      position: b.position || null,
      sport: b.sport || 'Hockey',
      jersey_number: b.jersey_number ? String(b.jersey_number) : null,
      date_of_birth: b.date_of_birth || null,
      load_status: b.load_status || 'Normal',
      notes: b.notes || null,
      height_cm: b.height_cm || null,
      weight_kg: b.weight_kg || null,
    }).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/athletes/:id', async function(req, res) {
  try {
    var b = req.body;
    var updates = {};
    ['first_name','last_name','position','sport','jersey_number','date_of_birth',
     'load_status','notes','height_cm','weight_kg'].forEach(function(k) {
      if (b[k] !== undefined) updates[k] = b[k];
    });
    var r = await supabase.from('athletes').update(updates).eq('id', req.params.id).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/athletes/:id', async function(req, res) {
  try {
    var r = await supabase.from('athletes').delete().eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/athletes/:id', async function(req, res) {
  try {
    var r = await supabase.from('athletes').select('*').eq('id', req.params.id).single();
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// LOAD RECORDS
// ============================================================

app.post('/api/loads', async function(req, res) {
  try {
    var b = req.body;
    var r = await supabase.from('load_records').insert({
      athlete_id: b.athlete_id,
      session_date: b.session_date,
      session_type: b.session_type || null,
      session_name: b.session_name || b.session_type || null,
      rpe: b.rpe || null,
      duration_min: b.duration_min || null,
      session_load: b.rpe && b.duration_min ? b.rpe * b.duration_min : b.session_load || null,
      total_distance_m: b.total_distance_m || null,
      source: 'manual',
    }).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/loads', async function(req, res) {
  try {
    var q = supabase.from('load_records')
      .select('*, athletes(first_name, last_name)')
      .order('session_date', { ascending: false });
    if (req.query.athlete_id) q = q.eq('athlete_id', req.query.athlete_id);
    if (req.query.days) {
      var cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(req.query.days));
      q = q.gte('session_date', cutoff.toISOString().split('T')[0]);
    }
    q = q.limit(200);
    var r = await q;
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/loads/:id', async function(req, res) {
  try {
    var r = await supabase.from('load_records').delete().eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// FLAGS — CREATE + BULK RESOLVE
// ============================================================

app.post('/api/flags', async function(req, res) {
  try {
    var b = req.body;
    var r = await supabase.from('athlete_flags').insert({
      athlete_id: b.athlete_id,
      message: b.message,
      severity: b.severity || 'warning',
      flag_type: b.flag_type || 'manual',
    }).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/flags/resolve-all', async function(req, res) {
  try {
    var athleteId = req.body.athlete_id;
    var q = supabase.from('athlete_flags').update({ resolved: true, resolved_at: new Date().toISOString() });
    if (athleteId) q = q.eq('athlete_id', athleteId);
    else q = q.eq('resolved', false);
    var r = await q;
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// PROGRAMS — DELETE + RENAME
// ============================================================

app.delete('/api/programs/:id', async function(req, res) {
  try {
    var progId = req.params.id;
    // Get all days
    var daysR = await supabase.from('program_days').select('id').eq('program_id', progId);
    if (!daysR.error && daysR.data.length) {
      for (var i = 0; i < daysR.data.length; i++) {
        var blocksR = await supabase.from('workout_blocks').select('id').eq('day_id', daysR.data[i].id);
        if (!blocksR.error && blocksR.data.length) {
          for (var j = 0; j < blocksR.data.length; j++) {
            var exsR = await supabase.from('workout_exercises').select('id').eq('block_id', blocksR.data[j].id);
            if (!exsR.error && exsR.data.length) {
              for (var k = 0; k < exsR.data.length; k++) {
                await supabase.from('workout_progressions').delete().eq('workout_exercise_id', exsR.data[k].id);
              }
            }
            await supabase.from('workout_exercises').delete().eq('block_id', blocksR.data[j].id);
          }
        }
        await supabase.from('workout_blocks').delete().eq('day_id', daysR.data[i].id);
      }
    }
    await supabase.from('program_days').delete().eq('program_id', progId);
    await supabase.from('athlete_programs').delete().eq('program_id', progId);
    var r = await supabase.from('programs').delete().eq('id', progId);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/programs/:id', async function(req, res) {
  try {
    var r = await supabase.from('programs').update({ name: req.body.name }).eq('id', req.params.id).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});





// ============================================================
// VIDEO MANAGEMENT
// ============================================================

// Bulk import videos from Google Drive share links
app.post('/api/videos/import', async function(req, res) {
  try {
    var links = req.body.links || [];
    var results = { matched: [], unmatched: [], errors: [] };

    // Get all exercises
    var exR = await supabase.from('exercises').select('id, name');
    if (exR.error) throw exR.error;
    var exercises = exR.data;

    for (var i = 0; i < links.length; i++) {
      var link = links[i].trim();
      if (!link) continue;

      // Extract file ID from Drive or YouTube URL
      var built0 = buildEmbedUrl(link);
      var fileId = built0.fileId;
      if (!built0.embedUrl) { results.errors.push(link); continue; }

      // Get filename from Drive
      var fileName = req.body.names ? req.body.names[i] : null;
      if (!fileName) {
        // Try to fetch the page title
        try {
          var https = require('https');
          fileName = await new Promise(function(resolve) {
            var url = 'https://drive.google.com/file/d/'+fileId+'/view';
            https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(resp) {
              var data = '';
              resp.on('data', function(chunk){ data += chunk; });
              resp.on('end', function(){
                var titleMatch = data.match(/<title>([^<]+) - Google Drive<\/title>/);
                if (titleMatch) {
                  var name = titleMatch[1].trim().replace(/\.MOV$/i,'').replace(/\.mp4$/i,'').replace(/\.mov$/i,'').trim();
                  resolve(name);
                } else { resolve(null); }
              });
            }).on('error', function(){ resolve(null); });
          });
        } catch(e) { fileName = null; }
      }

      if (!fileName) { results.errors.push(link); continue; }

      // Clean up filename for matching
      var cleanName = fileName.replace(/\.MOV$/i,'').replace(/\.mp4$/i,'').replace(/\.mov$/i,'').trim().toLowerCase();

      // Find best matching exercise
      var bestMatch = null;
      var bestScore = 0;
      for (var j = 0; j < exercises.length; j++) {
        var exName = exercises[j].name.toLowerCase();
        // Exact match
        if (exName === cleanName) { bestMatch = exercises[j]; bestScore = 1; break; }
        // Strong contains match — one must contain the other substantially
        if (exName.includes(cleanName) || cleanName.includes(exName)) {
          var score = Math.min(exName.length, cleanName.length) / Math.max(exName.length, cleanName.length);
          if (score > bestScore && score >= 0.6) { bestScore = score; bestMatch = exercises[j]; }
        }
        // Word overlap — ALL significant words must match, not just some
        var exWords = exName.split(/\s+/).filter(function(w){ return w.length > 2; });
        var vidWords = cleanName.split(/\s+/).filter(function(w){ return w.length > 2; });
        if (exWords.length > 0 && vidWords.length > 0) {
          var overlap = vidWords.filter(function(w){ return exWords.includes(w); }).length;
          // Require ALL video words to appear in exercise name, or vice versa
          var allVidWordsMatch = overlap === vidWords.length;
          var allExWordsMatch = overlap === exWords.length;
          if (allVidWordsMatch || allExWordsMatch) {
            var score3 = overlap / Math.max(exWords.length, vidWords.length);
            if (score3 > bestScore) { bestScore = score3; bestMatch = exercises[j]; }
          }
        }
      }

      var videoUrl = built0.embedUrl;

      if (bestMatch && bestScore >= 0.4) {
        await supabase.from('exercises').update({
          video_url: videoUrl,
          video_file_id: fileId,
        }).eq('id', bestMatch.id);
        results.matched.push({ file: fileName, exercise: bestMatch.name, score: Math.round(bestScore*100) });
      } else {
        // Store unmatched for manual review
        results.unmatched.push({ file: fileName, fileId: fileId, url: videoUrl });
      }
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manually link a video to an exercise
app.patch('/api/exercises/:id/video', async function(req, res) {
  try {
    var built = buildEmbedUrl(req.body.url);
    var r = await supabase.from('exercises').update({
      video_url: built.embedUrl,
      video_file_id: built.fileId,
    }).eq('id', req.params.id).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get exercises with videos
app.get('/api/exercises/videos', async function(req, res) {
  try {
    var r = await supabase.from('exercises').select('id,name,category,video_url,video_file_id')
      .not('video_url', 'is', null).order('name');
    if (r.error) throw r.error;
    res.json(r.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update exercise with video manually
app.patch('/api/exercises/:id', async function(req, res) {
  try {
    var updates = {};
    if (req.body.video_url !== undefined) {
      if (req.body.video_url) {
        var built = buildEmbedUrl(req.body.video_url);
        updates.video_url = built.embedUrl;
        updates.video_file_id = built.fileId;
      } else {
        updates.video_url = null;
        updates.video_file_id = null;
      }
    }
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.category !== undefined) updates.category = req.body.category;
    var r = await supabase.from('exercises').update(updates).eq('id', req.params.id).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


function buildEmbedUrl(rawUrl) {
  if (!rawUrl) return { embedUrl: null, fileId: null };
  // Google Drive
  var driveMatch = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) {
    return { embedUrl: 'https://drive.google.com/file/d/'+driveMatch[1]+'/preview', fileId: driveMatch[1] };
  }
  // YouTube — youtube.com/watch?v=ID or youtu.be/ID or youtube.com/embed/ID or unlisted shorts
  var ytMatch = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/);
  if (ytMatch) {
    return { embedUrl: 'https://www.youtube.com/embed/'+ytMatch[1], fileId: ytMatch[1] };
  }
  // Fallback — store as-is
  return { embedUrl: rawUrl, fileId: null };
}

app.post('/api/exercises', async function(req, res) {
  try {
    var b = req.body;
    var built = buildEmbedUrl(b.video_url);
    var r = await supabase.from('exercises').insert({
      name: b.name,
      category: b.category || 'Hip',
      equipment: b.equipment || null,
      video_url: built.embedUrl,
      video_file_id: built.fileId,
    }).select();
    if (r.error) throw r.error;
    res.json(r.data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});


app.delete('/api/exercises/:id', async function(req, res) {
  try {
    var r = await supabase.from('exercises').delete().eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

app.patch('/api/workout-exercises/:id', async function(req, res) {
  try {
    var r = await supabase.from('workout_exercises')
      .update({
        exercise_name: req.body.exercise_name,
        sets: req.body.sets !== undefined ? req.body.sets : null,
        tempo: req.body.tempo !== undefined ? req.body.tempo : null,
        rest: req.body.rest !== undefined ? req.body.rest : null,
        notes: req.body.notes !== undefined ? req.body.notes : null,
      })
      .eq('id', req.params.id);
    if (r.error) throw r.error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/workout-progressions/:exId', async function(req, res) {
  try {
    var updates = req.body.weeks;
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      var existing = await supabase.from('workout_progressions')
        .select('id, reps, weight')
        .eq('workout_exercise_id', req.params.exId)
        .eq('week_number', u.week)
        .maybeSingle();
      var reps = u.reps !== undefined ? u.reps : (existing.data ? existing.data.reps : null);
      var weight = u.weight !== undefined ? u.weight : (existing.data ? existing.data.weight : null);
      await supabase.from('workout_progressions').upsert({
        workout_exercise_id: req.params.exId,
        week_number: u.week,
        reps: reps,
        weight: weight,
      }, { onConflict: 'workout_exercise_id,week_number' });
    }
    res.json({ ok: true });
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
