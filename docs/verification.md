# Verification

The repository separates contract evidence, native media evidence, desktop evidence and paid-model evidence.

| Check                                                | Proves                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                  | Strict TypeScript compatibility across the app, core and SDK.                                                                                                |
| `npm test`                                           | Public editing/SQLite behavior, Pi tool loops on a local stream, Seedance HTTP contracts, native Kit boundaries and actual FFmpeg outputs.                   |
| `npm run build`                                      | Production main/preload/workers and renderer compile.                                                                                                        |
| `npm run test:desktop`                               | Actual Electron IPC, mandatory model setup, import, trim/caption, undo/redo, composed playback, MP4 export and project reopen.                               |
| `npm run test:desktop-failures`                      | Actual Electron failure messages, redacted keys, unknown submissions, cancellation guidance and reopening without network requests.                          |
| `npm run test:desktop-generated -- --project <path>` | Adoption and editing of an already generated project copy, real composed playback, captioned 120-frame export and reopening, with all cloud fetches blocked. |
| `npm run test:desktop-languages`                     | English default, both-language native controls/notices, persistence, retained drafts and authored-content preservation in actual Electron.                   |
| SDK build                                            | Kit authors can compile the public package independently.                                                                                                    |
| Paid account acceptance                              | Real Ark inference, Seedance task creation, polling and candidate download on the selected account.                                                          |

Tests contain no real keys. Provider fixtures deliberately simulate lost submit responses, rejected authentication, cancellation races, missing output and changed task IDs. These are protocol checks, not claims of an actual Seedance generation.

Native rendering checks decoded pixels at exact frame boundaries, including a first tick at 7/24 second, independent source split boundaries, Chinese captions, audio gain and muted tracks, exact frame count, dimensions and complete decoding. Use the native macOS host to permit VideoToolbox; the restricted shell sandbox can reject encoder sessions.

Desktop evidence is written to `test-results/desktop-smoke/evidence.json` and the workspace screenshot under `docs/images/`. It uses an isolated profile and a labeled synthetic test image. The screenshot demonstrates the running editor, not model-generated footage.

Release acceptance additionally checks the packaged application, clean-profile first use, installed native tools and worker resolution. Apple Developer signing, notarization and real paid-account acceptance require the owner's credentials; source/fixture tests cannot prove those gates.

Implementation review used the initial repository commit as a fixed baseline and checked both documented standards and the supplied desktop requirements. Fixes include aborted preparation, crash-safe shared budgets, exact recipe approvals, core-owned idempotent undo/redo, confined session files, registered-only media access, and explicit memory confirmation. A small duplicate proposal-construction helper remains a refactoring opportunity; it does not create another write path.

## Framo 0.3.0 evidence

The final macOS Apple Silicon ZIP was extracted into a clean temporary directory and checked on 2026-10-14:

- Strict typecheck, production/SDK builds, formatting and all 166 tests pass. Runtime dependency audit reports zero vulnerabilities. Ad-hoc signature, DMG integrity and all four release checksums pass.
- The extracted application passes all five desktop suites: bilingual default/persistence/native menu/dialog/error checks; import, editing, Kit workers, exact reviews and MP4 export; both-language model failure/unknown-submit handling; editing an existing generated candidate with captioned 120-frame export; and focus, IME, retained drafts, history, busy dialogs and minimum-window layout.
- A clean or older profile without a language preference starts in English. Switching updates already displayed tool notices without a snapshot, preserves matching user/model text, and retains settings, composer and caption drafts. The language choice survives app relaunch without credentials.
- Prompt-derived Seedance task titles remain authored content, including prompts that resemble system messages. Canonical stored errors, task IDs, account references, inputs and cancellation state survive both-language presentation and reopening.
- A golden legacy pending generation review remains acceptable after switching language; its original approval hash and task/account fields are unchanged. Legacy Frameo/Reelbeam shared formats, profile selection and built-in fingerprints are covered by regression checks.
- Standards review raised one visible-label issue; Spec review raised authored task-title translation and stale chat system notices. All three are fixed and independently rechecked with no remaining actionable finding in that scope.
- The README image is the actual packaged application in English, using synthetic acceptance data. All model/provider requests in this update use local controlled fixtures; no new paid inference occurred. Developer ID signing/notarization and paid Ark chat acceptance remain outside this release verification.

## Frameo 0.2.0 evidence

