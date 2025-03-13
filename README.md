# Kanban Status Updater for Obsidian

This plugin automatically updates a property in a note's frontmatter when a card containing a link to that note is moved to a different column on a Kanban board.

![demo](demo.gif)

## Features

- Automatically updates a YAML frontmatter property (default: "status") when a card is moved on a Kanban board
- Works with the [Obsidian Kanban plugin](https://github.com/mgmeyers/obsidian-kanban)
- Performance optimized: only monitors the currently active Kanban board
- Customizable property name
- Visual feedback when properties are updated
- Debug mode for troubleshooting

## Use Cases

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

### Example:

1. You have a note called "Project X Research"
2. You add a card with a link to `[[Project X Research]]` on your Kanban board
3. When you move this card from the "To Do" column to the "In Progress" column
4. The "Project X Research" note's frontmatter will be updated:

```yaml
---
status: In Progress
---
```

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

## Credits

- This plugin works with the [Obsidian Kanban plugin](https://github.com/mgmeyers/obsidian-kanban) by mgmeyers
- Inspired by the need to integrate Kanban workflow states with note frontmatter

## License

MIT License, see [LICENSE](LICENSE) for details.

---

If you find this plugin helpful, consider:
- Star the [GitHub repository](https://github.com/yourusername/obsidian-kanban-status-updater)
- Report any [issues](https://github.com/yourusername/obsidian-kanban-status-updater/issues)
- Submit [pull requests](https://github.com/yourusername/obsidian-kanban-status-updater/pulls) for new features or bug fixes