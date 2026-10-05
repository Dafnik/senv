export function withAddresses<
  T extends { previewUrl: string; branchAlias: string | null; tags: string[] },
>(deployment: T) {
  const alias = (label: string) => {
    const url = new URL(deployment.previewUrl);
    url.hostname = label + url.hostname.slice(url.hostname.indexOf('.'));
    return url.href;
  };
  return {
    ...deployment,
    addresses: {
      fixed: deployment.previewUrl,
      branch: deployment.branchAlias ? alias(deployment.branchAlias) : null,
      tags: deployment.tags.map((name) => ({ name, url: alias(name) })),
    },
  };
}
