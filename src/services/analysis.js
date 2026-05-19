const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const MIN_SESSIONS_FOR_NORM = 5;
const OUTLIER_SD_THRESHOLD = 2.5;

/**
 * Calculate mean of an array
 */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length;
}

/**
 * Calculate standard deviation of an array
 */
function stdDev(arr) {
  if (arr.length < 2) return 0;
  var m = mean(arr);
  var variance = arr.reduce(function(sum, val) {
    return sum + Math.pow(val - m, 2);
  }, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Remove outliers using SD method
 */
function removeOutliers(values) {
  if (values.length < 3) return values;
  var m = mean(values);
  var sd = stdDev(values);
  if (sd === 0) return values;
  return values.filter(function(v) {
    return Math.abs(v - m) <= OUTLIER_SD_THRESHOLD * sd;
  });
}

/**
 * Determine flag color based on asymmetry and athlete norm
 */
function getFlagColor(asymmetryPct, norm) {
  var abs = Math.abs(asymmetryPct);

  // If we have a norm with enough sessions, use SD-based thresholds
  if (norm && norm.session_count >= MIN_SESSIONS_FOR_NORM && norm.std_dev > 0) {
    var sdFromMean = (abs - norm.mean) / norm.std_dev;
    if (sdFromMean > 2) return { color: 'red', reason: 'sd', sd: sdFromMean };
    if (sdFromMean > 1) return { color: 'yellow', reason: 'sd', sd: sdFromMean };
    return { color: 'green', reason: 'sd', sd: sdFromMean };
  }

  // Fall back to population thresholds
  if (abs > 15) return { color: 'red', reason: 'threshold', sd: null };
  if (abs > 10) return { color: 'yellow', reason: 'threshold', sd: null };
  return { color: 'green', reason: 'threshold', sd: null };
}

/**
 * Process a session's raw sprint_records rows into L/R asymmetry.
 * Groups by exercise + direction, combines machines, removes outliers,
 * picks highest valid peak force per side.
 */
function processSessionReps(rows) {
  // Group by exercise + direction + side
  var groups = {};
  rows.forEach(function(row) {
    if (!row.exercise || !row.direction || !row.side) return;
    var key = row.exercise + '|' + row.direction;
    if (!groups[key]) groups[key] = { left: {}, right: {} };
    var side = row.side.toLowerCase();
    if (side !== 'left' && side !== 'right') return;

    // Group by rep number to combine machines
    var repKey = (row.set_number || 0) + '_' + (row.rep_number || 0);
    if (!groups[key][side][repKey]) groups[key][side][repKey] = 0;
    groups[key][side][repKey] += parseFloat(row.peak_force_n) || 0;
  });

  var results = [];
  Object.keys(groups).forEach(function(key) {
    var parts = key.split('|');
    var exercise = parts[0];
    var direction = parts[1];
    var group = groups[key];

    // Get combined force values per rep for each side
    var leftValues = Object.values(group.left).filter(function(v) { return v > 0; });
    var rightValues = Object.values(group.right).filter(function(v) { return v > 0; });

    if (!leftValues.length || !rightValues.length) return;

    // Remove outliers
    var cleanLeft = removeOutliers(leftValues);
    var cleanRight = removeOutliers(rightValues);

    if (!cleanLeft.length || !cleanRight.length) return;

    // Take highest valid peak force per side
    var leftPeak = Math.max.apply(null, cleanLeft);
    var rightPeak = Math.max.apply(null, cleanRight);

    // Calculate asymmetry
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

/**
 * Get or calculate session asymmetry for all athletes.
 * Called after import to update the analysis tables.
 */
async function updateAsymmetryForAthlete(athleteId) {
  // Get all sprint records for this athlete grouped by session date
  const { data: records, error } = await supabase
    .from('sprint_records')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('session_date', { ascending: true });

  if (error) throw error;
  if (!records.length) return;

  // Group by session date
  var sessions = {};
  records.forEach(function(r) {
    var d = r.session_date;
    if (!sessions[d]) sessions[d] = [];
    sessions[d].push(r);
  });

  var sessionDates = Object.keys(sessions).sort();

  for (var i = 0; i < sessionDates.length; i++) {
    var date = sessionDates[i];
    try {
      var rows = sessions[date];
      var results = processSessionReps(rows);

      for (var j = 0; j < results.length; j++) {
        var result = results[j];

        const { data: normData } = await supabase
          .from('athlete_norms')
          .select('*')
          .eq('athlete_id', athleteId)
          .eq('exercise', result.exercise)
          .eq('direction', result.direction)
          .eq('metric', 'asymmetry_pct')
          .maybeSingle();

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
      console.log('Processed session ' + date + ' for athlete ' + athleteId);
    } catch (sessionErr) {
      console.error('Failed session ' + date + ' for athlete ' + athleteId + ': ' + sessionErr.message);
    }
  }

    for (var j = 0; j < results.length; j++) {
      var result = results[j];

      // Get current norm for this athlete + exercise + direction
      const { data: normData } = await supabase
        .from('athlete_norms')
        .select('*')
        .eq('athlete_id', athleteId)
        .eq('exercise', result.exercise)
        .eq('direction', result.direction)
        .eq('metric', 'asymmetry_pct')
        .maybeSingle();

      var flag = getFlagColor(result.asymmetry_pct, normData);

      // Save session asymmetry
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

    // Update norm after each session using rolling last 5
    await updateNormsForAthlete(athleteId);
  }
}

/**
 * Recalculate athlete norms using their last 5 sessions.
 */
async function updateNormsForAthlete(athleteId) {
  const { data: sessions, error } = await supabase
    .from('session_asymmetry')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('session_date', { ascending: false });

  if (error || !sessions.length) return;

  // Group by exercise + direction
  var groups = {};
  sessions.forEach(function(s) {
    var key = s.exercise + '|' + s.direction;
    if (!groups[key]) groups[key] = [];
    groups[key].push(Math.abs(s.asymmetry_pct));
  });

  for (var key in groups) {
    var parts = key.split('|');
    var values = groups[key].slice(0, 5); // last 5 sessions
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

/**
 * Get analysis data for the dashboard.
 */
async function getAnalysisData(athleteId) {
  var query = supabase
    .from('session_asymmetry')
    .select('*, athletes(first_name, last_name)')
    .order('session_date', { ascending: false })
    .limit(100);

  if (athleteId) query = query.eq('athlete_id', athleteId);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getNorms(athleteId) {
  var query = supabase
    .from('athlete_norms')
    .select('*, athletes(first_name, last_name)');

  if (athleteId) query = query.eq('athlete_id', athleteId);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

module.exports = {
  updateAsymmetryForAthlete,
  updateNormsForAthlete,
  getAnalysisData,
  getNorms,
  processSessionReps,
  getFlagColor,
};
