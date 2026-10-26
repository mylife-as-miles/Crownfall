# Crownfall desktop and Quest

Maintain both menu versions for every UI, content, artwork, settings or behavior update:

- `main game/` is the approved React desktop and landscape-phone menu.
- `main-game-vr/` is the hands-first Meta Quest experience using IWSDK. Read its scoped instructions and skills before changing it.
- `shared/menu/` owns common content, modal copy, design tokens and geometry. Prefer changes here; both adapters must consume them.

Do not fork common labels, supplied artwork or feature availability into independent copies. The Quest native panel is generated from shared content, and its local asset copies are generated from the canonical desktop assets. Do not hand-edit generated files. A platform-specific feature needs the corresponding behavior or an honest platform adaptation in the other version.

Preserve the approved desktop layout and real animated sorcerer. Quest uses world-space hand-operable UI, with no controller pairing requirement, stationary comfort, explicit Resume, and a reachable Exit VR. Desktop frame-rate caps, window settings and keyboard bindings must not masquerade as Quest settings.

Run both builds and `npm run check:sync` from the repository root after changes, plus relevant interaction tests. Node 20.19 or later is required; use the SDK-supported Node ranges in the Quest package. Keep each app's dependencies separate: IWSDK's Three alias must not replace the desktop renderer's Three runtime.

Immersive and hand-interaction claims require an active XR session and actual input evidence. Browser emulation does not establish physical Quest comfort, tracking quality, cold-start speed or GPU performance. Continue the established draft-PR workflow; do not merge or deploy without existing authorization.
