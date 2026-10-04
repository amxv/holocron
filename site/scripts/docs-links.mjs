// Keep repository/package Markdown links portable while rendering website routes.
export default function docsLinks() {
  return {
    name: 'holocron-docs-links',
    element: {
      filter: ['a'],
      visit(node, ctx) {
        const href = node.properties.href;
        if (typeof href === 'string' && /^[\w-]+\.md(?:#.*)?$/.test(href)) {
          ctx.setProperty(node, 'href', `/docs/${href.replace(/\.md(?=#|$)/, '')}`);
        }
      }
    }
  };
}
