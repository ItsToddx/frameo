# Contributing

Report a bug with the app version, macOS/architecture, reproducible steps, and a minimal project whose media you may share. Do not attach API keys, private conversations or account data.

Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:desktop` for changes affecting desktop behavior. Native media tests require access to VideoToolbox on macOS; in restricted environments run the tests on the host rather than interpreting an encoder permission error as a media success.

Keep editing rules in `packages/core`: the core must not import Electron, Pi, the Kit SDK or a database. Manual and agent edits use the same revision-checked command entry. Adapters perform boundary validation and connect storage or runtimes; the desktop entry composes those parts. Do not put raw IPC, database access or credentials in the renderer.

Use integer timeline ticks and half-open ranges. A generation result is a candidate; adopting it is a separate edit. Preserve durable task IDs and do not automatically retry an uncertain paid submit. Every new native edit operation must have undo, preview, export and behavior tests before exposure to Kits.

Kit authors can work independently through the public SDK and examples. Declare the exact permissions, dependencies and capabilities your package registers. Code imports require explicit trust; project imports never enable code.

For project-format, SDK or major behavior changes, open a proposal before a pull request. Contributions retain author attribution. Include upstream license and commit information when copying source; distinguish copied source from design inspiration.
