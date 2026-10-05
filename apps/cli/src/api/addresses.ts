export function withAddresses<
  T extends {
    previewUrl: string;
    addresses?: { fixed: string; branch: string | null; tags: { name: string; url: string }[] };
  },
>(deployment: T) {
  return {
    ...deployment,
    addresses: deployment.addresses ?? { fixed: deployment.previewUrl, branch: null, tags: [] },
  };
}
