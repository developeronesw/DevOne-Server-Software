# DevOne Server — Premium Light UI Contract

Approved design direction: bright professional glass-SaaS, based on the October 2026 design review.

## Principles
- Pearl white, soft lavender and electric blue; translucent surfaces, precise layout, rounded cards, layered depth.
- Typography: Manrope for headings and DM Sans for UI text, with safe system fallbacks.
- Desktop / tablet / phone layouts; clear focus indicators and reduced-motion support.
- No fabricated monitoring data, application inventory, activity history, or working integrations.
- Never change backend authentication/session semantics to implement visual styling.
- Action buttons must map to existing API endpoints; critical service/site actions retain confirmation and job tracking.
- Features not available in the Node edition must appear as upcoming, not simulated operational screens.

## Implemented
- Full-page split brand/owner login; responsive decorative server illustration, accessible password visibility and errors.
- Premium dashboard shell; sidebar, status header, live resource cards, dynamic services/sites lists, queued activity and system details.
- Dedicated service controls, website/file workspace, job activity, owner vault views using pre-existing endpoints.
- Styling built with CSS and inline SVG; no new runtime dependencies.

## Current limitations
- API metrics supply CPU cores, load averages, memory, uptime, not sampled CPU percentage or time-series analytics.
- Apps, databases, backups, and full monitoring modules are not yet available in the Node edition.
- Social sign-in and password reset were intentionally not advertised: no supported backend.
- UI deployment to existing VPS is separate from pushing the source branch; the fresh-only installer is not an updater.

## Acceptance
Build with pnpm --filter @devone/dashboard build. Check owner sign-in, auth failure, sign-out, live data, service operations, static website/file actions, responsive behavior, and keyboard operation on a test VPS.
