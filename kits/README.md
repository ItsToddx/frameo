# Reelbeam Kits

The public SDK is in `packages/kit-sdk/src`. A Kit declares capabilities and uses `KitRegistry.register()` to stage all registrations. The registry enables the package only after the registrations match its manifest. Cleanup removes every capability in the package.

The first release ships a curated Seedance provider, three specialist agents, caption styling, and a product-film recipe. The application imports **declarative JSON packages only**. Imported agents and recipes use the built-in host tools and cannot contain code entry points or install scripts. A package is installed disabled; enabling it makes its declared roles and recipes available. Native TypeScript Kits can be built against the SDK, but this release does not execute downloaded native packages.

Agents propose changes and cloud generations for review. Tools receive a bounded project snapshot, never the host database. Edit tools return the target sequence revision and commands; job tools return a plan. The host owns acceptance, budget reservations, generation submission and asset ingestion.

Recipes bind inputs through JSON Pointers, declare predecessor steps, and retain separate reviews before execution and after results. Packages cannot contain API keys, private file paths, chat sessions or recipe run state.
