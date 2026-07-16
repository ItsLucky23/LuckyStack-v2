export interface SyncParams {
  clientInput: {
    at: Date;
  };
}

export const main = ({ clientInput }: SyncParams) => ({
  status: 'success' as const,
  received: clientInput.at,
});
