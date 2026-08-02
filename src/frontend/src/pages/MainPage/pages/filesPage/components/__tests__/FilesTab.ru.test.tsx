jest.unmock("react-i18next");

import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createTestI18n } from "@/test-utils/create-test-i18n";

jest.mock("@/controllers/API/queries/file-management", () => ({
  useGetFilesV2: () => ({
    data: Object.freeze([
      Object.freeze({
        id: "file-1",
        name: "first",
        path: "first.txt",
        size: 10,
        updated_at: "2026-07-12T00:00:00",
      }),
      Object.freeze({
        id: "file-2",
        name: "second",
        path: "second.txt",
        size: 20,
        updated_at: "2026-07-13T00:00:00",
      }),
    ]),
  }),
}));

jest.mock("@/controllers/API/queries/file-management/use-delete-files", () => ({
  useDeleteFilesV2: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock(
  "@/controllers/API/queries/file-management/use-put-rename-file",
  () => ({ usePostRenameFileV2: () => ({ mutate: jest.fn() }) }),
);
jest.mock("@/customization/hooks/use-custom-post-upload-file", () => ({
  customPostUploadFileV2: () => ({ mutate: jest.fn() }),
}));
jest.mock("@/hooks/files/use-upload-file", () => ({
  __esModule: true,
  default: () => jest.fn(),
}));
jest.mock("@/stores/alertStore", () => ({
  __esModule: true,
  default: (selector: (state: unknown) => unknown) =>
    selector({ setErrorData: jest.fn(), setSuccessData: jest.fn() }),
}));
jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/components/core/cardsWrapComponent", () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock(
  "@/components/core/parameterRenderComponent/components/tableComponent",
  () => ({ __esModule: true, default: () => <div /> }),
);
jest.mock(
  "@/modals/fileManagerModal/components/filesContextMenuComponent",
  () => ({
    __esModule: true,
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }),
);
jest.mock("../dragWrapComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/modals/deleteConfirmationModal", () => ({
  __esModule: true,
  default: ({
    children,
    description,
  }: {
    children: React.ReactNode;
    description: string;
  }) => (
    <div data-testid="delete-confirmation" data-description={description}>
      {children}
    </div>
  ),
}));

import FilesTab from "../FilesTab";

describe("FilesTab Russian bulk delete", () => {
  it("renders file data without mutating the query cache", async () => {
    const russian = await createTestI18n("ru");

    expect(() =>
      render(
        <I18nextProvider i18n={russian}>
          <FilesTab
            quickFilterText=""
            setQuickFilterText={jest.fn()}
            selectedFiles={[]}
            setSelectedFiles={jest.fn()}
            quantitySelected={0}
            setQuantitySelected={jest.fn()}
            isShiftPressed={false}
          />
        </I18nextProvider>,
      ),
    ).not.toThrow();
  });

  it("passes a pluralized selected-file count to the rendered confirmation", async () => {
    const russian = await createTestI18n("ru");

    render(
      <I18nextProvider i18n={russian}>
        <FilesTab
          quickFilterText=""
          setQuickFilterText={jest.fn()}
          selectedFiles={[]}
          setSelectedFiles={jest.fn()}
          quantitySelected={2}
          setQuantitySelected={jest.fn()}
          isShiftPressed={false}
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("delete-confirmation")).toHaveAttribute(
      "data-description",
      "2 выбранных файлов",
    );
  });
});
