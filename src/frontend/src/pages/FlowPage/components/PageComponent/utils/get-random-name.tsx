import { ADJECTIVES, NOUNS } from "../../../../../flow_constants";
import i18n from "../../../../../i18n";
import { getRandomElement } from "../../../../../utils/reactflowUtils";

export default function getRandomName(
  retry: number = 0,
  noSpace: boolean = false,
  maxRetries: number = 3,
): string {
  if (!noSpace) {
    const suffix = Math.floor(Math.random() * 10_000)
      .toString()
      .padStart(4, "0");
    return i18n.t("flow.groupDefaultName", { suffix });
  }

  const left: string[] = ADJECTIVES;
  const right: string[] = NOUNS;

  const lv = getRandomElement(left);
  const rv = getRandomElement(right);

  // Condition to avoid "boring wozniak"
  if (lv === "boring" && rv === "wozniak") {
    if (retry < maxRetries) {
      return getRandomName(retry + 1, noSpace, maxRetries);
    } else {
      console.warn("Max retries reached, returning as is");
    }
  }

  // Append a suffix if retrying and noSpace is true
  if (retry > 0 && noSpace) {
    const retrySuffix = Math.floor(Math.random() * 10);
    return `${lv}_${rv}${retrySuffix}`;
  }

  // Construct the final name
  const final_name = `${lv}_${rv}`;
  return final_name;
}
