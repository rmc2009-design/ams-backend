require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const MIN_SESSIONS_FOR_NORM = 5;
const OUTLIER_SD_THRESHOLD = 2.5;

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  var m = mean(arr);
  var variance = arr.reduce(function(sum, val) {
    return sum + Math.pow(val - m, 2);
  }, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function removeOutliers(values) {
  if (values.length < 3) return values;
  var m = mean(values);
  var sd = stdDev(values);
  if (sd === 0) return values;
  return values.filter(function(v) {
    return Math.abs(v - m) <= OUTLIER_SD_THRESHOLD * sd;
  });
}

function getFlagColor(asymmetryPct, norm) {
  var abs = Math.abs(asymmetryPct);
  if (norm && norm.session_count >= MIN_SESSIONS_FOR_NORM && norm.std_dev > 0) {
    var sdFromMean = (abs - norm.mean) / norm.std_dev;
    if (sdFromMean > 2) return { color: 'red', reason: 'sd', sd: sdFromMean };
    if (sdFromMean > 1) return { color: 'yellow', reason: 'sd', sd: sdFromMean };
    return { color: 'green', reason: 'sd', sd: sdFromMean };
  }
  if (abs > 15) return { color: 'red', reason: 'threshold', sd: null };
  if (abs > 10) return { color: 'yellow', reason: 'threshold', sd: null };
  return { color: 'green', reason: 'threshold', sd: null };
}

function processSessionReps(rows) {
  var groups = {};
  rows.forEach(function(row) {
    if (!row.exercise || !row.direction || !row.side) return;
    var key = row.exercise + '|' + row.direction;
    if (!groups[key]) groups[key] = { left: [], right: [] };
    var side = row.side.toLowerCase();
    if (side !== 'left' && side !== 'right') return;
    var force = parseFloat(row.peak_force_n) || 0;
    if (force <= 0) return;
    groups[key][side].push(force);
  });

  var results = [];
  Object.keys(groups).forEach(function(key) {
    var parts = key.split('|');
    var exercise = parts[0];
    var direction = parts[1];
    var group = groups[key];

    if (!group.left.length || !group.right.length) return;

    var cleanLeft = removeOutliers(group.left);
    var cleanRight = removeOutliers(group.right);

    if (!cleanLeft.length || !cleanRight.length) return;

    var leftPeak = Math.max.apply(null, cleanLeft);
    var rightPeak = Math.max.apply(null, cleanRight);
    var avg = (leftPeak + rightPeak) / 2;
    var asymmetry = avg > 0 ? ((leftPeak - rightPeak) / avg) * 100 : 0;

    results.push({
      exercise: exercise,
      direction: direction,
      left_peak_force_n: leftPeak,
      right_peak_force_n: rightPeak,
      asymmetry_pct: asymmetry,
      left_rep_count: cleanLeft.length,
      right_rep_count: cleanRight.length,
    });
  });
  return results;
}

async function updateAsymmetryForAthlete(athleteId) {
  var recordsResult = await supabase
    .from('sprint_records')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('session_date', { ascending: true })
    .limit(10000);
  if (recordsResult.error) throw recordsResult.error;
  if (!recordsResult.data.length) return;

var sessions = {};
  recordsResult.data.forEach(function(r) {
    var d = r.session_date;
    if (!sessions[d]) sessions[d] = { rows: [], hasLeft: false, hasRight: false };
    sessions[d].rows.push(r);
    if (r.side && r.side.toLowerCase() === 'left') sessions[d].hasLeft = true;
    if (r.side && r.side.toLowerCase() === 'right') sessions[d].hasRight = true;
  });

  // Only process sessions that have both left and right
  var allDates = Object.keys(sessions).sort();
  var sessionDates = allDates.filter(function(d) {
    return sessions[d].hasLeft && sessions[d].hasRight;
  });
  console.log('Found ' + allDates.length + ' total sessions, ' + sessionDates.length + ' bilateral sessions for athlete ' + athleteId);

  for (var i = 0; i < sessionDates.length; i++) {
    var date = sessionDates[i];
    try {
      var rows = sessions[date].rows;
      var results = processSessionReps(rows);

      for (var j = 0; j < results.length; j++) {
        var result = results[j];

        var normResult = await supabase
          .from('athlete_norms')
          .select('*')
          .eq('athlete_id', athleteId)
          .eq('exercise', result.exercise)
          .eq('direction', result.direction)
          .eq('metric', 'asymmetry_pct')
          .maybeSingle();

        var normData = normResult.data;
        var flag = getFlagColor(result.asymmetry_pct, normData);

        await supabase
          .from('session_asymmetry')
          .upsert({
            athlete_id: athleteId,
            session_date: date,
            exercise: result.exercise,
            direction: result.direction,
            left_peak_force_n: result.left_peak_force_n,
            right_peak_force_n: result.right_peak_force_n,
            asymmetry_pct: result.asymmetry_pct,
            flag_color: flag.color,
            sd_from_norm: flag.sd,
            session_count_at_calc: normData ? normData.session_count : 0,
          }, { onConflict: 'athlete_id,session_date,exercise,direction' });
      }

      await updateNormsForAthlete(athleteId);
      console.log('Processed session ' + date + ' for ' + athleteId);
    } catch (sessionErr) {
      console.error('Failed session ' + date + ' for ' + athleteId + ': ' + sessionErr.message);
    }
  }
}

async function updateNormsForAthlete(athleteId) {
  var result = await supabase
    .from('session_asymmetry')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('session_date', { ascending: false });

  if (result.error || !result.data.length) return;

  var groups = {};
  result.data.forEach(function(s) {
    var key = s.exercise + '|' + s.direction;
    if (!groups[key]) groups[key] = [];
    groups[key].push(Math.abs(s.asymmetry_pct));
  });

  for (var key in groups) {
    var parts = key.split('|');
    var values = groups[key].slice(0, 5);
    var m = mean(values);
    var sd = stdDev(values);

    await supabase
      .from('athlete_norms')
      .upsert({
        athlete_id: athleteId,
        exercise: parts[0],
        direction: parts[1],
        metric: 'asymmetry_pct',
        session_count: values.length,
        mean: m,
        std_dev: sd,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'athlete_id,exercise,direction,metric' });
  }
}

async function getAnalysisData(athleteId) {
  var query = supabase
    .from('session_asymmetry')
    .select('*, athletes(first_name, last_name)')
    .order('session_date', { ascending: false })
    .limit(200);
  if (athleteId) query = query.eq('athlete_id', athleteId);
  var result = await query;
  if (result.error) throw result.error;
  return result.data;
}

async function getNorms(athleteId) {
  var query = supabase
    .from('athlete_norms')
    .select('*, athletes(first_name, last_name)');
  if (athleteId) query = query.eq('athlete_id', athleteId);
  var result = await query;
  if (result.error) throw result.error;
  return result.data;
}

module.exports = {
  updateAsymmetryForAthlete,
  updateNormsForAthlete,
  getAnalysisData,
  getNorms,
  processSessionReps,
  getFlagColor,
};
