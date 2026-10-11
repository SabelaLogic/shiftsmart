# ShiftSmart

Find your dead hours. Drive the gold ones.

A private, offline-first web app for e-hailing drivers. Time your shifts, log what you earned, and see which hours and areas actually pay you. No account, no server, no tracking: everything is stored on the phone.

ShiftSmart is an independent tool. It is not made by, or affiliated with, Bolt, Uber or inDrive.

## What it does

- **Shift timer.** Tap start when you go online, tap stop and enter what you earned. Waiting time is included, which is where dead hours hide.
- **Heatmap.** A 7-day by 24-hour grid of rand per hour. Slots with under 90 minutes of data, or from fewer than 2 shifts, are faded and never called gold or dead.
- **Plan.** Your best and worst slots, your best areas, and an estimate of what moving hours is worth, based only on your own history.
- **Import and backup.** Import any CSV (you choose which column is which; South African day-first dates and `R 1 234,50` amounts are handled; unreadable rows are skipped, never guessed). Export CSV or a JSON backup.
- **Sample data.** A clearly labelled demo mode with invented data, kept separate from real entries.

## Privacy

Data lives in the browser's `localStorage`. The site ships a Content-Security-Policy (`public/_headers`) that restricts it to its own origin, and the code makes no network calls. Browsers can clear site data when storage runs low, so the app offers a backup file. Shift data is never uploaded. The only network call is `POST /api/verify`, which sends the subscriber's email so the Worker can ask Paystack whether the subscription is active. Payment happens on a hosted Paystack page; the app never handles card details.

## Subscriptions (ShiftSmart Pro)

Logging, the timer, CSV import and backups are free. The Heatmap and Plan tabs need an active R49/month Paystack subscription (sample data is always viewable). `src/worker.js` serves the static app and `POST /api/verify`, which looks the email up with Paystack's `GET /customer/:email` and checks for an `active` subscription (or a `non-renewing` one that is still paid up). The phone stores the email and re-checks about daily when online, with a 14-day offline grace period.

Setup: in Cloudflare, Workers & Pages > shiftsmart > Settings > Variables and Secrets, add a **secret** named `PAYSTACK_SECRET_KEY` with your Paystack secret key (Settings > API Keys & Webhooks). Never commit it.

Limitation: the app is client-side, so the lock is a soft paywall. It stops casual use but a technical user can bypass it in browser dev tools, and anyone who knows a subscriber's email can unlock with it.

## Stack

Plain HTML, CSS and JavaScript. No framework and no build step. A service worker (`public/sw.js`) caches the app so it works offline. Fonts (Poppins, Inter) are self-hosted.

## Run locally

```bash
python3 -m http.server 8000 --directory public
```

Open http://localhost:8000.

## Deploy (Cloudflare Workers static assets)

`wrangler.jsonc` serves `public/` as static assets.

```bash
npx wrangler deploy
```

Or connect this repo under Workers & Pages → Create → Import a repository, and every push to `main` deploys. When you ship a change, bump `V` in `public/sw.js` so installed copies refresh.

## People reel

The Today screen shows a swipeable reel of short looping clips (muted, tap to pause). Clips are listed in `public/media/stories.json`, each as MP4 plus a same-named WebM and a poster image:

```json
[
  { "type": "video", "src": "media/family.mp4", "poster": "media/family.jpg", "caption": "What the hours are for" }
]
```

Each card shows a small "AI-generated" tag by default. Set `"label": ""` on a card to hide it, or `"label": "Filmed at Bree rank"` to replace it, for example when you add footage of real drivers who agreed to appear.

## Status

Working prototype. No automated tests yet. Average rates are only as good as the shifts logged, and the Plan estimate assumes demand holds when you add hours to a busy slot.
