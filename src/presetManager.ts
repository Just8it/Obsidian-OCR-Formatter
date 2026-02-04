import { App, Notice, normalizePath, Plugin, TFile } from "obsidian";

export class PresetManager {
    app: App;
    plugin: Plugin;
    presetsDir: string;

    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.presetsDir = normalizePath(this.plugin.manifest.dir + "/presets");
    }

    async ensurePresetsDir(): Promise<void> {
        if (!(await this.app.vault.adapter.exists(this.presetsDir))) {
            await this.app.vault.adapter.mkdir(this.presetsDir);
        }
    }

    async initializeDefaultPresets(): Promise<void> {
        await this.ensurePresetsDir();

        // Create Academic Blue default if not exists
        const academicBluePath = `${this.presetsDir}/Academic Blue.md`;
        if (!(await this.app.vault.adapter.exists(academicBluePath))) {
            const content = `## Academic Blue Style
Use this style for university lecture notes (Math/CS/Engineering).

**KEY RULES:**
1. **Callouts**:
   - \`> [!definition]\` for definitions
   - \`> [!result]\` for theorems/formulas
   - \`> [!example]\` for examples
   - \`> [!handwritten]\` for warnings/notes

2. **Math**:
   - Use standard LaTeX: $x^2$ and $$ \\sum x $$
   - Normalize variable names (e.g. fix OCR errors like 'u_x' -> '$u_x$')

3. **Structure**:
   - Use # H1, ## H2, ### H3
   - Separate major topics with '---'
`;
            await this.app.vault.adapter.write(academicBluePath, content);
        }

        // Create Clean Markdown default if not exists
        const cleanMarkdownPath = `${this.presetsDir}/Clean Markdown.md`;
        if (!(await this.app.vault.adapter.exists(cleanMarkdownPath))) {
            const cleanContent = `## Clean Markdown Style
Output clean, well-structured markdown without special formatting.

**KEY RULES:**
1. **NO Callouts**: Do NOT use \`> [!...]\` callout blocks. Use plain text or bullet points instead.
2. **NO HTML**: Do NOT use <details>, <summary>, or any HTML tags.

3. **Structure**:
   - Use # H1, ## H2, ### H3 for headings
   - Use bullet points (-) for lists
   - Use **bold** for key terms
   - Use tables where appropriate

4. **Math**:
   - Use standard LaTeX: $x^2$ for inline, $$ \\sum x $$ for block
   - Fix OCR errors in variable names

5. **Keep it Simple**: Focus on readability and clean hierarchy.
`;
            await this.app.vault.adapter.write(cleanMarkdownPath, cleanContent);
        }
    }

    async getPresets(): Promise<string[]> {
        await this.ensurePresetsDir();
        const result = await this.app.vault.adapter.list(this.presetsDir);
        return result.files
            .filter((f: string) => f.endsWith(".md"))
            .map((f: string) => f.split("/").pop()?.replace(".md", "") || "");
    }

    async getPresetContent(name: string): Promise<string | null> {
        const path = `${this.presetsDir}/${name}.md`;
        if (await this.app.vault.adapter.exists(path)) {
            return await this.app.vault.adapter.read(path);
        }
        return null;
    }

    async openPresetFile(name: string): Promise<void> {
        const path = `${this.presetsDir}/${name}.md`;
        if (await this.app.vault.adapter.exists(path)) {
            await this.app.workspace.openLinkText(path, "", true);
        } else {
            new Notice(`Preset file not found: ${name}`);
        }
    }
}
