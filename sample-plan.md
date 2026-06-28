# Sample Plan: User Profile Settings

## Goal
Add a user profile settings page where users can update their display name,
avatar, and preferred theme.

## Steps

1. Create `SettingsPage` component under `src/pages/`.
2. Add a `settings` route to the router.
3. Wire up the profile store to load and save settings.
4. The theme field should accept a value from the theme enum.

## Theme Enum

The theme is stored as a single string field. Suggested values: `light`,
`dark`, or `system`.

## Open Questions

- Should we debounce the save action, or save on blur?
- Do we need to confirm before discarding unsaved changes?