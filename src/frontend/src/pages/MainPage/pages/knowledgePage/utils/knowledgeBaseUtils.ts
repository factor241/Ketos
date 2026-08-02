import { formatNumber } from "@/utils/locale-format";

export { formatNumber };

/**
 * Format average chunk size with units
 */
export const formatAverageChunkSize = (avgChunkSize: number): string => {
  return `${formatNumber(Math.round(avgChunkSize))}`;
};
