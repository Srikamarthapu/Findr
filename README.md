# Findr

Findr is a professional, source-conscious event discovery prototype for young
people in San Francisco and the Bay Area. It combines a browsable upcoming-event
catalog with a grounded concierge that keeps uncertain eligibility visible.

## Current product status

- Discovery, filtering, sorting, event details, save, share, dismiss, and
  responsive layouts are implemented.
- Supabase email/password account UI and session handling are implemented. A
  Supabase project URL and publishable key are required to activate them.
- The visible catalog contains eight real, scheduled events verified against
  canonical Luma structured data on July 23, 2026. Every card links to the exact
  organizer event page. This is a verified snapshot, not an automatically
  synchronized Luma feed.
- The local Findr guide uses structured retrieval over that verified catalog,
  then calls NVIDIA NIM DeepSeek V4 Pro, NVIDIA NIM DeepSeek V4 Flash, Z.ai,
  and DeepSeek in order. Model output is buffered and validated before the UI
  receives it; an honest retrieval-only response remains available if every
  provider fails.
- Supabase currently stores identity only. Event records live in the versioned
  catalog, while saved and dismissed event IDs stay in browser storage.

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

## Local AI setup

Add server-only provider credentials to `.env.local`:

```dotenv
NVIDIA_NIM_API_KEY=
ZAI_API_KEY=
DEEPSEEK_API_KEY=
```

Never prefix provider credentials with `VITE_`. The live guide endpoint is
mounted only by the local Vite development server. The current static Sites
worker intentionally does not provide `/api/guide`; a production deployment
needs a server function or edge function before the live concierge is enabled.

## Local development

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

## Validation

```bash
npm run build
npm run test:guide
npm run verify:events
npm run test:secrets
npm run test:sites
```

The build also prepares the artifact structure used by OpenAI Sites.
