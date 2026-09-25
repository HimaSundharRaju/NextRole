import rootConfig from "../../eslint.config.mjs";

export default [
  ...rootConfig,
  {
    // Workers log through console; Cloudflare's observability collects it.
    rules: { "no-console": "off" },
  },
];
