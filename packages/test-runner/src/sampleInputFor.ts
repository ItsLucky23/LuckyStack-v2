//? Builds the per-endpoint sample payload the sweep layers and registered
//? custom layers send: a Zod-valid value generated from the route's runtime
//? input schema (`apiInputSchemas` for API routes, `syncInputSchemas` for sync
//? routes — both emitted by devkit), or `{}` when the route has no schema.

import type { ZodType } from 'zod';

import { sampleSchemaInput } from './schemaSampleInput';
import type { EndpointDescriptor } from './types';

export type InputSchemaMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, ZodType | undefined>>>>>>;

export interface CreateSampleInputForOptions {
  apiInputSchemas?: InputSchemaMap;
  syncInputSchemas?: InputSchemaMap;
  /**
   * Prefix for generated unconstrained strings — pass the run's
   * `createTestDataMarker()` so rows the probes create are identifiable.
   */
  stringPrefix?: string;
}

export const createSampleInputFor = (options: CreateSampleInputForOptions) =>
  (endpoint: EndpointDescriptor): unknown => {
    const schemas = endpoint.kind === 'sync' ? options.syncInputSchemas : options.apiInputSchemas;
    const schema = schemas?.[endpoint.page]?.[endpoint.name]?.[endpoint.version];
    return schema ? sampleSchemaInput(schema, { stringPrefix: options.stringPrefix }) : {};
  };
