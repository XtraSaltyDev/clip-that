# ClipThat UI contract v1

This contract records the existing patterns used as the Priority 2 consistency baseline. It is intentionally small: shared renderer primitives remain in `theme.css` and `ui.tsx`; surface-specific layout stays with each surface.

- Spacing: use the shared 4, 8, 12, 16 and 24px steps. Dense tool chrome may use 4–8px; forms and grouped content use 12–16px; page sections use 24px.
- Type: 13px body text is canonical. Use 11–12px for secondary facts and uppercase section labels, 14px for compact window titles, and 22px for page titles. Essential labels never use muted colour alone.
- Controls: `btn`, `field`, `segmented`, `Toggle` and `Slider` are canonical. Primary actions use one solid accent treatment per decision group; secondary actions use the standard or ghost treatment.
- Targets and focus: common controls are at least 32px high, keyboard focus uses the shared 2px accent ring, and selected state is exposed in text/ARIA as well as colour.
- Surfaces: `card`/existing surface cards use the shared radii, border and elevation. Avoid adding a card when spacing or a divider expresses the grouping.
- Status: pair colour with a visible state label and actionable copy. Use supported, unavailable, unverified, permission-needed and device-error language without implying runtime verification.
- Progressive detail: show the primary decision and the next action first. Technical checks, device detail and secondary commands remain reachable through existing disclosure, inspector, overflow or command-palette patterns.
- Platform language: renderer shortcut labels use the shared platform modifier (`Cmd` on macOS, `Ctrl` on Windows); paths and capability copy stay platform-specific.

Canonical examples: Library toolbar for primary/secondary action hierarchy, compact Editor overflow for preserved advanced commands, Settings field rows for labels plus explanations, and Recorder readiness for status plus progressive technical detail.
