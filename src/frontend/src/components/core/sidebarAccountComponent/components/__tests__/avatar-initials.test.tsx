import { render, screen } from "@testing-library/react";
import { AvatarInitials } from "../avatar-initials";

describe("AvatarInitials", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render the user profile image when a custom image is provided", () => {
    render(
      <AvatarInitials username="john doe" profileImage="People/001-user.svg" />,
    );

    expect(screen.getByRole("img", { name: "User" })).toHaveAttribute(
      "src",
      "/api/v1/files/profile_pictures/People/001-user.svg",
    );
  });

  it.each([undefined, null, "", "   "])(
    "should render initials when the profile image is %p",
    (profileImage) => {
      render(
        <AvatarInitials username="john doe" profileImage={profileImage} />,
      );

      expect(screen.getByText("JD")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    },
  );

  it("should render initials for the standard fallback profile image", () => {
    render(
      <AvatarInitials
        username="john doe"
        profileImage="Space/046-rocket.svg"
      />,
    );

    expect(screen.getByText("JD")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("should use the primary circular avatar styles for initials", () => {
    render(<AvatarInitials username="john doe" />);

    expect(screen.getByText("JD")).toHaveClass(
      "rounded-full",
      "bg-primary",
      "text-primary-foreground",
    );
  });

  it.each(["", "   "])(
    "should render a question mark when the username is %p",
    (username) => {
      render(<AvatarInitials username={username} />);

      expect(screen.getByText("?")).toBeInTheDocument();
    },
  );
});
