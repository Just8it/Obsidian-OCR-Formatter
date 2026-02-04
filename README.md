# AI OCR Formatter

An Obsidian plugin that combines OCR extraction (via Mistral AI) with AI-powered formatting to transform PDFs and images into clean, structured Markdown.

## Features

- **Mistral OCR Integration**: Extract text from PDFs and images using Mistral's Vision API
- **AI Formatting**: Clean and structure OCR output using customizable presets
- **OpenRouter Support**: Use any model via OpenRouter (standalone or with OpenRouter Provider plugin)
- **Customizable Presets**: Define your own formatting styles (Academic Blue, Clean Markdown, etc.)
- **LaTeX Support**: Automatically converts LaTeX delimiters to Obsidian-compatible format

## Installation

1. Download the latest release
2. Extract to `.obsidian/plugins/ai-ocr-formatter/`
3. Enable the plugin in Obsidian settings
4. Configure your API keys (Mistral for OCR, OpenRouter for formatting)

## Usage

1. Open a note or select text containing OCR output
2. Use the command palette: `AI OCR Formatter: Format Selection/Document`
3. Choose a preset or use custom instructions
4. The formatted Markdown will replace the original text

## Configuration

### API Keys

- **Mistral API Key**: Required for OCR functionality (get one at [mistral.ai](https://mistral.ai))
- **OpenRouter API Key**: Required for AI formatting (or use OpenRouter Provider plugin)

### Presets

Presets are stored in `.obsidian/plugins/ai-ocr-formatter/presets/`. Edit them to customize formatting behavior.

## Dependencies

This plugin uses the following libraries:

- [@mistralai/mistralai](https://github.com/mistralai/client-js) - Mistral AI SDK
- [zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation

## Credits

This plugin was inspired by and incorporates concepts from:

- **[obsidian-marker](https://github.com/L3-N0X/obsidian-marker)** by L3-N0X (MIT License) - PDF to Markdown conversion using Marker API

## License

MIT License - see [LICENSE](LICENSE) for details.
