# LittleTool

LittleTool is a lightweight desktop toolbox for development and operations work. The goal is to keep common utilities in one local desktop app with fast startup, a clear UI, and minimal dependencies.

中文版: [README.md](./README.md)

## Current Goal

- Build a truly lightweight local toolbox instead of a large all-in-one platform
- Prioritize high-frequency, practical utilities first
- Keep Chinese as the default while retaining expandable i18n support
- Deliver most core capabilities with minimal dependencies

## Current Status

### Done

- [x] Tauri + React + Vite project scaffold
- [x] Two-level sidebar navigation
- [x] Settings page
- [x] Dark theme
- [x] Light theme
- [x] Basic JSON tool
- [x] Chinese / English switching
- [x] Extensible base i18n structure
- [x] Chinese and English README files

### Present But Still Placeholder

- [ ] Timestamp Converter
- [ ] Redis Manager
- [ ] MQ Manager
- [ ] ES Manager
- [ ] OCR
- [ ] Format Converter
- [ ] Todo

## Implemented Features

### Navigation Structure

- Basic Tools
  - `JSON Tool`
  - `Timestamp Converter`
- Ops Tools
  - `Redis Manager`
  - `MQ Manager`
  - `ES Manager`
- Document Tools
  - `OCR`
  - `Format Converter`
- Top-level entry
  - `Todo`
- System page
  - `Settings`

### JSON Tool

- JSON formatting
- JSON minifying
- JSON validation
- One-click copy
- `2 / 4` space indentation switch

### Settings

- Dark theme
- Light theme
- Chinese / English switch

## Tech Stack

- `Tauri 2`
- `React 19`
- `TypeScript`
- `Vite`

## Development

```bash
pnpm install
pnpm dev
```

Desktop app development:

```bash
pnpm tauri dev
```

Build the frontend:

```bash
pnpm build
```

## i18n

The i18n structure is now organized for future expansion instead of hardcoding bilingual copy inside page components.

- Message files: `src/i18n/messages`
- Provider: `src/i18n/I18nProvider.tsx`
- Config: `src/i18n/config.ts`
- Default locale: `zh-CN`
- Built-in locales:
  - `zh-CN`
  - `en-US`

To add another language later, the expected path is:

1. Add a new locale file
2. Register it in `i18n/config.ts`
3. Fill in the translated messages

## Roadmap

### P0

- [ ] Build the `Timestamp Converter` page
- [ ] Build the first usable version of `Todo`
- [ ] Add proper empty states and scope notes for placeholder tools
- [ ] Add a basic persistence approach

### P1

- [ ] Add read-only Redis connection and key browsing
- [ ] Add basic MQ message inspection
- [ ] Add ES index query and document search
- [ ] Ship the first version of `Format Converter`
- [ ] Add support for more languages

### P2

- [ ] Add `OCR`
- [ ] Extend Todo with filters, status, and simple grouping
- [ ] Add more theme options such as accent color, density, and default home page
- [ ] Split tool pages into separate modules to reduce `App.tsx` complexity

### Maybe

- [ ] Import / export configuration
- [ ] Command palette
- [ ] Recent tools
- [ ] Plugin-based tool extensions
