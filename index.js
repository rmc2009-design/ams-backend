require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AMS backend running on port ${PORT}`);
  console.log(`Supabase URL: ${process.env.SUPABASE_URL ? 'connected' : 'NOT SET'}`);
});
