import { Plugin, PluginSettingTab, Setting, Notice, requestUrl, Modal, App, Editor, MarkdownView, TFile, TFolder, ButtonComponent, base64ToArrayBuffer } from "obsidian";
import { PresetManager } from "./presetManager";
import { z } from "zod";
import { Mistral } from "@mistralai/mistralai";

// Definitions for OpenRouter Provider Plugin
interface OpenRouterPreferences {
    credits?: number;
    apiKey?: string;
    // ... other fields
}

interface OpenRouterProviderPlugin {
    settings: OpenRouterPreferences;
    getFavorites(): string[];
    getModel(pluginId: string): string;
    openModelSelector(pluginId: string, callback: () => void): void;
    fetchCredits(): Promise<string | null>;
    fetchWithRetry(options: any): Promise<any>;
}

// Plugin Settings
interface AIOcrSettings {
    mistralApiKey: string;
    language: string;
    saveLocation: "cursor" | "file";
    defaultPreset: string;
    openRouterApiKey: string;
    openRouterModel: string;
    extractImages: boolean;
    imageSubfolder: string;
}

const DEFAULT_SETTINGS: AIOcrSettings = {
    mistralApiKey: "",
    language: "German",
    saveLocation: "cursor",
    defaultPreset: "Academic Blue",
    openRouterApiKey: "",
    openRouterModel: "google/gemini-2.0-flash-exp:free",
    extractImages: true,
    imageSubfolder: "assets"
};

// OCR Result Interface
interface OCRResult {
    markdown: string;
    images: { [id: string]: string };  // id -> base64 data
}

// Zod Schema for Structured Output
const FormattedResponseSchema = z.object({
    formatted_markdown: z.string().describe("The OCR text formatted into standard Markdown following the rules."),
    confidence_score: z.number().optional().describe("Confidence in the formatting (0-1)."),
});

// Fallback System Prompt
const ACADEMIC_BLUE_PROMPT = `You are an expert academic note formatter.
Formatted markdown must be returned in JSON structure matching the schema.`;

export default class AIOcrFormatterPlugin extends Plugin {
    settings!: AIOcrSettings;
    presetManager!: PresetManager;
    statusBarItem!: HTMLElement;
    currentPreset: string = "";

