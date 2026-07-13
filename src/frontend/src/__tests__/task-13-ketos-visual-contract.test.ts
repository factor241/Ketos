import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const frontendRoot = resolve(__dirname, "../..");
const repositoryRoot = resolve(frontendRoot, "../..");
const assetsRoot = resolve(frontendRoot, "src/assets");
const publicRoot = resolve(frontendRoot, "public");
const upstreamBrand = ["lang", "flow"].join("");
const upstreamBrandTitle = ["Lang", "flow"].join("");

const legacyAssetNames = [
  `${upstreamBrandTitle}Logo.svg`,
  `${upstreamBrandTitle}LogoColor.svg`,
  `MCP${upstreamBrandTitle}.png`,
  `${upstreamBrand}-icon-smooth.png`,
  `${upstreamBrand}-icon-smooth.svg`,
  `${upstreamBrand}_assistant.svg`,
  `${upstreamBrand}_assistant_idle.svg`,
  `${upstreamBrand}_logo_black.svg`,
  `${upstreamBrand}_logo_white.svg`,
  `${["logo", "dark"].join("_")}.png`,
  `${["logo", "light"].join("_")}.png`,
  "ketos-assistant-active.svg",
  "ketos-assistant-idle.svg",
  "ketos-mcp-composition.png",
  "ketos-symbol-color.svg",
  "ketos-symbol.svg",
];

const legacyAssetHashes = new Set([
  "084eaeac23448e4c7886567b92b65962185f45911f7ab57fb91a9eaf6b20d4d1",
  "fd2e8cb873e0de708044b7719417b7220b0a79d5f20087431b87002a56ac9d5b",
  "f647ef631a632891777de35a4852711dc25a98ab9df8e46a9b83ba30e015d40d",
  "c0ec95a31c6fc2ad10837572050a005c0d964e3c07cdc3a59d38d6ba9f44b5d6",
  "c4cccd95e1975ece8dc6f25292e3292802aa59c40bab12a4d8f9d1048b52349c",
  "2938632d60d8329569bd7ca570d6fa399a52bc847bf28b70c380fbfee67d3037",
  "1f4465469d58cad1d682f6285a9535d586245deb81f95f7f171a97c6f7469acb",
  "f6a6c97c4e2f6223ed8acda0c2eb232e2c19b004093c0cbf86966a1abb34b441",
  "93dc4c461f90cc342627b4bde5657e99b7df9ef28f4220340e01e52fe6915660",
  "57fbc494d58335abd447a415378976e050a2b04f9201afc52d797cace32f7651",
  "153180a50cdbb193dcedba27d28de6851f754b9ba554eb81ae99dcc3c2334954",
]);

const canonicalCopies = {
  "ketos-symbol-light.svg": "brand/assets/generated/svg/ketos-symbol-light.svg",
  "ketos-symbol-dark.svg": "brand/assets/generated/svg/ketos-symbol-dark.svg",
  "ketos-horizontal-light.svg":
    "brand/assets/generated/svg/ketos-horizontal-light.svg",
  "ketos-horizontal-dark.svg":
    "brand/assets/generated/svg/ketos-horizontal-dark.svg",
} as const;

const canonicalPublicAssets = {
  "favicon.ico": {
    canonicalPath: "brand/assets/generated/favicon/ketos-favicon.ico",
    sha256: "3baf6f84a593906303589569f053ee94758f5fef24fd5e5fea55c3cc403f0fbb",
  },
  "ketos-favicon.svg": {
    canonicalPath: "brand/assets/generated/favicon/ketos-favicon.svg",
    sha256: "5a8d0ca8ac1eaa25000fce8eba50af385428d261502398c747851a793287ea99",
  },
} as const;

const sha256 = (contents: Buffer) =>
  createHash("sha256").update(contents).digest("hex");

function filesRecursively(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesRecursively(path) : [path];
  });
}

function publicReference(reference: string): string | null {
  if (!reference.startsWith("/") || reference.startsWith("//")) return null;
  return reference.slice(1).split(/[?#]/, 1)[0] || null;
}

function manifestAssetReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(manifestAssetReferences);
  if (value === null || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, nested]) => {
    if (key === "src" && typeof nested === "string") {
      const reference = publicReference(nested);
      return reference === null ? [] : [reference];
    }
    return manifestAssetReferences(nested);
  });
}

