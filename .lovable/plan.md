# WP0D-1 Font Scale, Workspace Safety, and Test Completion

## Verified starting point

- Lovable Project ID: `b3e9b910-2e99-4ccf-83cd-e1681bfea420`.
- Required input commit exists as `d1377e9da9b30795e8da13f6746897b95c613764`, titled `Stabilised build & tests`.
- The current child commit differs from that input only through known platform-generated residue: browser auth files and a reformatted frozen database types file. No unknown product-file drift was found.
- The mounted preview was inspected. It builds successfully and has an authenticated N3 session, but that session is role-unassigned, so protected screens and authenticated visual checks are not currently available.

## Implementation

1. **Restore the locked boundary first**
   - Remove regenerated browser-auth files.
   - Restore the frozen generated database types file to its approved bytes and SHA-256.
   - Keep packages, migrations, server/API/N3 code, calculations, permissions, and generated route structure unchanged.

2. **Apply real root font scaling**
   - Replace wrapper-only scaling with one allowlisted, SSR-safe root-font helper/hook that applies Small `90%`, Standard `100%`, or Large `112.5%` to the HTML element after hydration.
   - Preserve same-tab events, cross-tab storage events, invalid/throwing/quota storage handling, in-memory fallback, cleanup, and the existing storage key.
   - Keep display width independent, enforce at least 16px editable controls on mobile while allowing Large to grow, and reset font scaling for A4 quotation printing.

3. **Make workspace registration and capacity safe**
   - Stop AppShell/URL presence from creating placeholder project tabs.
   - Register or update a project only after permission and successful visible workspace data return; remove a proven stale inaccessible/not-found entry without deleting valid entries on transient errors.
   - Centralize ordinary same-tab activation checks so Projects, Dashboard, workspace links, deep links, and successful enquiry conversion enforce the same eight-project cap.
   - Preserve modified-click, middle-click, and new-browser-tab behavior without mutating the originating workspace.

4. **Correct workspace navigation semantics and dirty-draft flow**
   - Render A as labelled navigation with real links, `aria-current`, separate named close buttons, horizontal containment, and complete Left/Right/Home/End/Enter/Space behavior.
   - Restore predictable focus after inactive and active closes.
   - Centralize the New Enquiry discard decision so route changes, workspace switches, close actions, history navigation, and browser unload produce exactly one prompt path; successful submit bypasses it and failed submit preserves the draft.

5. **Correct project section relationships**
   - Keep the approved six sections and Quotation permission gate.
   - Point all rendered B tabs to one stable, existing active panel and label that panel from the active tab.
   - Add complete keyboard activation while preserving URL/deep-link/history behavior, Overview fallback, one A entry per project, and active-only section mounting.

6. **Complete restrained card treatment**
   - Make the shared neutral Card subtly tinted by default.
   - Apply information, project, financial, or destructive tones only where meaningful across current Dashboard, register, project, budget/BOQ, quotation chrome, Settings, roles, verification, capability, and state surfaces.
   - Preserve table scrolling, contrast, button hierarchy, and white/black quotation print output.

7. **Add the required behavioral matrix**
   - Expand focused tests for root font behavior and storage failures/events/cleanup, mobile and print contracts, and display-width independence.
   - Add mounted workspace tests for registration timing, cap behavior at every entry point, modified clicks, semantics, keyboard/focus, lifecycle clearing, stale/transient project outcomes, and memory-only state.
   - Add mounted dirty-enquiry tests for clean/dirty close, cancel/confirm, global/workspace/history navigation, before-unload, successful replacement, and failed-save retention.
   - Add mounted B-section tests for every permitted section, permission fallback, panel relationships, keyboard/history/deep links, active-only mounting, and A deduplication.
   - Add representative semantic-card and print tests while retaining New Enquiry payload/date/layout and C-link regressions.

8. **Verify without publishing**
   - Run the requested frozen install, whole-repository formatting check, typecheck, both complete test runs, lint, production build, diff check, status check, frozen hash, integration-directory check, and authorized-boundary diff review.
   - Record exact totals and any known warnings. Mark protected viewport/zoom and print evidence `NOT VERIFIED` unless a role-authorized N3 session becomes available.
   - Produce the requested 18-point factual candidate report for external audit, without self-acceptance, publishing, deployment, or another milestone.
