import type { PrimaryNavItem, SiteConfig } from "zuedocs/types";

export const siteConfig = {
  name: "Holocron",
  strapline: "Your context, shared deliberately",
  description: "Share selected text and UTF-8 context files between your Mac and ChatGPT Dots. Set up the private companion, connection and optional cloud clipboard helper.",
  repoUrl: "https://github.com/amxv/holocron",
  logoHref: "/favicon.svg",
  accentColor: "#275d48",
  accentColorDark: "#9acbb2",
  footerSections: [
    { title: "Holocron", text: "Selected context. Literal text. You choose what happens next." },
    { title: "Start here", linkHref: "/docs/getting-started", linkLabel: "Set up Holocron", text: "A companion on your Mac. A connection in ChatGPT." },
    { title: "Built with ZueDocs", linkHref: "https://github.com/amxv/zuedocs", linkLabel: "Documentation framework", text: "Open source · Private companion" }
  ]
} satisfies SiteConfig;

export const docCategories = ["Start", "Use Holocron", "Reference"] as const;

export const primaryNav: PrimaryNavItem[] = [
  { href: "/docs/getting-started", label: "Get started" },
  { href: "/docs", label: "Docs" },
  { href: siteConfig.repoUrl, label: "GitHub", external: true }
];
