# Halwani FS Cloud CRM, exact approved UI edition

This package uses the UI from `halwani-fs-visit-tracker-local-backup-templates` unchanged as the visual base, while replacing local-only data with the existing Supabase cloud database.

## Deploy
1. Replace the contents of the existing cloud GitHub repository with this package.
2. Keep the existing Vercel environment variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Deploy.

The root app redirects to `/legacy/index.html` where the approved interface runs. Data, login, active visits, closed visits, collections, customer updates, plans and manager view are read from Supabase.

## Invitation URL configuration
In Supabase Auth URL Configuration add:
- `https://YOUR-VERCEL-URL`
- `https://YOUR-VERCEL-URL/accept-invitation`

## Notes
- The original visual structure, labels, card hierarchy and mobile layout are retained from the approved local-backup package.
- Managers see an additional Manage tab after login.
- Customer import and journey/collection template imports use the shared database for Head of Food Service roles.

## Deployment fix, 5 July 2026
This release pins Node 22 and matching React / React DOM versions. It also tells Vercel to install with `--legacy-peer-deps` to avoid the NPM peer-dependency resolution issue. Do not add a package-lock.json from another environment.
