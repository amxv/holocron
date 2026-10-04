import { defineConfig } from "astro/config";
import zueDocs from "zuedocs/astro";
import { satteri } from "@astrojs/markdown-satteri";
import docsLinks from "./scripts/docs-links.mjs";

export default defineConfig({
  output: "static",
  site: "https://holocron.ashray.xyz",
  integrations: [zueDocs()],
  markdown: { processor: satteri({ hastPlugins: [docsLinks()] }) }
});
