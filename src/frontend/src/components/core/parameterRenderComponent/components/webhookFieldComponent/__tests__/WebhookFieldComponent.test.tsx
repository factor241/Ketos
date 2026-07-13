import { render, screen } from "@testing-library/react";
import WebhookFieldComponent from "../index";

jest.mock(
  "@/controllers/API/queries/_builds/use-get-builds-polling-mutation",
  () => ({ useGetBuildsMutation: () => ({ mutate: jest.fn() }) }),
);

jest.mock("@/customization/utils/get-modal-props", () => ({
  getModalPropsApiKey: () => ({}),
}));

const renderWebhook = (variableName: "endpoint" | "curl") =>
  render(
    <WebhookFieldComponent
      id={`webhook-${variableName}`}
      value="https://example.test/hook"
      disabled
      editNode
      handleOnNewValue={jest.fn()}
      nodeInformationMetadata={{
        variableName,
        flowId: "flow-1",
        nodeType: "Webhook",
        flowName: "Webhook test flow",
        isAuth: false,
      }}
    />,
  );

describe("WebhookFieldComponent disabled state", () => {
  it("forwards disabled to the endpoint copy field", () => {
    renderWebhook("endpoint");

    expect(
      screen.getByDisplayValue("https://example.test/hook"),
    ).toBeDisabled();
  });

  it("forwards disabled to the curl text area", () => {
    renderWebhook("curl");

    expect(screen.getByTestId("webhook-curl")).toBeDisabled();
    expect(screen.getByText("Receiving input")).toBeInTheDocument();
  });
});
