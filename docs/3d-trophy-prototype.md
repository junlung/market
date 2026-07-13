# 3D trophy prototype (low-poly, PS1-style)

Planned with Jon on 2026-07-12 as the Phase 3 appendix; the schema and layout
are already prepared, so this is wire-up work, not groundwork.

**Goal:** one low-poly trophy spinning in a trophy-case tile, proving the
`renderer: "model3d"` pipeline end to end.

## What already exists (Phase 3a/3b, shipped)

- `Item.style` accepts `{ renderer: "model3d", src, fallbackEmoji }` today —
  validated by `trophyStyleSchema` in `src/lib/cosmetics.ts`, zero migration
  needed.
- The trophy case (`src/components/members/trophy-case.tsx`) renders model3d
  items as a placeholder tile with an empty
  `<span data-model-src={...} data-model-mount>` — the sized mount point the
  canvas drops into.
- The admin item editor (`/admin/items/new`, kind = Trophy → "3D model")
  can author these items already; the grant tool can hand one to yourself.
- `ProfileBanner` reserves `data-scene-mount` for the later profile
  showcase/character scene — out of scope for the prototype.

## Steps

1. **Asset**: model a ~300-tri trophy in **Blockbench** (free, built for
   low-poly; export glTF). PS1 look = low poly count + small (64–128px)
   nearest-neighbor texture + no smoothing. Export `.glb`, target <150 KB.
   For v0 the file lives at `public/models/trophy-gold.glb` — no Blob/storage
   decisions needed yet; swap to Vercel Blob when assets multiply.
2. **Deps**: `three` + `@react-three/fiber` + `@react-three/drei` (r3f fits
   the React app; drei's `useGLTF` handles loading/caching).
3. **Component**: `src/components/members/trophy-model.tsx` (`"use client"`):
   `<Canvas frameloop="demand">`, upgraded to a slow auto-rotate on hover;
   ambient + one directional light; `useGLTF(src)`; `dpr={[1, 1.5]}` and
   `gl={{ antialias: false }}` for the PS1 crunch. Wrap in `next/dynamic`
   with `ssr: false`, using the existing placeholder tile (fallbackEmoji) as
   the loading/error/no-WebGL fallback so mobile degrades gracefully.
4. **Wire-up**: in the trophy case, `renderer: "model3d"` tiles mount
   `TrophyModel` at the reserved `data-model-mount` span. Create the item via
   the admin editor (`{ renderer: "model3d", src: "/models/trophy-gold.glb",
   fallbackEmoji: "🏆" }`) and grant it to yourself with the grant tool.
5. **Validate**: bundle impact (three.js is ~150 KB gz — the dynamic import
   must keep it off every other page; check `next build` output), mobile
   Safari rendering, and that the tile layout is unchanged when WebGL is
   unavailable.

## Later (not the prototype)

- Blob-hosted `.glb`s once assets multiply (upload field in the admin editor).
- A shared `<ModelViewer>` for the profile showcase / avatar-character scene,
  mounted behind `ProfileBanner`'s `data-scene-mount`.
