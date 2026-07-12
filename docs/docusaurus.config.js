// @ts-check

const path = require("path");
const lightCodeTheme = require("prism-react-renderer/themes/github");
const darkCodeTheme = require("prism-react-renderer/themes/dracula");
const { remarkCodeHike } = require("@code-hike/mdx");
const rehypeWbrUnderscore = require("./src/plugins/rehypeWbrUnderscore");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "Ketos Documentation",
  tagline: "Build and operate AI workflows with Ketos.",
  favicon: "img/ketos-favicon.ico",
  url: "https://docs.ketos.test",
  baseUrl: process.env.BASE_URL || "/",
  onBrokenLinks: "throw",
  onBrokenAnchors: "warn",
  organizationName: "ketos",
  projectName: "ketos",
  trailingSlash: false,
  staticDirectories: ["static"],
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "@docusaurus/preset-classic",
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: "/",
          sidebarPath: require.resolve("./sidebars.js"),
          sidebarCollapsed: true,
          beforeDefaultRemarkPlugins: [
            [
              remarkCodeHike,
              {
                theme: "github-dark",
                showCopyButton: true,
                lineNumbers: true,
              },
            ],
          ],
          rehypePlugins: [rehypeWbrUnderscore],
        },
        sitemap: {
          lastmod: "datetime",
          changefreq: null,
          priority: null,
          ignorePatterns: [],
        },
        blog: false,
        theme: {
          customCss: [
            require.resolve("@code-hike/mdx/styles.css"),
            require.resolve("./css/custom.css"),
          ],
        },
      }),
    ],
    [
      "redocusaurus",
      {
        openapi: {
          path: "openapi",
          routeBasePath: "/api",
        },
        specs: [
          {
            id: "api",
            spec: "openapi/openapi.json",
            route: "/api",
          },
          {
            id: "workflow",
            spec: "openapi/ketos-workflows-openapi.json",
            route: "/api/workflow",
          },
        ],
        theme: {
          primaryColor: "#17324f",
        },
      },
    ],
  ],
  plugins: [
    function ketosCodeImportPlugin(context) {
      return {
        name: "ketos-code-import",
        configureWebpack() {
          return {
            resolve: {
              alias: {
                "@ketos": path.resolve(context.siteDir, ".."),
              },
            },
          };
        },
      };
    },
    ["docusaurus-node-polyfills", { excludeAliases: ["console"] }],
    "docusaurus-plugin-image-zoom",
    async function tailwindPlugin(_context, _options) {
      return {
        name: "docusaurus-tailwindcss",
        configurePostCss(postcssOptions) {
          postcssOptions.plugins.push(require("tailwindcss"));
          postcssOptions.plugins.push(require("autoprefixer"));
          return postcssOptions;
        },
      };
    },
  ],
  clientModules: [require.resolve("./src/clientModules/tocProgress.js")],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: "img/ketos-social-1200x630.png",
      navbar: {
        hideOnScroll: false,
        logo: {
          alt: "Ketos",
          src: "img/ketos-docs-light.svg",
          srcDark: "img/ketos-docs-dark.svg",
        },
        items: [
          {
            position: "right",
            href: "https://git.ketos.test/ketos/ketos",
            label: "Source",
            target: "_blank",
            rel: "noopener noreferrer",
          },
        ],
      },
      colorMode: {
        defaultMode: "light",
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
      },
      zoom: {
        selector: ".markdown :not(a) > img:not(.no-zoom)",
        background: {
          light: "rgba(240, 240, 240, 0.9)",
        },
        config: {},
      },
      docs: {
        sidebar: {
          hideable: false,
          autoCollapseCategories: false,
        },
      },
      footer: {
        links: [],
        copyright: `© ${new Date().getFullYear()} Ketos`,
      },
    }),
};

module.exports = config;
