# Kanban Status Updater

This is a plugin for making [Kanban boards]((https://github.com/mgmeyers/obsidian-kanban)) better in [Obsidian](https://obsidian.md). When you move a card from one column to another it automatically updates a property in the note's frontmatter.


![demo](demo.gif)

Alternative I found to this ([MetaEdit plugin](https://github.com/chhoumann/MetaEdit)) was slow and buggy, I decided to use a different approach to make a lightweight plugin that is snappy and just works.

## Features

- Auto-updates a frontmatter property (default: "status") when a card is moved on a Kanban board
- Performance optimized: only monitors the currently active Kanban board
- Customizable property name
- Visual feedback when properties are updated
- Debug mode for troubleshooting

## Why do I need it?

This lets you view your tasks/projects in other **non-kanban** ways, for eg. with a `dataview` query on all open tasks (across multiple Kanban boards). 

Use-cases:
- Project management: Move a task card to "In Progress" column and the linked note's status is updated automatically
- Content workflow: Track the status of documents as they move through editorial stages
- Study tracking: Update the status of study notes as they move through learning stages
- Research organization: Track research notes through various phases

## Installation

### From Obsidian Community Plugins

1. Open Obsidian Settings
2. Go to Community Plugins and disable Safe Mode (if enabled)
3. Click "Browse" and search for "Kanban Status Updater"
4. Click Install, then Enable

### Manual Installation

1. Download the latest release from the [GitHub repository](https://github.com/yourusername/obsidian-kanban-status-updater/releases)
2. Extract the zip file into your Obsidian vault's `.obsidian/plugins/` folder
3. Restart Obsidian and enable the plugin in Settings > Community Plugins

## Requirements

- [Obsidian Kanban plugin](https://github.com/mgmeyers/obsidian-kanban) must be installed and enabled
- Kanban cards must contain internal links to notes (e.g., `[[Note Title]]`)

## Usage

1. Create a Kanban board using the Obsidian Kanban plugin
2. Add cards with links to notes (e.g., `[[My Note]]`)
3. When you move a card to a different column, the linked note's status property will automatically update to match the column name

No additional configuration is required for basic functionality.

## Configuration

The plugin can be configured in the Settings tab:

- **Status Property Name**: The name of the property to update in the note's frontmatter (default: "status")
- **Show Notifications**: Toggle notifications when a status is updated
- **Debug Mode**: Enable detailed logging to console (reduces performance, only use for troubleshooting)

There's also a "Test Plugin" button that will scan for Kanban items on the active board to verify the plugin is working.

## Performance Considerations

This plugin is designed to minimize performance impact by:

- Only monitoring the currently active Kanban board
- Disconnecting observers when switching to other views
- Processing a limited number of mutations
- Only updating notes when the status actually changes

If you experience any performance issues, try disabling Debug Mode in the settings.

## Troubleshooting

If the plugin isn't working as expected:

1. **Make sure your Kanban cards contain internal links** to notes (`[[Note Title]]`)
2. **Check that the Kanban plugin is installed and enabled**
3. **Verify you're viewing a Kanban board** (plugin only works with the active board)
4. **Enable Debug Mode** temporarily and check the console (Ctrl+Shift+I) for logs

## Compatibility

- Requires Obsidian v0.15.0 or higher
- Requires Obsidian Kanban plugin v1.3.0 or higher

## If you find this plugin helpful,
- ⭐️ Star the [GitHub repository](https://github.com/ankit-kapur/obsidian-kanban-status-updater-plugin)
- ⚠️ Report any [issues](https://github.com/ankit-kapur/obsidian-kanban-status-updater-plugin/issues)
- ⬆️ Submit [pull requests](https://github.com/ankit-kapur/obsidian-kanban-status-updater-plugin/pulls) for new features or bug fixes