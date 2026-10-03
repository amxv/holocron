import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { docCategories } from "./data/docs";

const docs = defineCollection({
  // The same Markdown is shipped in the CLI tarball and rendered on the site.
  loader: glob({ base: "../docs", pattern: "*.md" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    order: z.number(),
    category: z.enum(docCategories),
    summary: z.string().optional()
  })
});

export const collections = { docs };
