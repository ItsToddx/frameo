# Verification

The repository separates contract evidence, native media evidence, desktop evidence and paid-model evidence.

| Check | Proves |
| --- | --- |
| `npm run typecheck` | Strict TypeScript compatibility across the app, core and SDK. |
| `npm test` | Public editing/SQLite behavior, Pi tool loops on a local stream, Seedance HTTP contracts, native Kit boundaries and actual FFmpeg outputs. |
| `npm run build` | Production main/preload/workers and renderer compile. |
| `npm run test:desktop` | Actual Electron IPC, mandatory model setup, import, trim/caption, undo/redo, composed playback, MP4 export and project reopen. |
| SDK build | Kit authors can compile the public package independently. |
| Paid account acceptance | Real Ark inference, Seedance task creation, polling and candidate download on the selected account. |

Tests contain no real keys. Provider fixtures deliberately simulate lost submit responses, rejected authentication, cancellation races, missing output and changed task IDs. These are protocol checks, not claims of an actual Seedance generation.

Native rendering checks decoded pixels at exact frame boundaries, including a first tick at 7/24 second, independent source split boundaries, Chinese captions, audio gain and muted tracks, exact frame count, dimensions and complete decoding. Use the native macOS host to permit VideoToolbox; the restricted shell sandbox can reject encoder sessions.

Desktop evidence is written to `test-results/desktop-smoke/evidence.json` and the workspace screenshot under `docs/images/`. It uses an isolated profile and a labeled synthetic test image. The screenshot demonstrates the running editor, not model-generated footage.

Release acceptance additionally checks the packaged application, clean-profile first use, installed native tools and worker resolution. Apple Developer signing, notarization and real paid-account acceptance require the owner's credentials; source/fixture tests cannot prove those gates.

Implementation review used the initial repository commit as a fixed baseline and checked both documented standards and the supplied desktop requirements. Fixes include aborted preparation, crash-safe shared budgets, exact recipe approvals, core-owned idempotent undo/redo, confined session files, registered-only media access, and explicit memory confirmation. A small duplicate proposal-construction helper remains a refactoring opportunity; it does not create another write path.

## Current preview evidence

The macOS Apple Silicon release was built and checked locally on 2026-10-13:

- Strict typecheck and all 113 tests passed, including actual source-frame/audio inspection and native media composition.
- The final ZIP was extracted separately; its ad-hoc signature passed strict verification.
- The extracted packaged app passed the desktop smoke: model setup gate, isolated preload/IPC, media import, trim/captions, undo/redo, actual composed playback, 90-frame MP4 export, reopen, native Kit installation/execution, authored recipe bindings and exact reviews.
- Runtime dependency audit reported zero vulnerabilities. The standalone SDK built and packed with its license.
- DMG, ZIP, SDK and the corresponding FFmpeg source archive have SHA-256 checksums.

One authorized real Seedance creation request was made on 2026-10-13 through the production provider and durable job runner, in an isolated project. Ark returned HTTP 404 / `ModelNotOpen` for `doubao-seedance-2-5-260628`: the selected model was not activated on the account. The app persisted a failed job without a remote task ID and did not resubmit. Credentials were loaded only into memory; no credentials or account identifiers are published.

Successful real Seedance generation, polling, collection and decoding remain unverified until an activated model or endpoint is supplied. Paid Ark chat inference remains untested. The preview is ad-hoc signed; Apple Developer ID signing/notarization has not been performed.
