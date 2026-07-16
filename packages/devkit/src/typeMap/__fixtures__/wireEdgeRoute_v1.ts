const callableWithData = Object.assign(() => 'not serialized', { metadata: 'also omitted' });

export const main = () => {
  const maybeValue: string | undefined = Math.random() > 0.5 ? 'present' : undefined;

  return {
    status: 'success' as const,
    alwaysMissing: undefined,
    maybeValue,
    callableWithData,
    list: [undefined, callableWithData] as const,
  };
};
