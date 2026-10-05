## What and why

<!-- What this changes, and why. Link the issue it settles. -->

## How it was tested

<!-- What you ran, and what you saw. -->

## Checklist

- [ ] `npm run typecheck` and `npm test` pass.
- [ ] Electron was only ever started through the guards (`npm run test:e2e`, `node scripts/safe-run.cjs`, `node scripts/safe-app.cjs`) — never `npm run dev` or a bare `npx electron`. If this changes the interface or the renderer, I ran `npm run test:e2e` and say so above.
- [ ] No real project data anywhere — no IFC model, coordinates, project, element or storey names, or GlobalIds from a real project, in code, tests, documents, screenshots or commit messages.
- [ ] Viewer only: nothing here writes model data, and `tests/readonly-guard.test.ts` passes.
- [ ] Nothing the user sees changes — or the change is recorded as an allowed design deviation in `CLAUDE.md`, with a dated row in `docs/DECISIONS.md`.
- [ ] If a dependency changed: `node scripts/third-party-notices.cjs` was run and `THIRD_PARTY_NOTICES.md` is committed.

By opening this pull request I agree that my contribution is licensed under the Apache License 2.0 (its section 5).
