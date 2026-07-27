import { fireEvent, render, screen } from "@testing-library/react";
import FileRendererComponent from ".";

jest.mock("@/components/common/shadTooltipComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/common/genericIconComponent", () => ({
  __esModule: true,
  default: () => <span />,
}));

jest.mock("@/customization/hooks/use-custom-post-upload-file", () => ({
  customPostUploadFileV2: () => ({ mutate: jest.fn() }),
}));

jest.mock("../../../filesContextMenuComponent", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

describe("FileRendererComponent", () => {
  it("selects a file exactly once when its checkbox is clicked", () => {
    const handleFileSelect = jest.fn();

    render(
      <FileRendererComponent
        file={{
          id: "file-id",
          user_id: "user-id",
          provider: "local",
          name: "notes",
          path: "/files/notes.txt",
          created_at: "2026-07-27T00:00:00Z",
          size: 1,
        }}
        handleFileSelect={handleFileSelect}
        selectedFiles={[]}
        index={0}
      />,
    );

    fireEvent.click(screen.getByTestId("checkbox-notes"));

    expect(handleFileSelect).toHaveBeenCalledTimes(1);
    expect(handleFileSelect).toHaveBeenCalledWith("/files/notes.txt");
  });
});
