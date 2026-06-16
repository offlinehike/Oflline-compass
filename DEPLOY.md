# Offline Compass — Deployment Guide

## What's in this project
- React + Vite single-page app
- Supabase Auth (magic link login)
- Supabase Firestore sync (data available on any device)
- PWA (installable on phone home screen)
- Vercel hosting

---

## YOUR STEPS (do these in order)

### STEP 1 — Supabase: create the database table

1. Go to https://supabase.com → open your project
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy and paste the entire contents of `supabase-setup.sql`
5. Click **Run**
6. You should see "Success. No rows returned"

### STEP 2 — Supabase: allow magic link login

1. In Supabase, go to **Authentication → Providers**
2. Make sure **Email** is enabled (it is by default)
3. Go to **Authentication → URL Configuration**
4. Under **Site URL**, enter your Vercel URL (you'll get this after Step 5)
   - For now leave it as `http://localhost:5173`
   - You'll come back and update it after deploying

### STEP 3 — GitHub: create a repo and push the code

In Termux, run these commands one by one:

```bash
cd ~/offline-compass
npm install
git init
git add .
git commit -m "Initial commit - Offline Compass"
```

Then go to https://github.com → click **New repository**
- Name: `offline-compass`
- Set to **Private**
- Do NOT check "Initialize with README"
- Click **Create repository**

GitHub will show you commands. Copy and run these two:
```bash
git remote add origin https://github.com/YOUR_USERNAME/offline-compass.git
git push -u origin main
```

### STEP 4 — Vercel: deploy

1. Go to https://vercel.com → log in
2. Click **Add New → Project**
3. Find and import your `offline-compass` repo
4. Before clicking Deploy, click **Environment Variables** and add:

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | `https://tbegswmaqoppdunawhmw.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (your full anon key) |

5. Click **Deploy**
6. Wait ~1 minute — you'll get a URL like `offline-compass.vercel.app`

### STEP 5 — Supabase: update the Site URL

1. Go back to Supabase → **Authentication → URL Configuration**
2. Update **Site URL** to your Vercel URL e.g. `https://offline-compass.vercel.app`
3. Under **Redirect URLs**, add the same URL
4. Click **Save**

### STEP 6 — Install on your phone/tablet

1. Open your Vercel URL in Chrome on your tablet
2. Tap the **⋮ menu → Add to Home Screen**
3. It installs like a real app — tap the icon to open

---

## Logging in

1. Open the app URL
2. Enter `offlinehike@gmail.com`
3. Click **Send Magic Link**
4. Check your Gmail — click the link
5. You're in — data syncs automatically across devices

---

## How data works

- Every change saves to localStorage instantly (works offline)
- 2 seconds after any change, it syncs to Supabase
- When you open the app on a new device, it loads from Supabase
- If you're offline, it uses the local copy and syncs when back online
