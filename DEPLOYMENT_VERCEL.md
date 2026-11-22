# ZuumStock Studio — Vercel Production Deployment Guide

ZuumStock Studio is architected as a Vite React SPA (`dist/`) paired with a Vercel Serverless Express backend (`api/index.ts`) configured via `vercel.json`.

---

## 1. Prerequisites
1. **Cloud PostgreSQL Database**: Create a free or production PostgreSQL database on **Neon**, **Supabase**, or **Vercel Postgres**.
   - Obtain the connection string (`DATABASE_URL` or `POSTGRES_URL`).
   - All required tables (`admin_users`, `auth_sessions`, `audit_logs`, `assets`, `asset_metadata`, `generation_runs`, `exports`, etc.) initialize automatically on cold start (`ensureDbReady()`), or you can pre-apply `/server/schema.sql`.
2. **Cloud Object Storage** (pick one):
   - **Vercel Blob (Recommended for Vercel)**: Create a Blob Store in Vercel Dashboard → Storage → Blob, and attach `BLOB_READ_WRITE_TOKEN`.
   - **S3 / Cloudflare R2**: Set `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and optionally `S3_PUBLIC_BASE_URL`.
3. **AI Provider Secret**:
   - Set `GEMINI_API_KEY` (and/or `OPENROUTER_API_KEY`, `HF_API_KEY`, `OPENAI_COMPAT_API_KEY`).

---

## 2. Required Production Environment Variables
Configure these in **Vercel Project → Settings → Environment Variables**:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `DATABASE_URL` | Yes | PostgreSQL connection URL (local SQLite is strictly disabled in production) |
| `BLOB_READ_WRITE_TOKEN` | Yes* | Vercel Blob token for persisting SVGs, PNGs, EPS, ZIPs (*or set `S3_*` vars) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key (or another enabled AI provider key) |
| `SESSION_SECRET` | Yes | Strong 32+ byte random hex string (`openssl rand -hex 32`) |
| `ADMIN_USERNAME` | Yes | Admin login username (e.g. `zuumadmin`) |
| `ADMIN_PASSWORD` | Yes* | Strong production password (*or `ADMIN_PASSWORD_HASH` in `scrypt:salt:hash` format) |
| `APP_URL` | Yes | Public deployment URL (e.g. `https://studio.yourdomain.com`) |

> **Security Note**: The development fallback `admin` / `admin` is **strictly disabled** whenever `NODE_ENV === 'production'` or `VERCEL === '1'`.

---

## 3. Deploy to Vercel

### Option A: GitHub Integration
1. Push this repository to GitHub.
2. In Vercel Dashboard, click **Add New Project** → Import the repository.
3. Framework Preset: **Vite** (`buildCommand`: `npm run build`, `outputDirectory`: `dist` — already configured in `vercel.json`).
4. Add all Environment Variables listed above.
5. Click **Deploy**.

### Option B: Vercel CLI
```bash
npm install -g vercel
vercel login
vercel link
vercel env add DATABASE_URL
vercel env add BLOB_READ_WRITE_TOKEN
vercel env add GEMINI_API_KEY
vercel env add SESSION_SECRET
vercel env add ADMIN_USERNAME
vercel env add ADMIN_PASSWORD
vercel --prod
```

---

## 4. Custom Domain Setup
1. Open **Vercel Dashboard → Project → Settings → Domains**.
2. Add your domain (e.g. `studio.yourdomain.com`).
3. Add the `CNAME` (`cname.vercel-dns.com`) or `A` record (`76.76.21.21`) at your DNS registrar.
4. Update `APP_URL` in Vercel Environment Variables to `https://studio.yourdomain.com` and redeploy so secure session cookies align cleanly.

---

## 5. Video Binary Note (`FFmpeg` / `Ghostscript`)
- **Always available in Vercel Serverless**: Pure-TS SVG generation, Resvg PNG rasterization, EPSF-3.0 PostScript compilation, Lottie JSON animation export, PNG Sequence ZIPs, Asset ZIPs, and CSV metadata export.
- **Container / Full-VM Features**: MP4 / ProRes MOV / WebM / GIF encoding requires `ffmpeg`/`ffprobe` binaries, and secondary EPS linting uses Ghostscript (`gs`). When deploying to standard Vercel Serverless Functions without custom FFmpeg layers, ZuumStock Studio automatically continues serving SVG, EPS, PNG, Lottie JSON, and PNG Sequence ZIPs cleanly, and clearly notifies when FFmpeg binaries are not present in the serverless image.
