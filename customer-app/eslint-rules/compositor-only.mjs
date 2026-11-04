// shop/compositor-only (docs/design/shop-motion.md, section 6): Motion may animate only transform,
// opacity, filter and clip-path. A height, width, top, left, right, bottom, margin or padding in
// animate / initial / exit / while* (or in variants, or in a call to animate()) is a layout
// animation: it reflows every frame and janks on low-end phones. Use scale, translate or clip-path.
const PROPS = new Set(["animate", "initial", "exit", "whileHover", "whileTap", "whileFocus", "whileDrag", "whileInView", "variants"]);
const LAYOUT = /^(height|width|top|left|right|bottom|inset|minHeight|maxHeight|minWidth|maxWidth|margin\w*|padding\w*)$/;

function keyName(p) {
  if (p.type !== "Property") return null;
  if (p.key.type === "Identifier") return p.key.name;
  if (p.key.type === "Literal") return String(p.key.value);
  return null;
}

/** Every layout key in an object, looking one level into nested objects (variants, transition-free states). */
function* layoutKeys(node, depth = 0) {
  if (!node || node.type !== "ObjectExpression") return;
  for (const p of node.properties) {
    const name = keyName(p);
    if (!name || name === "transition") continue;
    if (LAYOUT.test(name)) yield p;
    else if (depth < 1 && p.value.type === "ObjectExpression") yield* layoutKeys(p.value, depth + 1);
  }
}

function* branches(node) {
  if (!node) return;
  if (node.type === "ConditionalExpression") {
    yield* branches(node.consequent);
    yield* branches(node.alternate);
  } else if (node.type === "LogicalExpression") {
    yield* branches(node.left);
    yield* branches(node.right);
  } else yield node;
}

const message = "Animate transform, opacity, filter or clip-path only: '{{name}}' reflows the page on every frame (docs/design/shop-motion.md).";

const rule = {
  meta: { type: "problem", docs: { description: "Motion animates compositor-only properties" }, messages: { layout: message }, schema: [] },
  create(context) {
    const report = (p) => context.report({ node: p, messageId: "layout", data: { name: keyName(p) } });
    return {
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !PROPS.has(node.name.name)) return;
        const expr = node.value?.type === "JSXExpressionContainer" ? node.value.expression : null;
        for (const b of branches(expr)) for (const p of layoutKeys(b)) report(p);
      },
      CallExpression(node) {
        // animate(el, { height: … }) and controls.start({ width: … })
        const callee = node.callee;
        const name = callee.type === "Identifier" ? callee.name : callee.type === "MemberExpression" && callee.property.type === "Identifier" ? callee.property.name : null;
        if (name !== "animate" && name !== "start") return;
        for (const arg of node.arguments.slice(0, 2)) for (const p of layoutKeys(arg)) report(p);
      },
    };
  },
};

export default rule;