    async onload() {
        await this.loadSettings();

        // Initialize Preset Manager
        this.presetManager = new PresetManager(this.app, this);
        await this.presetManager.initializeDefaultPresets();

        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.setText('');

        this.addRibbonIcon('scan-text', 'AI OCR Formatter', () => {
            new OCRModal(this.app, this).open();
        });

        this.addCommand({
            id: 'open-ocr-formatter',
            name: 'Open OCR Formatter',
            callback: () => {
                new OCRModal(this.app, this).open();
            }
        });

        this.addCommand({
            id: 'format-selection',
            name: 'Format Selection',
            editorCallback: async (editor: Editor) => {
                const selection = editor.getSelection();
                if (!selection || selection.trim().length < 5) {
                    new Notice("⚠️ Please select some text to format.");
                    return;
                }
                const formatted = await this.formatText(selection, undefined, undefined, editor);
                if (formatted) {
                    editor.replaceSelection(formatted);
                }
            }
        });

        this.addSettingTab(new AIOcrSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // ==================== PROVIDER ACCESS ====================
    getProvider(): OpenRouterProviderPlugin | null {
        // @ts-ignore - Dynamic plugin access
        const provider = this.app.plugins.getPlugin('openrouter-provider');
        // Silent return null if not found
        return provider as OpenRouterProviderPlugin || null;
    }

    // ==================== LOCAL FETCH (FALLBACK) ====================
    async localFetch(options: any): Promise<any> {
        const apiKey = this.settings.openRouterApiKey;
        if (!apiKey) throw new Error("API Key missing. Enable OpenRouter Provider OR set key in settings.");

        return requestUrl({
            url: "https://openrouter.ai/api/v1/chat/completions",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": "https://obsidian.md",
                "X-Title": "Obsidian AI OCR Formatter"
            },
            body: JSON.stringify(options)
        });
    }

    // ==================== MISTRAL OCR ====================
    // ==================== MISTRAL OCR (SDK Implementation) ====================
    async performMistralOCR(base64Data: string, mimeType: string): Promise<OCRResult> {
        if (!this.settings.mistralApiKey) {
            throw new Error("Mistral API Key not configured");
        }

        this.setStatus("Uploading to Mistral...");
        new Notice("cloud_upload Uploading to Mistral...");

        try {
            const client = new Mistral({ apiKey: this.settings.mistralApiKey });

            // 1. Convert Base64 to File/Blob for upload
            // We create a dummy filename based on mime type
            const ext = mimeType.split('/')[1] || 'bin';
            const filename = `upload-${Date.now()}.${ext}`;

            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const file = new File([bytes], filename, { type: mimeType });

            // 2. Upload File
            const uploadedFile = await client.files.upload({
                file: {
                    fileName: filename,
                    content: file,
                },
                purpose: "ocr"
            });

            if (!uploadedFile || !uploadedFile.id) {
                throw new Error("Failed to upload file to Mistral");
            }

            // 3. Get Signed URL
            const signedUrl = await client.files.getSignedUrl({
                fileId: uploadedFile.id
            });

            // 4. Run OCT
            this.setStatus("Running OCR...");
            new Notice("🔍 Processing OCR...");

            const ocrResponse = await client.ocr.process({
                model: "mistral-ocr-latest",
                document: {
                    type: "document_url",
                    documentUrl: signedUrl.url,
                },
                includeImageBase64: this.settings.extractImages
            });

            // 5. Parse Results - Extract both markdown and images
            let markdown = "";
            const images: { [id: string]: string } = {};

            if (ocrResponse && ocrResponse.pages) {
                ocrResponse.pages.forEach((page: any, index: number) => {
                    if (index > 0) markdown += "\n\n---\n\n";
                    markdown += page.markdown || "";

                    // Extract images if enabled
                    if (this.settings.extractImages && page.images && page.images.length > 0) {
                        page.images.forEach((image: any) => {
                            const imageName = image.id;
                            let base64Data = image.imageBase64 || "";
                            // Strip data URL prefix if present
                            if (base64Data.startsWith("data:")) {
                                base64Data = base64Data.split(",")[1];
                            }
                            if (base64Data) {
                                images[imageName] = base64Data;
                            }
                        });
                    }
                });
            }

            return { markdown: markdown.trim(), images };

        } catch (error: any) {
            console.error("Mistral SDK Error:", error);
            throw new Error(`Mistral OCR Failed: ${error.message}`);
        }
    }

    // ==================== IMAGE SAVING ====================
    async saveOCRImages(images: { [id: string]: string }, basePath: string): Promise<{ [id: string]: string }> {
        const savedPaths: { [id: string]: string } = {};

        if (Object.keys(images).length === 0) return savedPaths;

        // Create subfolder if needed
        let targetFolder = basePath;
        if (this.settings.imageSubfolder) {
            targetFolder = `${basePath}/${this.settings.imageSubfolder}`;
            const folder = this.app.vault.getAbstractFileByPath(targetFolder);
            if (!(folder instanceof TFolder)) {
                await this.app.vault.createFolder(targetFolder);
            }
        }

        for (const [imageName, base64Data] of Object.entries(images)) {
            try {
                const imagePath = `${targetFolder}/${imageName}`;
                const arrayBuffer = base64ToArrayBuffer(base64Data);

                // Check if file exists
                const existingFile = this.app.vault.getAbstractFileByPath(imagePath);
                if (existingFile instanceof TFile) {
                    await this.app.vault.modifyBinary(existingFile, arrayBuffer);
                } else {
                    await this.app.vault.createBinary(imagePath, arrayBuffer);
                }

                savedPaths[imageName] = imagePath;
            } catch (error: any) {
                console.error(`Failed to save image ${imageName}:`, error);
            }
        }

        new Notice(`📷 Saved ${Object.keys(savedPaths).length} images`);
        return savedPaths;
    }

    // ==================== CORE FORMATTING (WITH ZOD) ====================
    async formatText(rawText: string, modelOverride?: string, customInstruction?: string, editor: Editor | null = null): Promise<string | null> {
        const provider = this.getProvider();

        let model = modelOverride;
        let fetcher: (opts: any) => Promise<any>;

        if (provider) {
            model = modelOverride || provider.getModel('ai-ocr-formatter');
            fetcher = provider.fetchWithRetry.bind(provider);
        } else {
            model = modelOverride || this.settings.openRouterModel;
            fetcher = this.localFetch.bind(this);
        }

        this.setStatus("Formatting...");
        new Notice(`🎨 Formatting with ${model.split('/').pop()}...`);

        // Get Preset Prompt
        const presetName = this.currentPreset || this.settings.defaultPreset;
        let systemPrompt = await this.presetManager.getPresetContent(presetName);
        if (!systemPrompt) systemPrompt = ACADEMIC_BLUE_PROMPT;

        // Append Custom Instruction if provided
        if (customInstruction && customInstruction.trim().length > 0) {
            systemPrompt += `\n\n[USER CUSTOM INSTRUCTION]\n${customInstruction}`;
        }

        // Augment with Zod Instruction
        const zodInstruction = `
        output should be valid JSON matching this schema:
        {
          "formatted_markdown": "string (The formatted content. Use Standard Markdown headers (#, ##). DO NOT use HTML tags like <details>, <summary>, or <div>. DO NOT repeat content. Use proper Callouts > [!...])",
          "confidence_score": "number (0-1)"
        }
        Response MUST be pure JSON. Do not wrap in markdown code blocks.
        `;

        const fullSystemPrompt = `${systemPrompt}\n\n${zodInstruction}`;

        try {
            const response = await fetcher({
                model: model,
                messages: [
                    { role: "system", content: fullSystemPrompt },
                    { role: "user", content: `Format the following OCR text. Language: ${this.settings.language}.\n\n---\n${rawText}\n---` }
                ]
            });

            // Parse Response with Zod
            let content = response.json.choices[0].message.content;
            // Remove <think> tags (deepseek/reasoning models)
            content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
            // Cleanup common LLM mistakes (markdown wrapping)
            content = content.replace(/^```json\s*/, "").replace(/^```/, "").replace(/```$/, "");

            try {
                const parsedJson = JSON.parse(content);
                const result = FormattedResponseSchema.parse(parsedJson); // Validate!

                let formattedMarkdown = result.formatted_markdown;
                formattedMarkdown = this.cleanLatexDelimiters(formattedMarkdown);

                if (editor) {
                    // editor replacement handled by caller usually or here if preferred
                    // editor.replaceSelection(formattedMarkdown);
                    new Notice("✅ formatted!");
                }

                this.clearStatus();
                return formattedMarkdown;

            } catch (validationError) {
                console.error("Zod Validation Failed:", validationError);
                new Notice("⚠️ Formatting structure invalid. Returning raw output.");
                // Fallback to raw content if JSON parse fails, stripping json syntax if possible
                this.clearStatus();
                return content;
            }

        } catch (error: any) {
            new Notice(`❌ Formatting failed: ${error.message}`);
            this.clearStatus();
            return null;
        }
    }

    // ==================== PIPELINE ====================
    async processImage(base64Data: string, mimeType: string, modelOverride?: string, customInstruction?: string): Promise<string | null> {
        try {
            const ocrResult = await this.performMistralOCR(base64Data, mimeType);
            if (!ocrResult.markdown) throw new Error("Empty OCR Result");

            // Save images if extracted
            if (Object.keys(ocrResult.images).length > 0) {
                // Get current file's folder as base path
                const activeFile = this.app.workspace.getActiveFile();
                const basePath = activeFile?.parent?.path || "";
                await this.saveOCRImages(ocrResult.images, basePath);
            }

            new Notice("✅ OCR complete! Formatting...");
            const formatted = await this.formatText(ocrResult.markdown, modelOverride, customInstruction);
            return formatted;
        } catch (error: any) {
            new Notice(`❌ Error: ${error.message}`);
            this.clearStatus();
            return null;
        }
    }

    cleanLatexDelimiters(text: string): string {
        if (!text) return text;

        // Clean non-breaking spaces (U+00A0) and other problematic whitespace
        text = text.replace(/\u00A0/g, ' ');
        text = text.replace(/[\u2000-\u200B\u202F\u205F\u3000]/g, ' ');

        // Replace \[ content \] blocks with proper $$ formatting
        text = text.replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (match, content) => {
            const trimmedContent = content.trim();
            return `$$\n${trimmedContent}\n$$`;
        });
        // Replace \( content \) inline math with $ ... $
        text = text.replace(/\\\(\s*(.*?)\s*\\\)/g, (match, content) => {
            const trimmedContent = content.trim();
            return `$${trimmedContent}$`;
        });
        return text;
    }

    setStatus(text: string) {
        if (this.statusBarItem) this.statusBarItem.setText(text ? `📄 ${text}` : '');
    }

    clearStatus() {
        this.setStatus('');
    }
}

// ==================== UI COMPONENTS ====================

class AIOcrSettingTab extends PluginSettingTab {
    plugin: AIOcrFormatterPlugin;

    constructor(app: App, plugin: AIOcrFormatterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: '📄 AI OCR Formatter Settings' });

        const provider = this.plugin.getProvider();
        if (provider) {
            containerEl.createEl('h3', { text: '🔌 OpenRouter Provider Connected' });
            containerEl.createDiv({ text: "✅ Using shared API key and models.", cls: "setting-item-description" });
        } else {
            containerEl.createEl('h3', { text: '🔌 Standalone Configuration' });
            const warning = containerEl.createDiv({ cls: 'setting-item-description' });
            warning.style.color = 'var(--text-error)';
            warning.style.fontWeight = 'bold';
            warning.style.marginBottom = '15px';
            warning.innerHTML = "⚠️ Works best with <b>OpenRouter Provider</b> plugin.<br>You are currently in standalone mode.";

            new Setting(containerEl)
                .setName("OpenRouter API Key")
                .setDesc("For Formatting (LLM)")
                .addText(text => text
                    .setPlaceholder("sk-or-...")
                    .setValue(this.plugin.settings.openRouterApiKey)
                    .onChange(async v => {
                        this.plugin.settings.openRouterApiKey = v;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName("Fallback Model")
                .setDesc("Model ID for formatting")
                .addText(text => text
                    .setPlaceholder("google/gemini-2.0-flash-exp:free")
                    .setValue(this.plugin.settings.openRouterModel)
                    .onChange(async v => {
                        this.plugin.settings.openRouterModel = v;
                        await this.plugin.saveSettings();
                    }));
        }

        // Mistral Key
        new Setting(containerEl)
            .setName('Mistral API Key')
            .setDesc('For OCR Vision')
            .addText(text => text
                .setPlaceholder('API Key')
                .setValue(this.plugin.settings.mistralApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.mistralApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(b => b.setButtonText("Test").onClick(() => { /* Add test logic */ }));

        // ==================== IMAGE EXTRACTION ====================
        containerEl.createEl('h3', { text: 'Image Extraction' });

        new Setting(containerEl)
            .setName('Extract Images')
            .setDesc('Save images from OCR response to vault')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.extractImages)
                .onChange(async (value) => {
                    this.plugin.settings.extractImages = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Image Subfolder')
            .setDesc('Subfolder for saved images (e.g., "assets"). Leave empty to save in same folder.')
            .addText(text => text
                .setPlaceholder('assets')
                .setValue(this.plugin.settings.imageSubfolder)
                .onChange(async (value) => {
                    this.plugin.settings.imageSubfolder = value;
                    await this.plugin.saveSettings();
                }));

        // Preset Config
        new Setting(containerEl)
            .setName('Default Preset')
            .addDropdown(async (d) => {
                const presets = await this.plugin.presetManager.getPresets();
                presets.forEach(p => d.addOption(p, p));
                d.setValue(this.plugin.settings.defaultPreset);
                d.onChange(async (v) => {
                    this.plugin.settings.defaultPreset = v;
                    await this.plugin.saveSettings();
                });
            });
    }
}


class OCRModal extends Modal {
    plugin: AIOcrFormatterPlugin;
    fileData: string | null = null;
    fileMimeType: string | null = null;
    previewEl!: HTMLImageElement;
    fileInfoEl!: HTMLElement;
    statusEl!: HTMLElement;
    currentModel: string = "google/gemini-2.0-flash-001"; // Default fallback

    customInstruction: string = "";

    constructor(app: App, plugin: AIOcrFormatterPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-ocr-modal');

        contentEl.createEl('h2', { text: '📄 AI OCR Formatter' });

        const provider = this.plugin.getProvider();
        if (provider) {
            this.currentModel = provider.getModel('ai-ocr-formatter') || this.currentModel;
        }

        // Settings Section
        const settingsDiv = contentEl.createDiv({ cls: 'ai-ocr-settings' });

        // 1. Formatting Style (Templates)
        new Setting(settingsDiv)
            .setName("Formatting Style")
            .setDesc("Rules for the AI Formatter")
            .addDropdown(async d => {
                const presets = await this.plugin.presetManager.getPresets();
                presets.forEach(p => d.addOption(p, p));

                let current = this.plugin.settings.defaultPreset;
                if (!presets.includes(current) && presets.length > 0) current = presets[0];

                d.setValue(current);
                this.plugin.currentPreset = current;
                d.onChange(v => this.plugin.currentPreset = v);
            });

        // 2. Formatting Model (Restored to Top)
        // Initialize model from provider or settings
        if (provider) {
            this.currentModel = provider.getModel('ai-ocr-formatter') || this.currentModel;
        } else {
            this.currentModel = this.plugin.settings.openRouterModel || this.currentModel;
        }

        // 2. Formatting Model
        const modelSetting = new Setting(settingsDiv)
            .setName("Formatting Model")
            .addDropdown(d => {
                const refreshOptions = () => {
                    const favorites = provider && provider.getFavorites ? provider.getFavorites() : [];
                    const currentVal = this.currentModel;
                    d.selectEl.innerHTML = "";
                    if (!favorites.includes(currentVal)) {
                        d.addOption(currentVal, currentVal);
                    }
                    favorites.forEach(f => d.addOption(f, f));
                    d.setValue(currentVal);
                };
                refreshOptions();

                if (provider) {
                    d.selectEl.addEventListener('mousedown', refreshOptions);
                    d.onChange(v => this.currentModel = v);
                } else {
                    d.selectEl.title = "Manually set in settings";
                    d.onChange(v => this.currentModel = v); // Allow change if they typed regular string? No, purely display preferred
                }
            })
            .addButton(btn => {
                btn.setButtonText("Browse");
                if (provider) {
                    btn.onClick(() => {
                        provider.openModelSelector('ai-ocr-formatter', () => {
                            this.currentModel = provider.getModel('ai-ocr-formatter');
                            this.onOpen();
                        });
                    });
                } else {
                    btn.setDisabled(true);
                    btn.setTooltip("Requires OpenRouter Provider plugin");
                }
            });

        // Balance (Async with fallback)
        const descEl = modelSetting.descEl.createDiv({ cls: 'ai-ocr-balance-desc' });
        descEl.style.fontSize = '0.8em';
        descEl.style.color = 'var(--text-muted)';

        if (provider && typeof provider.fetchCredits === 'function') {
            descEl.setText("Loading balance...");
            provider.fetchCredits().then((credits: string | null) => {
                descEl.setText(credits ? `Credits: $${credits}` : 'Credits: ???');
            }).catch(() => {
                descEl.setText('Credits: ???');
            });
        } else if (!provider) {
            descEl.setText('⚠️ Standalone Mode');
            descEl.style.color = 'var(--text-warning)';
        }

        // Drop Zone or Selection Info
        const selection = this.getActiveSelection();
        const hasSelection = selection && selection.length > 0;

        let mode = 'file'; // 'file' | 'selection'
        if (hasSelection && !this.fileData) {
            mode = 'selection';
        }

        if (mode === 'selection') {
            contentEl.createEl('div', { cls: 'ai-ocr-section-header', text: 'Text Source' });
            const selInfo = contentEl.createDiv({ cls: 'ai-ocr-dropzone' });
            selInfo.style.borderStyle = 'solid';
            selInfo.style.borderColor = 'var(--interactive-accent)';
            selInfo.createDiv({ text: "📝 Using Current Selection" });
            selInfo.createDiv({ text: `(${selection?.length} chars)`, cls: 'ai-ocr-dropzone-text' });

            selInfo.setAttr('title', 'Click to switch to file upload');
            const fileInput = contentEl.createEl('input', { type: 'file', attr: { accept: 'image/*,.pdf' } });
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', () => { if (fileInput.files?.length) this.handleFile(fileInput.files[0]); });
            selInfo.addEventListener('click', () => fileInput.click());

            selInfo.addEventListener('dragover', (e) => { e.preventDefault(); selInfo.addClass('drag-over'); });
            selInfo.addEventListener('dragleave', () => selInfo.removeClass('drag-over'));
            selInfo.addEventListener('drop', (e) => {
                e.preventDefault();
                if (e.dataTransfer?.files.length) this.handleFile(e.dataTransfer.files[0]);
            });

        } else {
            // Standard Drop Zone
            contentEl.createEl('div', { cls: 'ai-ocr-section-header', text: 'Upload Image or PDF' });
            const dropzone = contentEl.createDiv({ cls: 'ai-ocr-dropzone' });
            const iconDiv = dropzone.createDiv({ cls: 'ai-ocr-dropzone-icon' });
            iconDiv.setText("📷");
            dropzone.createDiv({ text: "Drop image/PDF here or click to browse" });
            const fileInput = contentEl.createEl('input', { type: 'file', attr: { accept: 'image/*,.pdf' } });
            fileInput.style.display = 'none';
            dropzone.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => { if (fileInput.files?.length) this.handleFile(fileInput.files[0]); });
            dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.addClass('drag-over'); });
            dropzone.addEventListener('dragleave', () => dropzone.removeClass('drag-over'));
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.removeClass('drag-over');
                if (e.dataTransfer?.files.length) this.handleFile(e.dataTransfer.files[0]);
            });
        }

        // Preview Area
        this.fileInfoEl = contentEl.createDiv({ cls: 'ai-ocr-file-info' });
        this.previewEl = contentEl.createEl('img', { cls: 'ai-ocr-preview' });
        this.previewEl.style.display = 'none';

        // ==================== FOOTER ACTIONS ====================
        const actionsContainer = contentEl.createDiv({ cls: 'ai-ocr-actions' });
        // Use Flexbox: Left side (Model) - Right side (Buttons)
        actionsContainer.style.display = 'flex';
        actionsContainer.style.justifyContent = 'space-between';
        actionsContainer.style.alignItems = 'end';
        actionsContainer.style.marginTop = '20px';

        const leftActions = actionsContainer.createDiv({ cls: 'ai-ocr-left-actions' });
        const rightActions = actionsContainer.createDiv({ cls: 'ai-ocr-right-actions' });
        // Ensure right actions flex correctly
        rightActions.style.display = 'flex';
        rightActions.style.gap = '8px';

        // --- LEFT: Custom Instructions (Moved to Bottom) ---
        const details = leftActions.createEl('details');
        // Summary
        const summary = details.createEl('summary', { text: '✏️ Instructions' });
        summary.style.cursor = 'pointer';
        summary.style.color = 'var(--text-muted)';
        summary.style.fontSize = '0.9em';

        // TextArea
        const textArea = details.createEl('textarea');
        textArea.placeholder = "e.g. 'Use markdown tables', 'No LaTeX'...";
        textArea.style.width = '200px';
        textArea.style.height = '60px'; // Slightly taller to be usable
        textArea.style.marginTop = '5px';
        textArea.style.resize = 'none';
        textArea.style.display = 'block';
        textArea.value = this.customInstruction;
        textArea.addEventListener('input', (e) => {
            this.customInstruction = (e.target as HTMLTextAreaElement).value;
        });

        // --- RIGHT: Action Buttons ---
        new ButtonComponent(rightActions)
            .setButtonText("Cancel")
            .onClick(() => this.close());

        if (mode === 'selection') {
            // Format Selection Button
            new ButtonComponent(rightActions)
                .setButtonText("Format")
                .setCta()
                .setIcon("highlighter")
                .onClick(async () => {
                    const sel = this.getActiveSelection();
                    if (!sel) return;
                    rightActions.empty();
                    rightActions.createEl('span', { text: '⏳ Formatting...' });

                    const formatted = await this.plugin.formatText(sel, this.currentModel, this.customInstruction, this.getEditor());
                    if (formatted) {
                        this.getEditor()?.replaceSelection(formatted);
                        this.close();
                    } else {
                        this.close();
                    }
                });
        } else {
            // File Mode Buttons

            // 1. OCR Only Button
            new ButtonComponent(rightActions)
                .setButtonText("OCR")
                .setIcon("scan")
                .setTooltip("Extract text only")
                .onClick(async () => {
                    if (!this.fileData || !this.fileMimeType) {
                        new Notice("Please select a file first");
                        return;
                    }
                    rightActions.empty();
                    rightActions.createEl('span', { text: '⏳ ...' });

                    try {
                        const ocrResult = await this.plugin.performMistralOCR(this.fileData, this.fileMimeType);
                        // Save images if extracted
                        if (Object.keys(ocrResult.images).length > 0) {
                            const activeFile = this.plugin.app.workspace.getActiveFile();
                            const basePath = activeFile?.parent?.path || "";
                            await this.plugin.saveOCRImages(ocrResult.images, basePath);
                        }
                        this.outputResult(ocrResult.markdown);
                        this.close();
                    } catch (e) {
                        new Notice("OCR Failed: " + e);
                        this.close();
                    }
                });

            // 2. OCR & Format Button
            new ButtonComponent(rightActions)
                .setButtonText("OCR & Format")
                .setCta()
                .setIcon("refresh-cw")
                .onClick(async () => {
                    if (!this.fileData || !this.fileMimeType) {
                        new Notice("Please select a file first");
                        return;
                    }
                    rightActions.empty();
                    rightActions.createEl('span', { text: '⏳ ...' });

                    const res = await this.plugin.processImage(this.fileData, this.fileMimeType, this.currentModel, this.customInstruction);
                    if (res) {
                        this.outputResult(res);
                        this.close();
                    } else {
                        this.close();
                    }
                });
        }
    }

    getActiveSelection(): string | null {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        return view ? view.editor.getSelection() : null;
    }

    getEditor(): Editor | null {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        return view ? view.editor : null;
    }

    async outputResult(content: string) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            activeView.editor.replaceRange(content, activeView.editor.getCursor());
        } else {
            const newFile = await this.app.vault.create(`OCR-${Date.now()}.md`, content);
            await this.app.workspace.getLeaf(true).openFile(newFile);
        }
    }

    handleFile(file: File) {
        this.fileMimeType = file.type;
        this.fileInfoEl.setText(`Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            // Extract base64 part
            this.fileData = result.split(',')[1];

            if (file.type.startsWith('image/')) {
                this.previewEl.src = result;
                this.previewEl.style.display = 'block';
            } else {
                this.previewEl.style.display = 'none';
                this.fileInfoEl.createEl('div', { text: '📄 PDF Document Ready' });
            }
        };
        reader.readAsDataURL(file);
    }
}
