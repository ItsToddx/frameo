# @framo/kit-sdk

Public, host-independent contracts for Framo providers, tools, specialist agents and recipes.

Build with `npm ci && npm run build` in this directory. Install the `.tgz` distributed with a Framo release using `npm install /path/to/framo-kit-sdk-0.1.0.tgz`.

Read the [Kit guide](https://github.com/ItsToddx/framo/blob/main/docs/kits.md) and the [caption-case example](https://github.com/ItsToddx/framo/tree/main/kits/examples/caption-case). A native Kit exports `register(api)` and declares all capabilities, permissions and exact dependencies in `kit.manifest.json`. The host reviews source and digest before execution.

Native Kits are trusted code with the user's operating-system permissions. They receive a bounded snapshot, fixed target and cancellation signal; edit and job tools produce proposals requiring acceptance.

Apache-2.0. See LICENSE.
