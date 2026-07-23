# Findr

Findr is a professional, source-conscious event discovery prototype for young
people in San Francisco and the Bay Area. It combines a browsable weekend
catalog with a grounded concierge that keeps uncertain eligibility visible.

## Current product status

- Discovery, filtering, sorting, event details, save, share, dismiss, and
  responsive layouts are implemented.
- Supabase email/password account UI and session handling are implemented. A
  Supabase project URL and publishable key are required to activate them.
- The Findr guide currently uses deterministic local responses; no external AI
  model is connected yet.
- The three visible events are clearly labeled demo catalog records; no live
  event feed is connected yet.

## Supabase setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Add the project URL and browser-safe publishable key:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
   ```

4. In Supabase Auth URL Configuration, use `http://localhost:4173` as the local
   Site URL and allow `http://localhost:4173/**` as a redirect URL.

Never place a Supabase secret key or `service_role` key in this frontend.

## Local development

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

## Validation

```bash
npm run build
npm run test:sites
```

The build also prepares the artifact structure used by OpenAI Sites.
