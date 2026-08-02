import { render } from "@testing-library/react";
import { Select, SelectTrigger, SelectValue } from "./select-custom";

describe("SelectTrigger", () => {
  it("renders without an invalid empty asChild slot", () => {
    expect(() =>
      render(
        <Select>
          <SelectTrigger aria-label="Session">
            <SelectValue placeholder="Select a session" />
          </SelectTrigger>
        </Select>,
      ),
    ).not.toThrow();
  });
});
