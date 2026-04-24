const VERSION_SEGMENT_REGEX = /^v\d+$/;

export interface ServiceRouteParseSuccess {
  status: 'success';
  normalizedRouteName: string;
  service: string;
  routeName: string;
}

export interface ServiceRouteParseError {
  status: 'error';
  reason: string;
}

export type ServiceRouteParseResult = ServiceRouteParseSuccess | ServiceRouteParseError;

export interface TransportRouteParseSuccess {
  status: 'success';
  normalizedFullName: string;
  version: string;
  serviceRoute: ServiceRouteParseSuccess;
}

export interface TransportRouteParseError {
  status: 'error';
  reason: string;
}

export type TransportRouteParseResult = TransportRouteParseSuccess | TransportRouteParseError;

const normalizeRawRoute = (value: string): string => {
  return value.trim().replaceAll('\\', '/').replaceAll(/^\/+/g, '').replaceAll(/\/+$/g, '');
};

const hasEmptySegments = (value: string): boolean => {
  return value.split('/').some((segment) => segment.length === 0);
};

export const parseServiceRouteName = (value: string): ServiceRouteParseResult => {
  const normalized = normalizeRawRoute(value);
  if (!normalized) {
    return { status: 'error', reason: 'Route name cannot be empty.' };
  }

  if (hasEmptySegments(normalized)) {
    return { status: 'error', reason: 'Route name cannot contain empty segments.' };
  }

  const segments = normalized.split('/');
  if (segments.length < 2) {
    return { status: 'error', reason: 'Route name must include service and route segments.' };
  }

  const [service, ...routeSegments] = segments;
  const routeName = routeSegments.join('/');

  if (!service || !routeName) {
    return { status: 'error', reason: 'Route name must include service and route segments.' };
  }

  return {
    status: 'success',
    normalizedRouteName: `${service}/${routeName}`,
    service,
    routeName,
  };
};

export const parseTransportRouteName = ({
  value,
  prefix,
}: {
  value: string;
  prefix: 'api' | 'sync';
}): TransportRouteParseResult => {
  const normalized = normalizeRawRoute(value);
  if (!normalized) {
    return { status: 'error', reason: 'Transport route cannot be empty.' };
  }

  if (hasEmptySegments(normalized)) {
    return { status: 'error', reason: 'Transport route cannot contain empty segments.' };
  }

  const segments = normalized.split('/');
  const routeSegments = segments[0] === prefix ? segments.slice(1) : segments;

  if (routeSegments.length < 3) {
    return {
      status: 'error',
      reason: `Transport route must use ${prefix}/{service}/{name}/{version} format.`,
    };
  }

  const version = routeSegments.at(-1);
  if (!version || !VERSION_SEGMENT_REGEX.test(version)) {
    return { status: 'error', reason: 'Route version segment must match v{number}.' };
  }

  const serviceRouteToken = routeSegments.slice(0, -1).join('/');
  const serviceRoute = parseServiceRouteName(serviceRouteToken);
  if (serviceRoute.status === 'error') {
    return {
      status: 'error',
      reason: serviceRoute.reason,
    };
  }

  return {
    status: 'success',
    normalizedFullName: `${prefix}/${serviceRoute.normalizedRouteName}/${version}`,
    version,
    serviceRoute,
  };
};
