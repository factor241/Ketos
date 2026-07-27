const configuredPort =
  process.env.KETOS_PLAYWRIGHT_OPENAI_PORT ??
  process.env.STAGE10_OPENAI_PORT ??
  process.env.STAGE08_OPENAI_PORT ??
  process.env.STAGE05_OPENAI_PORT ??
  "18767";

export const deterministicProviderPort = Number(configuredPort);

if (
  !Number.isInteger(deterministicProviderPort) ||
  deterministicProviderPort < 1 ||
  deterministicProviderPort > 65_535
) {
  throw new Error(
    `Invalid deterministic Playwright provider port: ${configuredPort}`,
  );
}
