# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Findr design direction

- Use the refined second concept at `/Users/kamarthapusri/.codex/generated_images/019f908e-ecfe-7fa1-b517-0485ce151afd/call_FXisUUS3bIkJ9fmGrcQIibkX.png` as the visual source of truth.
- Preserve the editorial date rail, central event results, and persistent grounded-concierge panel.
- Keep the product professional and calm: deep ink navy, mineral white, restrained teal/sage, and brick only for dates or uncertainty.
- Avoid neon, arcade typography, leaderboard cues, HUD styling, glow, and other gamified treatments.
- Prioritize scanability, honest eligibility states, source freshness, visible focus, and simple navigation.
- The guide must begin with conversational profile intake and collect age, interests, travel area or city, availability, and budget before it retrieves or recommends events. Greetings and incomplete profiles must never trigger recommendations.
- Keep guide dialogue continuous: greet at most once, briefly acknowledge only newly captured details, ask exactly one next-missing question, and never restart onboarding or narrate the intake process on later turns.
- Account deletion must be a real, irreversible Supabase Auth deletion performed server-side after re-verifying the current session. Never expose the service-role key or accept a user ID from the browser.
- Treat the editorial calendar rail as navigation, not decoration: users must be able to select a date, see only events on that date, understand dates with verified events, and clear the date filter.
- Use real Supabase Auth for account creation and sign-in; never present simulated authentication as live.
- Show only source-verified real events with direct, event-specific organizer links; never mix mock records into the visible catalog.
- Build the catalog from refreshable official open-data or RSS sources, normalize and deduplicate every record, retain provenance and freshness, and commit a verified snapshot so the demo never falls back to mock data when a feed is unavailable.
- Make Bay Area AI and startup gatherings a first-class discovery lane: prioritize hackathons, founder and builder meetups, research talks, workshops, demo nights, and technical networking from supported official feeds or organizer pages. Do not scrape Luma Discover or Cerebral Valley HTML.
- Keep organizer age policies unknown unless a source explicitly confirms them, even when an event mentions students.
- Keep AI provider keys server-only in ignored environment files and expose provider/model status without exposing credentials.
- Let users close and reopen the Findr concierge without losing the current conversation.
- Keep the concierge welcoming for brief event-related greetings and small talk while still requiring the profile before recommendations. After grounded recommendations, offer a clear action to show the same verified events as interactive cards in the main event catalog.
- Use muted ochre yellow for the main date and uncertainty accent instead of red/orange; reserve red for destructive account actions and serious errors.
