# Findr

Findr is a professional, source-conscious event discovery prototype for young
people in San Francisco and the Bay Area. It combines a browsable upcoming-event
catalog with a grounded concierge that keeps uncertain eligibility visible.

## Current product status

- Discovery, interactive date filtering, sorting, event details, save, share,
  dismiss, and responsive layouts are implemented.
- Supabase email/password account UI, session handling, and a confirmed
  account-deletion flow are implemented. Sign-in needs the project URL and
  publishable key; deletion additionally needs a server-only secret key.
- The visible catalog is a generated snapshot of current, real events from
  DataSF Our415, SF Recreation and Parks' official RSS, Palo Alto City
  Library's official event RSS, Luma's supported San Francisco city iCal, and
  a small set of re-verified organizer-hosted Luma pages. Every card links to
  the exact event page; mock records and generic landing pages are rejected.
- The local Findr guide first collects age, interests, travel area,
  availability, and budget. It does not retrieve or recommend events until
  that profile is complete. It then uses structured retrieval over the
  verified catalog and calls NVIDIA NIM DeepSeek V4 Pro, NVIDIA NIM DeepSeek V4
  Flash, Z.ai, and DeepSeek in order. Model output is buffered and validated
  before the UI receives it; an honest retrieval-only response remains
  available if every provider fails.
- Supabase currently stores identity only. Event records live in the versioned
  catalog, while saved and dismissed event IDs stay in browser storage.

## Event data

`src/events.json` is the committed, demo-safe catalog snapshot and
`src/catalog-meta.json` records when it was generated, its active sources, and
any source warnings. Refresh both files with:

```bash
npm run sync:events
```

The sync runs server-side, normalizes all feeds to one schema, removes ended,
cancelled, full, duplicate, or unreachable records, and keeps a diverse subset
instead of allowing one source or venue to overwhelm the product. If a feed is
temporarily unavailable, its still-current records from the last committed
snapshot remain available.

Source metadata is intentionally conservative:

- Cost is `Cost not published` unless a source provides an exact price or says
  the event is free.
- Audience labels from open data or RSS are retrieval hints, not confirmed age
  policies.
- Descriptions are short excerpts. Attribution and a direct organizer link stay
  attached to every record.

Active inputs:

- [DataSF Our415](https://data.sfgov.org/Economy-and-Community/Our415-Events-and-Activities/8i3s-ih2a)
  for SF Public Library and community-organization listings.
- [SF Recreation and Parks calendar RSS](https://www.sfrecpark.org/rss.aspx)
  for event-specific city park listings.
- [Palo Alto City Library events](https://paloalto.bibliocommons.com/events)
  through its official event RSS.
- [Luma San Francisco](https://luma.com/sf) through Luma's documented city
  iCal subscription. Findr selects AI, startup, builder, hackathon, demo, and
  research events, then rechecks each event's structured organizer page.
- Organizer-hosted Luma pages already curated in the catalog, re-verified from
  their canonical structured event data on each sync.

Cerebral Valley is useful for understanding the desired event mix, but its
events page does not publish a supported API, RSS, iCal feed, or reuse license.
Findr therefore does not scrape it. Many of the same organizer events enter
through Luma's supported city subscription; a direct Cerebral Valley adapter
should wait for written feed permission.

The Our415 adapter works without credentials. A free Socrata app token is
optional but useful for a dedicated request pool:

```dotenv
DATASF_APP_TOKEN=
```

## Supabase setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Add the project URL and browser-safe publishable key:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
   ```

4. To activate permanent account deletion in the local demo, add a
   server-only secret key. A legacy service-role JWT remains supported:

   ```dotenv
   SUPABASE_SECRET_KEY=
   # Legacy fallback:
   SUPABASE_SERVICE_ROLE_KEY=
   ```

5. In Supabase Auth URL Configuration, use `http://localhost:4173` as the local
   Site URL and allow `http://localhost:4173/**` as a redirect URL.

Never prefix an admin key with `VITE_`, place it in browser code, or
commit it. The local Vite server reads it from `.env.local`; the production
equivalent belongs in a protected server or edge-function secret.

## Local AI setup

Add server-only provider credentials to `.env.local`:

```dotenv
NVIDIA_NIM_API_KEY=
ZAI_API_KEY=
DEEPSEEK_API_KEY=
```

Never prefix provider credentials with `VITE_`. The same bounded guide and
account endpoints run through local Vite middleware, the bundled Sites Worker,
and the Node serverless handlers under `api/` for Vercel. Configure provider
and Supabase admin credentials only in the selected host's protected server
environment.

For Vercel, `vercel.json` builds the Vite client, preserves filesystem API
routes before the SPA fallback, and gives the provider cascade enough time to
reach its retrieval-only fallback. Add the deployed origin to Supabase Auth's
Site URL and allowed redirect URLs before testing confirmation emails.

## Local development

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
```

## Validation

```bash
npm run build
npm run test:account
npm run test:guide
npm run test:events
npm run verify:events
npm run test:secrets
npm run test:sites
```

The build also prepares the artifact structure used by OpenAI Sites.
