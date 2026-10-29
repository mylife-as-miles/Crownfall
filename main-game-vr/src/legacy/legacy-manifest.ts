// Manifest identities of the My Legacy panel documents. Kept free of the
// Legacy domain and content, so the asset manifest, which ships in the startup
// chunk, never pulls Legacy code or copy in ahead of the first entry.

export const LEGACY_MANIFEST = {
  panelManifestId: 'crownfall-legacy',
  dockManifestId: 'crownfall-legacy-dock',
  panelDocumentPath: 'ui/legacy.uikitml',
  dockDocumentPath: 'ui/legacy-dock.uikitml',
} as const;
