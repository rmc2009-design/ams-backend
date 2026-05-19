require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

app.get('/api/athletes', async function(req, res) {
  try {
    const { data, error } = await supabase.from('athletes').select('*').eq('active', true).order('last_name');
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/', function(req, res) {
  res.send('<html><body><h2 id="status">Loading...</h2><ul id="list"></ul><script>fetch("/api/athletes").then(function(r){return r.json()}).then(function(data){document.getElementById("status").textContent=data.length+" athletes loaded";data.forEach(function(a){var li=document.createElement("li");li.textContent=a.first_name+" "+a.last_name;document.getElementById("list").appendChild(li)})}).catch(function(e){document.getElementById("status").textContent="Error: "+e.message})<\/script></body></html>');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log('Running on port ' + PORT);
});
