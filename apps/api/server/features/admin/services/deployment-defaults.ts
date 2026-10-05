import { instanceDeploymentDefaultsSchema } from '../../../../shared/deployments';
import {
  findInstanceDeploymentDefaults,
  saveInstanceDeploymentDefaults,
} from '../repositories/deployment-defaults';
const defaultInstance = instanceDeploymentDefaultsSchema.parse({});

export function getInstanceDeploymentDefaults() {
  const saved = findInstanceDeploymentDefaults();
  if (!saved) return defaultInstance;
  return instanceDeploymentDefaultsSchema.parse(saved);
}
export function updateInstanceDeploymentDefaults(input: unknown) {
  const valid = instanceDeploymentDefaultsSchema.parse(input);
  saveInstanceDeploymentDefaults(valid);
  return valid;
}
