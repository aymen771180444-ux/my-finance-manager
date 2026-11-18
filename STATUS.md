# Feature Status — My Finance Manager

Per PRD §31, every feature is tracked honestly. Updated at each stage review.
Legend: ✅ Fully implemented · 🟡 Partially implemented · ⏳ Pending integration · 🔜 Planned (later stage) · ❌ Not supported

## Stage 6 — Google Drive sync (each user's own Drive)

| Feature | Status | Notes |
|---|---|---|
| Sign in with Google, Drive hidden app folder only | 🟡 | Scope `drive.appdata` — the app cannot see any other Drive file. No client secret in the app. Live once VITE_GOOGLE_CLIENT_ID is set; shows an honest "not set up" card until then |
| End-to-end encryption | ✅ | Sync password → PBKDF2 (600k) → AES-256-GCM on the phone; Google stores only ciphertext (test: no readable text in Drive). Wrong password detected before anything changes |
| Sync key on the device | ✅ | Encrypted under the app-lock data key when the lock is on; unwrapped automatically if the lock is removed |
| Two-way sync between phones | ✅ | Three-way merge per record; balances, goal totals, debt remaining, investment figures are recomputed on each phone, never copied |
| Conflicts never lost silently | ✅ | Newer edit wins, an edit beats a delete, the other version is kept and can be restored with one tap (tested end-to-end) |
| Join a second phone | ✅ | Empty phone takes the Drive copy (its starter data restored if joining fails); a phone with its own data merges and warns about duplicate starter categories |
| Daily encrypted snapshots / restore points | ✅ | Last 7 kept; roll back all phones to one; old change files cleaned up, a long-offline phone still catches up (tested) |
| Receipt attachments | ✅ | Uploaded once, re-encrypted with the receiving phone's lock key |
| Automatic sync | 🟡 | On start, return to app, back online, every 5 min and 15 s after edits — **only while the app is open** (Android does not allow web apps to sync when closed) |
| Google session length | 🟡 | Browser sign-in lasts ~1 hour (Google gives web apps no refresh token); after that the banner asks for one tap to reconnect |
| Disconnect / erase Drive copy | ✅ | Stop on this phone (Drive copy stays) or erase everything in the app folder (confirmed) |

## PRD gap closing (after Stage 5)

