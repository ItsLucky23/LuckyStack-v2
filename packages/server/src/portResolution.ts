export interface ResolveServerPortInput {
  optionsPort?: number | string;
  parsedPort?: number | null;
  defaultPort?: number | string;
  envPort?: string;
}

export const normalizeServerPort = (
  value: number | string,
  source = 'server port',
): number => {
  let normalized: number;
  if (typeof value === 'number') normalized = value;
  else normalized = /^\d+$/.test(value) ? Number(value) : Number.NaN;

  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 65_535) {
    throw new RangeError(
      `[luckystack:port] ${source} must be an integer from 0 through 65535, got: "${String(value)}".`,
    );
  }

  return normalized;
};

//? One explicit, testable precedence chain. The scaffold passes ports.backend as
//? `defaultPort`; SERVER_PORT remains a final compatibility fallback.
export const resolveServerPort = ({
  optionsPort,
  parsedPort,
  defaultPort,
  envPort,
}: ResolveServerPortInput): number => {
  if (optionsPort !== undefined) return normalizeServerPort(optionsPort, 'options.port');
  if (parsedPort !== undefined && parsedPort !== null) return normalizeServerPort(parsedPort, 'argv port');
  if (defaultPort !== undefined) return normalizeServerPort(defaultPort, 'options.defaultPort');
  if (envPort !== undefined) return normalizeServerPort(envPort, 'SERVER_PORT');
  return 80;
};
