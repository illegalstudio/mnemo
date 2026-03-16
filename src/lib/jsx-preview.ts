/**
 * Transform a Claude-generated JSX/TSX file into a self-contained HTML
 * that can be rendered in a WebviewWindow.
 *
 * React/ReactDOM loaded as UMD globals.
 * Other deps loaded via esm.sh with an importmap that aliases react
 * back to a shim exposing the UMD globals — single React instance.
 */

function extractImports(source: string): { packages: Set<string>; strippedCode: string; componentName: string } {
  const packages = new Set<string>();
  const lines: string[] = [];

  for (const line of source.split("\n")) {
    const fromMatch = line.match(/^import\s+.*from\s+['"]([^./][^'"]*)['"]/);
    if (fromMatch) { packages.add(fromMatch[1]); continue; }
    const sideEffect = line.match(/^import\s+['"]([^./][^'"]*)['"]/);
    if (sideEffect) { packages.add(sideEffect[1]); continue; }
    if (line.match(/^import\s+/)) continue;
    lines.push(line.replace(/^export\s+default\s+/, ""));
  }

  let componentName = "App";
  const fnMatch = source.match(/(?:export\s+default\s+)?function\s+(\w+)/);
  if (fnMatch) componentName = fnMatch[1];
  const constMatch = source.match(/export\s+default\s+(\w+)\s*;?\s*$/m);
  if (constMatch) componentName = constMatch[1];

  return { packages, strippedCode: lines.join("\n"), componentName };
}

function getExternalPkgs(packages: Set<string>): string[] {
  return [...packages].filter(p =>
    p !== "react" && p !== "react-dom" && p !== "react-dom/client"
  );
}

function buildEsmLoader(externalPkgs: string[], source: string): string {
  if (externalPkgs.length === 0) return "";

  const loaders: string[] = [];
  for (const pkg of externalPkgs) {
    // Use esm.sh with ?external=react,react-dom so it uses OUR React
    const url = `https://esm.sh/${pkg}?external=react,react-dom`;
    const safeVar = pkg.replace(/[^a-zA-Z0-9]/g, "_");

    const namedRe = new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${pkg.replace(/[-/]/g, "\\$&")}['"]`);
    const namedMatch = source.match(namedRe);
    const defaultRe = new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${pkg.replace(/[-/]/g, "\\$&")}['"]`);
    const defaultMatch = source.match(defaultRe);

    loaders.push(`try {
        const ${safeVar} = await import("${url}");`);

    if (namedMatch) {
      for (const name of namedMatch[1].split(",").map(n => n.trim()).filter(Boolean)) {
        const parts = name.split(/\s+as\s+/);
        const original = parts[0].trim();
        const alias = (parts[1] || parts[0]).trim();
        loaders.push(`        window.__pkg_${alias} = ${safeVar}["${original}"];`);
      }
    }
    if (defaultMatch) {
      loaders.push(`        window.__pkg_${defaultMatch[1]} = ${safeVar}.default || ${safeVar};`);
    }
    loaders.push(`      } catch(e) { console.warn("Failed to load ${pkg}:", e); }`);
  }

  return `
  <script type="module">
    ${loaders.join("\n    ")}
    window.__esmReady = true;
    window.dispatchEvent(new Event("esm-ready"));
  <\/script>`;
}

function buildGlobalDecls(externalPkgs: string[], source: string): string {
  const decls: string[] = [];
  for (const pkg of externalPkgs) {
    const namedRe = new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${pkg.replace(/[-/]/g, "\\$&")}['"]`);
    const namedMatch = source.match(namedRe);
    if (namedMatch) {
      for (const name of namedMatch[1].split(",").map(n => n.trim()).filter(Boolean)) {
        const parts = name.split(/\s+as\s+/);
        const alias = (parts[1] || parts[0]).trim();
        decls.push(`const ${alias} = window.__pkg_${alias};`);
      }
    }
    const defaultRe = new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${pkg.replace(/[-/]/g, "\\$&")}['"]`);
    const defaultMatch = source.match(defaultRe);
    if (defaultMatch) {
      decls.push(`const ${defaultMatch[1]} = window.__pkg_${defaultMatch[1]};`);
    }
  }
  return decls.join("\n    ");
}

export function jsxToHtml(source: string, filename: string): string {
  const { packages, strippedCode, componentName } = extractImports(source);
  const externalPkgs = getExternalPkgs(packages);
  const esmLoader = buildEsmLoader(externalPkgs, source);
  const globalDecls = buildGlobalDecls(externalPkgs, source);

  const appCode = `
    const { useState, useEffect, useCallback, useRef, useMemo, useReducer, useContext, createContext, memo, forwardRef, Fragment, useId, useTransition, useDeferredValue } = React;

    ${globalDecls}

    ${strippedCode}

    const root = ReactDOM.createRoot(document.getElementById("root"));
    root.render(React.createElement(${componentName}));
  `;

  const runFn = `
  function __runApp() {
    try {
      var transformed = Babel.transform(${JSON.stringify(appCode)}, { presets: ["react"] });
      eval(transformed.code);
    } catch(e) {
      document.getElementById("root").innerHTML =
        '<pre style="color:red;padding:20px;font-size:13px;white-space:pre-wrap;">' +
        e.message + '\\n\\n' + e.stack + '</pre>';
      console.error(e);
    }
  }`;

  const renderScript = externalPkgs.length > 0
    ? `<script>
    ${runFn}
    if (window.__esmReady) __runApp();
    else window.addEventListener("esm-ready", __runApp);
  <\/script>`
    : `<script>
    ${runFn}
    __runApp();
  <\/script>`;

  // Importmap: alias react/react-dom to shim modules that re-export UMD globals
  // This way esm.sh packages with ?external=react get OUR React instance
  const importMap = `<script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18",
      "react-dom": "https://esm.sh/react-dom@18",
      "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime"
    }
  }
  <\/script>
  <script type="module">
    import * as React from "react";
    import * as ReactDOM from "react-dom";
    window.React = React;
    window.ReactDOM = ReactDOM;
  <\/script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${filename}</title>
  ${externalPkgs.length > 0 ? importMap : `
  <script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>`}
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    @keyframes spin { to { transform: rotate(360deg); } }
    .animate-spin { animation: spin 1s linear infinite; }
    .animate-pulse { animation: pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
    .animate-bounce { animation: bounce 1s infinite; }
    @keyframes bounce { 0%,100%{transform:translateY(-25%);animation-timing-function:cubic-bezier(0.8,0,1,1)} 50%{transform:none;animation-timing-function:cubic-bezier(0,0,0.2,1)} }
  </style>
  ${esmLoader}
</head>
<body>
  <div id="root"></div>
  ${renderScript}
</body>
</html>`;
}
