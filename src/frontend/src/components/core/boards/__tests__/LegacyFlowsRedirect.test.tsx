import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useFolderStore } from "@/stores/foldersStore";
import { LegacyFlowsRedirect } from "../LegacyFlowsRedirect";

jest.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: jest.fn() },
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) =>
      values?.name ? `${key}:${values.name}` : key,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/flows" element={<LegacyFlowsRedirect />} />
        <Route path="/all/folder/:folderId" element={<LegacyFlowsRedirect />} />
        <Route path="/project/:projectId/boards" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const folder = (id: string, name: string) => ({
  id,
  name,
  display_name: name,
  description: "",
  parent_id: "",
  flows: [],
  components: [],
});

describe("LegacyFlowsRedirect", () => {
  beforeEach(() => {
    useFolderStore.setState({
      folders: [
        folder("project-a", "Project A"),
        folder("project-b", "Project B"),
      ],
      myCollectionId: "",
    });
  });

  it("bridges a known folder bookmark exactly to the canonical inventory route", async () => {
    renderRoute("/all/folder/project-a");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/project/project-a/boards?panel=automations",
    );
  });

  it("uses a known current project for the legacy flows route", async () => {
    useFolderStore.setState({ myCollectionId: "project-b" });
    renderRoute("/flows");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/project/project-b/boards?panel=automations",
    );
  });

  it("does not depend on a hydrated folder cache for explicit deep links", async () => {
    useFolderStore.setState({ folders: [], myCollectionId: "" });
    renderRoute("/all/folder/project-not-loaded");
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/project/project-not-loaded/boards?panel=automations",
    );
  });

  it("offers a chooser when /flows has no current project and continues with replace", async () => {
    const user = userEvent.setup();
    renderRoute("/flows");

    expect(
      screen.getByRole("heading", {
        name: "board.automation.legacy.chooseProject",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "board.automation.legacy.choose:Project A",
      }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/project/project-a/boards?panel=automations",
    );
  });
});
