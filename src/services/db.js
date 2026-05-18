require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

async function getAllAthletes() {
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('active', true)
    .order('last_name');
  if (error) throw error;
  return data;
}

async function findAthleteByPlatformId(platform, externalId) {
  const { data, error } = await supabase
    .from('athlete_platform_ids')
    .select('athlete_id, athletes(*)')
    .eq('platform', platform)
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw error;
  return data?.athletes ?? null;
}

async function findAthleteByName(fullName) {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .ilike('first_name', `${first}%`)
    .ilike('last_name', `${last}%`)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function updateAthleteLoadStatus(athleteId, status) {
  const { error } = await supabase
    .from('athletes')
    .update({ load_status: status })
    .eq('id', athleteId);
  if (error) throw error;
}

async function getAthletesWithOAuthPlatform(platform) {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('*, athletes(*)')
    .eq('platform', platform);
  if (error) throw error;
  return data;
}

async function updateOAuthTokens(athleteId, platform, tokens) {
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      athlete_id: athleteId,
      platform,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'athlete_id,platform' });
  if (error) throw error;
}

async function upsertLoadRecord(record) {
  const { error } = await supabase
    .from('load_records')
    .upsert({
      athlete_id:        record.athleteId,
      source:            record.source,
      session_date:      record.date,
      session_name:      record.session_name ?? null,
      session_type:      record.session_type ?? null,
      duration_min:      record.duration_min ?? null,
      rpe:               record.rpe ?? null,
      session_load:      record.rpe && record.duration_min ? record.rpe * record.duration_min : null,
      player_load:       record.player_load ?? null,
      total_distance_m:  record.total_distance_m ?? null,
      high_speed_dist_m: record.high_speed_distance_m ?? null,
      sprint_dist_m:     record.sprint_distance_m ?? null,
      accelerations:     record.accelerations ?? null,
      decelerations:     record.decelerations ?? null,
      max_velocity_ms:   record.max_velocity_ms ?? null,
      heart_rate_avg:    record.heart_rate_avg ?? null,
      raw_payload:       record.raw ?? null,
    }, { onConflict: 'athlete_id,source,session_date,session_name' });
  if (error) throw error;
}

async function upsertRecoveryRecord(record) {
  const { error } = await supabase
    .from('recovery_records')
    .upsert({
      athlete_id:         record.athleteId,
      source:             record.source,
      record_date:        record.date,
      recovery_score:     record.recovery_score ?? null,
      hrv_rmssd_ms:       record.hrv_rmssd ?? null,
      resting_hr_bpm:     record.resting_hr ?? null,
      sleep_duration_min: record.sleep_duration_min ?? null,
      sleep_performance:  record.sleep_performance ?? null,
      strain_score:       record.strain ?? null,
      raw_payload:        record.raw ?? null,
    }, { onConflict: 'athlete_id,source,record_date' });
  if (error) throw error;
}

async function insertTestRecord(record) {
  const { error } = await supabase
    .from('test_records')
    .upsert({
      athlete_id:               record.athleteId,
      source:                   record.source,
      external_test_id:         record.vald_test_id ?? record.hawkin_test_id ?? null,
      test_date:                record.date,
      test_type:                record.test_type,
      jump_height_cm:           record.jump_height_cm ?? null,
      rsi_modified:             record.rsi_modified ?? record.rsi ?? null,
      peak_power_w:             record.peak_power_w ?? null,
      peak_power_w_per_kg:      record.peak_power_w_kg ?? null,
      peak_force_n:             record.peak_force_n ?? null,
      rfd_n_per_s:              record.rfd_n_s ?? null,
      impulse_ns:               record.impulse_ns ?? null,
      contraction_time_ms:      record.contraction_time_ms ?? null,
      left_right_asymmetry_pct: record.left_right_asymmetry_pct ?? null,
      peak_landing_force_bw:    record.peak_landing_force_bw ?? null,
      raw_payload:              record.raw ?? null,
    }, { onConflict: 'external_test_id' });
  if (error) throw error;
}

async function insertSprintRecord(record) {
  const { error } = await supabase
    .from('sprint_records')
    .insert({
      athlete_id:            record.athleteId,
      source:                record.source ?? '1080motion',
      session_date:          record.date,
      source_file:           record.filename ?? null,
      set_number:            record.set_number ?? null,
      rep_number:            record.rep_number ?? null,
      distance_m:            record.distance_m ?? null,
      time_s:                record.time_s ?? null,
      peak_velocity_ms:      record.peak_velocity_ms ?? null,
      peak_force_n:          record.peak_force_n ?? null,
      peak_power_w:          record.peak_power_w ?? null,
      peak_acceleration_ms2: record.peak_acceleration_ms2 ?? null,
      load_kg:               record.load_kg ?? null,
      raw_payload:           record.raw ?? null,
    });
  if (error) throw error;
}

async function saveFlags(flags) {
  if (!flags.length) return;
  const { error } = await supabase
    .from('athlete_flags')
    .insert(flags.map(f => ({
      athlete_id: f.athlete_id,
      flag_type:  f.type,
      severity:   f.severity,
      message:    f.message,
      source:     f.source ?? null,
    })));
  if (error) throw error;
}

async function getUnresolvedFlags() {
  const { data, error } = await supabase
    .from('athlete_flags')
    .select('*, athletes(first_name, last_name, sport, position)')
    .eq('resolved', false)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function resolveFlag(flagId, resolvedBy = 'system') {
  const { error } = await supabase
    .from('athlete_flags')
    .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
    .eq('id', flagId);
  if (error) throw error;
}

async function getRollingStats(athleteId) {
  const { data, error } = await supabase
    .from('rolling_stats')
    .select('*')
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (error) throw error;
  return data ?? {};
}

async function getJumpBaseline(athleteId, testType) {
  const { data, error } = await supabase
    .from('jump_baselines')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('test_type', testType)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function refreshRollingStats() {
  const { error } = await supabase.rpc('refresh_rolling_stats');
  if (error) throw error;
}

async function getWeeklyReportData() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const [athletes, flags, loads, recoveries, tests] = await Promise.all([
    supabase.from('athletes').select('*').eq('active', true).order('last_name'),
    supabase.from('athlete_flags').select('*, athletes(first_name,last_name)').eq('resolved', false),
    supabase.from('load_records').select('*').gte('session_date', weekAgo),
    supabase.from('recovery_records').select('*').gte('record_date', weekAgo),
    supabase.from('test_records').select('*').gte('test_date', weekAgo),
  ]);
  [athletes, flags, loads, recoveries, tests].forEach(r => { if (r.error) throw r.error; });
  return {
    athletes: athletes.data,
    flags: flags.data,
    loadRecords: loads.data,
    recoveryRecords: recoveries.data,
    testRecords: tests.data,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  supabase,
  getAllAthletes,
  findAthleteByPlatformId,
  findAthleteByName,
  updateAthleteLoadStatus,
  getAthletesWithOAuthPlatform,
  updateOAuthTokens,
  upsertLoadRecord,
  upsertRecoveryRecord,
  insertTestRecord,
  insertSprintRecord,
  saveFlags,
  getUnresolvedFlags,
  resolveFlag,
  getRollingStats,
  getJumpBaseline,
  refreshRollingStats,
  getWeeklyReportData,
};
