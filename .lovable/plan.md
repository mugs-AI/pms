# WP0D Compact UI, Workspace Tabs, and Font Scale

## Scope

Implement the approved UI-only milestone without changing server APIs, database code, N3 contracts, calculations, authentication, RBAC, packages, migrations, or quotation print behavior.

## Implementation

1. **Restore the locked frontend boundary**
   - Remove the known regenerated browser-auth files.
   - Restore the frozen generated database types file to its approved exact bytes and hash.

2. **Compact New Enquiry**
   - Reflow Project Details to three columns on desktop, two on tablet, and one on mobile.
   - Keep Malaysian date controls, ISO payload values, validation focus, and the stable request ID unchanged.
   - Replace customer modes with one required `Customer` picker while keeping the existing POST shape fixed to `linked_existing`.
   - Merge Customer and Primary Phase into one subtly tinted card.

3. **Shared presentation system**
   - Add restrained semantic card and button variants using existing theme roles plus a small set of new semantic surface tokens.
   - Apply variants only to current ProjectHub presentation surfaces where meaning is clear.
   - Preserve focus, disabled, destructive, and print states.

4. **System-wide font preference**
   - Add Small (90%), Standard (100%), and Large (112.5%) settings beside Display Width.
   - Mirror the accepted SSR-safe, same-tab, cross-tab, blocked-storage, and memory-fallback behavior.
   - Apply the selected scale once at the authenticated shell root; persist only `projecthub:font-size`.

5. **A — in-memory workspace tabs**
   - Add an application-memory-only workspace registry capped at eight saved projects plus one New Enquiry tab.
   - Reconstruct only the current project after reload, deduplicate project tabs across section changes, retain each tab’s last section, and clear state on sign-out, anonymous state, or tenant change.
   - Add accessible keyboard navigation, separate close actions, narrow horizontal scrolling, predictable active-tab closing, and a truthful cap message.
   - Add dirty New Enquiry navigation/close confirmation and browser unload protection without persisting draft data.

6. **B — URL-addressable project sections**
   - Validate a lowercase `section` search parameter with `overview` as the safe fallback.
   - Keep `budget` as the stable URL value.
   - Use accessible tabs with arrow/Home/End behavior and matching tab panels.
   - Mount only the active permitted section; unauthorized Quotation resolves to Overview and never mounts.

7. **C — small browser-tab link**
   - Add an unobtrusive `Open in new tab ↗` link near the project heading.
   - Include only the current project path and permitted section; use safe new-tab attributes.

8. **Verification**
   - Add focused unit and mounted behavioral tests for New Enquiry, font preference, workspace tabs, URL sections, and the new-tab link.
   - Preserve all existing tests and architecture guards.
   - Run frozen install, formatting, typecheck, full tests, lint, production build, diff check, integration-directory/hash checks, and boundary diffs.
   - Inspect authenticated responsive/zoom states only if a real N3 session is available; otherwise report them as `NOT VERIFIED`.
   - Do not publish, deploy, self-accept, or begin later milestones.
