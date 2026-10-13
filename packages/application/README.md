# Frameo application

This package owns portable project use cases and the interfaces they need. It imports domain rules
from `packages/core` and plain Kit declarations from `packages/kit-sdk/src/types`; it does not import
desktop adapters, Electron, SQLite, React, Pi, provider clients, or Node filesystem APIs.

Source dependencies point inward:

```text
desktop composition / SQLite / Pi / Seedance / media adapters
                         ↓
           application objects and owned ports
                         ↓
          core editing, generation and recipe rules
```

- `ProjectWorkspace` coordinates editing/history, independent canvas history and scoped memories.
  Its `ProjectStore` transaction commits project state, receipts and the event together. A thrown
  callback rolls everything back. `UserMemoryRepository` isolates user memory storage.
- `GenerationJobs` coordinates the generation gateway and media ports. The core `GenerationOrder`
  value object pins account, model and reference version; `GenerationTask` guards submission,
  remote identity, cancellation acknowledgement, stage identity and candidate completion.
  Submitting is durable before the paid call. An unknown receipt never reenters the submit path.
  A verified stage can recover without the account, expiring provider URL or a new paid call.
- `AgentExecution` owns active-request identity, stop gates, history preparation, shared durable
  request budgets, recipe capability execution and interrupted-run recovery. Pi is one runtime
  adapter; serialized history remains opaque to the application.
- `ReviewDecisions` accepts only the exact pending proposal with its original configuration,
  Kit digest, recipe attempt, sequence revision and draft lease. A repeated acceptance uses the
  existing receipt/job. Proposal acceptance and recipe input/result acceptance remain separate.
- `RecipeExecutionService` freezes actual authored graphs and capabilities, resolves artifacts,
  coordinates exact reviews and attempts, and refuses replay of active paid work. It receives an
  artifact-availability port; disk checks and Kit interchange validation belong to the desktop.
- `EditCoordinator` owns manual draft leases independently of editor content and canvas history.

The desktop `createDesktopApplication`, `ProjectService`, `RecipeService`, `JobRunner`, API DTO and
worker-protocol import paths remain compatibility facades. Data shapes and SQLite format version 1
stay compatible. Composition supplies identity/clock, storage, file work, providers and runtime.
The command map is checked against `DesktopApi`; its dynamic call surface is confined to the
already-validated desktop IPC adapter.

The editing, generation and agent-execution models describe different consistency needs within
the same desktop application. They are modules, not separate services. A generated **candidate**
is archived output and a canvas card; only explicit editing/adoption creates timeline content.
A **request budget** covers the original request and all specialists or resumed recipe steps.
An **approval** identifies a frozen proposal or exact step input/result, never general permission
to regenerate or overwrite a newer revision.

`tests/architecture.test.ts` executes generation, recovery, reviews and agent preparation using an
in-memory transactional adapter and fixture gateways, and enforces source dependency direction.
The existing SQLite, Pi fixture, provider, recipe and native-media regression tests cover concrete
adapter behavior.
