# Third-party notices

Framo source and Kit SDK: Apache-2.0.

| Component                        | Use                                 | License                                     |
| -------------------------------- | ----------------------------------- | ------------------------------------------- |
| Electron / Chromium / Node.js    | Desktop shell                       | MIT and their bundled third-party notices   |
| assistant-ui / Radix             | Conversation and accessible UI      | MIT                                         |
| react-markdown / remark-gfm      | Safe Markdown rendering             | MIT                                         |
| Tailwind / clsx / tailwind-merge | Design tokens and class composition | MIT                                         |
| class-variance-authority         | Typed component variants            | Apache-2.0                                  |
| React / React DOM                | Workbench                           | MIT                                         |
| React Flow                       | Canvas interaction                  | MIT                                         |
| Pi agent-core / pi-ai            | Reasoning runtime                   | MIT                                         |
| Zod / Ajv                        | Boundary and Kit schemas            | MIT                                         |
| Lucide                           | Interface icons                     | ISC                                         |
| @napi-rs/canvas / Skia           | Caption rasterization               | MIT / BSD and bundled notices               |
| adm-zip                          | Explicit project and Kit archives   | MIT                                         |
| SQLite                           | Project storage via Node            | Public domain                               |
| FFmpeg / FFprobe 9.0.2           | Standalone media subprocesses       | LGPL-2.1-or-later; see native build notices |

The distributed media build does not enable GPL or nonfree components. Source is the official FFmpeg 9.0.2 archive; exact configuration and binary hashes are included under `resources/licenses/`. The corresponding archive and `scripts/build-media.sh` are provided with release artifacts. Users may replace these standalone executables through `FRAMO_FFMPEG` and `FRAMO_FFPROBE`.

System fonts are referenced from macOS and are not redistributed. Imported media belongs to its owner; project sharing asks the user to confirm redistribution rights. The desktop smoke screenshot uses a synthetic image created by this project.

Hyperframes, ViMax, MiniMax Design, ChatCut, Toonflow, OpenCut and ComfyUI are research/design references. No private SDK or whole application from those projects is shipped. Future copied code or integrated components require their own pinned source and license notice.
