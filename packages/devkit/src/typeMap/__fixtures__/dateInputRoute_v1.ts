export interface ApiParams {
  data: {
    from: Date;
  };
}

export const main = ({ data }: ApiParams) => ({
  status: 'success' as const,
  received: data.from,
});
