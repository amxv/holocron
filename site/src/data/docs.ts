import type { PrimaryNavItem, SiteConfig } from "zuedocs/types";

export const siteConfig = {
  name: "Holocron",
  strapline: "Your context. Your keys. Your call.",
  description: "Share selected clipboard text and context with your agent on another computer. Pair a receiver and approve private API key requests on your Mac.",
  repoUrl: "https://github.com/amxv/holocron",
  logoHref: "/favicon.svg",
  accentColor: "#275d48",
  accentColorDark: "#9acbb2",
  footerSections: [
    { title: "Holocron", text: "Selected context. Approved keys. The decision stays with you." },
    { title: "Start here", linkHref: "/docs/getting-started", linkLabel: "Install Holocron", text: "Install, connect and test your first handoff." },
    { title: "Built with ZueDocs", linkHref: "https://github.com/amxv/zuedocs", linkLabel: "Documentation framework", text: "Open source · Private companion" }
  ]
} satisfies SiteConfig;

export const docCategories = ["Start", "Use Holocron", "Reference"] as const;

export const primaryNav: PrimaryNavItem[] = [
  { href: "/docs/getting-started", label: "Get started" },
  { href: "/docs/secret-requests", label: "API keys" },
  { href: "/docs", label: "Docs" },
  { href: siteConfig.repoUrl, label: "GitHub", external: true }
];
