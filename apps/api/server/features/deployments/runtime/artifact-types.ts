export type StaticUploadFile = { name: string; data: Buffer };
export type StoredArtifact = { storageKey: string; size: number; sha256: string };
export type ArtifactStoreOptions = { root: string; maxBytes: number };
