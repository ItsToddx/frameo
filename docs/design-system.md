# Framo design system

The desktop workbench uses a light, content-first interface. The agent, media canvas and timeline are views of one saved project. A creator moves from intent to a reviewed plan, execution, candidate selection and precise edits.

## Visual language

Use neutral white and zinc surfaces, near-black primary actions, quiet borders and one consistent Lucide icon family. Color identifies status and selection; it does not compete with video. Video preview retains a dark surround. System sans-serif and PingFang SC fonts remain available offline. Body text is 14–15 px, supporting labels 12–13 px and section headings 18–24 px. Layout follows a 4/8 px spacing rhythm. Main controls are 36–40 px high; compact desktop controls remain at least 32 px with visible focus.

Primary text uses #18181b on white; secondary text uses #71717a. Surface #fafafa and borders #e4e4e7 establish hierarchy. Shared semantic tokens control components. Use subtle 120–180 ms transitions and disable nonessential movement under reduced motion.

## Interaction language

Show the selected material or work beside the composer. Plans, approval requests, ongoing execution and candidates are concrete artifacts, not simulated chat decoration. A request does not silently approve edits or paid generation. Keep spending, trust, version checks, unknown task states and stop/cancel distinctions visible where the user makes a decision.

Dialogs use shadcn-style Radix primitives for focus management, inert background and keyboard dismissal. Every input has a visible label; drafts survive failures. Tab order follows the interface. IME composition never sends a prompt prematurely. Reading earlier conversation content must not force the viewport to the latest streamed token.

## Interface languages

Start in English unless this computer has an explicit Chinese preference. Put the language control in the top bar and dialog header, with a visible associated label. Changes must update in place, preserving authored text, pending review identities and all drafts. Dates use the selected locale. Longer English buttons and notices may wrap at the minimum 1120×760 window size; keep fields and actions reachable through their existing scroll areas.

## References and decisions

The requested [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) source at commit 7246805992a42b7bba37d4cac83b01416f0c6c44 was read and its local design-system/focus/shadcn searches were run. The verified Minimalism & Swiss Style guidance fits this professional desktop tool. Generated landing-page patterns and decorative color suggestions were not adopted: the product is an editing workspace, and the user explicitly selected a light workbench.

[shadcn/ui](https://github.com/shadcn-ui/ui) informs the component composition, semantic tokens and accessible controls. [assistant-ui](https://github.com/assistant-ui/assistant-ui) supplies the actual external-store conversation primitives while existing Pi/IPC/persistence remain authoritative. Hyperframes, Toonflow, ChatCut and MiniMax Design are interaction references for focused creative workspaces and artifact review; they are not backend dependencies.