| Feature | Status | Notes |
|---|---|---|
| Import historical transactions (CSV) — PRD §8 | ✅ | Auto-matches Arabic/English headers (and this app's own export); DD/MM, MM/DD, YYYY-MM-DD with auto-detect; signed amounts or a type column; income, expense, transfers; duplicate detection (vs existing data and within the file); per-row reasons for rejected rows; **atomic** commit through the posting engine; each batch tagged `import-YYYY-MM-DD` so it can be reviewed or deleted together |
| Share selected accounts between profiles — PRD §25 | ✅ | Explicit opt-in per profile on the account screen (owner only); never automatic |
| Preset color themes + custom color — PRD §26 | ✅ | 7 presets + any color; derived light/dark variants guaranteed ≥ 4.5:1 contrast (tested); Android status bar follows; printing keeps its own palette |
| Automatic monthly savings into goals — PRD §10 | ✅ | Source account + day of month; transfers (never expenses); catches up missed months once; skips with a notice instead of overdrawing; stops at the target |
| Debt installment schedule | ✅ | Shown in the financial calendar and dashboard (since Stage 3–4) |
| Startup bundle | ✅ | Charts moved to their own chunk: 282 → 170 KB gzip before first paint |

## Stage 5

| Feature | Status | Notes |
|---|---|---|
| PIN app lock (4–8 digits) | ✅ | No PIN or key stored in plaintext; wrong PINs locked out with growing waits (30 s → 15 min) |
| Password backup access (recovery password) | ✅ | Independent second unlock path for a forgotten PIN |
| Auto-lock after inactivity (default 10 min, 1–30 configurable) | ✅ | |
| Lock when leaving the app | ✅ | Short grace period while the camera/file picker is open so attachments aren't interrupted |
| Fingerprint / face unlock | 🟡 | Implemented with WebAuthn PRF (cryptographic, not a UI gate). Offered only where the device supports PRF; **not yet tested on a real phone** |
| Encrypted attachments | ✅ | AES-256-GCM under a data key wrapped by PIN and recovery keys |
| Encrypted database storage | 🟡 | Financial records are **not** encrypted inside the browser database (doing so would break search/indexes). They rely on Android device encryption + app lock. Attachments and backups ARE encrypted |
| Encrypted backup file (.mfm) + restore | ✅ | Backup password independent of PIN → restores on a new phone; wrong password / tampering / corruption detected **before** anything is replaced; atomic restore; tested round-trip of all 22 tables + attachments (acceptance #18) |
| Last successful backup date | ✅ | Shown on Backup screen; weekly backup reminder |
| Automatic daily cloud backup (Google Drive) | 🟡 | Built (Stage 6): a full encrypted snapshot to the user's own Drive once a day, last 7 kept as restore points. **Needs the app owner's Google OAuth client ID + an HTTPS address** before anyone can use it; not yet tested against real Google servers |
| Data export (ZIP of CSVs + attachments) | ✅ | Transactions, splits, accounts, budgets, debts + repayments, goals + contributions, investments + history, assets, receipt files; UTF-8 with BOM for Excel Arabic |
| Receipt / document attachments | ✅ | Transactions, accounts, debts (contracts), investments, assets; camera capture; images auto-shrunk; Trash + 90-day purge; included in search |
| Notification preferences | ✅ | Per type: budget, bills, installments, auto-recorded items, daily reminder (+hour), daily/weekly/monthly summaries, backup reminder |
| Device (system) notifications | 🟡 | Shown when permitted and the app is open/backgrounded. **Limitation (documented in-app):** a web app cannot wake itself when fully closed without a push server; reminders/summaries catch up on next open |
| Accessibility | ✅ | All text/background token pairs ≥ 4.5:1 (WCAG AA) in both themes — fixed 8 failing pairs; visible keyboard focus; reduced-motion support; translated screen-reader labels; locked app is `inert` |
| Screens loaded on demand | ✅ | Each screen 2–30 KB; main bundle 282 KB gzip (React + charts) — further splitting of the chart library is a possible later optimization |
| Android install (manifest, PNG + maskable icons) | ✅ | Arabic-first name "أموالي"; all 61 files precached for offline use |
| Offline use verified on a device | ⏳ | Service worker generated and validated (all files precached, offline page fallback). The development preview pane blocks service workers, so the real offline test needs a phone or Chrome |

## PRD acceptance criteria (§30)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1–2 | Expense/income change the right balance | ✅ | automated tests + browser |
| 3 | Transfers excluded from income/expense | ✅ | tests + browser |
| 4–5 | Credit-card purchase = expense + liability; payment not a 2nd expense | ✅ | tests |
| 6 | Splits reconcile exactly | ✅ | tests |
| 7–8 | Historical exchange rates frozen; editing today's rate doesn't rewrite history | ✅ | tests |
| 9 | Savings transfers not counted as income | ✅ | tests |
| 10 | Savings not double-counted in net worth | ✅ | tests |
| 11 | Investment cost basis vs market value separate | ✅ | tests + browser |
| 12 | Debt repayments update balances | ✅ | tests + browser |
| 13–14 | Budget alerts at thresholds; rollover | ✅ | tests + browser |
| 15 | Transactions created/viewed offline | 🟡 | Local-first DB works without network; installed-PWA offline check pending on a real device |
| 16 | Offline changes sync without loss | 🟡 | Two-device simulation tests: edits/deletes both ways, offline device after cleanup, failed upload retried, fixed-id automatic entries never duplicate. Real Google Drive test pending the client ID |
| 17 | Failed sync visible | ✅ | Status on the Drive sync screen, banner on every screen (expired sign-in, password needed, repeated failures, conflicts), notification after 3 failures |
| 18 | Backup/restore preserve all data + attachments | ✅ | round-trip test of all tables + files |
| 19 | Arabic RTL / English LTR | ✅ | browser, every stage |
| 20 | PDF/Excel show correct totals | ✅ | report + XLSX round-trip tests; PDF via print of the same view |
| 21 | Deleted records restorable within 90 days | ✅ | tests (transactions, accounts, categories, budgets, goals, debts, recurring, investments, assets, attachments) |
| 22 | Profile separation | ✅ | tests |
| 23 | Dashboard totals reconcile with records | ✅ | browser (hand-checked in Stages 1–4) |

## Stage 4

| Feature | Status | Notes |
|---|---|---|
| Investments: name, type, quantity, purchase price/date, cost basis, market value, profit/loss, history | ✅ | Average-cost method; fractional quantities exact (micro-units); BigInt-safe value math |
| Investment purchases and sales | ✅ | Optionally through a same-currency account (`investment_buy`/`investment_sell` — never income/expense); overselling at any date refused |
| Cost basis vs market value kept separate (acceptance #11) | ✅ | Price updates never touch cost basis; tested |
| No invented market prices | ✅ | Market value = last *recorded* price (buy, sale or manual price update), shown with its date. Automatic price feeds: ⏳ not connected |
| Realized gain/loss on sales | ✅ | Stored per sale, re-derived from history on every change |
| Other assets (cash savings, gold, financial, other) with valuation history | ✅ | Disposal records a zero valuation so history stays correct |
| Net worth includes investments (market value) and assets, no double counting (acceptance #10) | ✅ | |
| Net-worth monthly (12 mo) & yearly (5 yr) trend | ✅ | Reconstructed by reversing later postings from today's balances; uses the rate effective on each date |
| Forecast method 1: historical averages | ✅ | Needs ≥ 7 days of history; otherwise says so |
| Forecast method 2: budgets + recurring + debts due | ✅ | Bills inside budgeted categories are not double counted; money owed *to* you is listed but never counted as expected income |
| Overspend risk per budget | ✅ | Pace projection |
| Dashboard: all 14 PRD components | ✅ | Total balance, income, expenses, net worth, remaining budget, savings balance, goals, upcoming bills, upcoming debt payments, spending by category, income vs expenses, cash flow, recent transactions, forecast |
| Dashboard reorder / hide / restore | ✅ | More → Customize dashboard |
| Debt repayment history table (PRD entity #18) | ✅ | Every repayment dated, with or without an account; back-filled for existing data by the v4 upgrade |

Fixes made during Stage 4:
- Deleting a debt and later restoring it plus its repayments from Trash would have subtracted those repayments twice. The debt is now captured after its repayments are rolled back.
- Repositories that create transactions inside their own database transaction had hand-copied table lists (a source of "table not in transaction" failures). They now share one list.

## Stage 3

| Feature | Status | Notes |
|---|---|---|
| Period comparisons (month / year / custom vs previous) | ✅ | Custom compares against the equal-length window just before |
| Spending analysis (top categories, top days, weekdays, daily/weekly/monthly averages, needs vs wants) | ✅ | Needs = essentials + bills + emergencies; wants = wants group |
| Income analysis (by source with %, 6-month trend) | ✅ | |
| Savings analysis (savings rate, goal progress) | ✅ | Goal completion estimates on the Goals screen |
| Net-worth analysis (current, asset & liability distribution) | ✅ | Savings goals never added on top of accounts (acceptance #10) |
| Net-worth monthly/yearly trend | 🔜 | Stage 4 (needs historical balance reconstruction) |
| Rule-based insights | ✅ | Fire only with a real baseline; forecasts labelled as estimates |
| Daily / weekly / monthly summaries | ✅ | Net balance change includes debts; transfers net to zero |
| Reports: comprehensive, expense, income, debt, account, net-worth, custom | ✅ | Filters: date, account, currency, category (incl. subcategories), tag |
| Excel (XLSX) export | ✅ | Real numeric cells, RTL sheet in Arabic; verified by round-trip test (acceptance #20) |
| PDF export | ✅ | Via the browser's print → "Save as PDF" with a print stylesheet; chosen over pdfmake, which cannot shape/reorder Arabic RTL text |
| Financial calendar: Gregorian + true Hijri (Umm al-Qura) months, month & day views | ✅ | Income, expenses, recurring due, debt due, installments, goal deadlines, savings contributions |
| Global search (transactions, accounts, categories, people, debts, goals, tags) | ✅ | Arabic-normalized (أ/ا, ى/ي, ة/ه, diacritics); amount/date/category/account/person filters |
| Search in attachments | 🔜 | Arrives with attachments (Stage 5) |
| Calculator: arithmetic, percentages, discounts, currency conversion, installments, savings plan | ✅ | Safe parser (no eval); conversion shows the stored rate used; refuses without a rate |
| Tags: create, assign, filter (transactions + reports), delete | ✅ | |
| Refunds linked to the original expense | ✅ | Refund inherits the expense category and nets against it (PRD §8 rule 6) |

Fixes made during Stage 3 (bugs from earlier stages):
- Monthly schedules starting on the 29th–31st drifted after a short month (Jan 31 → Feb 28 → Mar 28 …). Now computed from the start date (→ Mar 31).
- Editing a split transaction dropped its split lines. Splits now load into the form.
- Debt- and goal-linked transactions could be edited from the generic form, desynchronising the debt/goal. They are now read-only there.
- Deleting a goal deposit from the transactions list left the goal's saved amount unchanged. Now corrected (and restored from Trash).
- A rendering bug in one screen blanked the whole app. Added an error boundary.

## Stage 2

| Feature | Status | Notes |
|---|---|---|
| Budgets: overall + per-category, daily/weekly/monthly/yearly | ✅ | In YER; subcategories count toward parent budgets; splits allocated proportionally |
| Budget rollover | ✅ | Unspent carries forward; overspending never shrinks the base limit |
| Budget alerts at 50/75/90/100% | ✅ | Deduped per budget+period+threshold; spending beyond budget allowed and flagged |
| Event budgets (travel, wedding…) | ✅ | Via optional end date |
| Savings goals (target, date, progress, est. completion) | ✅ | Estimates from planned monthly amount or contribution pace; "not enough data" shown honestly |
| Goal contributions / withdrawals | ✅ | Linked-account deposits are transfers — never income (acceptance #9) |
| Automatic monthly savings entries | ✅ | See "PRD gap closing" |
| Debts: both directions, partial/full repayment, history | ✅ | Remaining balance repo-maintained (acceptance #12); deleting a repayment rolls it back |
| Debt installment schedule | ✅ | Calendar + dashboard |
| Debt due-date reminders | ✅ | 3 days ahead + overdue |
| Recurring obligations (auto-create / remind modes) | ✅ | Catch-up on app open and on focus; month-end dates clamp correctly |
| Notification center | ✅ | In-app, bilingual (stored as i18n keys), unread badge on dashboard bell |
| Push notifications when app is closed | 🔜 | Stage 5 (PWA limits will be documented) |
| Transaction types lend/borrow/debt repayment | ✅ | Created via the Debts screen (keeps debt records consistent) |

## Stage 1

| Feature | Status | Notes |
|---|---|---|
| Arabic RTL / English LTR interface | ✅ | Full i18n, direction flips live |
| Light / dark / auto theme | ✅ | |
| Multi-profile support | ✅ | Independent data + explicit account sharing |
| Accounts (cash, bank, e-wallet, savings, credit card) | ✅ | CRUD, close/reopen, reconcile, detail screen |
| Account deletion safety | ✅ | Blocked when transactions exist; close instead |
| Transactions: income, expense, transfer, withdrawal, deposit, cc purchase, cc payment, refund | ✅ | Posting engine, atomic balance updates |
| Transactions: lend / borrow / debt repayment | 🟡 | Engine + tests done; UI arrives with Debts module (Stage 2) |
| Transactions: investment buy/sell | 🟡 | Engine done; UI arrives with Investments module (Stage 4) |
| Split transactions | ✅ | Exact reconciliation enforced |
| Tags | 🟡 | Data model + engine done; tag picker UI in Stage 3 with search |
| Categories + subcategories (default set, custom, color, icon) | ✅ | Archive-if-in-use on delete |
| Multi-currency (YER base, SAR, USD) | ✅ | Dated manual rates, frozen per-transaction rates |
| Automatic online rate updates | ⏳ | Needs internet integration; manual entry works |
| Dashboard (balance, income, expenses, charts, recent) | ✅ | Pie + bar charts, hide balances |
| Dashboard card reorder/hide | 🔜 | Stage 4 |
| Trash with 90-day retention + restore | ✅ | Transactions, accounts, categories |
| Audit log | ✅ | create/update/delete/restore/reconcile with before/after |
| Offline-first local database | ✅ | IndexedDB (Dexie); app runs fully offline |
| PWA install (manifest + service worker) | ✅ | SVG icon; final icon polish in Stage 5 |
| Sync outbox queue | ✅ | Superseded by fingerprint-based change detection (works for every table, survives app reinstall of the base) |
| Supabase cloud sync | ❌ | Dropped by the user: sync goes through each user's own Google Drive instead |
| Google Drive sync + backup | 🟡 | See Stage 6 section |

## Later stages
- Stage 2: budgets (+rollover, alerts), savings goals, debts, recurring obligations, notifications center
- Stage 3: analytics, reports + PDF/XLSX export, financial calendar (Hijri/Gregorian), global search, calculator, insights, summaries
- Stage 4: investments, assets, net worth trends, forecasting, dashboard customization
- Stage 5: PIN/biometric lock, encrypted local backup/restore, attachments, notification preferences, PWA polish
- Stage 6: sync + daily backup through each user's own Google Drive (built; needs OAuth client ID to go live)
