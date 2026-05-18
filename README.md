# Athlete Management System — API Integration Backend

## Stack
- **Runtime**: Node.js 18+
- **Database**: Supabase (Postgres) — or swap for any Postgres
- **Scheduler**: node-cron (polls APIs on a schedule)
- **Alerts**: configurable thresholds → console/email/webhook

## Quick start

```bash
npm install
cp .env.example .env   # fill in your API credentials
npm run sync           # one-time manual sync
npm run dev            # start the scheduler + API server
```

## Project structure

```
src/
  integrations/        # one file per data source
    whoop.js
    catapult.js
    polar.js
    vald.js
    hawkin.js
    1080motion.js
  services/
    normalizer.js      # maps raw API data → standard AthleteLoad schema
    alertEngine.js     # flags athletes based on configurable rules
    reportGenerator.js # builds weekly load report
  jobs/
    syncAll.js         # orchestrates all integrations
    weeklyReport.js    # cron job: every Monday 6am
  models/
    athlete.js         # DB schema helpers
    loadRecord.js
```

## API credentials needed

| Platform        | How to get access                                         |
|-----------------|-----------------------------------------------------------|
| Whoop           | developer.whoop.com → create an app → OAuth 2.0          |
| Catapult        | OpenField Cloud → Settings → API Keys                     |
| Polar           | admin.polaraccesslink.com → register app → OAuth 2.0     |
| Garmin          | developer.garmin.com → Health API partner application     |
| Vald            | VALD Hub → Settings → API → generate token               |
| Hawkin Dynamics | Your account rep → API credentials via customer portal    |
| 1080 Motion     | CSV export or webhook push (no REST API yet)              |
