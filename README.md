# My Finance Manager · مدير أموالي

A bilingual (Arabic / English) personal finance app for Android that works fully offline.
It installs from the browser as a Progressive Web App.

- Base currency YER, plus SAR and USD with dated exchange rates
- Accounts, all transaction types, budgets, savings goals, debts, recurring bills, investments and assets
- Analytics, reports (PDF / Excel), Hijri & Gregorian calendar, search, calculator
- PIN / fingerprint lock, encrypted backups, optional encrypted sync through each user's own Google Drive

All financial data stays on the user's device. See [STATUS.md](STATUS.md) for what is implemented.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # output in dist/
```

## Optional: Google Drive sync

Copy `.env.example` to `.env.local` and set `VITE_GOOGLE_CLIENT_ID` (an OAuth "Web application" client ID —
public by design, no secret). On Netlify, set the same variable in the site's environment variables.
