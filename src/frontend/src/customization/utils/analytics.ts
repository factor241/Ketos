export const track = async (
  name: string,
  properties: Record<string, unknown> = {},
  id: string = "",
): Promise<void> => {
  return;
};

export const trackFlowBuild = async (
  flowName: string,
  isError?: boolean,
  properties?: Record<string, unknown>,
): Promise<void> => {
  return;
};

export const trackDataLoaded = async (
  flowId?: string,
  flowName?: string,
  component?: string,
  componentId?: string,
): Promise<void> => {
  return;
};
