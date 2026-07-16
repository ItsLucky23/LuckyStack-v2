export const main = () => {
  return {
    status: 'success' as const,
    payload: Buffer.from('transport-dependent'),
  };
};
