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
   - Use standard LaTeX: $x^2$ and $$ \\\\sum x $$
   - Normalize variable names (e.g. fix OCR errors like 'u_x' -> '$u_x$')

3. **Structure**:
   - Use # H1, ## H2, ### H3
   - Separate major topics with '---'

4. **Mermaid Diagrams** (use for processes, flows, hierarchies):
   Use the "Academic Blue" color scheme:
   - Primary: #184a85 (dark blue) - borders, arrows
   - Background: #f2f6fa (light blue-grey) - node fills  
   - Accent: #e6fffa (light cyan) - result/highlight nodes
   - Text: #1a1a1a (dark grey)

   CRITICAL SYNTAX RULES:
   - NEVER use invisible/non-breaking spaces (U+00A0)
   - ALWAYS wrap labels with special characters in double quotes ""
   - NO LaTeX inside Mermaid labels - use Unicode (sigma) or text
   - NO markdown lists (* -) inside nodes - use <br> and bullet symbols
   - Prefer ASCII operators (">=" not ">=")

   Example:
   \\\`\\\`\\\`mermaid
   %%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#f2f6fa', 'primaryBorderColor': '#184a85', 'primaryTextColor': '#1a1a1a', 'lineColor': '#184a85', 'secondaryColor': '#e6fffa'}}}%%
   graph LR
       A["Input"] --> B["Process"]
       style B fill:#e6fffa,stroke:#184a85
   \\\`\\\`\\\`
`;
            await this.app.vault.adapter.write(academicBluePath, content);
        }

        // Create Clean Markdown default if not exists
        const cleanMarkdownPath = `${this.presetsDir}/Clean Markdown.md`;
        if (!(await this.app.vault.adapter.exists(cleanMarkdownPath))) {
            const cleanContent = `## Clean Markdown Style
Output clean, well-structured markdown without special formatting.

**KEY RULES:**
1. **NO Callouts**: Do NOT use \`> [!...]\` callout blocks.
2. **NO HTML**: Do NOT use <details>, <summary>, or any HTML tags.
3. **Structure**: Use # H1, ## H2, ### H3 for headings
4. **Math**: Use standard LaTeX: $x^2$ for inline, $$ \\\\sum x $$ for block
5. **Keep it Simple**: Focus on readability and clean hierarchy.
`;
            await this.app.vault.adapter.write(cleanMarkdownPath, cleanContent);
        }

        // Create Visual Academic preset (Mermaid-focused)
        const visualAcademicPath = `${this.presetsDir}/Visual Academic.md`;
        if (!(await this.app.vault.adapter.exists(visualAcademicPath))) {
            const visualContent = `## Visual Academic Style
Emphasis on visual explanations with Mermaid diagrams.

**WHEN TO USE DIAGRAMS:**
- Processes/workflows -> flowchart LR/TD
- Hierarchies/taxonomies -> graph TD
- States/transitions -> stateDiagram-v2

**MERMAID THEME:**
\\\`\\\`\\\`
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#f2f6fa', 'primaryBorderColor': '#184a85', 'primaryTextColor': '#1a1a1a', 'lineColor': '#184a85', 'secondaryColor': '#e6fffa'}}}%%
\\\`\\\`\\\`

**SYNTAX RULES (CRITICAL):**
| Issue | Fix |
|-------|-----|
| Special Symbols | Wrap label in "" |
| Line Breaks | Use <br> |
| Bullet Points | Use bullet symbol and <br> |
| Greek Letters | Use Unicode inside quotes |
| Blank Diagram | Remove non-breaking spaces |

**EXAMPLES:**
- WRONG: A[sigma = 10]
- RIGHT: A["sigma = 10"]
- Multi-line: C["Line 1<br>Line 2"]
`;
            await this.app.vault.adapter.write(visualAcademicPath, visualContent);
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
