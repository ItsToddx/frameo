# Creative Kits

A Kit declares exact capabilities in `kit.manifest.json`: provider, read/edit/job tool, agent or recipe. The public package is `@reelbeam/kit-sdk`; its registration APIs do not expose the core or database.

## Author a code Kit

See [caption-case](../kits/examples/caption-case). A bundled `.mjs` or `.js` entry exports `register(api)`. Use `registerReadTool`, `registerEditTool`, `registerJobTool`, `registerProvider`, `registerAgent` or `registerRecipe` and register exactly the IDs listed in the manifest.

Read tools return bounded values and artifacts. Edit tools return a proposal with sequence ID and expected revision. Job tools return a plan; only the host can review, record and execute it. The first app's video-generation UI uses Seedance.

Declare JSON input/output schemas, exact dependency versions, source, license and permissions. Registration is staged; a mismatch or failure removes the entire candidate registration. Unregistration is idempotent. Kits cannot change the project by receiving a snapshot.

Bundle required JavaScript with your entry; installation does not run npm scripts or resolve dependencies from the network. Relative files must remain within the package. Symlinks, path traversal and unbounded archives are rejected.

## Install and trust

Use **Kit store → Import**. Review source, permissions, license and content digest. A native Kit runs in a separate process with your OS account's permissions. Trust is tied to the reviewed content; a changed package requires another review. A process boundary catches crashes and timeouts, but does not restrict malicious code's OS access.

Enabled dependency manifests must match before activation. Failed upgrades keep the previous version. Disable stops new calls; standard media already in a project remains available. Installed version files are retained for provenance after removal.

## Declarative recipes

Declarative Kits omit a native entry and include agent and recipe JSON. Recipes name steps, role/capability IDs, dependency edges, input bindings, review points and output bindings. Inputs read the initial brief or declared predecessor results through JSON Pointer. Cycles and undeclared references are invalid.

Start a recipe from its Kit card, enter a goal and advance the plan. Review proposed generation or editing actions before continuing. Redo keeps prior results and marks downstream work stale; it does not replay a saved edit command over later manual changes.

Export the recipe from the workflow panel. Export contains portable definitions and declared dependencies. It does not contain keys, private media, chats or execution state. Recipients configure their own model account and input media.

## Catalog contributions

The built-in catalog is versioned in `kits/builtin.ts`. Submit a pull request with your manifest, fixed version/content digest, source, license, macOS compatibility, permissions, fees and independently reproducible example. Creators may submit a `.reelbeamkit` file instead of maintaining a code repository.

Reviewers distinguish listing, activation and execution. Browsing metadata never executes code. The current catalog is bundled for offline inspection; creative execution still requires model configuration. A larger remotely updated catalog can use the same versioned metadata and trust rules.
