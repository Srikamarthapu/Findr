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
- Use real Supabase Auth for account creation and sign-in; never present simulated authentication as live.
- Clearly label demo catalog records and local guide responses until live event ingestion and an external model provider are actually connected.
