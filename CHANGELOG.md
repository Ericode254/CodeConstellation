# Changelog

## 0.0.3

- **Auto refresh:** the graph rescans when files change and keeps its current layout.
- **Lower CPU usage:** animations pause when the graph isn't focused, respect reduced-motion, and can be turned off with `codeConstellation.animations`.
- **Smaller, faster install:** the extension is now bundled with esbuild.
- **More links detected:** multi-line imports, side-effect imports, `export … from`, `.js` imports of `.ts` files, and dotted Python imports.
- **Faster scanning:** files are read in parallel and import resolution no longer blocks the editor.
- **Fixed:** the graph going blank after switching away from its tab and back.
- **Fixed:** `.gitignore` folder rules such as `build/` were not respected.
- **Fixed:** label fonts, and file names containing HTML characters in tooltips.
