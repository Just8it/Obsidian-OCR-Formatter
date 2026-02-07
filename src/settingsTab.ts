/*
 * AI OCR SETTINGS TAB
 * Professional settings UI with sections and collapsible prompts
 */

import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import AIOcrFormatterPlugin from "./main";

export class AIOcrSettingTab extends PluginSettingTab {
    plugin: AIOcrFormatterPlugin;

    constructor(app: App, plugin: AIOcrFormatterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('ai-ocr-settings');

        // ===== HEADER =====
        containerEl.createEl('h2', { text: '📄 AI OCR Formatter' });

        const provider = this.plugin.getProvider();

        // ===== PROVIDER SECTION =====
        this.createCollapsibleSection(containerEl, 'Provider', 'plug', true, () => {
            const content = containerEl.createDiv({ cls: 'ai-settings-section-content' });

            if (provider) {
                const row = content.createDiv({ cls: 'ai-settings-row' });
                const left = row.createDiv({ cls: 'ai-settings-row-info' });
                const statusIcon = left.createSpan({ cls: 'ai-status-icon connected' });
                setIcon(statusIcon, 'check-circle');
                left.createSpan({ text: 'OpenRouter Provider Connected', cls: 'ai-settings-row-name' });

                const right = row.createDiv({ cls: 'ai-settings-row-action' });
                right.createSpan({ text: 'Using shared API key', cls: 'ai-settings-row-value' });
            } else {
                // Standalone
                const warningDiv = content.createDiv({ cls: 'ai-settings-warning' });
                const icon = warningDiv.createSpan({ cls: 'ai-warning-icon' });
                setIcon(icon, 'alert-triangle');
                warningDiv.createSpan({ text: 'Standalone Mode - Install OpenRouter Provider for best experience' });

                new Setting(content)
                    .setName("OpenRouter API Key")
                    .setDesc("For Formatting (LLM)")
                    .addText(text => text
                        .setPlaceholder("sk-or-...")
                        .setValue(this.plugin.settings.openRouterApiKey)
                        .onChange(async v => {
                            this.plugin.settings.openRouterApiKey = v;
                            await this.plugin.saveSettings();
                        }));

                new Setting(content)
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
        });

        // ===== MISTRAL OCR =====
        this.createCollapsibleSection(containerEl, 'Mistral OCR Vision', 'eye', true, () => {
            const content = containerEl.createDiv({ cls: 'ai-settings-section-content' });

            new Setting(content)
                .setName('Mistral API Key')
                .setDesc('Required for OCR extraction')
                .addText(text => text
                    .setPlaceholder('API Key')
                    .setValue(this.plugin.settings.mistralApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.mistralApiKey = value;
                        await this.plugin.saveSettings();
                    }));
        });

        // ===== IMAGE EXTRACTION =====
        this.createCollapsibleSection(containerEl, 'Image Extraction', 'image', true, () => {
            const content = containerEl.createDiv({ cls: 'ai-settings-section-content' });

            new Setting(content)
                .setName('Extract Images')
                .setDesc('Save images from OCR response to vault')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.extractImages)
                    .onChange(async (value) => {
                        this.plugin.settings.extractImages = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(content)
                .setName('Image Subfolder')
                .setDesc('Folder for saved images')
                .addText(text => text
                    .setPlaceholder('assets')
                    .setValue(this.plugin.settings.imageSubfolder)
                    .onChange(async (value) => {
                        this.plugin.settings.imageSubfolder = value;
                        await this.plugin.saveSettings();
                    }));
        });

        // ===== EXPERIMENTAL =====
        this.createCollapsibleSection(containerEl, 'Experimental', 'flask', true, () => {
            const content = containerEl.createDiv({ cls: 'ai-settings-section-content' });

            new Setting(content)
                .setName('Enable Streaming')
                .setDesc('Stream formatted text in real-time (OpenRouter only)')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.useStreaming)
                    .onChange(async (value) => {
                        this.plugin.settings.useStreaming = value;
                        await this.plugin.saveSettings();
                    }));
        });


        // ===== DEFAULTS =====
        this.createCollapsibleSection(containerEl, 'Formatting Defaults', 'settings', true, () => {
            const content = containerEl.createDiv({ cls: 'ai-settings-section-content' });

            new Setting(content)
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
        });
    }

    private createCollapsibleSection(container: HTMLElement, title: string, icon: string, openByDefault: boolean, buildContent: () => void): void {
        const section = container.createDiv({ cls: 'ai-settings-section ai-collapsible' });
        if (openByDefault) section.addClass('open');

        const header = section.createDiv({ cls: 'ai-settings-section-header clickable' });
        const iconEl = header.createSpan({ cls: 'ai-settings-section-icon' });
        setIcon(iconEl, icon);
        header.createSpan({ text: title });
        const chevron = header.createSpan({ cls: 'ai-chevron' });
        setIcon(chevron, 'chevron-down');

        const contentWrapper = section.createDiv({ cls: 'ai-collapsible-content' });

        header.addEventListener('click', () => {
            section.toggleClass('open', !section.hasClass('open'));
        });

        // Build content inside wrapper
        // We need to capture the elements created by buildContent and move them, or pass the wrapper
        // Since the pattern used in previous files was passing container and then moving, let's replicate that carefully
        // But here I passed `content` div inside the callback which is appended to `containerEl` (which is `this.containerEl` passed as `container`)
        // Wait, in my previous implementation:
        // `createCollapsibleSection(containerEl ...)`
        // Callback: `const content = containerEl.createDiv...`
        // Then `contentWrapper.appendChild(lastChild)`

        // Let's optimize: The callback should probably append to the wrapper directly?
        // No, to keep consistent with the successful `ai-flashcards` implementation, I used:
        /*
        const widthWrapper = section.createDiv...
        buildContent(); // this appends to container
        const lastChild = container.lastElementChild;
        if (lastChild !== section) widthWrapper.appendChild(lastChild);
        */

        // However, in this file I'm calling `const content = containerEl.createDiv` inside the callback.
        // So the `content` div is appended to `containerEl`.
        // So `container.lastElementChild` will indeed be that content div.

        buildContent();
        const lastChild = container.lastElementChild;
        if (lastChild && lastChild !== section) {
            contentWrapper.appendChild(lastChild);
        }
    }
}
