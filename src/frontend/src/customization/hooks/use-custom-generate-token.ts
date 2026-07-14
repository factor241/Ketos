type TokenFunction = (() => string) & { token: string };

export const useGenerateToken = (): TokenFunction => {
  const tokenFunction = (() => {
    return "token";
  }) as TokenFunction;
  tokenFunction.token = "token";
  return tokenFunction;
};
