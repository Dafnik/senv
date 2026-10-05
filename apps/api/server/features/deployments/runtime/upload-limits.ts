export function deploymentUploadLimit(): number {
  const configured = Number(process.env['DEPLOYMENT_UPLOAD_LIMIT_BYTES']);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 100 * 1024 * 1024;
}
