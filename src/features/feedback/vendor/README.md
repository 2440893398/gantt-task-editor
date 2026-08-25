# Feedback browser vendor assets

Browser bundles copied verbatim from installed packages and served as
same-origin Worker assets (`/feedback/assets/*`). Nothing here is hand-edited —
re-vendor by copying the source file again and updating the checksum below.

## `rrweb-replay-2.0.0-alpha.20.*.txt`

Copied from `@rrweb/replay@2.0.0-alpha.20`. The package is MIT licensed.

Source checksums:

- JavaScript: `9b6da1a0ba37225a977a242d7ad7adaa689e3f96bc5a0257ece0892d4271b863`
- CSS: `334d222824ebab92111f7db3231829847443a86ae26326cf4f68d5c5fdee40f9`

## `marked-17.0.1.umd.txt`

Copied from `marked@17.0.1` (`lib/marked.umd.js`), the same dependency the AI
drawer already renders Markdown with (`src/features/ai/components/AiDrawer.js`).
The package is MIT licensed.

The workbench client is a standalone `<script>` string served by the Worker, not
a bundled module, so it cannot `import` the npm package — the UMD build is
vendored and loaded from `/feedback/assets/marked-17.0.1.js` instead. `marked`
does not sanitize; the client runs every parse result through its own allowlist
sanitizer before it reaches `innerHTML`.

Source checksum:

- JavaScript: `e131975cfd9e6fd19a98ae2e1328e57232af7208198798834534b8e5326ed386`