The rebuilt macOS Apple Silicon package was checked locally on 2026-10-13:

- Strict typecheck, production build, standalone SDK build, formatting check and all 153 tests pass. Runtime dependency audit reports zero vulnerabilities.
- The final ZIP was extracted into a clean temporary directory and its ad-hoc signature passed strict verification. Release checksums and DMG integrity passed.
- The extracted application passed all four desktop suites: native import/edit/undo/preview/export/reopen and Kit/workflow reviews; model-failure and unknown-submit handling; generated-media adoption and captioned 120-frame export; modal focus, IME/draft/history behavior, exact UI review adoption, frame keyboard movement, busy dismissal and 1120×760 / 1520×1000 layout.
- Old 1.0.0 built-in fingerprints match the v0.1.1 baseline. Frozen recipes resume after reopen; changed capability content still invalidates approval. No frozen task/account identity is rewritten.
- A synthetic profile created by the old packaged application was opened by Frameo. Its old ciphertext is unreadable under the new app identity; explicitly saving a replacement now succeeds and retains an encrypted backup. Unit tests verify byte preservation, rollback on failed installation, unavailable-Keychain refusal, readable account retention and absence of account remapping.
- Code review found two issues: legacy builtin fingerprint changes and incomplete busy dismissal. Both are fixed and re-reviewed. A further real-package fake-key upgrade check exposed the vault replacement issue; that is fixed and verified too. The Standards review found no actionable introduced violation.
- No new paid inference occurred during this refactor. The real-generated-media check uses a copy of the previously authorized result. Paid chat inference and Apple Developer ID signing/notarization remain outside this acceptance.

## Earlier v0.1.1 evidence

The macOS Apple Silicon release was built and checked locally on 2026-10-13:

- Strict typecheck and all 117 tests passed, including actual source-frame/audio inspection, native media composition and persisted authentication/model/account-limit failures.
- The final ZIP was extracted separately; its ad-hoc signature passed strict verification.
- The extracted packaged app passed the desktop smoke: model setup gate, isolated preload/IPC, media import, trim/captions, undo/redo, actual composed playback, 90-frame MP4 export, reopen, native Kit installation/execution, authored recipe bindings and exact reviews.
- Runtime dependency audit reported zero vulnerabilities. The standalone SDK built and packed with its license.
- DMG, ZIP, SDK and the corresponding FFmpeg source archive have SHA-256 checksums.

Three separately authorized real Seedance checks were made on 2026-10-13 through the production provider and durable job runner, in isolated projects. The first creation request returned HTTP 404 / `ModelNotOpen` for `doubao-seedance-2-5-260628` and persisted a failed job without a remote task ID. After the owner supplied replacement credentials, a new creation request returned HTTP 200 with a task ID, and querying that exact task returned HTTP 200 with terminal status `failed` / `SetLimitExceeded`: the model service was paused by the account's configured usage limit or Safe Experience Mode. The app retained the original remote ID and persisted the terminal failure. After the owner confirmed adjusting the limit, one new authorized 5-second, 16:9 request succeeded: 1280×720, 24 fps, 121 decoded source frames, audio, 5.056-second container duration and zero full-decoding errors. The result was downloaded, hash-verified and registered as exactly one candidate, without changing the sequence. Its task ID, succeeded state and media hash survived reopening. None of these requests was automatically resubmitted. Credentials were used only in memory; no credentials or account identifiers are published.

Actual Electron additionally displayed both real failures and four controlled cases: rejected authentication, unactivated model, asynchronous usage-limit failure and lost submit response. Failed tasks show their causes, have no output/progress, and preserve their state and remote IDs after reopening with zero network requests. Unknown submissions remain explicitly unresolved. The cancellation hint now says to reconcile in the Ark console when no remote ID exists, rather than claiming that the app can query an unidentified task. Backend regression also confirms that explicit reconciliation of a known failed task sends only GET, never another POST.

The generated candidate was then adopted in a separate project copy through the actual Electron UI, trimmed to 5 seconds, captioned, previewed and exported as 1280×720 / 24 fps / 120 frames with audio. Full decoding and saved edits after reopening passed; this editing check made no additional cloud calls.

Paid Ark chat inference remains untested, as the owner authorized Seedance verification. Pi tool/vision/delegation behavior was exercised against a controlled compatible stream. The preview is ad-hoc signed; Apple Developer ID signing/notarization has not been performed.
