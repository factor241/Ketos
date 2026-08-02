export const GENERATED_SESSION_ID_PREFIX = "lf-session-";

/**
 * Creates a locale-independent session identifier for API/storage use.
 * Presentation is derived separately by getSessionTitle; legacy and renamed
 * session ids remain valid opaque strings.
 */
export const createNewSessionId = (now = new Date()): string =>
  `${GENERATED_SESSION_ID_PREFIX}${now.getTime()}`;

export const createUniqueSessionId = (
  existingIds: Iterable<string>,
  now = new Date(),
): string => {
  const existing = new Set(existingIds);
  let timestamp = now.getTime();
  let candidate = createNewSessionId(new Date(timestamp));

  while (existing.has(candidate)) {
    timestamp += 1;
    candidate = createNewSessionId(new Date(timestamp));
  }

  return candidate;
};

/** Kept as a source-compatible alias for customization imports. */
export const createNewSessionName = createNewSessionId;
