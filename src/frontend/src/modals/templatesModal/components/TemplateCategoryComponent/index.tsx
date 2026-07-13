import type {
  TemplateCardComponentProps,
  TemplateCategoryProps,
} from "../../../../types/templates/types";
import TemplateExampleCard from "../TemplateCardComponent";

interface TemplateCategoryComponentProps extends TemplateCategoryProps {
  loading: boolean;
}

type TemplateExample = TemplateCardComponentProps["example"];

const isTemplateExample = (value: unknown): value is TemplateExample =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "description" in value &&
  typeof value.description === "string" &&
  "id" in value &&
  typeof value.id === "string";

export function TemplateCategoryComponent({
  examples,
  onCardClick,
  loading,
}: TemplateCategoryComponentProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {examples.filter(isTemplateExample).map((example) => (
          <TemplateExampleCard
            key={example.id}
            example={example}
            onClick={() => onCardClick(example)}
            disabled={loading}
          />
        ))}
      </div>
    </>
  );
}
