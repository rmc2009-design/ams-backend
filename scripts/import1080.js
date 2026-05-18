require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

function excelDateToISO(serial) {
  const date = new Date((serial - 25569) * 86400 * 1000);
  return date.toISOString().split('T')[0];
}

async function findAthlete(clientName) {
  if (!clientName) return null;
  const parts = clientName.trim().split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  const { data } = await supabase
    .from('athletes')
    .select('id, first_name, last_name')
    .ilike('first_name', `${first}%`)
    .ilike('last_name', `${last}%`)
    .limit(1);
  return data?.[0] ?? null;
}

async function importFile(filePath) {
  console.log(`Reading: ${filePath}`);
  const XLSX2 = require('xlsx');
  const wb = XLSX2.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX2.utils.sheet_to_json(ws);
  console.log(`Found ${rows.length} rows`);

  let saved = 0;
  let skipped = 0;
  const cache = {};

  for (const row of rows) {
    const clientName = row['Client'];
    if (!clientName) continue;

    if (!cache[clientName]) {
      cache[clientName] = await findAthlete(clientName);
      if (!cache[clientName]) {
        console.warn(`No match for: "${clientName}" — add them to Supabase first`);
      }
    }

    const athlete = cache[clientName];
    if (!athlete) { skipped++; continue; }

    const sessionDate = row['SessionTime']
      ? excelDateToISO(row['SessionTime'])
      : new Date().toISOString().split('T')[0];

    const { error } = await supabase.from('sprint_records').insert({
      athlete_id:             athlete.id,
      source:                 '1080motion',
      session_date:           sessionDate,
      source_file:            path.basename(filePath),
      exercise:               row['Exercise'] ?? null,
      exercise_type:          row['ExerciseType'] ?? null,
      set_number:             row['SetNumber'] ?? null,
      rep_number:             row['RepNumber'] ?? null,
      direction:              row['Direction'] ?? null,
      side:                   row['Side'] ?? null,
      concentric_load_kg:     row['Concentric Load [kg]'] ?? null,
      eccentric_load_kg:      row['Eccentric Load [kg]'] ?? null,
      distance_m:             row['Distance [m]'] ?? null,
      time_s:                 row['Time [s]'] ?? null,
      avg_speed_ms:           row['AvgSpeed [m/s]'] ?? null,
      peak_velocity_ms:       row['PeakSpeed [m/s]'] ?? null,
      avg_acceleration_ms2:   row['AvgAcceleration [m/s2]'] ?? null,
      peak_acceleration_ms2:  row['PeakAcceleration [m/s2]'] ?? null,
      avg_force_n:            row['AvgForce [N]'] ?? null,
      peak_force_n:           row['PeakForce [N]'] ?? null,
      avg_power_w:            row['AvgPower [W]'] ?? null,
      peak_power_w:           row['PeakPower [W]'] ?? null,
      bodyweight_kg:          row['Client Weight [kg]'] ?? null,
      raw_payload:            row,
    });

    if (error) console.error(`Error:`, error.message);
    else saved++;
  }

  console.log(`Done: ${saved} saved, ${skipped} skipped`);
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import1080.js <file.xlsx>');
  process.exit(1);
}

importFile(file).catch(console.error);
