# Halwani FS Cloud CRM, corrected deployment package

## Important deployment fix

The earlier package contained a `package-lock.json` generated with a private build registry. Vercel could not access that registry and `npm install` failed. This package removes that lock file, adds `.npmrc` pointing to the public npm registry, and uses the lighter `xlsx` library for Excel imports.

**Do not upload any old `package-lock.json` file.**

## Upload checklist

At GitHub repository root, keep these folders/files directly:

- `app/`
- `lib/`
- `public/`
- `supabase/`
- `package.json`
- `.npmrc`
- `vercel.json`
- `.env.example`

There must be **no** `package-lock.json` in the repository after this update.

---

# Halwani Food Service Cloud CRM

This is the production cloud foundation for the Food Service visit app.

It replaces device-only data with:

- Secure user login
- Central Supabase database
- Live management dashboard
- GPS-verified visit check-in and close-out
- Salesperson journey plans
- Collection targets and receipts
- Customer master updates
- Competitor intelligence
- Action tracking
- Local download of a central JSON backup

## 1. Create the Supabase project

1. Create a new project at Supabase.
2. Open **SQL Editor**.
3. Copy all content from `supabase/schema.sql` and run it once.
4. In **Authentication → Users**, create your first email/password user.
5. Run this in SQL Editor, changing email and employee code:

```sql
update public.profiles
set
  full_name = 'Ghassan Baker',
  role = 'head_of_food_service',
  region = 'KSA',
  employee_code = 'GUS001'
where email = 'your-email@halwani.com';
```

Create every salesperson in Authentication first. Then complete their matching profile row:

```sql
update public.profiles
set
  full_name = 'Salesperson Name',
  employee_code = 'EMP001',
  role = 'salesperson',
  region = 'Jeddah',
  manager_id = 'MANAGER_PROFILE_UUID'
where email = 'salesperson@halwani.com';
```

Roles:

- `admin`: full system access
- `head_of_food_service`: full system access and imports
- `national_manager`: all management data, no bulk imports
- `regional_manager`: region management data
- `supervisor`: region management data
- `salesperson`: own customers, visits, collection records, plan, approved-customer entry

## 2. Configure Vercel

Import this repository into Vercel as a new project.

Framework: **Next.js**

In **Project Settings → Environment Variables**, add:

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

For older Supabase projects you can use this instead of the publishable key:

```text
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Redeploy after saving environment variables.

## 3. First data load

Sign in as Head of Food Service.

Open **Admin → Admin Import Centre**.

Import in this order:

1. Customer database
2. Product master
3. Monthly journey plan
4. Monthly collection targets

Exact templates are in `public/templates/`:

- `monthly_journey_plan_template.xlsx`
- `monthly_collection_targets_template.xlsx`

The app supports the exact attached template headings, including `Customder Code`, `customerName`, and `dueDate`.

## 4. GPS rules

- A visit can start only when the device is within the customer GPS radius. Default: **20 metres**.
- A visit can close only within the same radius.
- The app records a GPS point at check-in, while an active visit is open, and at close-out.
- The manager dashboard shows the last verified location only for active visits.

## 5. Daily management view

The Management Dashboard shows:

- Active visits now
- Planned versus completed visits today
- Journey completion by salesperson
- Last verified location for active visits, opening in Google Maps
- Monthly collection target and collected value
- Open actions and short-visit flags

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Security model

- Supabase Row Level Security controls who can view and change data.
- Salespeople see their own assigned data.
- Regional managers and supervisors see their region.
- National, Head of Food Service, and Admin roles see the full operation.
- Only Head of Food Service and Admin roles can run shared imports and export a central backup.
