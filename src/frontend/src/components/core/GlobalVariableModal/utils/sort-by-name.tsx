import { compareForPresentation } from "@/utils/locale-format";

export default function sortByName(stringList: string[]): string[] {
  return stringList.sort(compareForPresentation);
}
