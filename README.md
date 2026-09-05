# Steps & Slopes

A step-by-step differential equations solver — symbolic and numeric methods
with worked derivations — plus a separate Practice section with randomly
generated problems graded against an independent numerical check.

This is a plain static site: no build step, no framework, no dependencies to
install. It's just HTML, CSS, and vanilla JavaScript files, plus MathJax
loaded from a CDN for rendering equations.

## Structure

```
index.html          the solver (12 solution methods)
practice.html        the practice problem generator, as its own page
css/style.css        shared stylesheet for both pages
js/mathengine.js      the symbolic math engine (parser, simplifier, calculus)
js/odesolvers.js      the ODE-solving methods, built on mathengine.js
js/site.js            shared UI helpers (LaTeX rendering, theme switch, etc.)
js/app.js             solver page logic
js/practice.js         practice page logic
vercel.json            minimal Vercel config (clean URLs)
```

## Running it locally

Because the pages load their JavaScript via `<script src="js/...">`, most
browsers will run them fine even opened directly from disk
(`file:///.../index.html`). If your browser is stricter about local files,
serve the folder instead — from inside this directory:

```
python3 -m http.server 8000
# then open http://localhost:8000/
```

or, with Node installed:

```
npx serve .
```

## Deploying with GitHub + Vercel

1. Create a new GitHub repository and push this folder's contents to it:

   ```
   git init
   git add .
   git commit -m "Steps & Slopes"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com), sign in (GitHub sign-in is
   easiest), and click **Add New… → Project**.

3. Import the GitHub repository you just created.

4. Vercel will detect it as a static site — there's no framework and no
   build command needed. Leave the defaults:
   - **Framework Preset:** Other
   - **Build Command:** (none)
   - **Output Directory:** (leave as the repository root, i.e. `.` or blank)

5. Click **Deploy**. After it finishes, Vercel gives you a live URL
   (`your-project.vercel.app`) serving `index.html` at `/` and
   `practice.html` at `/practice`.

Any future `git push` to the connected branch redeploys automatically.

### Alternative: Vercel CLI

If you'd rather deploy without GitHub:

```
npm install -g vercel
vercel        # first deploy, follow the prompts
vercel --prod # promote to production
```

## Notes

- Everything runs client-side — there's no backend or database. The
  practice page keeps a session score in the browser's `localStorage`,
  which is why it resets per-browser and isn't shared across devices.
- The two pages are independent HTML documents linked by the nav bar in the
  header, not a single-page app — so each is its own URL and reloads
  cleanly.
