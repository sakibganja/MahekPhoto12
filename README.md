Mahek Photo — Local development and Netlify deployment

Overview

This repository contains a static website and an Express-based admin + API application designed to be deployed as a Netlify site with Netlify Functions.

Quick local run (development)

1. Install dependencies

```bash
npm install
```

2. Start the server (local development)

```bash
node server.js
# or
npm run dev
```

3. Open the site

Open http://127.0.0.1:4173 in your browser.
- Admin dashboard: http://127.0.0.1:4173/admin
- Public site: http://127.0.0.1:4173/

Seeded local admin credentials

- Email: admin@mahekphoto.in
- Password: Mahek@2026

What I changed to fix login behavior

- `admin.js`: ensured fetch requests send cookies by default (credentials: 'same-origin') and improved JSON parsing to avoid client-side crashes when the server returns non-JSON responses.
- `script.js`: added `apiFetch()` helper (sends cookies, robust parsing) and replaced direct `fetch()` calls for all API interactions so customer login, registration, enquiries, favorites and logout reliably work.

Why the login might fail when testing locally

- Do NOT open `admin.html` or `index.html` using `file://` in your browser. If you open files from the filesystem, the origin differs from the running server and cookies won't be set or sent. Always use the running server origin `http://127.0.0.1:4173` or a deployed hostname.

Deploying to Netlify

This project is configured for Netlify with `netlify.toml`.

1. Create a Git repository and push

```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
# Add your remote and push
git remote add origin git@github.com:youruser/yourrepo.git
git push -u origin main
```

2. Create a Netlify site and connect the repository

- Go to https://app.netlify.com -> New site -> Import from Git
- Choose your provider, select the repository and continue
- Netlify will pick up `netlify.toml` and detect `netlify/functions` as the functions folder.

3. Environment variables

Set these in Netlify site settings → Build & deploy → Environment

- `GOOGLE_CLIENT_ID` (if using Google sign-in)
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` — set to `https://<yoursite>.netlify.app/api/auth/google/callback`
- Optional: `ANALYTICS_SALT`
- `NODE_ENV=production`

4. Deploy

- Use the Netlify UI to trigger a deploy, or use the Netlify CLI:

```bash
npm i -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

Notes and production considerations

- SQLite persistence: Netlify Functions run in ephemeral containers. Bundling `data/mahek.sqlite` will let functions read the DB at deploy time, but writes won't persist reliably. For production, use a hosted DB (Postgres, MySQL, Supabase, PlanetScale) or host the app on a server with a persistent disk.

- Native module `sharp`: Netlify supports building native modules but can fail if the build environment or binary mismatch occurs. If you see errors during build related to `sharp`, use one of these options:
  - Move image processing to an external service (Cloudinary, Imgix).
  - Pre-process images during the build step.
  - Use a hosted server with the correct binaries.

- Cookie and CSRF: The app sets `mahek_admin` and `mahek_customer` cookies (HttpOnly). The site uses CSRF tokens returned by the login endpoints and requires the `X-CSRF-Token` header for state-modifying requests. The frontend now sends cookies and CSRF headers correctly when served from the same origin.

Troubleshooting tips

- 400 JSON parse errors when submitting forms from PowerShell `curl`: PowerShell's `curl` is an alias for `Invoke-WebRequest` which treats `-d` and `-c` differently. Use `curl.exe` or the Node fetch approach shown in the repo to test endpoints.

- If admin or customer login returns non-JSON (HTML), check whether you are using file:// origin or if a reverse proxy is blocking the request.

- If Netlify build fails, open the deploy log — it typically points to missing native binaries or missing env vars.

What I can do next for you

- I can create and push a GitHub repo for you (I will need the remote URL or GitHub access).
- I can run a Netlify CLI deploy from this workspace and report any build errors.
- I can help migrate SQLite to a managed DB and update `server.js` to use the new DB.

If you want me to publish the site for you, tell me which option:
- "Create repo & push" (provide Git remote URL),
- "Use my Netlify account" (you'll need to connect or provide site details), or
- "Guide only" — I'll walk you step-by-step while you do the actions.

License

This README and the repo edits are provided without warranty. Follow standard security practices when deploying production sites.
