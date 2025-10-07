# rudl-dl-v2

Next.js 15 + React 19 application prepared for Cloudflare Pages (Next on Pages). The app serves localized dashboards and API routes backed by a Cloudflare D1 database and files distributed through an R2-backed CDN.

## Development
- Install dependencies with `npm install`.
- Run the dev server with `npm run dev` (http://localhost:3000).
- The project relies on a D1 binding named `DB`. For local development you can use `wrangler pages dev` with a stub D1, or guard the code before hitting the database if you do not need those pages.

## Cloudflare Pages Deployment

### Git integration
1. Connect the GitHub repository to your Pages project. If you see **"The repository cannot be accessed"**, re-run the GitHub App installation from the Pages UI and grant it access to `jishidengguanli-cell/rudl-dl-v2`.
2. Build command: `npx @cloudflare/next-on-pages@latest` (same as `npm run cf:build`).
3. Build output directory: `.vercel/output/static`.
4. Set the project compatibility date to at least `2025-10-03` and enable the `nodejs_compat` flag (already shown in the screenshots).
5. Bindings: add a D1 binding named `DB` that points to your `rudl_app` database. The code now tolerates an existing binding called `rudl-app`, but standardising on `DB` avoids extra lookups.

Once pushed to the `main` branch, Cloudflare Pages will run the build and deploy automatically.

### Manual deploy via Wrangler
1. Authenticate once with `npx wrangler login`.
2. Build: `npm run cf:build` (generates `.vercel/output/{static,functions}`).
3. Deploy: `npm run cf:deploy` (wraps `wrangler pages deploy .vercel/output/static --project-name rudl-v2-web --branch main --functions .vercel/output/functions`).

This path is useful when testing before pushing to Git or when you need an immediate redeploy.

## Troubleshooting
- Missing D1 binding: API routes and server components return HTTP 500 with "D1 binding DB is missing". Ensure the Pages project exposes the binding as `DB` (or temporarily keep `rudl-app` while migrating).
- CDN assets: downloads redirect to `https://cdn.dataruapp.com/<key>`. Confirm that key exists in R2 and the CDN exposes it publicly.
- Locales: middleware redirects to `/en` or `/zh-TW`. Add languages under `src/i18n/messages` and update `src/i18n/locales.ts` for extra locales.

## Useful scripts
- `npm run dev` - local Next.js dev server.
- `npm run build` - standard Next build (useful for linting/diagnostics).
- `npm run cf:build` - build for Cloudflare Pages using `@cloudflare/next-on-pages`.
- `npm run cf:deploy` - build + deploy to the configured Cloudflare Pages project.
