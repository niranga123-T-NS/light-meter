# DIMO Lighting Operations System

Sales, Design & Estimation Monitoring System for **DIMO – Lighting Solutions**: one linked record from the
first sales visit to the submitted quotation, with every hand-off timed and every delay escalated automatically.

* **Mobile app** (iOS / Android) for field sales: My Day, GPS check-in (works offline), weekly plans, projects,
  inquiries, pending designs and estimations, debtors, samples.
* **Web portal** for managers, designers and estimators: dashboards, design and estimation boards, approvals,
  reports with branded PDF and Excel export, administration.
* **Supabase** backend: the whole workflow, the SLA engine, notifications and role-based visibility live in the database.

Built with Expo SDK 57 (Expo Router, one codebase for web and mobile), Supabase, EAS and Vercel.

**Start here → [docs/IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md)**

```bash
cp .env.example .env     # Supabase URL + anon key
npm install
npx expo start           # w = web
npx tsc --noEmit && npx expo lint
```
