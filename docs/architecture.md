# Architecture

Reelbeam ships as one Electron desktop application. The renderer holds selection, gestures and form drafts. A sandboxed, isolated preload exposes named APIs; the host validates the sender and each input before entering an application operation.

The core owns immutable sequence editing, time validation, revision conflicts and shared history. A SQLite project store atomically saves the edit, history, receipt and event cursor. Files are copied to project media storage and verified before registration. Canvas layout is separately versioned; task completion does not enter layout undo.

Pi runs in a worker. A coordinator can delegate to independent creative, visual and editing sessions. All participants share a request budget and stop gate. The host persists finalized histories separately from the project and checks proposals against current revisions. A specialist's text is not an edit or task receipt.

Seedance jobs are recorded before submit. The account reference, endpoint, model, inputs and review parameters stay fixed. A lost response becomes unknown, never a fresh submission. Existing remote IDs are queried and downloaded after restart. Outputs are candidates until a user adopts them through editing commands.

FFmpeg is a standalone native subprocess. Preview and export use the same sequence mapping. Composition normalizes frame rate, dimensions and audio, places layers by integer frame intervals and rasterizes captions consistently. Export writes a temporary file, validates it and atomically publishes the final MP4.

The public Kit SDK is independent of the core. A background Kit runtime validates registration, input and output schemas. Native code has the OS account's privileges and is loaded only after explicit source/permission trust. Declarative Kits contain agents and recipes; sharing a project never executes code.

Project directories contain `project.sqlite`, `media/`, `cache/`, `sessions/` and `snapshots/`. Application credentials and personal preferences live separately. Shared project archives omit jobs, reviews, chats, personal memories and credentials and receive a new project ID on import.

The renderer is denied Node integration, popups, arbitrary navigation and permission requests. The local media protocol serves only registered project media/cache and known export files, including byte ranges for playback.

Opening an existing project first creates a consistent SQLite snapshot in `snapshots/` and retains the latest three. Incompatible format versions are rejected before rewriting. Close the app before restoring a backup and retain a copy of the project; project media is immutable and lives outside the database.

Worker inference reserves the remaining root budget durably before launch and replaces it with actual settled usage afterward. After an interrupted process, the reservation remains conservative and orphan running recipe steps become interrupted; tools and paid submits are never replayed. Native recipe tools share that root tool/time budget. Long-term memory tools create an exact pending suggestion; only explicit user acceptance saves it.
