# Contributing to Code Constellation

Thank you for your interest in contributing to Code Constellation! We welcome all contributions, from bug reports and feature requests to code changes and documentation improvements.

## Development Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Ericode254/CodeConstellation.git
    cd CodeConstellation
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Open in VS Code:**
    ```bash
    code .
    ```

4.  **Run the extension:**
    - Press `F5` to open a new VS Code window with the extension loaded.
    - Run the command `Code Constellation: Show Project Graph` from the Command Palette (`Ctrl+Shift+P`).
    - After editing code, run `npm run compile` (or keep `npm run watch` running) and reload the window with `Ctrl+R`.

5.  **Build a `.vsix` package:**
    ```bash
    npm run package
    ```

The extension is bundled with esbuild into `dist/extension.js`. The webview's `force-graph` and `d3` scripts are copied to `dist/media/` during the build.

## Project Structure

- `src/extension.ts`: Main entry point for the extension.
- `src/GraphPanel.ts`: Manages the Webview and communication between VS Code and the graph.
- `src/ProjectScanner.ts`: Logic for scanning the workspace and parsing dependencies.
- `src/types/`: TypeScript interfaces and types.
- `src/test/`: Integration and unit tests.

## Coding Standards

- **TypeScript:** We use TypeScript for all code.
- **ESLint:** Run `npm run lint` to check for code style issues.
- **JSDoc:** Provide clear comments for classes and public methods.
- **Conciseness:** Keep functions focused and small.

## How to Contribute

1.  **Find an issue:** Look at the existing issues or create a new one.
2.  **Fork the repo:** Create your own fork and a new branch for your feature or bug fix.
3.  **Make changes:** Implement your changes and add tests if applicable.
4.  **Commit:** Write clear, concise commit messages.
5.  **Pull Request:** Submit a PR with a detailed description of your changes.

## License

By contributing, you agree that your contributions will be licensed under its MIT License.
