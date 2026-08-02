import type { APIClassType, InputFieldType } from "@/types/api";
import type { NodeDataType } from "@/types/flow";
import { checkCodeValidity } from "../check-code-validity";

describe("checkCodeValidity", () => {
  const inputField = (value: string): InputFieldType => ({
    type: "code",
    required: false,
    list: false,
    show: true,
    readonly: false,
    value,
  });

  const customComponentNode: APIClassType = {
    edited: false,
    description: "Custom component",
    display_name: "Custom Component",
    documentation: "",
    template: { code: inputField("user custom code") },
  };

  const customComponentData: NodeDataType = {
    id: "custom-component-1",
    type: "CustomComponent",
    node: customComponentNode,
  };

  const templates: Record<string, APIClassType> = {
    CustomComponent: {
      ...customComponentNode,
      outputs: [],
    },
  };

  it("allows custom components with matching template when custom components are disabled", () => {
    // Custom components loaded from components_path have a matching template,
    // so they should not be blocked — the backend hash validation is the security gate.
    expect(
      checkCodeValidity(customComponentData, templates, false),
    ).toMatchObject({
      outdated: false,
      blocked: false,
      breakingChange: false,
      userEdited: false,
    });
  });

  it("blocks custom components with no matching template", () => {
    const emptyTemplates = {};
    expect(
      checkCodeValidity(customComponentData, emptyTemplates, false),
    ).toMatchObject({
      outdated: false,
      blocked: true,
      breakingChange: false,
      userEdited: false,
    });
  });

  it("does not surface uploaded custom components as updatable when custom components are allowed", () => {
    expect(
      checkCodeValidity(customComponentData, templates, true),
    ).toMatchObject({
      outdated: false,
      blocked: false,
      breakingChange: false,
      userEdited: false,
    });
  });
});
