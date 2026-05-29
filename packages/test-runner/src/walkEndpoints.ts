import type { EndpointDescriptor, HttpMethod } from './types';

type ApiMethodMap = Partial<Record<string, Partial<Record<string, Partial<Record<string, string>>>>>>;

export const walkEndpoints = (apiMethodMap: ApiMethodMap): EndpointDescriptor[] => {
  const endpoints: EndpointDescriptor[] = [];
  for (const [page, nameMap] of Object.entries(apiMethodMap)) {
    if (!nameMap) continue;
    for (const [name, versionMap] of Object.entries(nameMap)) {
      if (!versionMap) continue;
      for (const [version, method] of Object.entries(versionMap)) {
        if (method === undefined) continue;
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
