require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

const db = require('./src/services/db');

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/athletes', async (req, res) => {
  try {
    const athletes = await db.getAllAthletes();
    res.json({ count: athletes.length, athletes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/flags', async (req, res) => {
  try {
    const flags = await db.getUnresolvedFlags();
    res.status(500).json({ count: flags.length, flags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AMS backend running on port ${PORT}`);
  console.log(`Supabase URL: ${process.env.SUPABASE_URL ? 'connected' : 'NOT SET'}`);
});
