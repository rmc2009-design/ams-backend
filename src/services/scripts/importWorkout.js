require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// Parse exercise label like "1A)" -> block "1", order "A"
function parseLabel(name) {
  if (!name) return { block: null, order: null, clean: name };
  var match = name.match(/^(\d+)([A-Za-z])\)/);
  if (match) {
    return {
      block: match[1],
      order: match[2].toUpperCase(),
      clean: name.replace(/^\d+[A-Za-z]\)\s*/, '').trim()
    };
  }
  return { block: null, order: null, clean: name.trim() };
}

// Parse day columns from a row - finds Monday/Wednesday/Friday headers
function findDayColumns(rows) {
  var days = [];
  for (var i = 0; i < Math.min(rows.length, 10); i++) {
    var row = rows[i];
    if (!row) continue;
    var keys = Object.keys(row);
    for (var j = 0; j < keys.length; j++) {
      var val = String(row[keys[j]] || '').trim();
      if (val === 'Monday' || val === 'Wednesday' || val === 'Friday') {
        days.push({ name: val, col: keys[j], rowIndex: i });
      }
    }
  }
  return days;
}

async function importSheet(sheetData, sheetName, programName, athleteName) {
  console.log('Importing sheet: ' + sheetName + ' for ' + (athleteName || 'unknown'));

  // Create or find program
  var progResult = await supabase
    .from('programs')
    .upsert({ name: programName, phase: sheetName }, { onConflict: 'name' })
    .select();
  if (progResult.error) { console.error('Program error:', progResult.error.message); return; }
  var programId = progResult.data[0].id;

  // Find athlete if name provided
  var athleteId = null;
  if (athleteName) {
    var parts = athleteName.trim().split(/\s+/);
    var aResult = await supabase.from('athletes').select('id')
      .ilike('last_name', parts[parts.length - 1] + '%')
      .limit(1);
    if (aResult.data && aResult.data[0]) {
      athleteId = aResult.data[0].id;
      // Link athlete to program
      await supabase.from('athlete_programs').upsert({
        athlete_id: athleteId,
        program_id: programId,
        active: true,
      }, { onConflict: 'athlete_id,program_id' });
    }
  }

  // Process each day
  var days = [
    { name: 'Monday', order: 1 },
    { name: 'Wednesday', order: 2 },
    { name: 'Friday', order: 3 },
    { name: 'Conditioning', order: 4 },
  ];

  for (var d = 0; d < days.length; d++) {
    var day = days[d];
    var dayResult = await supabase
      .from('program_days')
      .upsert({ program_id: programId, day_name: day.name, day_order: day.order, day_type: 'strength' }, { onConflict: 'program_id,day_name' })
      .select();
    if (dayResult.error) continue;
    var dayId = dayResult.data[0].id;

    // Find rows for this day
    var dayRows = [];
    var inDay = false;
    for (var i = 0; i < sheetData.length; i++) {
      var row = sheetData[i];
      var rowVals = Object.values(row).map(function(v) { return String(v || '').trim(); });
      var hasDay = rowVals.includes(day.name);
      var hasNextDay = d < days.length - 1 && rowVals.includes(days[d + 1].name);
      if (hasDay) { inDay = true; continue; }
      if (inDay && hasNextDay) { inDay = false; break; }
      if (inDay) dayRows.push(row);
    }

    // Group exercises into blocks
    var blocks = {};
    var blockOrder = {};
    for (var i = 0; i < dayRows.length; i++) {
      var row = dayRows[i];
      var vals = Object.values(row);
      // Find exercise name - usually in column 1 or 2
      var exName = null;
      for (var j = 0; j < Math.min(vals.length, 4); j++) {
        var v = String(vals[j] || '').trim();
        if (v && v.length > 2) { exName = v; break; }
      }
      if (!exName) continue;

      var parsed = parseLabel(exName);
      var blockKey = parsed.block || 'misc';
      if (!blocks[blockKey]) {
        blocks[blockKey] = [];
        blockOrder[blockKey] = Object.keys(blocks).length;
      }
      blocks[blockKey].push({
        name: parsed.clean || exName,
        order: parsed.order,
        row: row,
        vals: vals,
      });
    }

    // Save blocks and exercises
    for (var blockKey in blocks) {
      var blockExercises = blocks[blockKey];
      var blockResult = await supabase
        .from('workout_blocks')
        .upsert({
          day_id: dayId,
          block_label: blockKey,
          block_order: blockOrder[blockKey],
          block_type: blockKey === 'misc' ? 'straight' : 'superset',
        }, { onConflict: 'day_id,block_label' })
        .select();
      if (blockResult.error) continue;
      var blockId = blockResult.data[0].id;

      for (var e = 0; e < blockExercises.length; e++) {
        var ex = blockExercises[e];
        var vals = ex.vals;

        // Extract sets, tempo, rest from columns
        var sets = null, tempo = null, rest = null;
        for (var v = 0; v < vals.length; v++) {
          var val = String(vals[v] || '').trim();
          if (!sets && val && parseFloat(val) >= 1 && parseFloat(val) <= 10 && val.length <= 4) sets = parseFloat(val);
          if (!tempo && val.match(/^\d+[\./]\d+/) ) tempo = val;
          if (!rest && val.match(/^:?\d+$/) && parseInt(val.replace(':','')) <= 300) rest = val;
        }

        var exResult = await supabase
          .from('workout_exercises')
          .upsert({
            block_id: blockId,
            exercise_name: ex.name,
            exercise_order: e + 1,
            sets: sets,
            tempo: tempo,
            rest: rest,
          }, { onConflict: 'block_id,exercise_name' })
          .select();
        if (exResult.error) continue;
        var exId = exResult.data[0].id;

        // Extract week progressions - look for rep/weight pairs
        var weekData = [];
        var numVals = vals.filter(function(v) { return v && String(v).trim().length > 0; });
        for (var w = 1; w <= 4; w++) {
          var repIdx = (w - 1) * 2 + 5;
          var reps = vals[repIdx] ? String(vals[repIdx]).trim() : null;
          var wt = vals[repIdx + 1] ? String(vals[repIdx + 1]).trim() : null;
          if (reps) {
            await supabase.from('workout_progressions').upsert({
              workout_exercise_id: exId,
              week_number: w,
              reps: reps,
              weight: wt,
            }, { onConflict: 'workout_exercise_id,week_number' });
          }
        }
      }
    }
  }
  console.log('Done: ' + sheetName);
}

async function importFile(filePath) {
  const wb = XLSX.readFile(filePath);
  for (var i = 0; i < wb.SheetNames.length; i++) {
    var sheetName = wb.SheetNames[i];
    var ws = wb.Sheets[sheetName];
    var data = XLSX.utils.sheet_to_json(ws, { defval: '' });
    var programName = require('path').basename(filePath, '.xlsx') + ' - ' + sheetName;
    await importSheet(data, sheetName, programName, sheetName);
  }
  console.log('Import complete');
}

var file = process.argv[2];
if (!file) { console.error('Usage: node scripts/importWorkout.js <file.xlsx>'); process.exit(1); }
importFile(file).catch(console.error);
