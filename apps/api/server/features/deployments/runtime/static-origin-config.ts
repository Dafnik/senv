export function createStaticOriginNginxConfig(port: number, root: string): string {
  return `server { listen ${port}; server_tokens off; root ${root}; index index.html; location / { try_files $uri $uri/ =404; } }\n`;
}
