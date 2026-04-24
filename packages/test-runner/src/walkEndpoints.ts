import type { EndpointDescriptor, HttpMethod } from './types';

type ApiMethodMap = Record<string, Record<string, Record<string, string>>>;

export const walkEndpoints = (apiMethodMap: ApiMethodMap): EndpointDescriptor[] => {
  const endpoints: EndpointDescriptor[] = [];
  for (const [page, nameMap] of Object.entries(apiMethodMap)) {
    for (const [name, versionMap] of Object.entries(nameMap)) {
      for (const [version, method] of Object.entries(versionMap)) {
        endpoints.push({
          page,
          name,
          version,
          method: method as HttpMethod,
          fullPath: `api/${page}/${name}/${version}`,
        });
      }
    }
  }
  return endpoints;
};