function svgMetadata(contents: string) {
  const svgTag = contents.match(/<svg\b[^>]*>/)?.[0] ?? "";
  const viewBox = svgTag.match(/\bviewBox=["']([^"']+)["']/)?.[1];
  const dimensions = viewBox?.trim().split(/\s+/).map(Number) ?? [];
  return {
    role: svgTag.match(/\brole=["']([^"']+)["']/)?.[1],
    viewBox: dimensions,
    hasAccessibleName:
      /<title\b[^>]*>[^<]+<\/title>/.test(contents) ||
      /\baria-label=["'][^"']+["']/.test(svgTag),
  };
}

function icoMetadata(contents: Buffer) {
  expect(contents.readUInt16LE(0)).toBe(0);
  expect(contents.readUInt16LE(2)).toBe(1);
  const count = contents.readUInt16LE(4);

  return Array.from({ length: count }, (_, index) => {
    const directoryOffset = 6 + index * 16;
    const dataLength = contents.readUInt32LE(directoryOffset + 8);
    const dataOffset = contents.readUInt32LE(directoryOffset + 12);
    const png = contents.subarray(dataOffset, dataOffset + dataLength);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    return {
      width: contents[directoryOffset] || 256,
      height: contents[directoryOffset + 1] || 256,
      bitDepth: contents.readUInt16LE(directoryOffset + 6),
      decodedPngWidth: png.readUInt32BE(16),
      decodedPngHeight: png.readUInt32BE(20),
    };
  });
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(name) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/.test(name)
      ? [path]
      : [];
  });
}

const readFrontendSource = (relativePath: string) =>
  readFileSync(resolve(frontendRoot, relativePath), "utf8");

