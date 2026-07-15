export function getInitials(username: string): string {
  const segments = username.split(/[.\s]+/).filter(Boolean);

  const initials =
    segments.length === 1
      ? [...segments[0]].slice(0, 2).join("").toUpperCase()
      : segments
          .slice(0, 2)
          .map((segment) => segment[0].toUpperCase())
          .join("");

  return initials || "?";
}
