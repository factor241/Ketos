const autoprefixer = require("autoprefixer");
const tailwindTransform = require("tailwindcss")().plugins[0];

const ketosTailwind = {
  postcssPlugin: "ketos-tailwind",
  async Once(root, { result }) {
    const sourcePath = result.opts.from ?? "";
    if (
      sourcePath.endsWith(
        "/node_modules/@copilotkit/react-core/dist/v2/index.css",
      )
    ) {
      return;
    }
    await tailwindTransform(root, result);
  },
};

module.exports = {
  plugins: [ketosTailwind, autoprefixer],
};
