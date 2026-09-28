# DevOne Server — UI Design Contract

Status: LOCKED — SOURCE OF TRUTH

The official DevOne Server Glass UI recovered from the project Library is the visual source of truth for the new rebuild.

## Preserve
- overall information hierarchy
- navigation model
- dashboard composition
- glass-card and bento layouts
- rounded surfaces and subtle borders
- depth, shadow and restrained glow
- metrics and server status
- sites, databases, runtimes, files and VHosts
- DNS, SSL, containers and deployments
- authenticated terminal
- DevOne AI
- hosting/provider workflows
- responsive behavior
- premium SaaS feel

## Change only the theme
Dark backgrounds become warm/off-white backgrounds.
Dark glass becomes frosted white/light glass.
Light text becomes dark high-contrast text.
Heavy neon glow becomes restrained accent glow.
Purple/orange/cyan accents remain part of the DevOne identity.

## Do not turn it into
- generic Bootstrap
- flat white admin software
- a dark UI with slightly lighter panels
- a completely new visual language

## Architecture separation
The visual reference does not override the new implementation architecture:

Browser -> React/Vite Dashboard -> Node.js/TypeScript API -> DevOne Agent -> Ubuntu host

The old reference may contain historical Go/NGINX implementation details. Those are visual/reference context only unless explicitly adopted by the new architecture.

## Acceptance rule
Before accepting a UI feature, compare it against the official reference and ask:

Does this look like DevOne Server translated from dark Glass to light Glass?

If not, the UI is not complete.