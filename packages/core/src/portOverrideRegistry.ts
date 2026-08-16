//? Browser-safe bridge between @luckystack/server/parseArgv and a consumer's
//? config.ts. The positional CLI port is runtime input, while config.ports.ts
//? remains the consumer-owned static default. Keeping this tiny registry in
//? @luckystack/core/config lets both server and browser import the same config
//? module without pulling Node-only server code into the client bundle.

let portOverride: number | undefined;

const validatePortOverride = (port: number): number => {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(
      `[luckystack:port] port override must be an integer from 0 through 65535, got: "${String(port)}".`,
    );
  }
  return port;
};

export const registerPortOverride = (port: number | null): void => {
  portOverride = port === null ? undefined : validatePortOverride(port);
};

export const getPortOverride = (): number | undefined => portOverride;

export const resetPortOverrideForTests = (): void => {
  portOverride = undefined;
};
