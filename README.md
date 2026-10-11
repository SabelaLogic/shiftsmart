# ShiftSmart

Find your dead hours. Drive the gold ones.

A free, private, offline-first web app for e-hailing drivers. Time your shifts, log what you earned, and see which hours and areas actually pay you. No account, no server, no tracking: everything is stored on the phone.

ShiftSmart is an independent tool. It is not made by, or affiliated with, Bolt, Uber or inDrive.

## What it does

- **Shift timer.** Tap start when you go online, tap stop and enter what you earned. Waiting time is included, which is where dead hours hide.
- **Heatmap.** A 7-day by 24-hour grid of rand per hour. Slots with under 90 minutes of data, or from fewer than 2 shifts, are faded and never called gold or dead.
- **Plan.** Your best and worst slots, your best areas, and an estimate of what moving hours is worth, based only on your own history.
- **Import and backup.** Import any CSV (you choose which column is which; South African day-first dates and `R 1 234,50` amounts are handled; unreadable rows are skipped, never guessed). Export CSV or a JSON backup.
- **Sample data.** A clearly labelled demo mode with invented data, kept separate from real entries.

## Privacy

Data lives in the browser's `localStorage`. The site ships a Content-Security-Policy (`public/_headers`) that restricts it to its own origin, and the code makes no network calls. Browsers can clear site data when storage runs low, so the app offers a backup file.

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

## Adding real driver stories

The "From the road" section on the Today screen stays hidden until `public/media/stories.json` has entries:

```json
[
  { "type": "video", "src": "media/rank-clip.mp4", "caption": "What a Friday looks like", "credit": "Thabo, Sandton" },
  { "type": "image", "src": "media/photo.webp", "alt": "Driver at the taxi rank", "caption": "Short caption" }
]
```

Only add photos and clips of real drivers who have agreed to appear.

## Status

Working prototype. No automated tests yet. Average rates are only as good as the shifts logged, and the Plan estimate assumes demand holds when you add hours to a busy slot.
