jest.unmock("react-i18next");

import { act, renderHook, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createTestI18n } from "@/test-utils/create-test-i18n";
import useFileDrop from "../use-on-file-drop";

const uploadFlow = jest.fn();
const setSuccessData = jest.fn();
const setErrorData = jest.fn();

jest.mock("@/hooks/flows/use-upload-flow", () => ({
  __esModule: true,
  default: () => uploadFlow,
}));

jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (selector: (state: unknown) => unknown) =>
    selector({ setSuccessData, setErrorData }),
}));

describe("useFileDrop Russian presentation", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    uploadFlow.mockResolvedValue(undefined);
  });

  it("reports a successful flow upload in Russian", async () => {
    const russian = await createTestI18n("ru");
    const { result } = renderHook(() => useFileDrop("flows"), {
      wrapper: ({ children }) => (
        <I18nextProvider i18n={russian}>{children}</I18nextProvider>
      ),
    });
    const preventDefault = jest.fn();

    act(() => {
      result.current({
        preventDefault,
        dataTransfer: {
          types: ["Files"],
          files: [new File(["{}"], "flow.json")],
        },
      });
    });

    await waitFor(() =>
      expect(setSuccessData).toHaveBeenCalledWith({
        title: "Файлы успешно загружены",
      }),
    );
    expect(preventDefault).toHaveBeenCalled();
  });
});