describe("Task 13 Ketos visual integration", () => {
  it("recursively validates active public assets and manifest references", () => {
    const publicFiles = filesRecursively(publicRoot).map((path) =>
      relative(publicRoot, path).split(sep).join("/"),
    );
    const indexHtml = readFileSync(resolve(frontendRoot, "index.html"), "utf8");
    const htmlReferences = [
      ...indexHtml.matchAll(/\b(?:href|src)=["']([^"']+)["']/g),
    ]
      .map((match) => publicReference(match[1]))
      .filter((reference): reference is string => reference !== null)
      .filter((reference) => publicFiles.includes(reference));
    const manifest = JSON.parse(
      readFileSync(resolve(publicRoot, "manifest.json"), "utf8"),
    );
    const manifestReferences = manifestAssetReferences(manifest);
    const activeReferences = new Set([
      ...htmlReferences,
      ...manifestReferences,
      "favicon.ico",
    ]);

    expect([...activeReferences].sort()).toEqual(publicFiles.sort());
    for (const reference of activeReferences) {
      const publicPath = resolve(publicRoot, reference);
      expect(publicPath.startsWith(`${publicRoot}${sep}`)).toBe(true);
      expect(existsSync(publicPath)).toBe(true);
    }

    for (const path of filesRecursively(publicRoot)) {
      if (path.endsWith(".json")) {
        expect(() => JSON.parse(readFileSync(path, "utf8"))).not.toThrow();
      } else if (path.endsWith(".svg")) {
        const metadata = svgMetadata(readFileSync(path, "utf8"));
        expect(metadata.role).toBe("img");
        expect(metadata.hasAccessibleName).toBe(true);
        expect(metadata.viewBox).toHaveLength(4);
        expect(metadata.viewBox.every(Number.isFinite)).toBe(true);
        expect(metadata.viewBox[2]).toBeGreaterThan(0);
        expect(metadata.viewBox[3]).toBeGreaterThan(0);
      } else if (path.endsWith(".ico")) {
        expect(icoMetadata(readFileSync(path))).not.toHaveLength(0);
      } else {
        throw new Error(
          `Unsupported public asset: ${relative(publicRoot, path)}`,
        );
      }
    }
  });

  it("ships exact canonical public favicon hashes and ICO resolutions", () => {
    for (const [publicName, expected] of Object.entries(
      canonicalPublicAssets,
    )) {
      const canonicalContents = readFileSync(
        resolve(repositoryRoot, expected.canonicalPath),
      );
      const publicContents = readFileSync(resolve(publicRoot, publicName));

      expect(sha256(canonicalContents)).toBe(expected.sha256);
      expect(sha256(publicContents)).toBe(expected.sha256);
      expect(publicContents).toEqual(canonicalContents);
    }

    const frames = icoMetadata(
      readFileSync(resolve(publicRoot, "favicon.ico")),
    );
    expect(frames).toEqual(
      [16, 32, 48, 64, 128, 256].map((size) => ({
        width: size,
        height: size,
        bitDepth: 32,
        decodedPngWidth: size,
        decodedPngHeight: size,
      })),
    );
  });

  it("ships byte-identical frontend copies of the canonical Ketos assets", () => {
    for (const [frontendName, canonicalPath] of Object.entries(
      canonicalCopies,
    )) {
      const frontendPath = resolve(assetsRoot, frontendName);
      expect(existsSync(frontendPath)).toBe(true);
      if (!existsSync(frontendPath)) continue;

      expect(readFileSync(frontendPath)).toEqual(
        readFileSync(resolve(repositoryRoot, canonicalPath)),
      );
    }
  });

  it("removes legacy filenames, symbols and pixel signatures", () => {
    const assetNames = readdirSync(assetsRoot);
    expect(assetNames).not.toEqual(expect.arrayContaining(legacyAssetNames));

    const frontendHashes = assetNames.map((name) =>
      createHash("sha256")
        .update(readFileSync(resolve(assetsRoot, name)))
        .digest("hex"),
    );
    expect(frontendHashes.some((hash) => legacyAssetHashes.has(hash))).toBe(
      false,
    );

    const source = sourceFiles(resolve(frontendRoot, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(
      new RegExp(
        `${upstreamBrandTitle}Logo|MCP${upstreamBrandTitle}|${upstreamBrand}Assistant(?:Idle)?Icon|${upstreamBrand}_(?:assistant|logo)|${upstreamBrand}-icon-smooth|logo_(?:light|dark)\\.png`,
      ),
    );
  });

  it("covers assistant active and idle visuals without changing its behavior", () => {
    const controls = readFrontendSource(
      "src/components/core/canvasControlsComponent/CanvasControls.tsx",
    );
    expect(controls).toContain("KetosAssistantMark");
    expect(controls).toContain('data-testid="assistant-button"');
    expect(controls).toContain('label={t("assistant.title")}');
    expect(controls).toContain("decorative");

    const loading = readFrontendSource(
      "src/components/core/assistantPanel/components/assistant-loading-state.tsx",
    );
    expect(loading).toContain("KetosAssistantMark");
    expect(loading).toContain("KetosLoadingIcon");
    expect(loading).not.toMatch(/<svg|<style|ASSISTANT_PATH_D/);
  });

  it("covers themed, responsive and accessible product surfaces", () => {
    const emptyPage = readFrontendSource(
      "src/pages/MainPage/pages/empty-page.tsx",
    );
    expect(emptyPage).toContain("ketos-horizontal-light.svg");
    expect(emptyPage).toContain("ketos-horizontal-dark.svg");
    expect(emptyPage).toMatch(/dark:hidden/);
    expect(emptyPage).toMatch(/hidden dark:block/);
    expect(emptyPage).toMatch(/max-w-|sm:|md:/);

    const visualConsumers = [
      "src/components/common/loadingComponent/index.tsx",
      "src/components/core/appHeaderComponent/index.tsx",
      "src/pages/LoginPage/index.tsx",
      "src/pages/SignUpPage/index.tsx",
      "src/pages/DeleteAccountPage/index.tsx",
      "src/pages/MainPage/pages/emptyPage/index.tsx",
      "src/modals/IOModal/playground-modal.tsx",
    ]
      .map(readFrontendSource)
      .join("\n");
    expect(visualConsumers).toContain("KetosBrandMark");
    expect(visualConsumers).toContain("common.ketosLogo");
  });

  it("provides a Storybook visual matrix for direct scale and contrast QA", () => {
    const storyPath = resolve(
      frontendRoot,
      "src/components/common/ketos-brand-assets.stories.tsx",
    );
    expect(existsSync(storyPath)).toBe(true);
    if (!existsSync(storyPath)) return;

    const story = readFileSync(storyPath, "utf8");
    expect(story).toContain("SymbolScale");
    expect(story).toContain("AssistantStates");
    expect(story).toContain("ThemeAndContrast");
    expect(story).toContain("McpComposition");
    expect(story).toMatch(/16, 32, 64, 128/);
  });
});
