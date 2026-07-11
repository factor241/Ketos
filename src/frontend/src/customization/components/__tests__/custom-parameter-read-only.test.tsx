import { fireEvent, render, screen } from "@testing-library/react";
import { CanvasReadOnlyProvider } from "@/contexts/canvas-read-only-context";
import { CustomParameterComponent } from "../custom-parameter";

const renderedParameterProps: Array<Record<string, unknown>> = [];

jest.mock("@/components/core/parameterRenderComponent", () => ({
  ParameterRenderComponent: (props: {
    disabled: boolean;
    handleOnNewValue: (value: { value: string }) => void;
    handleNodeClass: (value: unknown) => void;
    templateData: { readonly?: boolean };
  }) => {
    renderedParameterProps.push(props);
    return (
      <button
        type="button"
        data-testid="parameter-probe"
        data-disabled={String(props.disabled)}
        data-readonly={String(props.templateData.readonly)}
        onClick={() => {
          props.handleOnNewValue({ value: "changed" });
          props.handleNodeClass({ display_name: "changed" });
        }}
      >
        parameter
      </button>
    );
  },
}));

const inputId = {
  inputTypes: ["Message"],
  type: "str",
  id: "node-1",
  fieldName: "input",
};

describe("CustomParameterComponent canvas read-only contract", () => {
  beforeEach(() => {
    renderedParameterProps.length = 0;
  });

  it("disables the field and replaces both mutation callbacks", () => {
    const handleOnNewValue = jest.fn();
    const handleNodeClass = jest.fn();

    render(
      <CanvasReadOnlyProvider readOnly>
        <CustomParameterComponent
          handleOnNewValue={handleOnNewValue}
          name="input"
          nodeId="node-1"
          inputId={inputId}
          templateData={{ type: "str", name: "input", value: "original" }}
          templateValue="original"
          showParameter
          inspectionPanel={false}
          editNode={false}
          handleNodeClass={handleNodeClass}
          nodeClass={{
            display_name: "Input",
            description: "",
            documentation: "",
            template: {},
          }}
          proxy={undefined}
        />
      </CanvasReadOnlyProvider>,
    );

    const probe = screen.getByTestId("parameter-probe");
    expect(probe).toHaveAttribute("data-disabled", "true");
    expect(probe).toHaveAttribute("data-readonly", "true");

    fireEvent.click(probe);

    expect(handleOnNewValue).not.toHaveBeenCalled();
    expect(handleNodeClass).not.toHaveBeenCalled();
  });
});
