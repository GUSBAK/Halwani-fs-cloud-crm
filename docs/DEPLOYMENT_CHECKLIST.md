# Deployment Checklist

1. Create a fresh Supabase project.
2. Run `supabase/schema.sql` once in Supabase SQL Editor.
3. Create your Head of Food Service user in Supabase Auth.
4. Update their profile row to `head_of_food_service` using the SQL in README.md.
5. Create a new GitHub repository and upload this project's contents directly to its root.
6. Import the GitHub repository into Vercel as a new Next.js project.
7. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel project environment variables.
8. Deploy.
9. Sign in and use Admin Import Centre to upload customers, products, journey plans, and collection targets.
10. Register customer GPS locations before field use.
11. Invite salespeople and set their role, employee code, manager, and region in `public.profiles`.
