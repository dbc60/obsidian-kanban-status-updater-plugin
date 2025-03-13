'use strict';

var obsidian = require('obsidian');

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

const DEFAULT_SETTINGS = {
    statusPropertyName: 'status',
    showNotifications: false,
    debugMode: false // Default to false for better performance
};
class KanbanStatusUpdaterPlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        // Track active observers to disconnect them when not needed
        this.currentObserver = null;
        this.isProcessing = false;
        this.activeKanbanBoard = null;
    }
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log('Loading Kanban Status Updater plugin');
            // Load settings
            yield this.loadSettings();
            // Add status bar item
            this.statusBarItem = this.addStatusBarItem();
            this.statusBarItem.setText('KSU: Idle');
            this.statusBarItem.addClass('kanban-status-updater-statusbar');
            // Display startup notification
            if (this.settings.showNotifications) {
                new obsidian.Notice('Kanban Status Updater activated');
            }
            this.log('Plugin loaded');
            // Register DOM event listener for drag events - but only process if active leaf is Kanban
            this.registerDomEvent(document, 'dragend', this.onDragEnd.bind(this));
            this.log('Registered drag event listener');
            // Watch for active leaf changes to only observe the current Kanban board
            this.registerEvent(this.app.workspace.on('active-leaf-change', this.onActiveLeafChange.bind(this)));
            // Initial check for active Kanban board
            this.app.workspace.onLayoutReady(() => {
                this.checkForActiveKanbanBoard();
            });
            // Add settings tab
            this.addSettingTab(new KanbanStatusUpdaterSettingTab(this.app, this));
        });
    }
    onunload() {
        // Disconnect any active observers to prevent memory leaks
        this.disconnectObservers();
        this.log('Plugin unloaded');
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveData(this.settings);
        });
    }
    // Log helper with debug mode check
    log(message) {
        if (this.settings.debugMode) {
            console.log(`[KSU] ${message}`);
            // Update status bar
            this.statusBarItem.setText(`KSU: ${message.substring(0, 25)}${message.length > 25 ? '...' : ''}`);
            // Reset status bar after 3 seconds if no other logs happen
            setTimeout(() => {
                if (this.activeKanbanBoard) {
                    this.statusBarItem.setText('KSU: Active');
                }
                else {
                    this.statusBarItem.setText('KSU: Idle');
                }
            }, 3000);
        }
    }
    // Clean up observers when switching away from a Kanban board
    disconnectObservers() {
        if (this.currentObserver) {
            this.log('Disconnecting observer for performance');
            this.currentObserver.disconnect();
            this.currentObserver = null;
        }
        this.activeKanbanBoard = null;
    }
    // Check if the active leaf is a Kanban board
    onActiveLeafChange(leaf) {
        this.checkForActiveKanbanBoard();
    }
    checkForActiveKanbanBoard() {
        var _a;
        // First disconnect any existing observers
        this.disconnectObservers();
        // Get the active leaf
        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf)
            return;
        try {
            // Find the content element safely
            let contentEl = null;
            // Use type assertions to avoid TypeScript errors
            if (activeLeaf.view) {
                // Try to access the contentEl property using type assertion
                // @ts-ignore - contentEl exists but might not be in type definitions
                contentEl = activeLeaf.view.contentEl;
            }
            // If that didn't work, try another approach
            if (!contentEl) {
                // Try to get the Kanban board directly from the DOM
                // Leaf containers have 'view-content' elements that contain the actual view
                const viewContent = (_a = activeLeaf.containerEl) === null || _a === void 0 ? void 0 : _a.querySelector('.view-content');
                if (viewContent) {
                    contentEl = viewContent;
                }
                else {
                    // Last resort - look for Kanban boards anywhere in the workspace
                    contentEl = document.querySelector('.workspace-leaf.mod-active .view-content');
                }
            }
            if (!contentEl) {
                this.log('Could not access content element for active leaf');
                return;
            }
            // Check if this is a Kanban board
            const kanbanBoard = contentEl.querySelector('.kanban-plugin__board');
            if (kanbanBoard) {
                this.log('Found active Kanban board, setting up observer');
                this.statusBarItem.setText('KSU: Active');
                // Store reference to active board
                this.activeKanbanBoard = kanbanBoard;
                // Set up observer only for this board
                this.setupObserverForBoard(kanbanBoard);
            }
            else {
                this.log('Active leaf is not a Kanban board');
                this.statusBarItem.setText('KSU: Idle');
            }
        }
        catch (error) {
            this.log(`Error detecting Kanban board: ${error.message}`);
            this.statusBarItem.setText('KSU: Error');
        }
    }
    setupObserverForBoard(boardElement) {
        // Create a new observer for this specific board
        this.currentObserver = new MutationObserver((mutations) => {
            if (this.isProcessing)
                return;
            // Simple debounce to prevent rapid-fire processing
            this.isProcessing = true;
            setTimeout(() => {
                this.handleMutations(mutations);
                this.isProcessing = false;
            }, 300);
        });
        // Observe only this board with minimal options needed
        this.currentObserver.observe(boardElement, {
            childList: true,
            subtree: true,
            attributes: false // Don't need attribute changes for performance
        });
        this.log('Observer set up for active Kanban board');
    }
    handleMutations(mutations) {
        if (!this.activeKanbanBoard)
            return;
        try {
            const max_mutations = 10;
            // Only process a sample of mutations for performance
            const mutationsToProcess = mutations.length > max_mutations ?
                mutations.slice(0, max_mutations) : mutations;
            this.log(`Got ${mutationsToProcess.length} mutations of ${mutations.length}`);
            // Look for Kanban items in mutation
            let i = 0;
            for (const mutation of mutationsToProcess) {
                this.log(`Mutation #${++i} - Type: ${mutation.type}`);
                if (mutation.type === 'childList') {
                    // Check added nodes for Kanban items
                    for (const node of Array.from(mutation.addedNodes)) {
                        try {
                            // Check if node is any kind of Element (HTML or SVG)
                            if (node instanceof Element) {
                                this.log(`Processing Element of type: ${node.tagName}`);
                                // Handle the node according to its type
                                if (node instanceof HTMLElement || node instanceof HTMLDivElement) {
                                    // Direct processing for HTML elements
                                    this.log(`Found HTML element of type ${node.className}`);
                                    this.processElement(node);
                                }
                                else if (node instanceof SVGElement) {
                                    // For SVG elements, look for parent HTML element
                                    const parentElement = node.closest('.kanban-plugin__item');
                                    if (parentElement) {
                                        this.log('Found Kanban item parent of SVG element');
                                        this.processElement(parentElement);
                                    }
                                    else {
                                        // Look for any kanban items in the document that might have changed
                                        // This is for cases where the SVG update is related to a card movement
                                        const items = this.activeKanbanBoard.querySelectorAll('.kanban-plugin__item');
                                        if (items.length > 0) {
                                            // Process only the most recently modified item
                                            const recentItems = Array.from(items).slice(-1);
                                            for (const item of recentItems) {
                                                this.log('Processing recent item after SVG change');
                                                this.processElement(item);
                                            }
                                        }
                                    }
                                }
                            }
                            else if (node.nodeType === Node.TEXT_NODE) {
                                // For text nodes, check the parent element
                                const parentElement = node.parentElement;
                                if (parentElement && (parentElement.classList.contains('kanban-plugin__item-title') ||
                                    parentElement.closest('.kanban-plugin__item'))) {
                                    this.log('Found text change in Kanban item');
                                    const itemElement = parentElement.closest('.kanban-plugin__item');
                                    if (itemElement) {
                                        this.processElement(itemElement);
                                    }
                                }
                            }
                            else {
                                this.log(`Skipping node type: ${node.nodeType}`);
                            }
                        }
                        catch (nodeError) {
                            this.log(`Error processing node: ${nodeError.message}`);
                            // Continue with next node even if this one fails
                        }
                    }
                }
                else {
                    this.log('Ignoring mutation type: ' + mutation.type);
                }
            }
        }
        catch (error) {
            this.log(`Error in handleMutations: ${error.message}`);
        }
    }
    onDragEnd(event) {
        // Only process if we have an active Kanban board
        if (!this.activeKanbanBoard || this.isProcessing) {
            this.log('Drag end detected but no active Kanban board or already processing');
            this.log('activeKanbanBoard: ' + (this.activeKanbanBoard ? 'Yes' : 'No'));
            this.log('isProcessing: ' + (this.isProcessing ? 'Yes' : 'No'));
            return;
        }
        try {
            this.log('Drag end detected');
            // Set processing flag to prevent multiple processing
            this.isProcessing = true;
            const target = event.target;
            if (!target)
                return;
            this.processElement(target);
        }
        catch (error) {
            this.log(`Error in onDragEnd: ${error.message}`);
        }
        finally {
            // Reset processing flag after a delay to debounce
            setTimeout(() => {
                this.isProcessing = false;
            }, 300);
        }
    }
    processElement(element) {
        try {
            // Only process if inside our active Kanban board
            if (!this.activeKanbanBoard || !element.closest('.kanban-plugin__board')) {
                this.log('Element NOT in active Kanban board. Skipping.');
                return;
            }
            // Use different strategies to find the Kanban item
            this.log("👀 Looking for Kanban item element");
            // Check if element is a Kanban item or contains one
            const kanbanItem = element.classList.contains('kanban-plugin__item')
                ? element
                : element.querySelector('.kanban-plugin__item');
            if (kanbanItem) {
                this.log(`✅ Found Kanban item: ${kanbanItem}`);
                this.log('classList of kanbanItem: ' + kanbanItem.classList);
                this.processKanbanItem(kanbanItem);
                return;
            }
            this.log('Not a Kanban item, checking for parent');
            // If element is inside a Kanban item, find the parent
            const parentItem = element.closest('.kanban-plugin__item');
            this.log(`Parent item: ${parentItem ? parentItem : 'Not found'}`);
            if (parentItem) {
                this.processKanbanItem(parentItem);
                return;
            }
        }
        catch (error) {
            this.log(`Error in processElement: ${error.message}`);
        }
    }
    processKanbanItem(itemElement) {
        try {
            // TODO: Select the title
            const internalLink = itemElement.querySelector('.kanban-plugin__item-title .kanban-plugin__item-markdown a.internal-link');
            if (!internalLink) {
                this.log('🚫 No internal link found in item');
                return;
            }
            this.log(`Found internal link: ${internalLink.textContent}`);
            // Get the link path from data-href or href attribute
            const linkPath = internalLink.getAttribute('data-href') ||
                internalLink.getAttribute('href');
            if (!linkPath)
                return;
            this.log(`🔗 Link path: ${linkPath}`);
            // Find the lane (column) this item is in
            const lane = itemElement.closest('.kanban-plugin__lane');
            if (!lane) {
                this.log('🚫 No lane found for item');
                return;
            }
            // Get column name from the lane header
            const laneHeader = lane.querySelector('.kanban-plugin__lane-header-wrapper .kanban-plugin__lane-title');
            if (!laneHeader) {
                this.log('🚫 No laneHeader found for item');
                return;
            }
            const columnName = laneHeader.textContent.trim();
            this.log(`✅ Got lane name: ${columnName}`);
            this.log(`Processing card with link to "${linkPath}" in column "${columnName}"`);
            // Update the linked note's status
            this.updateNoteStatus(linkPath, columnName);
        }
        catch (error) {
            this.log(`Error in processKanbanItem: ${error.message}`);
        }
    }
    updateNoteStatus(notePath, status) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Find the linked file
                const file = this.app.metadataCache.getFirstLinkpathDest(notePath, '');
                if (!file) {
                    if (this.settings.showNotifications) {
                        new obsidian.Notice(`⚠️ Note "${notePath}" not found`, 3000);
                    }
                    return;
                }
                // Read the file content
                const content = yield this.app.vault.read(file);
                // Check for existing frontmatter
                const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
                const frontmatterMatch = content.match(frontmatterRegex);
                let newContent;
                let oldStatus = null;
                if (frontmatterMatch) {
                    // File has frontmatter
                    const frontmatterText = frontmatterMatch[1];
                    let frontmatterObj;
                    try {
                        // Try to parse the frontmatter
                        frontmatterObj = obsidian.parseYaml(frontmatterText);
                        // Check if status property already exists
                        if (frontmatterObj[this.settings.statusPropertyName]) {
                            oldStatus = frontmatterObj[this.settings.statusPropertyName];
                        }
                    }
                    catch (e) {
                        this.log(`Error parsing frontmatter: ${e.message}`);
                        frontmatterObj = {};
                    }
                    // Only update if status has changed
                    if (frontmatterObj[this.settings.statusPropertyName] !== status) {
                        // Update the status property
                        frontmatterObj[this.settings.statusPropertyName] = status;
                        // Generate new frontmatter text
                        const newFrontmatterText = obsidian.stringifyYaml(frontmatterObj);
                        // Replace the frontmatter in the content
                        newContent = content.replace(frontmatterRegex, `---\n${newFrontmatterText}---`);
                        // Save the modified content
                        yield this.app.vault.modify(file, newContent);
                        // Show notification if enabled
                        if (this.settings.showNotifications) {
                            if (oldStatus) {
                                new obsidian.Notice(`Updated ${this.settings.statusPropertyName}: "${oldStatus}" → "${status}" for ${file.basename}`, 3000);
                            }
                            else {
                                new obsidian.Notice(`Set ${this.settings.statusPropertyName}: "${status}" for ${file.basename}`, 3000);
                            }
                        }
                        this.log(`Updated status for ${file.basename} to "${status}"`);
                    }
                    else {
                        this.log(`Status already set to "${status}" for ${file.basename}, skipping update`);
                    }
                }
                else {
                    // File has no frontmatter, create it
                    const frontmatterObj = {
                        [this.settings.statusPropertyName]: status
                    };
                    const frontmatterText = obsidian.stringifyYaml(frontmatterObj);
                    newContent = `---\n${frontmatterText}---\n\n${content}`;
                    // Save the modified content
                    yield this.app.vault.modify(file, newContent);
                    // Show notification if enabled
                    if (this.settings.showNotifications) {
                        new obsidian.Notice(`Added ${this.settings.statusPropertyName}: "${status}" to ${file.basename}`, 3000);
                    }
                    this.log(`Added frontmatter with status to ${file.basename}`);
                }
            }
            catch (error) {
                this.log(`Error updating note status: ${error.message}`);
                if (this.settings.showNotifications) {
                    new obsidian.Notice(`⚠️ Error updating status: ${error.message}`, 3000);
                }
            }
        });
    }
    // Method for the test button to use
    runTest() {
        this.log('Running test...');
        // Make sure we're using the current active board
        this.checkForActiveKanbanBoard();
        if (!this.activeKanbanBoard) {
            new obsidian.Notice('⚠️ No active Kanban board found - open a Kanban board first', 5000);
            return;
        }
        // Find items in the active board
        const items = this.activeKanbanBoard.querySelectorAll('.kanban-plugin__item');
        const count = items.length;
        new obsidian.Notice(`Found ${count} cards in active Kanban board`, 3000);
        if (count > 0) {
            // Process the first item with a link
            for (let i = 0; i < count; i++) {
                const item = items[i];
                if (item.querySelector('a.internal-link')) {
                    new obsidian.Notice(`Testing with card: "${item.textContent.substring(0, 20)}..."`, 3000);
                    this.processKanbanItem(item);
                    break;
                }
            }
        }
    }
}
class KanbanStatusUpdaterSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Kanban Status Updater Settings' });
        new obsidian.Setting(containerEl)
            .setName('Status Property Name')
            .setDesc('The name of the property to update when a card is moved')
            .addText(text => text
            .setPlaceholder('status')
            .setValue(this.plugin.settings.statusPropertyName)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.statusPropertyName = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName('Show Notifications')
            .setDesc('Show a notification when a status is updated')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.showNotifications)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.showNotifications = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName('Debug Mode')
            .setDesc('Enable detailed logging (reduces performance)')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.debugMode)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.debugMode = value;
            yield this.plugin.saveSettings();
            if (value) {
                new obsidian.Notice('Debug mode enabled - check console for logs', 3000);
            }
            else {
                new obsidian.Notice('Debug mode disabled', 3000);
            }
        })));
        // Add a test button
        new obsidian.Setting(containerEl)
            .setName('Test Plugin')
            .setDesc('Test with current Kanban board')
            .addButton(button => button
            .setButtonText('Run Test')
            .onClick(() => {
            this.plugin.runTest();
        }));
        // Performance info
        containerEl.createEl('h3', { text: 'Performance Optimization' });
        containerEl.createEl('p', {
            text: 'This plugin only monitors the currently active Kanban board to minimize performance impact.'
        });
        // Troubleshooting section
        containerEl.createEl('h3', { text: 'Troubleshooting' });
        const list = containerEl.createEl('ul');
        list.createEl('li', {
            text: 'The plugin only works with the currently open Kanban board'
        });
        list.createEl('li', {
            text: 'Cards must contain internal links to notes'
        });
        list.createEl('li', {
            text: 'Keep Debug Mode disabled for best performance'
        });
    }
}

module.exports = KanbanStatusUpdaterPlugin;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3RzbGliL3RzbGliLmVzNi5qcyIsIm1haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG5Db3B5cmlnaHQgKGMpIE1pY3Jvc29mdCBDb3Jwb3JhdGlvbi5cclxuXHJcblBlcm1pc3Npb24gdG8gdXNlLCBjb3B5LCBtb2RpZnksIGFuZC9vciBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUgZm9yIGFueVxyXG5wdXJwb3NlIHdpdGggb3Igd2l0aG91dCBmZWUgaXMgaGVyZWJ5IGdyYW50ZWQuXHJcblxyXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiIEFORCBUSEUgQVVUSE9SIERJU0NMQUlNUyBBTEwgV0FSUkFOVElFUyBXSVRIXHJcblJFR0FSRCBUTyBUSElTIFNPRlRXQVJFIElOQ0xVRElORyBBTEwgSU1QTElFRCBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWVxyXG5BTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsXHJcbklORElSRUNULCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgT1IgQU5ZIERBTUFHRVMgV0hBVFNPRVZFUiBSRVNVTFRJTkcgRlJPTVxyXG5MT1NTIE9GIFVTRSwgREFUQSBPUiBQUk9GSVRTLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgTkVHTElHRU5DRSBPUlxyXG5PVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SXHJcblBFUkZPUk1BTkNFIE9GIFRISVMgU09GVFdBUkUuXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqICovXHJcbi8qIGdsb2JhbCBSZWZsZWN0LCBQcm9taXNlLCBTdXBwcmVzc2VkRXJyb3IsIFN5bWJvbCwgSXRlcmF0b3IgKi9cclxuXHJcbnZhciBleHRlbmRTdGF0aWNzID0gZnVuY3Rpb24oZCwgYikge1xyXG4gICAgZXh0ZW5kU3RhdGljcyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fFxyXG4gICAgICAgICh7IF9fcHJvdG9fXzogW10gfSBpbnN0YW5jZW9mIEFycmF5ICYmIGZ1bmN0aW9uIChkLCBiKSB7IGQuX19wcm90b19fID0gYjsgfSkgfHxcclxuICAgICAgICBmdW5jdGlvbiAoZCwgYikgeyBmb3IgKHZhciBwIGluIGIpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYiwgcCkpIGRbcF0gPSBiW3BdOyB9O1xyXG4gICAgcmV0dXJuIGV4dGVuZFN0YXRpY3MoZCwgYik7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHRlbmRzKGQsIGIpIHtcclxuICAgIGlmICh0eXBlb2YgYiAhPT0gXCJmdW5jdGlvblwiICYmIGIgIT09IG51bGwpXHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNsYXNzIGV4dGVuZHMgdmFsdWUgXCIgKyBTdHJpbmcoYikgKyBcIiBpcyBub3QgYSBjb25zdHJ1Y3RvciBvciBudWxsXCIpO1xyXG4gICAgZXh0ZW5kU3RhdGljcyhkLCBiKTtcclxuICAgIGZ1bmN0aW9uIF9fKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gZDsgfVxyXG4gICAgZC5wcm90b3R5cGUgPSBiID09PSBudWxsID8gT2JqZWN0LmNyZWF0ZShiKSA6IChfXy5wcm90b3R5cGUgPSBiLnByb3RvdHlwZSwgbmV3IF9fKCkpO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fYXNzaWduID0gZnVuY3Rpb24oKSB7XHJcbiAgICBfX2Fzc2lnbiA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gX19hc3NpZ24odCkge1xyXG4gICAgICAgIGZvciAodmFyIHMsIGkgPSAxLCBuID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xyXG4gICAgICAgICAgICBzID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkpIHRbcF0gPSBzW3BdO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdDtcclxuICAgIH1cclxuICAgIHJldHVybiBfX2Fzc2lnbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZXN0KHMsIGUpIHtcclxuICAgIHZhciB0ID0ge307XHJcbiAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkgJiYgZS5pbmRleE9mKHApIDwgMClcclxuICAgICAgICB0W3BdID0gc1twXTtcclxuICAgIGlmIChzICE9IG51bGwgJiYgdHlwZW9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocyk7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmIChlLmluZGV4T2YocFtpXSkgPCAwICYmIE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChzLCBwW2ldKSlcclxuICAgICAgICAgICAgICAgIHRbcFtpXV0gPSBzW3BbaV1dO1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiB0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYykge1xyXG4gICAgdmFyIGMgPSBhcmd1bWVudHMubGVuZ3RoLCByID0gYyA8IDMgPyB0YXJnZXQgOiBkZXNjID09PSBudWxsID8gZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodGFyZ2V0LCBrZXkpIDogZGVzYywgZDtcclxuICAgIGlmICh0eXBlb2YgUmVmbGVjdCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgUmVmbGVjdC5kZWNvcmF0ZSA9PT0gXCJmdW5jdGlvblwiKSByID0gUmVmbGVjdC5kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYyk7XHJcbiAgICBlbHNlIGZvciAodmFyIGkgPSBkZWNvcmF0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoZCA9IGRlY29yYXRvcnNbaV0pIHIgPSAoYyA8IDMgPyBkKHIpIDogYyA+IDMgPyBkKHRhcmdldCwga2V5LCByKSA6IGQodGFyZ2V0LCBrZXkpKSB8fCByO1xyXG4gICAgcmV0dXJuIGMgPiAzICYmIHIgJiYgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCByKSwgcjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcGFyYW0ocGFyYW1JbmRleCwgZGVjb3JhdG9yKSB7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldCwga2V5KSB7IGRlY29yYXRvcih0YXJnZXQsIGtleSwgcGFyYW1JbmRleCk7IH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZXNEZWNvcmF0ZShjdG9yLCBkZXNjcmlwdG9ySW4sIGRlY29yYXRvcnMsIGNvbnRleHRJbiwgaW5pdGlhbGl6ZXJzLCBleHRyYUluaXRpYWxpemVycykge1xyXG4gICAgZnVuY3Rpb24gYWNjZXB0KGYpIHsgaWYgKGYgIT09IHZvaWQgMCAmJiB0eXBlb2YgZiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnVuY3Rpb24gZXhwZWN0ZWRcIik7IHJldHVybiBmOyB9XHJcbiAgICB2YXIga2luZCA9IGNvbnRleHRJbi5raW5kLCBrZXkgPSBraW5kID09PSBcImdldHRlclwiID8gXCJnZXRcIiA6IGtpbmQgPT09IFwic2V0dGVyXCIgPyBcInNldFwiIDogXCJ2YWx1ZVwiO1xyXG4gICAgdmFyIHRhcmdldCA9ICFkZXNjcmlwdG9ySW4gJiYgY3RvciA/IGNvbnRleHRJbltcInN0YXRpY1wiXSA/IGN0b3IgOiBjdG9yLnByb3RvdHlwZSA6IG51bGw7XHJcbiAgICB2YXIgZGVzY3JpcHRvciA9IGRlc2NyaXB0b3JJbiB8fCAodGFyZ2V0ID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih0YXJnZXQsIGNvbnRleHRJbi5uYW1lKSA6IHt9KTtcclxuICAgIHZhciBfLCBkb25lID0gZmFsc2U7XHJcbiAgICBmb3IgKHZhciBpID0gZGVjb3JhdG9ycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgIHZhciBjb250ZXh0ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4pIGNvbnRleHRbcF0gPSBwID09PSBcImFjY2Vzc1wiID8ge30gOiBjb250ZXh0SW5bcF07XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4uYWNjZXNzKSBjb250ZXh0LmFjY2Vzc1twXSA9IGNvbnRleHRJbi5hY2Nlc3NbcF07XHJcbiAgICAgICAgY29udGV4dC5hZGRJbml0aWFsaXplciA9IGZ1bmN0aW9uIChmKSB7IGlmIChkb25lKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IGFkZCBpbml0aWFsaXplcnMgYWZ0ZXIgZGVjb3JhdGlvbiBoYXMgY29tcGxldGVkXCIpOyBleHRyYUluaXRpYWxpemVycy5wdXNoKGFjY2VwdChmIHx8IG51bGwpKTsgfTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKDAsIGRlY29yYXRvcnNbaV0pKGtpbmQgPT09IFwiYWNjZXNzb3JcIiA/IHsgZ2V0OiBkZXNjcmlwdG9yLmdldCwgc2V0OiBkZXNjcmlwdG9yLnNldCB9IDogZGVzY3JpcHRvcltrZXldLCBjb250ZXh0KTtcclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJhY2Nlc3NvclwiKSB7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IHZvaWQgMCkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZFwiKTtcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmdldCkpIGRlc2NyaXB0b3IuZ2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LnNldCkpIGRlc2NyaXB0b3Iuc2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmluaXQpKSBpbml0aWFsaXplcnMudW5zaGlmdChfKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoXyA9IGFjY2VwdChyZXN1bHQpKSB7XHJcbiAgICAgICAgICAgIGlmIChraW5kID09PSBcImZpZWxkXCIpIGluaXRpYWxpemVycy51bnNoaWZ0KF8pO1xyXG4gICAgICAgICAgICBlbHNlIGRlc2NyaXB0b3Jba2V5XSA9IF87XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRhcmdldCkgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgY29udGV4dEluLm5hbWUsIGRlc2NyaXB0b3IpO1xyXG4gICAgZG9uZSA9IHRydWU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19ydW5Jbml0aWFsaXplcnModGhpc0FyZywgaW5pdGlhbGl6ZXJzLCB2YWx1ZSkge1xyXG4gICAgdmFyIHVzZVZhbHVlID0gYXJndW1lbnRzLmxlbmd0aCA+IDI7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGluaXRpYWxpemVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhbHVlID0gdXNlVmFsdWUgPyBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnLCB2YWx1ZSkgOiBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1c2VWYWx1ZSA/IHZhbHVlIDogdm9pZCAwO1xyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcHJvcEtleSh4KSB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHggPT09IFwic3ltYm9sXCIgPyB4IDogXCJcIi5jb25jYXQoeCk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zZXRGdW5jdGlvbk5hbWUoZiwgbmFtZSwgcHJlZml4KSB7XHJcbiAgICBpZiAodHlwZW9mIG5hbWUgPT09IFwic3ltYm9sXCIpIG5hbWUgPSBuYW1lLmRlc2NyaXB0aW9uID8gXCJbXCIuY29uY2F0KG5hbWUuZGVzY3JpcHRpb24sIFwiXVwiKSA6IFwiXCI7XHJcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGYsIFwibmFtZVwiLCB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IHByZWZpeCA/IFwiXCIuY29uY2F0KHByZWZpeCwgXCIgXCIsIG5hbWUpIDogbmFtZSB9KTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX21ldGFkYXRhKG1ldGFkYXRhS2V5LCBtZXRhZGF0YVZhbHVlKSB7XHJcbiAgICBpZiAodHlwZW9mIFJlZmxlY3QgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIFJlZmxlY3QubWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFJlZmxlY3QubWV0YWRhdGEobWV0YWRhdGFLZXksIG1ldGFkYXRhVmFsdWUpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikge1xyXG4gICAgZnVuY3Rpb24gYWRvcHQodmFsdWUpIHsgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgUCA/IHZhbHVlIDogbmV3IFAoZnVuY3Rpb24gKHJlc29sdmUpIHsgcmVzb2x2ZSh2YWx1ZSk7IH0pOyB9XHJcbiAgICByZXR1cm4gbmV3IChQIHx8IChQID0gUHJvbWlzZSkpKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gcmVqZWN0ZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3JbXCJ0aHJvd1wiXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gc3RlcChyZXN1bHQpIHsgcmVzdWx0LmRvbmUgPyByZXNvbHZlKHJlc3VsdC52YWx1ZSkgOiBhZG9wdChyZXN1bHQudmFsdWUpLnRoZW4oZnVsZmlsbGVkLCByZWplY3RlZCk7IH1cclxuICAgICAgICBzdGVwKChnZW5lcmF0b3IgPSBnZW5lcmF0b3IuYXBwbHkodGhpc0FyZywgX2FyZ3VtZW50cyB8fCBbXSkpLm5leHQoKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZ2VuZXJhdG9yKHRoaXNBcmcsIGJvZHkpIHtcclxuICAgIHZhciBfID0geyBsYWJlbDogMCwgc2VudDogZnVuY3Rpb24oKSB7IGlmICh0WzBdICYgMSkgdGhyb3cgdFsxXTsgcmV0dXJuIHRbMV07IH0sIHRyeXM6IFtdLCBvcHM6IFtdIH0sIGYsIHksIHQsIGcgPSBPYmplY3QuY3JlYXRlKCh0eXBlb2YgSXRlcmF0b3IgPT09IFwiZnVuY3Rpb25cIiA/IEl0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpO1xyXG4gICAgcmV0dXJuIGcubmV4dCA9IHZlcmIoMCksIGdbXCJ0aHJvd1wiXSA9IHZlcmIoMSksIGdbXCJyZXR1cm5cIl0gPSB2ZXJiKDIpLCB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgKGdbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSksIGc7XHJcbiAgICBmdW5jdGlvbiB2ZXJiKG4pIHsgcmV0dXJuIGZ1bmN0aW9uICh2KSB7IHJldHVybiBzdGVwKFtuLCB2XSk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHN0ZXAob3ApIHtcclxuICAgICAgICBpZiAoZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkdlbmVyYXRvciBpcyBhbHJlYWR5IGV4ZWN1dGluZy5cIik7XHJcbiAgICAgICAgd2hpbGUgKGcgJiYgKGcgPSAwLCBvcFswXSAmJiAoXyA9IDApKSwgXykgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKGYgPSAxLCB5ICYmICh0ID0gb3BbMF0gJiAyID8geVtcInJldHVyblwiXSA6IG9wWzBdID8geVtcInRocm93XCJdIHx8ICgodCA9IHlbXCJyZXR1cm5cIl0pICYmIHQuY2FsbCh5KSwgMCkgOiB5Lm5leHQpICYmICEodCA9IHQuY2FsbCh5LCBvcFsxXSkpLmRvbmUpIHJldHVybiB0O1xyXG4gICAgICAgICAgICBpZiAoeSA9IDAsIHQpIG9wID0gW29wWzBdICYgMiwgdC52YWx1ZV07XHJcbiAgICAgICAgICAgIHN3aXRjaCAob3BbMF0pIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgMDogY2FzZSAxOiB0ID0gb3A7IGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSA0OiBfLmxhYmVsKys7IHJldHVybiB7IHZhbHVlOiBvcFsxXSwgZG9uZTogZmFsc2UgfTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNTogXy5sYWJlbCsrOyB5ID0gb3BbMV07IG9wID0gWzBdOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNzogb3AgPSBfLm9wcy5wb3AoKTsgXy50cnlzLnBvcCgpOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEodCA9IF8udHJ5cywgdCA9IHQubGVuZ3RoID4gMCAmJiB0W3QubGVuZ3RoIC0gMV0pICYmIChvcFswXSA9PT0gNiB8fCBvcFswXSA9PT0gMikpIHsgXyA9IDA7IGNvbnRpbnVlOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wWzBdID09PSAzICYmICghdCB8fCAob3BbMV0gPiB0WzBdICYmIG9wWzFdIDwgdFszXSkpKSB7IF8ubGFiZWwgPSBvcFsxXTsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAob3BbMF0gPT09IDYgJiYgXy5sYWJlbCA8IHRbMV0pIHsgXy5sYWJlbCA9IHRbMV07IHQgPSBvcDsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiBfLmxhYmVsIDwgdFsyXSkgeyBfLmxhYmVsID0gdFsyXTsgXy5vcHMucHVzaChvcCk7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRbMl0pIF8ub3BzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIF8udHJ5cy5wb3AoKTsgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3AgPSBib2R5LmNhbGwodGhpc0FyZywgXyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkgeyBvcCA9IFs2LCBlXTsgeSA9IDA7IH0gZmluYWxseSB7IGYgPSB0ID0gMDsgfVxyXG4gICAgICAgIGlmIChvcFswXSAmIDUpIHRocm93IG9wWzFdOyByZXR1cm4geyB2YWx1ZTogb3BbMF0gPyBvcFsxXSA6IHZvaWQgMCwgZG9uZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fY3JlYXRlQmluZGluZyA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgbSwgaywgazIpIHtcclxuICAgIGlmIChrMiA9PT0gdW5kZWZpbmVkKSBrMiA9IGs7XHJcbiAgICB2YXIgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IobSwgayk7XHJcbiAgICBpZiAoIWRlc2MgfHwgKFwiZ2V0XCIgaW4gZGVzYyA/ICFtLl9fZXNNb2R1bGUgOiBkZXNjLndyaXRhYmxlIHx8IGRlc2MuY29uZmlndXJhYmxlKSkge1xyXG4gICAgICAgIGRlc2MgPSB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiBtW2tdOyB9IH07XHJcbiAgICB9XHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgazIsIGRlc2MpO1xyXG59KSA6IChmdW5jdGlvbihvLCBtLCBrLCBrMikge1xyXG4gICAgaWYgKGsyID09PSB1bmRlZmluZWQpIGsyID0gaztcclxuICAgIG9bazJdID0gbVtrXTtcclxufSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHBvcnRTdGFyKG0sIG8pIHtcclxuICAgIGZvciAodmFyIHAgaW4gbSkgaWYgKHAgIT09IFwiZGVmYXVsdFwiICYmICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgcCkpIF9fY3JlYXRlQmluZGluZyhvLCBtLCBwKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fdmFsdWVzKG8pIHtcclxuICAgIHZhciBzID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIFN5bWJvbC5pdGVyYXRvciwgbSA9IHMgJiYgb1tzXSwgaSA9IDA7XHJcbiAgICBpZiAobSkgcmV0dXJuIG0uY2FsbChvKTtcclxuICAgIGlmIChvICYmIHR5cGVvZiBvLmxlbmd0aCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHtcclxuICAgICAgICBuZXh0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChvICYmIGkgPj0gby5sZW5ndGgpIG8gPSB2b2lkIDA7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBvICYmIG9baSsrXSwgZG9uZTogIW8gfTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihzID8gXCJPYmplY3QgaXMgbm90IGl0ZXJhYmxlLlwiIDogXCJTeW1ib2wuaXRlcmF0b3IgaXMgbm90IGRlZmluZWQuXCIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZWFkKG8sIG4pIHtcclxuICAgIHZhciBtID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIG9bU3ltYm9sLml0ZXJhdG9yXTtcclxuICAgIGlmICghbSkgcmV0dXJuIG87XHJcbiAgICB2YXIgaSA9IG0uY2FsbChvKSwgciwgYXIgPSBbXSwgZTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgd2hpbGUgKChuID09PSB2b2lkIDAgfHwgbi0tID4gMCkgJiYgIShyID0gaS5uZXh0KCkpLmRvbmUpIGFyLnB1c2goci52YWx1ZSk7XHJcbiAgICB9XHJcbiAgICBjYXRjaCAoZXJyb3IpIHsgZSA9IHsgZXJyb3I6IGVycm9yIH07IH1cclxuICAgIGZpbmFsbHkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChyICYmICFyLmRvbmUgJiYgKG0gPSBpW1wicmV0dXJuXCJdKSkgbS5jYWxsKGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaW5hbGx5IHsgaWYgKGUpIHRocm93IGUuZXJyb3I7IH1cclxuICAgIH1cclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZCgpIHtcclxuICAgIGZvciAodmFyIGFyID0gW10sIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKVxyXG4gICAgICAgIGFyID0gYXIuY29uY2F0KF9fcmVhZChhcmd1bWVudHNbaV0pKTtcclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZEFycmF5cygpIHtcclxuICAgIGZvciAodmFyIHMgPSAwLCBpID0gMCwgaWwgPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgaWw7IGkrKykgcyArPSBhcmd1bWVudHNbaV0ubGVuZ3RoO1xyXG4gICAgZm9yICh2YXIgciA9IEFycmF5KHMpLCBrID0gMCwgaSA9IDA7IGkgPCBpbDsgaSsrKVxyXG4gICAgICAgIGZvciAodmFyIGEgPSBhcmd1bWVudHNbaV0sIGogPSAwLCBqbCA9IGEubGVuZ3RoOyBqIDwgamw7IGorKywgaysrKVxyXG4gICAgICAgICAgICByW2tdID0gYVtqXTtcclxuICAgIHJldHVybiByO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zcHJlYWRBcnJheSh0bywgZnJvbSwgcGFjaykge1xyXG4gICAgaWYgKHBhY2sgfHwgYXJndW1lbnRzLmxlbmd0aCA9PT0gMikgZm9yICh2YXIgaSA9IDAsIGwgPSBmcm9tLmxlbmd0aCwgYXI7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XHJcbiAgICAgICAgICAgIGlmICghYXIpIGFyID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSwgMCwgaSk7XHJcbiAgICAgICAgICAgIGFyW2ldID0gZnJvbVtpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdG8uY29uY2F0KGFyIHx8IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fYXdhaXQodikge1xyXG4gICAgcmV0dXJuIHRoaXMgaW5zdGFuY2VvZiBfX2F3YWl0ID8gKHRoaXMudiA9IHYsIHRoaXMpIDogbmV3IF9fYXdhaXQodik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jR2VuZXJhdG9yKHRoaXNBcmcsIF9hcmd1bWVudHMsIGdlbmVyYXRvcikge1xyXG4gICAgaWYgKCFTeW1ib2wuYXN5bmNJdGVyYXRvcikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0l0ZXJhdG9yIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgIHZhciBnID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pLCBpLCBxID0gW107XHJcbiAgICByZXR1cm4gaSA9IE9iamVjdC5jcmVhdGUoKHR5cGVvZiBBc3luY0l0ZXJhdG9yID09PSBcImZ1bmN0aW9uXCIgPyBBc3luY0l0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpLCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIsIGF3YWl0UmV0dXJuKSwgaVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0gPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzOyB9LCBpO1xyXG4gICAgZnVuY3Rpb24gYXdhaXRSZXR1cm4oZikgeyByZXR1cm4gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh2KS50aGVuKGYsIHJlamVjdCk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpZiAoZ1tuXSkgeyBpW25dID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChhLCBiKSB7IHEucHVzaChbbiwgdiwgYSwgYl0pID4gMSB8fCByZXN1bWUobiwgdik7IH0pOyB9OyBpZiAoZikgaVtuXSA9IGYoaVtuXSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gcmVzdW1lKG4sIHYpIHsgdHJ5IHsgc3RlcChnW25dKHYpKTsgfSBjYXRjaCAoZSkgeyBzZXR0bGUocVswXVszXSwgZSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gc3RlcChyKSB7IHIudmFsdWUgaW5zdGFuY2VvZiBfX2F3YWl0ID8gUHJvbWlzZS5yZXNvbHZlKHIudmFsdWUudikudGhlbihmdWxmaWxsLCByZWplY3QpIDogc2V0dGxlKHFbMF1bMl0sIHIpOyB9XHJcbiAgICBmdW5jdGlvbiBmdWxmaWxsKHZhbHVlKSB7IHJlc3VtZShcIm5leHRcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiByZWplY3QodmFsdWUpIHsgcmVzdW1lKFwidGhyb3dcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiBzZXR0bGUoZiwgdikgeyBpZiAoZih2KSwgcS5zaGlmdCgpLCBxLmxlbmd0aCkgcmVzdW1lKHFbMF1bMF0sIHFbMF1bMV0pOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jRGVsZWdhdG9yKG8pIHtcclxuICAgIHZhciBpLCBwO1xyXG4gICAgcmV0dXJuIGkgPSB7fSwgdmVyYihcIm5leHRcIiksIHZlcmIoXCJ0aHJvd1wiLCBmdW5jdGlvbiAoZSkgeyB0aHJvdyBlOyB9KSwgdmVyYihcInJldHVyblwiKSwgaVtTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfSwgaTtcclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpW25dID0gb1tuXSA/IGZ1bmN0aW9uICh2KSB7IHJldHVybiAocCA9ICFwKSA/IHsgdmFsdWU6IF9fYXdhaXQob1tuXSh2KSksIGRvbmU6IGZhbHNlIH0gOiBmID8gZih2KSA6IHY7IH0gOiBmOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jVmFsdWVzKG8pIHtcclxuICAgIGlmICghU3ltYm9sLmFzeW5jSXRlcmF0b3IpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNJdGVyYXRvciBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICB2YXIgbSA9IG9bU3ltYm9sLmFzeW5jSXRlcmF0b3JdLCBpO1xyXG4gICAgcmV0dXJuIG0gPyBtLmNhbGwobykgOiAobyA9IHR5cGVvZiBfX3ZhbHVlcyA9PT0gXCJmdW5jdGlvblwiID8gX192YWx1ZXMobykgOiBvW1N5bWJvbC5pdGVyYXRvcl0oKSwgaSA9IHt9LCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIpLCBpW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXM7IH0sIGkpO1xyXG4gICAgZnVuY3Rpb24gdmVyYihuKSB7IGlbbl0gPSBvW25dICYmIGZ1bmN0aW9uICh2KSB7IHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHYgPSBvW25dKHYpLCBzZXR0bGUocmVzb2x2ZSwgcmVqZWN0LCB2LmRvbmUsIHYudmFsdWUpOyB9KTsgfTsgfVxyXG4gICAgZnVuY3Rpb24gc2V0dGxlKHJlc29sdmUsIHJlamVjdCwgZCwgdikgeyBQcm9taXNlLnJlc29sdmUodikudGhlbihmdW5jdGlvbih2KSB7IHJlc29sdmUoeyB2YWx1ZTogdiwgZG9uZTogZCB9KTsgfSwgcmVqZWN0KTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19tYWtlVGVtcGxhdGVPYmplY3QoY29va2VkLCByYXcpIHtcclxuICAgIGlmIChPYmplY3QuZGVmaW5lUHJvcGVydHkpIHsgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvb2tlZCwgXCJyYXdcIiwgeyB2YWx1ZTogcmF3IH0pOyB9IGVsc2UgeyBjb29rZWQucmF3ID0gcmF3OyB9XHJcbiAgICByZXR1cm4gY29va2VkO1xyXG59O1xyXG5cclxudmFyIF9fc2V0TW9kdWxlRGVmYXVsdCA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgdikge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sIFwiZGVmYXVsdFwiLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2IH0pO1xyXG59KSA6IGZ1bmN0aW9uKG8sIHYpIHtcclxuICAgIG9bXCJkZWZhdWx0XCJdID0gdjtcclxufTtcclxuXHJcbnZhciBvd25LZXlzID0gZnVuY3Rpb24obykge1xyXG4gICAgb3duS2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzIHx8IGZ1bmN0aW9uIChvKSB7XHJcbiAgICAgICAgdmFyIGFyID0gW107XHJcbiAgICAgICAgZm9yICh2YXIgayBpbiBvKSBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIGspKSBhclthci5sZW5ndGhdID0gaztcclxuICAgICAgICByZXR1cm4gYXI7XHJcbiAgICB9O1xyXG4gICAgcmV0dXJuIG93bktleXMobyk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19pbXBvcnRTdGFyKG1vZCkge1xyXG4gICAgaWYgKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgcmV0dXJuIG1vZDtcclxuICAgIHZhciByZXN1bHQgPSB7fTtcclxuICAgIGlmIChtb2QgIT0gbnVsbCkgZm9yICh2YXIgayA9IG93bktleXMobW9kKSwgaSA9IDA7IGkgPCBrLmxlbmd0aDsgaSsrKSBpZiAoa1tpXSAhPT0gXCJkZWZhdWx0XCIpIF9fY3JlYXRlQmluZGluZyhyZXN1bHQsIG1vZCwga1tpXSk7XHJcbiAgICBfX3NldE1vZHVsZURlZmF1bHQocmVzdWx0LCBtb2QpO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9faW1wb3J0RGVmYXVsdChtb2QpIHtcclxuICAgIHJldHVybiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSA/IG1vZCA6IHsgZGVmYXVsdDogbW9kIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2NsYXNzUHJpdmF0ZUZpZWxkR2V0KHJlY2VpdmVyLCBzdGF0ZSwga2luZCwgZikge1xyXG4gICAgaWYgKGtpbmQgPT09IFwiYVwiICYmICFmKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBhY2Nlc3NvciB3YXMgZGVmaW5lZCB3aXRob3V0IGEgZ2V0dGVyXCIpO1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gXCJmdW5jdGlvblwiID8gcmVjZWl2ZXIgIT09IHN0YXRlIHx8ICFmIDogIXN0YXRlLmhhcyhyZWNlaXZlcikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgcmVhZCBwcml2YXRlIG1lbWJlciBmcm9tIGFuIG9iamVjdCB3aG9zZSBjbGFzcyBkaWQgbm90IGRlY2xhcmUgaXRcIik7XHJcbiAgICByZXR1cm4ga2luZCA9PT0gXCJtXCIgPyBmIDoga2luZCA9PT0gXCJhXCIgPyBmLmNhbGwocmVjZWl2ZXIpIDogZiA/IGYudmFsdWUgOiBzdGF0ZS5nZXQocmVjZWl2ZXIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZFNldChyZWNlaXZlciwgc3RhdGUsIHZhbHVlLCBraW5kLCBmKSB7XHJcbiAgICBpZiAoa2luZCA9PT0gXCJtXCIpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQcml2YXRlIG1ldGhvZCBpcyBub3Qgd3JpdGFibGVcIik7XHJcbiAgICBpZiAoa2luZCA9PT0gXCJhXCIgJiYgIWYpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQcml2YXRlIGFjY2Vzc29yIHdhcyBkZWZpbmVkIHdpdGhvdXQgYSBzZXR0ZXJcIik7XHJcbiAgICBpZiAodHlwZW9mIHN0YXRlID09PSBcImZ1bmN0aW9uXCIgPyByZWNlaXZlciAhPT0gc3RhdGUgfHwgIWYgOiAhc3RhdGUuaGFzKHJlY2VpdmVyKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCB3cml0ZSBwcml2YXRlIG1lbWJlciB0byBhbiBvYmplY3Qgd2hvc2UgY2xhc3MgZGlkIG5vdCBkZWNsYXJlIGl0XCIpO1xyXG4gICAgcmV0dXJuIChraW5kID09PSBcImFcIiA/IGYuY2FsbChyZWNlaXZlciwgdmFsdWUpIDogZiA/IGYudmFsdWUgPSB2YWx1ZSA6IHN0YXRlLnNldChyZWNlaXZlciwgdmFsdWUpKSwgdmFsdWU7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2NsYXNzUHJpdmF0ZUZpZWxkSW4oc3RhdGUsIHJlY2VpdmVyKSB7XHJcbiAgICBpZiAocmVjZWl2ZXIgPT09IG51bGwgfHwgKHR5cGVvZiByZWNlaXZlciAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgcmVjZWl2ZXIgIT09IFwiZnVuY3Rpb25cIikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgdXNlICdpbicgb3BlcmF0b3Igb24gbm9uLW9iamVjdFwiKTtcclxuICAgIHJldHVybiB0eXBlb2Ygc3RhdGUgPT09IFwiZnVuY3Rpb25cIiA/IHJlY2VpdmVyID09PSBzdGF0ZSA6IHN0YXRlLmhhcyhyZWNlaXZlcik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZShlbnYsIHZhbHVlLCBhc3luYykge1xyXG4gICAgaWYgKHZhbHVlICE9PSBudWxsICYmIHZhbHVlICE9PSB2b2lkIDApIHtcclxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0IGV4cGVjdGVkLlwiKTtcclxuICAgICAgICB2YXIgZGlzcG9zZSwgaW5uZXI7XHJcbiAgICAgICAgaWYgKGFzeW5jKSB7XHJcbiAgICAgICAgICAgIGlmICghU3ltYm9sLmFzeW5jRGlzcG9zZSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0Rpc3Bvc2UgaXMgbm90IGRlZmluZWQuXCIpO1xyXG4gICAgICAgICAgICBkaXNwb3NlID0gdmFsdWVbU3ltYm9sLmFzeW5jRGlzcG9zZV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkaXNwb3NlID09PSB2b2lkIDApIHtcclxuICAgICAgICAgICAgaWYgKCFTeW1ib2wuZGlzcG9zZSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5kaXNwb3NlIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgICAgICAgICAgZGlzcG9zZSA9IHZhbHVlW1N5bWJvbC5kaXNwb3NlXTtcclxuICAgICAgICAgICAgaWYgKGFzeW5jKSBpbm5lciA9IGRpc3Bvc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh0eXBlb2YgZGlzcG9zZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0IG5vdCBkaXNwb3NhYmxlLlwiKTtcclxuICAgICAgICBpZiAoaW5uZXIpIGRpc3Bvc2UgPSBmdW5jdGlvbigpIHsgdHJ5IHsgaW5uZXIuY2FsbCh0aGlzKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gUHJvbWlzZS5yZWplY3QoZSk7IH0gfTtcclxuICAgICAgICBlbnYuc3RhY2sucHVzaCh7IHZhbHVlOiB2YWx1ZSwgZGlzcG9zZTogZGlzcG9zZSwgYXN5bmM6IGFzeW5jIH0pO1xyXG4gICAgfVxyXG4gICAgZWxzZSBpZiAoYXN5bmMpIHtcclxuICAgICAgICBlbnYuc3RhY2sucHVzaCh7IGFzeW5jOiB0cnVlIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG5cclxufVxyXG5cclxudmFyIF9TdXBwcmVzc2VkRXJyb3IgPSB0eXBlb2YgU3VwcHJlc3NlZEVycm9yID09PSBcImZ1bmN0aW9uXCIgPyBTdXBwcmVzc2VkRXJyb3IgOiBmdW5jdGlvbiAoZXJyb3IsIHN1cHByZXNzZWQsIG1lc3NhZ2UpIHtcclxuICAgIHZhciBlID0gbmV3IEVycm9yKG1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIGUubmFtZSA9IFwiU3VwcHJlc3NlZEVycm9yXCIsIGUuZXJyb3IgPSBlcnJvciwgZS5zdXBwcmVzc2VkID0gc3VwcHJlc3NlZCwgZTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2Rpc3Bvc2VSZXNvdXJjZXMoZW52KSB7XHJcbiAgICBmdW5jdGlvbiBmYWlsKGUpIHtcclxuICAgICAgICBlbnYuZXJyb3IgPSBlbnYuaGFzRXJyb3IgPyBuZXcgX1N1cHByZXNzZWRFcnJvcihlLCBlbnYuZXJyb3IsIFwiQW4gZXJyb3Igd2FzIHN1cHByZXNzZWQgZHVyaW5nIGRpc3Bvc2FsLlwiKSA6IGU7XHJcbiAgICAgICAgZW52Lmhhc0Vycm9yID0gdHJ1ZTtcclxuICAgIH1cclxuICAgIHZhciByLCBzID0gMDtcclxuICAgIGZ1bmN0aW9uIG5leHQoKSB7XHJcbiAgICAgICAgd2hpbGUgKHIgPSBlbnYuc3RhY2sucG9wKCkpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGlmICghci5hc3luYyAmJiBzID09PSAxKSByZXR1cm4gcyA9IDAsIGVudi5zdGFjay5wdXNoKHIpLCBQcm9taXNlLnJlc29sdmUoKS50aGVuKG5leHQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHIuZGlzcG9zZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSByLmRpc3Bvc2UuY2FsbChyLnZhbHVlKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoci5hc3luYykgcmV0dXJuIHMgfD0gMiwgUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCkudGhlbihuZXh0LCBmdW5jdGlvbihlKSB7IGZhaWwoZSk7IHJldHVybiBuZXh0KCk7IH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSBzIHw9IDE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgIGZhaWwoZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHMgPT09IDEpIHJldHVybiBlbnYuaGFzRXJyb3IgPyBQcm9taXNlLnJlamVjdChlbnYuZXJyb3IpIDogUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICAgICAgaWYgKGVudi5oYXNFcnJvcikgdGhyb3cgZW52LmVycm9yO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5leHQoKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uKHBhdGgsIHByZXNlcnZlSnN4KSB7XHJcbiAgICBpZiAodHlwZW9mIHBhdGggPT09IFwic3RyaW5nXCIgJiYgL15cXC5cXC4/XFwvLy50ZXN0KHBhdGgpKSB7XHJcbiAgICAgICAgcmV0dXJuIHBhdGgucmVwbGFjZSgvXFwuKHRzeCkkfCgoPzpcXC5kKT8pKCg/OlxcLlteLi9dKz8pPylcXC4oW2NtXT8pdHMkL2ksIGZ1bmN0aW9uIChtLCB0c3gsIGQsIGV4dCwgY20pIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRzeCA/IHByZXNlcnZlSnN4ID8gXCIuanN4XCIgOiBcIi5qc1wiIDogZCAmJiAoIWV4dCB8fCAhY20pID8gbSA6IChkICsgZXh0ICsgXCIuXCIgKyBjbS50b0xvd2VyQ2FzZSgpICsgXCJqc1wiKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXRoO1xyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCB7XHJcbiAgICBfX2V4dGVuZHM6IF9fZXh0ZW5kcyxcclxuICAgIF9fYXNzaWduOiBfX2Fzc2lnbixcclxuICAgIF9fcmVzdDogX19yZXN0LFxyXG4gICAgX19kZWNvcmF0ZTogX19kZWNvcmF0ZSxcclxuICAgIF9fcGFyYW06IF9fcGFyYW0sXHJcbiAgICBfX2VzRGVjb3JhdGU6IF9fZXNEZWNvcmF0ZSxcclxuICAgIF9fcnVuSW5pdGlhbGl6ZXJzOiBfX3J1bkluaXRpYWxpemVycyxcclxuICAgIF9fcHJvcEtleTogX19wcm9wS2V5LFxyXG4gICAgX19zZXRGdW5jdGlvbk5hbWU6IF9fc2V0RnVuY3Rpb25OYW1lLFxyXG4gICAgX19tZXRhZGF0YTogX19tZXRhZGF0YSxcclxuICAgIF9fYXdhaXRlcjogX19hd2FpdGVyLFxyXG4gICAgX19nZW5lcmF0b3I6IF9fZ2VuZXJhdG9yLFxyXG4gICAgX19jcmVhdGVCaW5kaW5nOiBfX2NyZWF0ZUJpbmRpbmcsXHJcbiAgICBfX2V4cG9ydFN0YXI6IF9fZXhwb3J0U3RhcixcclxuICAgIF9fdmFsdWVzOiBfX3ZhbHVlcyxcclxuICAgIF9fcmVhZDogX19yZWFkLFxyXG4gICAgX19zcHJlYWQ6IF9fc3ByZWFkLFxyXG4gICAgX19zcHJlYWRBcnJheXM6IF9fc3ByZWFkQXJyYXlzLFxyXG4gICAgX19zcHJlYWRBcnJheTogX19zcHJlYWRBcnJheSxcclxuICAgIF9fYXdhaXQ6IF9fYXdhaXQsXHJcbiAgICBfX2FzeW5jR2VuZXJhdG9yOiBfX2FzeW5jR2VuZXJhdG9yLFxyXG4gICAgX19hc3luY0RlbGVnYXRvcjogX19hc3luY0RlbGVnYXRvcixcclxuICAgIF9fYXN5bmNWYWx1ZXM6IF9fYXN5bmNWYWx1ZXMsXHJcbiAgICBfX21ha2VUZW1wbGF0ZU9iamVjdDogX19tYWtlVGVtcGxhdGVPYmplY3QsXHJcbiAgICBfX2ltcG9ydFN0YXI6IF9faW1wb3J0U3RhcixcclxuICAgIF9faW1wb3J0RGVmYXVsdDogX19pbXBvcnREZWZhdWx0LFxyXG4gICAgX19jbGFzc1ByaXZhdGVGaWVsZEdldDogX19jbGFzc1ByaXZhdGVGaWVsZEdldCxcclxuICAgIF9fY2xhc3NQcml2YXRlRmllbGRTZXQ6IF9fY2xhc3NQcml2YXRlRmllbGRTZXQsXHJcbiAgICBfX2NsYXNzUHJpdmF0ZUZpZWxkSW46IF9fY2xhc3NQcml2YXRlRmllbGRJbixcclxuICAgIF9fYWRkRGlzcG9zYWJsZVJlc291cmNlOiBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZSxcclxuICAgIF9fZGlzcG9zZVJlc291cmNlczogX19kaXNwb3NlUmVzb3VyY2VzLFxyXG4gICAgX19yZXdyaXRlUmVsYXRpdmVJbXBvcnRFeHRlbnNpb246IF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uLFxyXG59O1xyXG4iLCJpbXBvcnQge1xuICBBcHAsXG4gIE5vdGljZSxcbiAgcGFyc2VZYW1sLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIHN0cmluZ2lmeVlhbWwsXG4gIFdvcmtzcGFjZUxlYWZcbn0gZnJvbSAnb2JzaWRpYW4nO1xuXG5pbnRlcmZhY2UgS2FuYmFuU3RhdHVzVXBkYXRlclNldHRpbmdzIHtcbiAgc3RhdHVzUHJvcGVydHlOYW1lOiBzdHJpbmc7XG4gIHNob3dOb3RpZmljYXRpb25zOiBib29sZWFuO1xuICBkZWJ1Z01vZGU6IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IEthbmJhblN0YXR1c1VwZGF0ZXJTZXR0aW5ncyA9IHtcbiAgc3RhdHVzUHJvcGVydHlOYW1lOiAnc3RhdHVzJyxcbiAgc2hvd05vdGlmaWNhdGlvbnM6IGZhbHNlLFxuICBkZWJ1Z01vZGU6IGZhbHNlICAvLyBEZWZhdWx0IHRvIGZhbHNlIGZvciBiZXR0ZXIgcGVyZm9ybWFuY2Vcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgS2FuYmFuU3RhdHVzVXBkYXRlclBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHNldHRpbmdzOiBLYW5iYW5TdGF0dXNVcGRhdGVyU2V0dGluZ3M7XG4gIHN0YXR1c0Jhckl0ZW06IEhUTUxFbGVtZW50O1xuICBcbiAgLy8gVHJhY2sgYWN0aXZlIG9ic2VydmVycyB0byBkaXNjb25uZWN0IHRoZW0gd2hlbiBub3QgbmVlZGVkXG4gIHByaXZhdGUgY3VycmVudE9ic2VydmVyOiBNdXRhdGlvbk9ic2VydmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaXNQcm9jZXNzaW5nID0gZmFsc2U7XG4gIHByaXZhdGUgYWN0aXZlS2FuYmFuQm9hcmQ6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIFxuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgICBjb25zb2xlLmxvZygnTG9hZGluZyBLYW5iYW4gU3RhdHVzIFVwZGF0ZXIgcGx1Z2luJyk7XG4gICAgICBcbiAgICAgIC8vIExvYWQgc2V0dGluZ3NcbiAgICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgICBcbiAgICAgIC8vIEFkZCBzdGF0dXMgYmFyIGl0ZW1cbiAgICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLnNldFRleHQoJ0tTVTogSWRsZScpO1xuICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLmFkZENsYXNzKCdrYW5iYW4tc3RhdHVzLXVwZGF0ZXItc3RhdHVzYmFyJyk7XG4gICAgICBcbiAgICAgIC8vIERpc3BsYXkgc3RhcnR1cCBub3RpZmljYXRpb25cbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLnNob3dOb3RpZmljYXRpb25zKSB7XG4gICAgICAgICAgbmV3IE5vdGljZSgnS2FuYmFuIFN0YXR1cyBVcGRhdGVyIGFjdGl2YXRlZCcpO1xuICAgICAgfVxuICAgICAgdGhpcy5sb2coJ1BsdWdpbiBsb2FkZWQnKTtcbiAgICAgIFxuICAgICAgLy8gUmVnaXN0ZXIgRE9NIGV2ZW50IGxpc3RlbmVyIGZvciBkcmFnIGV2ZW50cyAtIGJ1dCBvbmx5IHByb2Nlc3MgaWYgYWN0aXZlIGxlYWYgaXMgS2FuYmFuXG4gICAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQoZG9jdW1lbnQsICdkcmFnZW5kJywgdGhpcy5vbkRyYWdFbmQuYmluZCh0aGlzKSk7XG4gICAgICB0aGlzLmxvZygnUmVnaXN0ZXJlZCBkcmFnIGV2ZW50IGxpc3RlbmVyJyk7XG4gICAgICBcbiAgICAgIC8vIFdhdGNoIGZvciBhY3RpdmUgbGVhZiBjaGFuZ2VzIHRvIG9ubHkgb2JzZXJ2ZSB0aGUgY3VycmVudCBLYW5iYW4gYm9hcmRcbiAgICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsIHRoaXMub25BY3RpdmVMZWFmQ2hhbmdlLmJpbmQodGhpcykpXG4gICAgICApO1xuICAgICAgXG4gICAgICAvLyBJbml0aWFsIGNoZWNrIGZvciBhY3RpdmUgS2FuYmFuIGJvYXJkXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jaGVja0ZvckFjdGl2ZUthbmJhbkJvYXJkKCk7XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgLy8gQWRkIHNldHRpbmdzIHRhYlxuICAgICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBLYW5iYW5TdGF0dXNVcGRhdGVyU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICB9XG4gIFxuICBvbnVubG9hZCgpIHtcbiAgICAgIC8vIERpc2Nvbm5lY3QgYW55IGFjdGl2ZSBvYnNlcnZlcnMgdG8gcHJldmVudCBtZW1vcnkgbGVha3NcbiAgICAgIHRoaXMuZGlzY29ubmVjdE9ic2VydmVycygpO1xuICAgICAgdGhpcy5sb2coJ1BsdWdpbiB1bmxvYWRlZCcpO1xuICB9XG4gIFxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUywgYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgfVxuICBcbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxuICBcbiAgLy8gTG9nIGhlbHBlciB3aXRoIGRlYnVnIG1vZGUgY2hlY2tcbiAgbG9nKG1lc3NhZ2U6IHN0cmluZykge1xuICAgICAgaWYgKHRoaXMuc2V0dGluZ3MuZGVidWdNb2RlKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYFtLU1VdICR7bWVzc2FnZX1gKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBVcGRhdGUgc3RhdHVzIGJhclxuICAgICAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5zZXRUZXh0KGBLU1U6ICR7bWVzc2FnZS5zdWJzdHJpbmcoMCwgMjUpfSR7bWVzc2FnZS5sZW5ndGggPiAyNSA/ICcuLi4nIDogJyd9YCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUmVzZXQgc3RhdHVzIGJhciBhZnRlciAzIHNlY29uZHMgaWYgbm8gb3RoZXIgbG9ncyBoYXBwZW5cbiAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgaWYgKHRoaXMuYWN0aXZlS2FuYmFuQm9hcmQpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5zZXRUZXh0KCdLU1U6IEFjdGl2ZScpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLnNldFRleHQoJ0tTVTogSWRsZScpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfSwgMzAwMCk7XG4gICAgICB9XG4gIH1cbiAgXG4gIC8vIENsZWFuIHVwIG9ic2VydmVycyB3aGVuIHN3aXRjaGluZyBhd2F5IGZyb20gYSBLYW5iYW4gYm9hcmRcbiAgZGlzY29ubmVjdE9ic2VydmVycygpIHtcbiAgICAgIGlmICh0aGlzLmN1cnJlbnRPYnNlcnZlcikge1xuICAgICAgICAgIHRoaXMubG9nKCdEaXNjb25uZWN0aW5nIG9ic2VydmVyIGZvciBwZXJmb3JtYW5jZScpO1xuICAgICAgICAgIHRoaXMuY3VycmVudE9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcbiAgICAgICAgICB0aGlzLmN1cnJlbnRPYnNlcnZlciA9IG51bGw7XG4gICAgICB9XG4gICAgICB0aGlzLmFjdGl2ZUthbmJhbkJvYXJkID0gbnVsbDtcbiAgfVxuICBcbiAgLy8gQ2hlY2sgaWYgdGhlIGFjdGl2ZSBsZWFmIGlzIGEgS2FuYmFuIGJvYXJkXG4gIG9uQWN0aXZlTGVhZkNoYW5nZShsZWFmOiBXb3Jrc3BhY2VMZWFmKSB7XG4gICAgICB0aGlzLmNoZWNrRm9yQWN0aXZlS2FuYmFuQm9hcmQoKTtcbiAgfVxuICBcbiAgY2hlY2tGb3JBY3RpdmVLYW5iYW5Cb2FyZCgpIHtcbiAgICAvLyBGaXJzdCBkaXNjb25uZWN0IGFueSBleGlzdGluZyBvYnNlcnZlcnNcbiAgICB0aGlzLmRpc2Nvbm5lY3RPYnNlcnZlcnMoKTtcbiAgICBcbiAgICAvLyBHZXQgdGhlIGFjdGl2ZSBsZWFmXG4gICAgY29uc3QgYWN0aXZlTGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5hY3RpdmVMZWFmO1xuICAgIGlmICghYWN0aXZlTGVhZikgcmV0dXJuO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICAgIC8vIEZpbmQgdGhlIGNvbnRlbnQgZWxlbWVudCBzYWZlbHlcbiAgICAgICAgbGV0IGNvbnRlbnRFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgICAgICAgXG4gICAgICAgIC8vIFVzZSB0eXBlIGFzc2VydGlvbnMgdG8gYXZvaWQgVHlwZVNjcmlwdCBlcnJvcnNcbiAgICAgICAgaWYgKGFjdGl2ZUxlYWYudmlldykge1xuICAgICAgICAgICAgLy8gVHJ5IHRvIGFjY2VzcyB0aGUgY29udGVudEVsIHByb3BlcnR5IHVzaW5nIHR5cGUgYXNzZXJ0aW9uXG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIC0gY29udGVudEVsIGV4aXN0cyBidXQgbWlnaHQgbm90IGJlIGluIHR5cGUgZGVmaW5pdGlvbnNcbiAgICAgICAgICAgIGNvbnRlbnRFbCA9IGFjdGl2ZUxlYWYudmlldy5jb250ZW50RWw7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIElmIHRoYXQgZGlkbid0IHdvcmssIHRyeSBhbm90aGVyIGFwcHJvYWNoXG4gICAgICAgIGlmICghY29udGVudEVsKSB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gZ2V0IHRoZSBLYW5iYW4gYm9hcmQgZGlyZWN0bHkgZnJvbSB0aGUgRE9NXG4gICAgICAgICAgICAvLyBMZWFmIGNvbnRhaW5lcnMgaGF2ZSAndmlldy1jb250ZW50JyBlbGVtZW50cyB0aGF0IGNvbnRhaW4gdGhlIGFjdHVhbCB2aWV3XG4gICAgICAgICAgICBjb25zdCB2aWV3Q29udGVudCA9IChhY3RpdmVMZWFmIGFzIGFueSkuY29udGFpbmVyRWw/LnF1ZXJ5U2VsZWN0b3IoJy52aWV3LWNvbnRlbnQnKTtcbiAgICAgICAgICAgIGlmICh2aWV3Q29udGVudCkge1xuICAgICAgICAgICAgICAgIGNvbnRlbnRFbCA9IHZpZXdDb250ZW50O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyBMYXN0IHJlc29ydCAtIGxvb2sgZm9yIEthbmJhbiBib2FyZHMgYW55d2hlcmUgaW4gdGhlIHdvcmtzcGFjZVxuICAgICAgICAgICAgICAgIGNvbnRlbnRFbCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJy53b3Jrc3BhY2UtbGVhZi5tb2QtYWN0aXZlIC52aWV3LWNvbnRlbnQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgaWYgKCFjb250ZW50RWwpIHtcbiAgICAgICAgICAgIHRoaXMubG9nKCdDb3VsZCBub3QgYWNjZXNzIGNvbnRlbnQgZWxlbWVudCBmb3IgYWN0aXZlIGxlYWYnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBpcyBhIEthbmJhbiBib2FyZFxuICAgICAgICBjb25zdCBrYW5iYW5Cb2FyZCA9IGNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yKCcua2FuYmFuLXBsdWdpbl9fYm9hcmQnKTtcbiAgICAgICAgaWYgKGthbmJhbkJvYXJkKSB7XG4gICAgICAgICAgICB0aGlzLmxvZygnRm91bmQgYWN0aXZlIEthbmJhbiBib2FyZCwgc2V0dGluZyB1cCBvYnNlcnZlcicpO1xuICAgICAgICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLnNldFRleHQoJ0tTVTogQWN0aXZlJyk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFN0b3JlIHJlZmVyZW5jZSB0byBhY3RpdmUgYm9hcmRcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlS2FuYmFuQm9hcmQgPSBrYW5iYW5Cb2FyZCBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU2V0IHVwIG9ic2VydmVyIG9ubHkgZm9yIHRoaXMgYm9hcmRcbiAgICAgICAgICAgIHRoaXMuc2V0dXBPYnNlcnZlckZvckJvYXJkKGthbmJhbkJvYXJkIGFzIEhUTUxFbGVtZW50KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMubG9nKCdBY3RpdmUgbGVhZiBpcyBub3QgYSBLYW5iYW4gYm9hcmQnKTtcbiAgICAgICAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5zZXRUZXh0KCdLU1U6IElkbGUnKTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nKGBFcnJvciBkZXRlY3RpbmcgS2FuYmFuIGJvYXJkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5zZXRUZXh0KCdLU1U6IEVycm9yJyk7XG4gICAgfVxuICB9XG4gIFxuICBzZXR1cE9ic2VydmVyRm9yQm9hcmQoYm9hcmRFbGVtZW50OiBIVE1MRWxlbWVudCkge1xuICAgICAgLy8gQ3JlYXRlIGEgbmV3IG9ic2VydmVyIGZvciB0aGlzIHNwZWNpZmljIGJvYXJkXG4gICAgICB0aGlzLmN1cnJlbnRPYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKChtdXRhdGlvbnMpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5pc1Byb2Nlc3NpbmcpIHJldHVybjtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBTaW1wbGUgZGVib3VuY2UgdG8gcHJldmVudCByYXBpZC1maXJlIHByb2Nlc3NpbmdcbiAgICAgICAgICB0aGlzLmlzUHJvY2Vzc2luZyA9IHRydWU7XG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuaGFuZGxlTXV0YXRpb25zKG11dGF0aW9ucyk7XG4gICAgICAgICAgICAgIHRoaXMuaXNQcm9jZXNzaW5nID0gZmFsc2U7XG4gICAgICAgICAgfSwgMzAwKTtcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICAvLyBPYnNlcnZlIG9ubHkgdGhpcyBib2FyZCB3aXRoIG1pbmltYWwgb3B0aW9ucyBuZWVkZWRcbiAgICAgIHRoaXMuY3VycmVudE9ic2VydmVyLm9ic2VydmUoYm9hcmRFbGVtZW50LCB7XG4gICAgICAgICAgY2hpbGRMaXN0OiB0cnVlLFxuICAgICAgICAgIHN1YnRyZWU6IHRydWUsXG4gICAgICAgICAgYXR0cmlidXRlczogZmFsc2UgLy8gRG9uJ3QgbmVlZCBhdHRyaWJ1dGUgY2hhbmdlcyBmb3IgcGVyZm9ybWFuY2VcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICB0aGlzLmxvZygnT2JzZXJ2ZXIgc2V0IHVwIGZvciBhY3RpdmUgS2FuYmFuIGJvYXJkJyk7XG4gIH1cbiAgXG4gIGhhbmRsZU11dGF0aW9ucyhtdXRhdGlvbnM6IE11dGF0aW9uUmVjb3JkW10pIHtcbiAgICBpZiAoIXRoaXMuYWN0aXZlS2FuYmFuQm9hcmQpIHJldHVybjtcbiAgICBcbiAgICB0cnkge1xuICAgICAgICBjb25zdCBtYXhfbXV0YXRpb25zID0gMTA7XG4gICAgICAgIC8vIE9ubHkgcHJvY2VzcyBhIHNhbXBsZSBvZiBtdXRhdGlvbnMgZm9yIHBlcmZvcm1hbmNlXG4gICAgICAgIGNvbnN0IG11dGF0aW9uc1RvUHJvY2VzcyA9IG11dGF0aW9ucy5sZW5ndGggPiBtYXhfbXV0YXRpb25zID8gXG4gICAgICAgICAgICBtdXRhdGlvbnMuc2xpY2UoMCwgbWF4X211dGF0aW9ucykgOiBtdXRhdGlvbnM7XG4gICAgICAgICAgICBcbiAgICAgICAgdGhpcy5sb2coYEdvdCAke211dGF0aW9uc1RvUHJvY2Vzcy5sZW5ndGh9IG11dGF0aW9ucyBvZiAke211dGF0aW9ucy5sZW5ndGh9YCk7XG4gICAgICAgIFxuICAgICAgICAvLyBMb29rIGZvciBLYW5iYW4gaXRlbXMgaW4gbXV0YXRpb25cbiAgICAgICAgbGV0IGkgPSAwO1xuICAgICAgICBmb3IgKGNvbnN0IG11dGF0aW9uIG9mIG11dGF0aW9uc1RvUHJvY2Vzcykge1xuICAgICAgICAgICAgdGhpcy5sb2coYE11dGF0aW9uICMkeysraX0gLSBUeXBlOiAke211dGF0aW9uLnR5cGV9YCk7XG4gICAgICAgICAgICBpZiAobXV0YXRpb24udHlwZSA9PT0gJ2NoaWxkTGlzdCcpIHtcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBhZGRlZCBub2RlcyBmb3IgS2FuYmFuIGl0ZW1zXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBub2RlIG9mIEFycmF5LmZyb20obXV0YXRpb24uYWRkZWROb2RlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIG5vZGUgaXMgYW55IGtpbmQgb2YgRWxlbWVudCAoSFRNTCBvciBTVkcpXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIEVsZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZyhgUHJvY2Vzc2luZyBFbGVtZW50IG9mIHR5cGU6ICR7bm9kZS50YWdOYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEhhbmRsZSB0aGUgbm9kZSBhY2NvcmRpbmcgdG8gaXRzIHR5cGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIEhUTUxFbGVtZW50IHx8IG5vZGUgaW5zdGFuY2VvZiBIVE1MRGl2RWxlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBEaXJlY3QgcHJvY2Vzc2luZyBmb3IgSFRNTCBlbGVtZW50c1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZyhgRm91bmQgSFRNTCBlbGVtZW50IG9mIHR5cGUgJHtub2RlLmNsYXNzTmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzRWxlbWVudChub2RlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG5vZGUgaW5zdGFuY2VvZiBTVkdFbGVtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvciBTVkcgZWxlbWVudHMsIGxvb2sgZm9yIHBhcmVudCBIVE1MIGVsZW1lbnRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyZW50RWxlbWVudCA9IG5vZGUuY2xvc2VzdCgnLmthbmJhbi1wbHVnaW5fX2l0ZW0nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBhcmVudEVsZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nKCdGb3VuZCBLYW5iYW4gaXRlbSBwYXJlbnQgb2YgU1ZHIGVsZW1lbnQnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc0VsZW1lbnQocGFyZW50RWxlbWVudCBhcyBIVE1MRWxlbWVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBMb29rIGZvciBhbnkga2FuYmFuIGl0ZW1zIGluIHRoZSBkb2N1bWVudCB0aGF0IG1pZ2h0IGhhdmUgY2hhbmdlZFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVGhpcyBpcyBmb3IgY2FzZXMgd2hlcmUgdGhlIFNWRyB1cGRhdGUgaXMgcmVsYXRlZCB0byBhIGNhcmQgbW92ZW1lbnRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZC5xdWVyeVNlbGVjdG9yQWxsKCcua2FuYmFuLXBsdWdpbl9faXRlbScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGl0ZW1zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIG9ubHkgdGhlIG1vc3QgcmVjZW50bHkgbW9kaWZpZWQgaXRlbVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlY2VudEl0ZW1zID0gQXJyYXkuZnJvbShpdGVtcykuc2xpY2UoLTEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiByZWNlbnRJdGVtcykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZygnUHJvY2Vzc2luZyByZWNlbnQgaXRlbSBhZnRlciBTVkcgY2hhbmdlJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc0VsZW1lbnQoaXRlbSBhcyBIVE1MRWxlbWVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChub2RlLm5vZGVUeXBlID09PSBOb2RlLlRFWFRfTk9ERSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIEZvciB0ZXh0IG5vZGVzLCBjaGVjayB0aGUgcGFyZW50IGVsZW1lbnRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJlbnRFbGVtZW50ID0gbm9kZS5wYXJlbnRFbGVtZW50O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwYXJlbnRFbGVtZW50ICYmIChcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50RWxlbWVudC5jbGFzc0xpc3QuY29udGFpbnMoJ2thbmJhbi1wbHVnaW5fX2l0ZW0tdGl0bGUnKSB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRFbGVtZW50LmNsb3Nlc3QoJy5rYW5iYW4tcGx1Z2luX19pdGVtJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICApKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nKCdGb3VuZCB0ZXh0IGNoYW5nZSBpbiBLYW5iYW4gaXRlbScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBpdGVtRWxlbWVudCA9IHBhcmVudEVsZW1lbnQuY2xvc2VzdCgnLmthbmJhbi1wbHVnaW5fX2l0ZW0nKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGl0ZW1FbGVtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NFbGVtZW50KGl0ZW1FbGVtZW50IGFzIEhUTUxFbGVtZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2coYFNraXBwaW5nIG5vZGUgdHlwZTogJHtub2RlLm5vZGVUeXBlfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChub2RlRXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nKGBFcnJvciBwcm9jZXNzaW5nIG5vZGU6ICR7bm9kZUVycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIG5leHQgbm9kZSBldmVuIGlmIHRoaXMgb25lIGZhaWxzXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMubG9nKCdJZ25vcmluZyBtdXRhdGlvbiB0eXBlOiAnICsgbXV0YXRpb24udHlwZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZyhgRXJyb3IgaW4gaGFuZGxlTXV0YXRpb25zOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9XG4gIFxuICBvbkRyYWdFbmQoZXZlbnQ6IERyYWdFdmVudCkge1xuICAgICAgLy8gT25seSBwcm9jZXNzIGlmIHdlIGhhdmUgYW4gYWN0aXZlIEthbmJhbiBib2FyZFxuICAgICAgaWYgKCF0aGlzLmFjdGl2ZUthbmJhbkJvYXJkIHx8IHRoaXMuaXNQcm9jZXNzaW5nKSB7XG4gICAgICAgIHRoaXMubG9nKCdEcmFnIGVuZCBkZXRlY3RlZCBidXQgbm8gYWN0aXZlIEthbmJhbiBib2FyZCBvciBhbHJlYWR5IHByb2Nlc3NpbmcnKTtcbiAgICAgICAgdGhpcy5sb2coJ2FjdGl2ZUthbmJhbkJvYXJkOiAnICsgKHRoaXMuYWN0aXZlS2FuYmFuQm9hcmQgPyAnWWVzJyA6ICdObycpKTtcbiAgICAgICAgdGhpcy5sb2coJ2lzUHJvY2Vzc2luZzogJyArICh0aGlzLmlzUHJvY2Vzc2luZyA/ICdZZXMnIDogJ05vJykpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIHRyeSB7XG4gICAgICAgICAgdGhpcy5sb2coJ0RyYWcgZW5kIGRldGVjdGVkJyk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2V0IHByb2Nlc3NpbmcgZmxhZyB0byBwcmV2ZW50IG11bHRpcGxlIHByb2Nlc3NpbmdcbiAgICAgICAgICB0aGlzLmlzUHJvY2Vzc2luZyA9IHRydWU7XG4gICAgICAgICAgXG4gICAgICAgICAgY29uc3QgdGFyZ2V0ID0gZXZlbnQudGFyZ2V0IGFzIEhUTUxFbGVtZW50O1xuICAgICAgICAgIGlmICghdGFyZ2V0KSByZXR1cm47XG4gICAgICAgICAgXG4gICAgICAgICAgdGhpcy5wcm9jZXNzRWxlbWVudCh0YXJnZXQpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZyhgRXJyb3IgaW4gb25EcmFnRW5kOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIC8vIFJlc2V0IHByb2Nlc3NpbmcgZmxhZyBhZnRlciBhIGRlbGF5IHRvIGRlYm91bmNlXG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuaXNQcm9jZXNzaW5nID0gZmFsc2U7XG4gICAgICAgICAgfSwgMzAwKTtcbiAgICAgIH1cbiAgfVxuICBcbiAgcHJvY2Vzc0VsZW1lbnQoZWxlbWVudDogSFRNTEVsZW1lbnQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gT25seSBwcm9jZXNzIGlmIGluc2lkZSBvdXIgYWN0aXZlIEthbmJhbiBib2FyZFxuICAgICAgICAgIGlmICghdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCB8fCAhZWxlbWVudC5jbG9zZXN0KCcua2FuYmFuLXBsdWdpbl9fYm9hcmQnKSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZygnRWxlbWVudCBOT1QgaW4gYWN0aXZlIEthbmJhbiBib2FyZC4gU2tpcHBpbmcuJyk7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVXNlIGRpZmZlcmVudCBzdHJhdGVnaWVzIHRvIGZpbmQgdGhlIEthbmJhbiBpdGVtXG4gICAgICAgICAgdGhpcy5sb2coXCLwn5GAIExvb2tpbmcgZm9yIEthbmJhbiBpdGVtIGVsZW1lbnRcIik7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gQ2hlY2sgaWYgZWxlbWVudCBpcyBhIEthbmJhbiBpdGVtIG9yIGNvbnRhaW5zIG9uZVxuICAgICAgICAgIGNvbnN0IGthbmJhbkl0ZW0gPSBlbGVtZW50LmNsYXNzTGlzdC5jb250YWlucygna2FuYmFuLXBsdWdpbl9faXRlbScpIFxuICAgICAgICAgICAgICA/IGVsZW1lbnRcbiAgICAgICAgICAgICAgOiBlbGVtZW50LnF1ZXJ5U2VsZWN0b3IoJy5rYW5iYW4tcGx1Z2luX19pdGVtJyk7XG4gICAgICAgICAgICAgIFxuICAgICAgICAgIGlmIChrYW5iYW5JdGVtKSB7XG4gICAgICAgICAgICAgIHRoaXMubG9nKGDinIUgRm91bmQgS2FuYmFuIGl0ZW06ICR7a2FuYmFuSXRlbX1gKTtcbiAgICAgICAgICAgICAgdGhpcy5sb2coJ2NsYXNzTGlzdCBvZiBrYW5iYW5JdGVtOiAnICsga2FuYmFuSXRlbS5jbGFzc0xpc3QpO1xuICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NLYW5iYW5JdGVtKGthbmJhbkl0ZW0gYXMgSFRNTEVsZW1lbnQpO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMubG9nKCdOb3QgYSBLYW5iYW4gaXRlbSwgY2hlY2tpbmcgZm9yIHBhcmVudCcpO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIElmIGVsZW1lbnQgaXMgaW5zaWRlIGEgS2FuYmFuIGl0ZW0sIGZpbmQgdGhlIHBhcmVudFxuICAgICAgICAgIGNvbnN0IHBhcmVudEl0ZW0gPSBlbGVtZW50LmNsb3Nlc3QoJy5rYW5iYW4tcGx1Z2luX19pdGVtJykgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgdGhpcy5sb2coYFBhcmVudCBpdGVtOiAke3BhcmVudEl0ZW0gPyBwYXJlbnRJdGVtIDogJ05vdCBmb3VuZCd9YCk7XG4gICAgICAgICAgaWYgKHBhcmVudEl0ZW0pIHtcbiAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzS2FuYmFuSXRlbShwYXJlbnRJdGVtKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2coYEVycm9yIGluIHByb2Nlc3NFbGVtZW50OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gIH1cbiAgXG4gIHByb2Nlc3NLYW5iYW5JdGVtKGl0ZW1FbGVtZW50OiBIVE1MRWxlbWVudCkgeyAvLyBpdGVtRWxlbWVudCB3aWxsIGJlIG9mIGNsYXNzIGBrYW5iYW4tcGx1Z2luX19pdGVtYFxuICAgICAgdHJ5IHtcblxuICAgICAgICAgIC8vIFRPRE86IFNlbGVjdCB0aGUgdGl0bGVcbiAgICAgICAgICBjb25zdCBpbnRlcm5hbExpbmsgPSBpdGVtRWxlbWVudC5xdWVyeVNlbGVjdG9yKCcua2FuYmFuLXBsdWdpbl9faXRlbS10aXRsZSAua2FuYmFuLXBsdWdpbl9faXRlbS1tYXJrZG93biBhLmludGVybmFsLWxpbmsnKTtcbiAgICAgICAgICBcbiAgICAgICAgICBpZiAoIWludGVybmFsTGluaykge1xuICAgICAgICAgICAgdGhpcy5sb2coJ/CfmqsgTm8gaW50ZXJuYWwgbGluayBmb3VuZCBpbiBpdGVtJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMubG9nKGBGb3VuZCBpbnRlcm5hbCBsaW5rOiAke2ludGVybmFsTGluay50ZXh0Q29udGVudH1gKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBHZXQgdGhlIGxpbmsgcGF0aCBmcm9tIGRhdGEtaHJlZiBvciBocmVmIGF0dHJpYnV0ZVxuICAgICAgICAgIGNvbnN0IGxpbmtQYXRoID0gaW50ZXJuYWxMaW5rLmdldEF0dHJpYnV0ZSgnZGF0YS1ocmVmJykgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGludGVybmFsTGluay5nZXRBdHRyaWJ1dGUoJ2hyZWYnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgaWYgKCFsaW5rUGF0aCkgcmV0dXJuO1xuICAgICAgICAgIHRoaXMubG9nKGDwn5SXIExpbmsgcGF0aDogJHtsaW5rUGF0aH1gKTtcblxuICAgICAgICAgIC8vIEZpbmQgdGhlIGxhbmUgKGNvbHVtbikgdGhpcyBpdGVtIGlzIGluXG4gICAgICAgICAgY29uc3QgbGFuZSA9IGl0ZW1FbGVtZW50LmNsb3Nlc3QoJy5rYW5iYW4tcGx1Z2luX19sYW5lJyk7XG4gICAgICAgICAgaWYgKCFsYW5lKSB7IFxuICAgICAgICAgICAgdGhpcy5sb2coJ/CfmqsgTm8gbGFuZSBmb3VuZCBmb3IgaXRlbScpO1xuICAgICAgICAgICAgcmV0dXJuOyBcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gR2V0IGNvbHVtbiBuYW1lIGZyb20gdGhlIGxhbmUgaGVhZGVyXG4gICAgICAgICAgY29uc3QgbGFuZUhlYWRlciA9IGxhbmUucXVlcnlTZWxlY3RvcignLmthbmJhbi1wbHVnaW5fX2xhbmUtaGVhZGVyLXdyYXBwZXIgLmthbmJhbi1wbHVnaW5fX2xhbmUtdGl0bGUnKTtcbiAgICAgICAgICBpZiAoIWxhbmVIZWFkZXIpIHsgXG4gICAgICAgICAgICB0aGlzLmxvZygn8J+aqyBObyBsYW5lSGVhZGVyIGZvdW5kIGZvciBpdGVtJyk7XG4gICAgICAgICAgICByZXR1cm47IFxuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICBjb25zdCBjb2x1bW5OYW1lID0gbGFuZUhlYWRlci50ZXh0Q29udGVudC50cmltKCk7XG4gICAgICAgICAgdGhpcy5sb2coYOKchSBHb3QgbGFuZSBuYW1lOiAke2NvbHVtbk5hbWV9YCk7XG4gICAgICAgICAgXG4gICAgICAgICAgdGhpcy5sb2coYFByb2Nlc3NpbmcgY2FyZCB3aXRoIGxpbmsgdG8gXCIke2xpbmtQYXRofVwiIGluIGNvbHVtbiBcIiR7Y29sdW1uTmFtZX1cImApO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgbGlua2VkIG5vdGUncyBzdGF0dXNcbiAgICAgICAgICB0aGlzLnVwZGF0ZU5vdGVTdGF0dXMobGlua1BhdGgsIGNvbHVtbk5hbWUpO1xuICAgICAgICAgIFxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZyhgRXJyb3IgaW4gcHJvY2Vzc0thbmJhbkl0ZW06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgfVxuICBcbiAgYXN5bmMgdXBkYXRlTm90ZVN0YXR1cyhub3RlUGF0aDogc3RyaW5nLCBzdGF0dXM6IHN0cmluZykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBGaW5kIHRoZSBsaW5rZWQgZmlsZVxuICAgICAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KG5vdGVQYXRoLCAnJyk7XG4gICAgICAgICAgXG4gICAgICAgICAgaWYgKCFmaWxlKSB7XG4gICAgICAgICAgICAgIGlmICh0aGlzLnNldHRpbmdzLnNob3dOb3RpZmljYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKGDimqDvuI8gTm90ZSBcIiR7bm90ZVBhdGh9XCIgbm90IGZvdW5kYCwgMzAwMCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICAvLyBSZWFkIHRoZSBmaWxlIGNvbnRlbnRcbiAgICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBDaGVjayBmb3IgZXhpc3RpbmcgZnJvbnRtYXR0ZXJcbiAgICAgICAgICBjb25zdCBmcm9udG1hdHRlclJlZ2V4ID0gL14tLS1cXG4oW1xcc1xcU10qPylcXG4tLS0vO1xuICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyTWF0Y2ggPSBjb250ZW50Lm1hdGNoKGZyb250bWF0dGVyUmVnZXgpO1xuICAgICAgICAgIFxuICAgICAgICAgIGxldCBuZXdDb250ZW50O1xuICAgICAgICAgIGxldCBvbGRTdGF0dXMgPSBudWxsO1xuICAgICAgICAgIFxuICAgICAgICAgIGlmIChmcm9udG1hdHRlck1hdGNoKSB7XG4gICAgICAgICAgICAgIC8vIEZpbGUgaGFzIGZyb250bWF0dGVyXG4gICAgICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyVGV4dCA9IGZyb250bWF0dGVyTWF0Y2hbMV07XG4gICAgICAgICAgICAgIGxldCBmcm9udG1hdHRlck9iajtcbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICAvLyBUcnkgdG8gcGFyc2UgdGhlIGZyb250bWF0dGVyXG4gICAgICAgICAgICAgICAgICBmcm9udG1hdHRlck9iaiA9IHBhcnNlWWFtbChmcm9udG1hdHRlclRleHQpO1xuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBzdGF0dXMgcHJvcGVydHkgYWxyZWFkeSBleGlzdHNcbiAgICAgICAgICAgICAgICAgIGlmIChmcm9udG1hdHRlck9ialt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZV0pIHtcbiAgICAgICAgICAgICAgICAgICAgICBvbGRTdGF0dXMgPSBmcm9udG1hdHRlck9ialt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZV07XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgdGhpcy5sb2coYEVycm9yIHBhcnNpbmcgZnJvbnRtYXR0ZXI6ICR7ZS5tZXNzYWdlfWApO1xuICAgICAgICAgICAgICAgICAgZnJvbnRtYXR0ZXJPYmogPSB7fTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgLy8gT25seSB1cGRhdGUgaWYgc3RhdHVzIGhhcyBjaGFuZ2VkXG4gICAgICAgICAgICAgIGlmIChmcm9udG1hdHRlck9ialt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZV0gIT09IHN0YXR1cykge1xuICAgICAgICAgICAgICAgICAgLy8gVXBkYXRlIHRoZSBzdGF0dXMgcHJvcGVydHlcbiAgICAgICAgICAgICAgICAgIGZyb250bWF0dGVyT2JqW3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lXSA9IHN0YXR1cztcbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgbmV3IGZyb250bWF0dGVyIHRleHRcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG5ld0Zyb250bWF0dGVyVGV4dCA9IHN0cmluZ2lmeVlhbWwoZnJvbnRtYXR0ZXJPYmopO1xuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAvLyBSZXBsYWNlIHRoZSBmcm9udG1hdHRlciBpbiB0aGUgY29udGVudFxuICAgICAgICAgICAgICAgICAgbmV3Q29udGVudCA9IGNvbnRlbnQucmVwbGFjZShmcm9udG1hdHRlclJlZ2V4LCBgLS0tXFxuJHtuZXdGcm9udG1hdHRlclRleHR9LS0tYCk7XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgIC8vIFNhdmUgdGhlIG1vZGlmaWVkIGNvbnRlbnRcbiAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBuZXdDb250ZW50KTtcbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgLy8gU2hvdyBub3RpZmljYXRpb24gaWYgZW5hYmxlZFxuICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd05vdGlmaWNhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAob2xkU3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoYFVwZGF0ZWQgJHt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZX06IFwiJHtvbGRTdGF0dXN9XCIg4oaSIFwiJHtzdGF0dXN9XCIgZm9yICR7ZmlsZS5iYXNlbmFtZX1gLCAzMDAwKTtcbiAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKGBTZXQgJHt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZX06IFwiJHtzdGF0dXN9XCIgZm9yICR7ZmlsZS5iYXNlbmFtZX1gLCAzMDAwKTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgIHRoaXMubG9nKGBVcGRhdGVkIHN0YXR1cyBmb3IgJHtmaWxlLmJhc2VuYW1lfSB0byBcIiR7c3RhdHVzfVwiYCk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICB0aGlzLmxvZyhgU3RhdHVzIGFscmVhZHkgc2V0IHRvIFwiJHtzdGF0dXN9XCIgZm9yICR7ZmlsZS5iYXNlbmFtZX0sIHNraXBwaW5nIHVwZGF0ZWApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgLy8gRmlsZSBoYXMgbm8gZnJvbnRtYXR0ZXIsIGNyZWF0ZSBpdFxuICAgICAgICAgICAgICBjb25zdCBmcm9udG1hdHRlck9iaiA9IHtcbiAgICAgICAgICAgICAgICAgIFt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZV06IHN0YXR1c1xuICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJUZXh0ID0gc3RyaW5naWZ5WWFtbChmcm9udG1hdHRlck9iaik7XG4gICAgICAgICAgICAgIG5ld0NvbnRlbnQgPSBgLS0tXFxuJHtmcm9udG1hdHRlclRleHR9LS0tXFxuXFxuJHtjb250ZW50fWA7XG4gICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAvLyBTYXZlIHRoZSBtb2RpZmllZCBjb250ZW50XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBuZXdDb250ZW50KTtcbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIC8vIFNob3cgbm90aWZpY2F0aW9uIGlmIGVuYWJsZWRcbiAgICAgICAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd05vdGlmaWNhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoYEFkZGVkICR7dGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWV9OiBcIiR7c3RhdHVzfVwiIHRvICR7ZmlsZS5iYXNlbmFtZX1gLCAzMDAwKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgdGhpcy5sb2coYEFkZGVkIGZyb250bWF0dGVyIHdpdGggc3RhdHVzIHRvICR7ZmlsZS5iYXNlbmFtZX1gKTtcbiAgICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nKGBFcnJvciB1cGRhdGluZyBub3RlIHN0YXR1czogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICAgIGlmICh0aGlzLnNldHRpbmdzLnNob3dOb3RpZmljYXRpb25zKSB7XG4gICAgICAgICAgICAgIG5ldyBOb3RpY2UoYOKaoO+4jyBFcnJvciB1cGRhdGluZyBzdGF0dXM6ICR7ZXJyb3IubWVzc2FnZX1gLCAzMDAwKTtcbiAgICAgICAgICB9XG4gICAgICB9XG4gIH1cbiAgXG4gIC8vIE1ldGhvZCBmb3IgdGhlIHRlc3QgYnV0dG9uIHRvIHVzZVxuICBydW5UZXN0KCkge1xuICAgICAgdGhpcy5sb2coJ1J1bm5pbmcgdGVzdC4uLicpO1xuICAgICAgXG4gICAgICAvLyBNYWtlIHN1cmUgd2UncmUgdXNpbmcgdGhlIGN1cnJlbnQgYWN0aXZlIGJvYXJkXG4gICAgICB0aGlzLmNoZWNrRm9yQWN0aXZlS2FuYmFuQm9hcmQoKTtcbiAgICAgIFxuICAgICAgaWYgKCF0aGlzLmFjdGl2ZUthbmJhbkJvYXJkKSB7XG4gICAgICAgICAgbmV3IE5vdGljZSgn4pqg77iPIE5vIGFjdGl2ZSBLYW5iYW4gYm9hcmQgZm91bmQgLSBvcGVuIGEgS2FuYmFuIGJvYXJkIGZpcnN0JywgNTAwMCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBGaW5kIGl0ZW1zIGluIHRoZSBhY3RpdmUgYm9hcmRcbiAgICAgIGNvbnN0IGl0ZW1zID0gdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZC5xdWVyeVNlbGVjdG9yQWxsKCcua2FuYmFuLXBsdWdpbl9faXRlbScpO1xuICAgICAgY29uc3QgY291bnQgPSBpdGVtcy5sZW5ndGg7XG4gICAgICBcbiAgICAgIG5ldyBOb3RpY2UoYEZvdW5kICR7Y291bnR9IGNhcmRzIGluIGFjdGl2ZSBLYW5iYW4gYm9hcmRgLCAzMDAwKTtcbiAgICAgIFxuICAgICAgaWYgKGNvdW50ID4gMCkge1xuICAgICAgICAgIC8vIFByb2Nlc3MgdGhlIGZpcnN0IGl0ZW0gd2l0aCBhIGxpbmtcbiAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNvdW50OyBpKyspIHtcbiAgICAgICAgICAgICAgY29uc3QgaXRlbSA9IGl0ZW1zW2ldIGFzIEhUTUxFbGVtZW50O1xuICAgICAgICAgICAgICBpZiAoaXRlbS5xdWVyeVNlbGVjdG9yKCdhLmludGVybmFsLWxpbmsnKSkge1xuICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZShgVGVzdGluZyB3aXRoIGNhcmQ6IFwiJHtpdGVtLnRleHRDb250ZW50LnN1YnN0cmluZygwLCAyMCl9Li4uXCJgLCAzMDAwKTtcbiAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc0thbmJhbkl0ZW0oaXRlbSk7XG4gICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgIH1cbiAgfVxufVxuXG5jbGFzcyBLYW5iYW5TdGF0dXNVcGRhdGVyU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwbHVnaW46IEthbmJhblN0YXR1c1VwZGF0ZXJQbHVnaW47XG4gIFxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBLYW5iYW5TdGF0dXNVcGRhdGVyUGx1Z2luKSB7XG4gICAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuICBcbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICAgIGNvbnN0IHtjb250YWluZXJFbH0gPSB0aGlzO1xuICAgICAgXG4gICAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ2gyJywge3RleHQ6ICdLYW5iYW4gU3RhdHVzIFVwZGF0ZXIgU2V0dGluZ3MnfSk7XG4gICAgICBcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAgIC5zZXROYW1lKCdTdGF0dXMgUHJvcGVydHkgTmFtZScpXG4gICAgICAgICAgLnNldERlc2MoJ1RoZSBuYW1lIG9mIHRoZSBwcm9wZXJ0eSB0byB1cGRhdGUgd2hlbiBhIGNhcmQgaXMgbW92ZWQnKVxuICAgICAgICAgIC5hZGRUZXh0KHRleHQgPT4gdGV4dFxuICAgICAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ3N0YXR1cycpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWUpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIH0pKTtcbiAgICAgIFxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgICAgLnNldE5hbWUoJ1Nob3cgTm90aWZpY2F0aW9ucycpXG4gICAgICAgICAgLnNldERlc2MoJ1Nob3cgYSBub3RpZmljYXRpb24gd2hlbiBhIHN0YXR1cyBpcyB1cGRhdGVkJylcbiAgICAgICAgICAuYWRkVG9nZ2xlKHRvZ2dsZSA9PiB0b2dnbGVcbiAgICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dOb3RpZmljYXRpb25zKVxuICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93Tm90aWZpY2F0aW9ucyA9IHZhbHVlO1xuICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIH0pKTtcbiAgICAgIFxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgICAgLnNldE5hbWUoJ0RlYnVnIE1vZGUnKVxuICAgICAgICAgIC5zZXREZXNjKCdFbmFibGUgZGV0YWlsZWQgbG9nZ2luZyAocmVkdWNlcyBwZXJmb3JtYW5jZSknKVxuICAgICAgICAgIC5hZGRUb2dnbGUodG9nZ2xlID0+IHRvZ2dsZVxuICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVidWdNb2RlKVxuICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWJ1Z01vZGUgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKCdEZWJ1ZyBtb2RlIGVuYWJsZWQgLSBjaGVjayBjb25zb2xlIGZvciBsb2dzJywgMzAwMCk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoJ0RlYnVnIG1vZGUgZGlzYWJsZWQnLCAzMDAwKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSkpO1xuICAgICAgXG4gICAgICAvLyBBZGQgYSB0ZXN0IGJ1dHRvblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgICAgLnNldE5hbWUoJ1Rlc3QgUGx1Z2luJylcbiAgICAgICAgICAuc2V0RGVzYygnVGVzdCB3aXRoIGN1cnJlbnQgS2FuYmFuIGJvYXJkJylcbiAgICAgICAgICAuYWRkQnV0dG9uKGJ1dHRvbiA9PiBidXR0b25cbiAgICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoJ1J1biBUZXN0JylcbiAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucnVuVGVzdCgpO1xuICAgICAgICAgICAgICB9KSk7XG4gICAgICBcbiAgICAgIC8vIFBlcmZvcm1hbmNlIGluZm9cbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKCdoMycsIHt0ZXh0OiAnUGVyZm9ybWFuY2UgT3B0aW1pemF0aW9uJ30pO1xuICAgICAgXG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbCgncCcsIHtcbiAgICAgICAgICB0ZXh0OiAnVGhpcyBwbHVnaW4gb25seSBtb25pdG9ycyB0aGUgY3VycmVudGx5IGFjdGl2ZSBLYW5iYW4gYm9hcmQgdG8gbWluaW1pemUgcGVyZm9ybWFuY2UgaW1wYWN0LidcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICAvLyBUcm91Ymxlc2hvb3Rpbmcgc2VjdGlvblxuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ2gzJywge3RleHQ6ICdUcm91Ymxlc2hvb3RpbmcnfSk7XG4gICAgICBcbiAgICAgIGNvbnN0IGxpc3QgPSBjb250YWluZXJFbC5jcmVhdGVFbCgndWwnKTtcbiAgICAgIFxuICAgICAgbGlzdC5jcmVhdGVFbCgnbGknLCB7XG4gICAgICAgICAgdGV4dDogJ1RoZSBwbHVnaW4gb25seSB3b3JrcyB3aXRoIHRoZSBjdXJyZW50bHkgb3BlbiBLYW5iYW4gYm9hcmQnXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgbGlzdC5jcmVhdGVFbCgnbGknLCB7XG4gICAgICAgICAgdGV4dDogJ0NhcmRzIG11c3QgY29udGFpbiBpbnRlcm5hbCBsaW5rcyB0byBub3RlcydcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBsaXN0LmNyZWF0ZUVsKCdsaScsIHtcbiAgICAgICAgICB0ZXh0OiAnS2VlcCBEZWJ1ZyBNb2RlIGRpc2FibGVkIGZvciBiZXN0IHBlcmZvcm1hbmNlJ1xuICAgICAgfSk7XG4gIH1cbn0iXSwibmFtZXMiOlsiUGx1Z2luIiwiTm90aWNlIiwicGFyc2VZYW1sIiwic3RyaW5naWZ5WWFtbCIsIlBsdWdpblNldHRpbmdUYWIiLCJTZXR0aW5nIl0sIm1hcHBpbmdzIjoiOzs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQW9HQTtBQUNPLFNBQVMsU0FBUyxDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRTtBQUM3RCxJQUFJLFNBQVMsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLE9BQU8sS0FBSyxZQUFZLENBQUMsR0FBRyxLQUFLLEdBQUcsSUFBSSxDQUFDLENBQUMsVUFBVSxPQUFPLEVBQUUsRUFBRSxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRTtBQUNoSCxJQUFJLE9BQU8sS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLE9BQU8sQ0FBQyxFQUFFLFVBQVUsT0FBTyxFQUFFLE1BQU0sRUFBRTtBQUMvRCxRQUFRLFNBQVMsU0FBUyxDQUFDLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7QUFDbkcsUUFBUSxTQUFTLFFBQVEsQ0FBQyxLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUU7QUFDdEcsUUFBUSxTQUFTLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxNQUFNLENBQUMsSUFBSSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDLEVBQUU7QUFDdEgsUUFBUSxJQUFJLENBQUMsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsVUFBVSxJQUFJLEVBQUUsQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7QUFDOUUsS0FBSyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBNk1EO0FBQ3VCLE9BQU8sZUFBZSxLQUFLLFVBQVUsR0FBRyxlQUFlLEdBQUcsVUFBVSxLQUFLLEVBQUUsVUFBVSxFQUFFLE9BQU8sRUFBRTtBQUN2SCxJQUFJLElBQUksQ0FBQyxHQUFHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQy9CLElBQUksT0FBTyxDQUFDLENBQUMsSUFBSSxHQUFHLGlCQUFpQixFQUFFLENBQUMsQ0FBQyxLQUFLLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxVQUFVLEdBQUcsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUNyRjs7QUMxVEEsTUFBTSxnQkFBZ0IsR0FBZ0M7QUFDcEQsSUFBQSxrQkFBa0IsRUFBRSxRQUFRO0FBQzVCLElBQUEsaUJBQWlCLEVBQUUsS0FBSztJQUN4QixTQUFTLEVBQUUsS0FBSztDQUNqQixDQUFBO0FBRW9CLE1BQUEseUJBQTBCLFNBQVFBLGVBQU0sQ0FBQTtBQUE3RCxJQUFBLFdBQUEsR0FBQTs7O1FBS1UsSUFBZSxDQUFBLGVBQUEsR0FBNEIsSUFBSSxDQUFDO1FBQ2hELElBQVksQ0FBQSxZQUFBLEdBQUcsS0FBSyxDQUFDO1FBQ3JCLElBQWlCLENBQUEsaUJBQUEsR0FBdUIsSUFBSSxDQUFDO0tBZ2V0RDtJQTlkTyxNQUFNLEdBQUE7O0FBQ1IsWUFBQSxPQUFPLENBQUMsR0FBRyxDQUFDLHNDQUFzQyxDQUFDLENBQUM7O0FBR3BELFlBQUEsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7O0FBRzFCLFlBQUEsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztBQUM3QyxZQUFBLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQ3hDLFlBQUEsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsaUNBQWlDLENBQUMsQ0FBQzs7QUFHL0QsWUFBQSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCLEVBQUU7QUFDakMsZ0JBQUEsSUFBSUMsZUFBTSxDQUFDLGlDQUFpQyxDQUFDLENBQUM7QUFDakQsYUFBQTtBQUNELFlBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQzs7QUFHMUIsWUFBQSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQ3RFLFlBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDOztZQUczQyxJQUFJLENBQUMsYUFBYSxDQUNkLElBQUksQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxvQkFBb0IsRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQ2xGLENBQUM7O1lBR0YsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsYUFBYSxDQUFDLE1BQUs7Z0JBQ2xDLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFDO0FBQ3JDLGFBQUMsQ0FBQyxDQUFDOztBQUdILFlBQUEsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLDZCQUE2QixDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQztTQUN6RSxDQUFBLENBQUE7QUFBQSxLQUFBO0lBRUQsUUFBUSxHQUFBOztRQUVKLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO0FBQzNCLFFBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0tBQy9CO0lBRUssWUFBWSxHQUFBOztBQUNkLFlBQUEsSUFBSSxDQUFDLFFBQVEsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1NBQzlFLENBQUEsQ0FBQTtBQUFBLEtBQUE7SUFFSyxZQUFZLEdBQUE7O1lBQ2QsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztTQUN0QyxDQUFBLENBQUE7QUFBQSxLQUFBOztBQUdELElBQUEsR0FBRyxDQUFDLE9BQWUsRUFBQTtBQUNmLFFBQUEsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFNBQVMsRUFBRTtBQUN6QixZQUFBLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxPQUFPLENBQUEsQ0FBRSxDQUFDLENBQUM7O0FBR2hDLFlBQUEsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsQ0FBQSxLQUFBLEVBQVEsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUEsRUFBRyxPQUFPLENBQUMsTUFBTSxHQUFHLEVBQUUsR0FBRyxLQUFLLEdBQUcsRUFBRSxDQUFBLENBQUUsQ0FBQyxDQUFDOztZQUdsRyxVQUFVLENBQUMsTUFBSztnQkFDWixJQUFJLElBQUksQ0FBQyxpQkFBaUIsRUFBRTtBQUN4QixvQkFBQSxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQztBQUM3QyxpQkFBQTtBQUFNLHFCQUFBO0FBQ0gsb0JBQUEsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7QUFDM0MsaUJBQUE7YUFDSixFQUFFLElBQUksQ0FBQyxDQUFDO0FBQ1osU0FBQTtLQUNKOztJQUdELG1CQUFtQixHQUFBO1FBQ2YsSUFBSSxJQUFJLENBQUMsZUFBZSxFQUFFO0FBQ3RCLFlBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO0FBQ25ELFlBQUEsSUFBSSxDQUFDLGVBQWUsQ0FBQyxVQUFVLEVBQUUsQ0FBQztBQUNsQyxZQUFBLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSSxDQUFDO0FBQy9CLFNBQUE7QUFDRCxRQUFBLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUM7S0FDakM7O0FBR0QsSUFBQSxrQkFBa0IsQ0FBQyxJQUFtQixFQUFBO1FBQ2xDLElBQUksQ0FBQyx5QkFBeUIsRUFBRSxDQUFDO0tBQ3BDO0lBRUQseUJBQXlCLEdBQUE7OztRQUV2QixJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQzs7UUFHM0IsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDO0FBQ2pELFFBQUEsSUFBSSxDQUFDLFVBQVU7WUFBRSxPQUFPO1FBRXhCLElBQUk7O1lBRUEsSUFBSSxTQUFTLEdBQXVCLElBQUksQ0FBQzs7WUFHekMsSUFBSSxVQUFVLENBQUMsSUFBSSxFQUFFOzs7QUFHakIsZ0JBQUEsU0FBUyxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO0FBQ3pDLGFBQUE7O1lBR0QsSUFBSSxDQUFDLFNBQVMsRUFBRTs7O2dCQUdaLE1BQU0sV0FBVyxHQUFHLENBQUEsRUFBQSxHQUFDLFVBQWtCLENBQUMsV0FBVyxNQUFBLElBQUEsSUFBQSxFQUFBLEtBQUEsS0FBQSxDQUFBLEdBQUEsS0FBQSxDQUFBLEdBQUEsRUFBQSxDQUFFLGFBQWEsQ0FBQyxlQUFlLENBQUMsQ0FBQztBQUNwRixnQkFBQSxJQUFJLFdBQVcsRUFBRTtvQkFDYixTQUFTLEdBQUcsV0FBVyxDQUFDO0FBQzNCLGlCQUFBO0FBQU0scUJBQUE7O0FBRUgsb0JBQUEsU0FBUyxHQUFHLFFBQVEsQ0FBQyxhQUFhLENBQUMsMENBQTBDLENBQUMsQ0FBQztBQUNsRixpQkFBQTtBQUNKLGFBQUE7WUFFRCxJQUFJLENBQUMsU0FBUyxFQUFFO0FBQ1osZ0JBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxrREFBa0QsQ0FBQyxDQUFDO2dCQUM3RCxPQUFPO0FBQ1YsYUFBQTs7WUFHRCxNQUFNLFdBQVcsR0FBRyxTQUFTLENBQUMsYUFBYSxDQUFDLHVCQUF1QixDQUFDLENBQUM7QUFDckUsWUFBQSxJQUFJLFdBQVcsRUFBRTtBQUNiLGdCQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsZ0RBQWdELENBQUMsQ0FBQztBQUMzRCxnQkFBQSxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxhQUFhLENBQUMsQ0FBQzs7QUFHMUMsZ0JBQUEsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFdBQTBCLENBQUM7O0FBR3BELGdCQUFBLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxXQUEwQixDQUFDLENBQUM7QUFDMUQsYUFBQTtBQUFNLGlCQUFBO0FBQ0gsZ0JBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxtQ0FBbUMsQ0FBQyxDQUFDO0FBQzlDLGdCQUFBLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBQzNDLGFBQUE7QUFDSixTQUFBO0FBQUMsUUFBQSxPQUFPLEtBQUssRUFBRTtZQUNaLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSw4QkFBQSxFQUFpQyxLQUFLLENBQUMsT0FBTyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQzNELFlBQUEsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDNUMsU0FBQTtLQUNGO0FBRUQsSUFBQSxxQkFBcUIsQ0FBQyxZQUF5QixFQUFBOztRQUUzQyxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksZ0JBQWdCLENBQUMsQ0FBQyxTQUFTLEtBQUk7WUFDdEQsSUFBSSxJQUFJLENBQUMsWUFBWTtnQkFBRSxPQUFPOztBQUc5QixZQUFBLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDO1lBQ3pCLFVBQVUsQ0FBQyxNQUFLO0FBQ1osZ0JBQUEsSUFBSSxDQUFDLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQztBQUNoQyxnQkFBQSxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQzthQUM3QixFQUFFLEdBQUcsQ0FBQyxDQUFDO0FBQ1osU0FBQyxDQUFDLENBQUM7O0FBR0gsUUFBQSxJQUFJLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQyxZQUFZLEVBQUU7QUFDdkMsWUFBQSxTQUFTLEVBQUUsSUFBSTtBQUNmLFlBQUEsT0FBTyxFQUFFLElBQUk7WUFDYixVQUFVLEVBQUUsS0FBSztBQUNwQixTQUFBLENBQUMsQ0FBQztBQUVILFFBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO0tBQ3ZEO0FBRUQsSUFBQSxlQUFlLENBQUMsU0FBMkIsRUFBQTtRQUN6QyxJQUFJLENBQUMsSUFBSSxDQUFDLGlCQUFpQjtZQUFFLE9BQU87UUFFcEMsSUFBSTtZQUNBLE1BQU0sYUFBYSxHQUFHLEVBQUUsQ0FBQzs7WUFFekIsTUFBTSxrQkFBa0IsR0FBRyxTQUFTLENBQUMsTUFBTSxHQUFHLGFBQWE7Z0JBQ3ZELFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLGFBQWEsQ0FBQyxHQUFHLFNBQVMsQ0FBQztBQUVsRCxZQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSxJQUFBLEVBQU8sa0JBQWtCLENBQUMsTUFBTSxDQUFBLGNBQUEsRUFBaUIsU0FBUyxDQUFDLE1BQU0sQ0FBQSxDQUFFLENBQUMsQ0FBQzs7WUFHOUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ1YsWUFBQSxLQUFLLE1BQU0sUUFBUSxJQUFJLGtCQUFrQixFQUFFO0FBQ3ZDLGdCQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSxVQUFBLEVBQWEsRUFBRSxDQUFDLENBQVksU0FBQSxFQUFBLFFBQVEsQ0FBQyxJQUFJLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDdEQsZ0JBQUEsSUFBSSxRQUFRLENBQUMsSUFBSSxLQUFLLFdBQVcsRUFBRTs7b0JBRS9CLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLEVBQUU7d0JBQ2hELElBQUk7OzRCQUVBLElBQUksSUFBSSxZQUFZLE9BQU8sRUFBRTtnQ0FDekIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBLDRCQUFBLEVBQStCLElBQUksQ0FBQyxPQUFPLENBQUUsQ0FBQSxDQUFDLENBQUM7O0FBR3hELGdDQUFBLElBQUksSUFBSSxZQUFZLFdBQVcsSUFBSSxJQUFJLFlBQVksY0FBYyxFQUFFOztvQ0FFL0QsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBLDJCQUFBLEVBQThCLElBQUksQ0FBQyxTQUFTLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDekQsb0NBQUEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUM3QixpQ0FBQTtxQ0FBTSxJQUFJLElBQUksWUFBWSxVQUFVLEVBQUU7O29DQUVuQyxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLHNCQUFzQixDQUFDLENBQUM7QUFDM0Qsb0NBQUEsSUFBSSxhQUFhLEVBQUU7QUFDZix3Q0FBQSxJQUFJLENBQUMsR0FBRyxDQUFDLHlDQUF5QyxDQUFDLENBQUM7QUFDcEQsd0NBQUEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxhQUE0QixDQUFDLENBQUM7QUFDckQscUNBQUE7QUFBTSx5Q0FBQTs7O3dDQUdILE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBQzlFLHdDQUFBLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7O0FBRWxCLDRDQUFBLE1BQU0sV0FBVyxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDaEQsNENBQUEsS0FBSyxNQUFNLElBQUksSUFBSSxXQUFXLEVBQUU7QUFDNUIsZ0RBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO0FBQ3BELGdEQUFBLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBbUIsQ0FBQyxDQUFDO0FBQzVDLDZDQUFBO0FBQ0oseUNBQUE7QUFDSixxQ0FBQTtBQUNKLGlDQUFBO0FBQ0osNkJBQUE7QUFBTSxpQ0FBQSxJQUFJLElBQUksQ0FBQyxRQUFRLEtBQUssSUFBSSxDQUFDLFNBQVMsRUFBRTs7QUFFekMsZ0NBQUEsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQztnQ0FDekMsSUFBSSxhQUFhLEtBQ2IsYUFBYSxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsMkJBQTJCLENBQUM7QUFDN0Qsb0NBQUEsYUFBYSxDQUFDLE9BQU8sQ0FBQyxzQkFBc0IsQ0FBQyxDQUNoRCxFQUFFO0FBQ0Msb0NBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO29DQUM3QyxNQUFNLFdBQVcsR0FBRyxhQUFhLENBQUMsT0FBTyxDQUFDLHNCQUFzQixDQUFDLENBQUM7QUFDbEUsb0NBQUEsSUFBSSxXQUFXLEVBQUU7QUFDYix3Q0FBQSxJQUFJLENBQUMsY0FBYyxDQUFDLFdBQTBCLENBQUMsQ0FBQztBQUNuRCxxQ0FBQTtBQUNKLGlDQUFBO0FBQ0osNkJBQUE7QUFBTSxpQ0FBQTtnQ0FDSCxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUEsb0JBQUEsRUFBdUIsSUFBSSxDQUFDLFFBQVEsQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUNwRCw2QkFBQTtBQUNKLHlCQUFBO0FBQUMsd0JBQUEsT0FBTyxTQUFTLEVBQUU7NEJBQ2hCLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSx1QkFBQSxFQUEwQixTQUFTLENBQUMsT0FBTyxDQUFFLENBQUEsQ0FBQyxDQUFDOztBQUUzRCx5QkFBQTtBQUNKLHFCQUFBO0FBQ0osaUJBQUE7QUFBTSxxQkFBQTtvQkFDSCxJQUFJLENBQUMsR0FBRyxDQUFDLDBCQUEwQixHQUFHLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN4RCxpQkFBQTtBQUNKLGFBQUE7QUFDSixTQUFBO0FBQUMsUUFBQSxPQUFPLEtBQUssRUFBRTtZQUNaLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSwwQkFBQSxFQUE2QixLQUFLLENBQUMsT0FBTyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQzFELFNBQUE7S0FDRjtBQUVELElBQUEsU0FBUyxDQUFDLEtBQWdCLEVBQUE7O1FBRXRCLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRTtBQUNoRCxZQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsb0VBQW9FLENBQUMsQ0FBQztBQUMvRSxZQUFBLElBQUksQ0FBQyxHQUFHLENBQUMscUJBQXFCLElBQUksSUFBSSxDQUFDLGlCQUFpQixHQUFHLEtBQUssR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO0FBQzFFLFlBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsSUFBSSxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBQ2hFLE9BQU87QUFDUixTQUFBO1FBRUQsSUFBSTtBQUNBLFlBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDOztBQUc5QixZQUFBLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDO0FBRXpCLFlBQUEsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLE1BQXFCLENBQUM7QUFDM0MsWUFBQSxJQUFJLENBQUMsTUFBTTtnQkFBRSxPQUFPO0FBRXBCLFlBQUEsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUMvQixTQUFBO0FBQUMsUUFBQSxPQUFPLEtBQUssRUFBRTtZQUNaLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSxvQkFBQSxFQUF1QixLQUFLLENBQUMsT0FBTyxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ3BELFNBQUE7QUFBUyxnQkFBQTs7WUFFTixVQUFVLENBQUMsTUFBSztBQUNaLGdCQUFBLElBQUksQ0FBQyxZQUFZLEdBQUcsS0FBSyxDQUFDO2FBQzdCLEVBQUUsR0FBRyxDQUFDLENBQUM7QUFDWCxTQUFBO0tBQ0o7QUFFRCxJQUFBLGNBQWMsQ0FBQyxPQUFvQixFQUFBO1FBQy9CLElBQUk7O0FBRUEsWUFBQSxJQUFJLENBQUMsSUFBSSxDQUFDLGlCQUFpQixJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQyxFQUFFO0FBQ3RFLGdCQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsK0NBQStDLENBQUMsQ0FBQztnQkFDMUQsT0FBTztBQUNWLGFBQUE7O0FBR0QsWUFBQSxJQUFJLENBQUMsR0FBRyxDQUFDLG9DQUFvQyxDQUFDLENBQUM7O1lBRy9DLE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLHFCQUFxQixDQUFDO0FBQ2hFLGtCQUFFLE9BQU87QUFDVCxrQkFBRSxPQUFPLENBQUMsYUFBYSxDQUFDLHNCQUFzQixDQUFDLENBQUM7QUFFcEQsWUFBQSxJQUFJLFVBQVUsRUFBRTtBQUNaLGdCQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsd0JBQXdCLFVBQVUsQ0FBQSxDQUFFLENBQUMsQ0FBQztnQkFDL0MsSUFBSSxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsR0FBRyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUM7QUFDN0QsZ0JBQUEsSUFBSSxDQUFDLGlCQUFpQixDQUFDLFVBQXlCLENBQUMsQ0FBQztnQkFDbEQsT0FBTztBQUNWLGFBQUE7QUFDRCxZQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsd0NBQXdDLENBQUMsQ0FBQzs7WUFHbkQsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxzQkFBc0IsQ0FBZ0IsQ0FBQztBQUMxRSxZQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSxhQUFBLEVBQWdCLFVBQVUsR0FBRyxVQUFVLEdBQUcsV0FBVyxDQUFBLENBQUUsQ0FBQyxDQUFDO0FBQ2xFLFlBQUEsSUFBSSxVQUFVLEVBQUU7QUFDWixnQkFBQSxJQUFJLENBQUMsaUJBQWlCLENBQUMsVUFBVSxDQUFDLENBQUM7Z0JBQ25DLE9BQU87QUFDVixhQUFBO0FBQ0osU0FBQTtBQUFDLFFBQUEsT0FBTyxLQUFLLEVBQUU7WUFDWixJQUFJLENBQUMsR0FBRyxDQUFDLENBQUEseUJBQUEsRUFBNEIsS0FBSyxDQUFDLE9BQU8sQ0FBRSxDQUFBLENBQUMsQ0FBQztBQUN6RCxTQUFBO0tBQ0o7QUFFRCxJQUFBLGlCQUFpQixDQUFDLFdBQXdCLEVBQUE7UUFDdEMsSUFBSTs7WUFHQSxNQUFNLFlBQVksR0FBRyxXQUFXLENBQUMsYUFBYSxDQUFDLDBFQUEwRSxDQUFDLENBQUM7WUFFM0gsSUFBSSxDQUFDLFlBQVksRUFBRTtBQUNqQixnQkFBQSxJQUFJLENBQUMsR0FBRyxDQUFDLG1DQUFtQyxDQUFDLENBQUM7Z0JBQzlDLE9BQU87QUFDUixhQUFBO1lBQ0QsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBLHFCQUFBLEVBQXdCLFlBQVksQ0FBQyxXQUFXLENBQUUsQ0FBQSxDQUFDLENBQUM7O0FBRzdELFlBQUEsTUFBTSxRQUFRLEdBQUcsWUFBWSxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUM7QUFDdkMsZ0JBQUEsWUFBWSxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQztBQUVsRCxZQUFBLElBQUksQ0FBQyxRQUFRO2dCQUFFLE9BQU87QUFDdEIsWUFBQSxJQUFJLENBQUMsR0FBRyxDQUFDLGlCQUFpQixRQUFRLENBQUEsQ0FBRSxDQUFDLENBQUM7O1lBR3RDLE1BQU0sSUFBSSxHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUMsc0JBQXNCLENBQUMsQ0FBQztZQUN6RCxJQUFJLENBQUMsSUFBSSxFQUFFO0FBQ1QsZ0JBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO2dCQUN0QyxPQUFPO0FBQ1IsYUFBQTs7WUFHRCxNQUFNLFVBQVUsR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFDLGdFQUFnRSxDQUFDLENBQUM7WUFDeEcsSUFBSSxDQUFDLFVBQVUsRUFBRTtBQUNmLGdCQUFBLElBQUksQ0FBQyxHQUFHLENBQUMsaUNBQWlDLENBQUMsQ0FBQztnQkFDNUMsT0FBTztBQUNSLGFBQUE7WUFFRCxNQUFNLFVBQVUsR0FBRyxVQUFVLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxDQUFDO0FBQ2pELFlBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsVUFBVSxDQUFBLENBQUUsQ0FBQyxDQUFDO1lBRTNDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSw4QkFBQSxFQUFpQyxRQUFRLENBQWdCLGFBQUEsRUFBQSxVQUFVLENBQUcsQ0FBQSxDQUFBLENBQUMsQ0FBQzs7QUFHakYsWUFBQSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFDO0FBRS9DLFNBQUE7QUFBQyxRQUFBLE9BQU8sS0FBSyxFQUFFO1lBQ1osSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBLDRCQUFBLEVBQStCLEtBQUssQ0FBQyxPQUFPLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDNUQsU0FBQTtLQUNKO0lBRUssZ0JBQWdCLENBQUMsUUFBZ0IsRUFBRSxNQUFjLEVBQUE7O1lBQ25ELElBQUk7O0FBRUEsZ0JBQUEsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsb0JBQW9CLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUV2RSxJQUFJLENBQUMsSUFBSSxFQUFFO0FBQ1Asb0JBQUEsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixFQUFFO3dCQUNqQyxJQUFJQSxlQUFNLENBQUMsQ0FBWSxTQUFBLEVBQUEsUUFBUSxhQUFhLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDdkQscUJBQUE7b0JBQ0QsT0FBTztBQUNWLGlCQUFBOztBQUdELGdCQUFBLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDOztnQkFHaEQsTUFBTSxnQkFBZ0IsR0FBRyx1QkFBdUIsQ0FBQztnQkFDakQsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFFekQsZ0JBQUEsSUFBSSxVQUFVLENBQUM7Z0JBQ2YsSUFBSSxTQUFTLEdBQUcsSUFBSSxDQUFDO0FBRXJCLGdCQUFBLElBQUksZ0JBQWdCLEVBQUU7O0FBRWxCLG9CQUFBLE1BQU0sZUFBZSxHQUFHLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDO0FBQzVDLG9CQUFBLElBQUksY0FBYyxDQUFDO29CQUVuQixJQUFJOztBQUVBLHdCQUFBLGNBQWMsR0FBR0Msa0JBQVMsQ0FBQyxlQUFlLENBQUMsQ0FBQzs7d0JBRzVDLElBQUksY0FBYyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsRUFBRTs0QkFDbEQsU0FBUyxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDLENBQUM7QUFDaEUseUJBQUE7QUFFSixxQkFBQTtBQUFDLG9CQUFBLE9BQU8sQ0FBQyxFQUFFO3dCQUNSLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSwyQkFBQSxFQUE4QixDQUFDLENBQUMsT0FBTyxDQUFFLENBQUEsQ0FBQyxDQUFDO3dCQUNwRCxjQUFjLEdBQUcsRUFBRSxDQUFDO0FBQ3ZCLHFCQUFBOztvQkFHRCxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDLEtBQUssTUFBTSxFQUFFOzt3QkFFN0QsY0FBYyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsR0FBRyxNQUFNLENBQUM7O0FBRzFELHdCQUFBLE1BQU0sa0JBQWtCLEdBQUdDLHNCQUFhLENBQUMsY0FBYyxDQUFDLENBQUM7O3dCQUd6RCxVQUFVLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFRLEtBQUEsRUFBQSxrQkFBa0IsQ0FBSyxHQUFBLENBQUEsQ0FBQyxDQUFDOztBQUdoRix3QkFBQSxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUM7O0FBRzlDLHdCQUFBLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRTtBQUNqQyw0QkFBQSxJQUFJLFNBQVMsRUFBRTtnQ0FDWCxJQUFJRixlQUFNLENBQUMsQ0FBVyxRQUFBLEVBQUEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBTSxHQUFBLEVBQUEsU0FBUyxRQUFRLE1BQU0sQ0FBQSxNQUFBLEVBQVMsSUFBSSxDQUFDLFFBQVEsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO0FBQ3RILDZCQUFBO0FBQU0saUNBQUE7QUFDSCxnQ0FBQSxJQUFJQSxlQUFNLENBQUMsQ0FBQSxJQUFBLEVBQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQSxHQUFBLEVBQU0sTUFBTSxDQUFBLE1BQUEsRUFBUyxJQUFJLENBQUMsUUFBUSxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDakcsNkJBQUE7QUFDSix5QkFBQTt3QkFFRCxJQUFJLENBQUMsR0FBRyxDQUFDLENBQXNCLG1CQUFBLEVBQUEsSUFBSSxDQUFDLFFBQVEsQ0FBUSxLQUFBLEVBQUEsTUFBTSxDQUFHLENBQUEsQ0FBQSxDQUFDLENBQUM7QUFDbEUscUJBQUE7QUFBTSx5QkFBQTt3QkFDSCxJQUFJLENBQUMsR0FBRyxDQUFDLENBQTBCLHVCQUFBLEVBQUEsTUFBTSxDQUFTLE1BQUEsRUFBQSxJQUFJLENBQUMsUUFBUSxDQUFtQixpQkFBQSxDQUFBLENBQUMsQ0FBQztBQUN2RixxQkFBQTtBQUNKLGlCQUFBO0FBQU0scUJBQUE7O0FBRUgsb0JBQUEsTUFBTSxjQUFjLEdBQUc7QUFDbkIsd0JBQUEsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLGtCQUFrQixHQUFHLE1BQU07cUJBQzdDLENBQUM7QUFFRixvQkFBQSxNQUFNLGVBQWUsR0FBR0Usc0JBQWEsQ0FBQyxjQUFjLENBQUMsQ0FBQztBQUN0RCxvQkFBQSxVQUFVLEdBQUcsQ0FBUSxLQUFBLEVBQUEsZUFBZSxDQUFVLE9BQUEsRUFBQSxPQUFPLEVBQUUsQ0FBQzs7QUFHeEQsb0JBQUEsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxDQUFDOztBQUc5QyxvQkFBQSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCLEVBQUU7QUFDakMsd0JBQUEsSUFBSUYsZUFBTSxDQUFDLENBQUEsTUFBQSxFQUFTLElBQUksQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUEsR0FBQSxFQUFNLE1BQU0sQ0FBQSxLQUFBLEVBQVEsSUFBSSxDQUFDLFFBQVEsRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO0FBQ2xHLHFCQUFBO29CQUVELElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQSxpQ0FBQSxFQUFvQyxJQUFJLENBQUMsUUFBUSxDQUFFLENBQUEsQ0FBQyxDQUFDO0FBQ2pFLGlCQUFBO0FBQ0osYUFBQTtBQUFDLFlBQUEsT0FBTyxLQUFLLEVBQUU7Z0JBQ1osSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFBLDRCQUFBLEVBQStCLEtBQUssQ0FBQyxPQUFPLENBQUUsQ0FBQSxDQUFDLENBQUM7QUFDekQsZ0JBQUEsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixFQUFFO29CQUNqQyxJQUFJQSxlQUFNLENBQUMsQ0FBQSwwQkFBQSxFQUE2QixLQUFLLENBQUMsT0FBTyxDQUFFLENBQUEsRUFBRSxJQUFJLENBQUMsQ0FBQztBQUNsRSxpQkFBQTtBQUNKLGFBQUE7U0FDSixDQUFBLENBQUE7QUFBQSxLQUFBOztJQUdELE9BQU8sR0FBQTtBQUNILFFBQUEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDOztRQUc1QixJQUFJLENBQUMseUJBQXlCLEVBQUUsQ0FBQztBQUVqQyxRQUFBLElBQUksQ0FBQyxJQUFJLENBQUMsaUJBQWlCLEVBQUU7QUFDekIsWUFBQSxJQUFJQSxlQUFNLENBQUMsNkRBQTZELEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDaEYsT0FBTztBQUNWLFNBQUE7O1FBR0QsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDLENBQUM7QUFDOUUsUUFBQSxNQUFNLEtBQUssR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO1FBRTNCLElBQUlBLGVBQU0sQ0FBQyxDQUFTLE1BQUEsRUFBQSxLQUFLLCtCQUErQixFQUFFLElBQUksQ0FBQyxDQUFDO1FBRWhFLElBQUksS0FBSyxHQUFHLENBQUMsRUFBRTs7WUFFWCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxFQUFFLENBQUMsRUFBRSxFQUFFO0FBQzVCLGdCQUFBLE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQWdCLENBQUM7QUFDckMsZ0JBQUEsSUFBSSxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLEVBQUU7QUFDdkMsb0JBQUEsSUFBSUEsZUFBTSxDQUFDLENBQUEsb0JBQUEsRUFBdUIsSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFDakYsb0JBQUEsSUFBSSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxDQUFDO29CQUM3QixNQUFNO0FBQ1QsaUJBQUE7QUFDSixhQUFBO0FBQ0osU0FBQTtLQUNKO0FBQ0YsQ0FBQTtBQUVELE1BQU0sNkJBQThCLFNBQVFHLHlCQUFnQixDQUFBO0lBRzFELFdBQVksQ0FBQSxHQUFRLEVBQUUsTUFBaUMsRUFBQTtBQUNuRCxRQUFBLEtBQUssQ0FBQyxHQUFHLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFDbkIsUUFBQSxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztLQUN4QjtJQUVELE9BQU8sR0FBQTtBQUNILFFBQUEsTUFBTSxFQUFDLFdBQVcsRUFBQyxHQUFHLElBQUksQ0FBQztRQUUzQixXQUFXLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDcEIsV0FBVyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsRUFBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUMsQ0FBQyxDQUFDO1FBRXJFLElBQUlDLGdCQUFPLENBQUMsV0FBVyxDQUFDO2FBQ25CLE9BQU8sQ0FBQyxzQkFBc0IsQ0FBQzthQUMvQixPQUFPLENBQUMseURBQXlELENBQUM7QUFDbEUsYUFBQSxPQUFPLENBQUMsSUFBSSxJQUFJLElBQUk7YUFDaEIsY0FBYyxDQUFDLFFBQVEsQ0FBQzthQUN4QixRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUM7QUFDakQsYUFBQSxRQUFRLENBQUMsQ0FBTyxLQUFLLEtBQUksU0FBQSxDQUFBLElBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxhQUFBO1lBQ3RCLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLGtCQUFrQixHQUFHLEtBQUssQ0FBQztBQUNoRCxZQUFBLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQztTQUNwQyxDQUFBLENBQUMsQ0FBQyxDQUFDO1FBRVosSUFBSUEsZ0JBQU8sQ0FBQyxXQUFXLENBQUM7YUFDbkIsT0FBTyxDQUFDLG9CQUFvQixDQUFDO2FBQzdCLE9BQU8sQ0FBQyw4Q0FBOEMsQ0FBQztBQUN2RCxhQUFBLFNBQVMsQ0FBQyxNQUFNLElBQUksTUFBTTthQUN0QixRQUFRLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUM7QUFDaEQsYUFBQSxRQUFRLENBQUMsQ0FBTyxLQUFLLEtBQUksU0FBQSxDQUFBLElBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxLQUFBLENBQUEsRUFBQSxhQUFBO1lBQ3RCLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLGlCQUFpQixHQUFHLEtBQUssQ0FBQztBQUMvQyxZQUFBLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQztTQUNwQyxDQUFBLENBQUMsQ0FBQyxDQUFDO1FBRVosSUFBSUEsZ0JBQU8sQ0FBQyxXQUFXLENBQUM7YUFDbkIsT0FBTyxDQUFDLFlBQVksQ0FBQzthQUNyQixPQUFPLENBQUMsK0NBQStDLENBQUM7QUFDeEQsYUFBQSxTQUFTLENBQUMsTUFBTSxJQUFJLE1BQU07YUFDdEIsUUFBUSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztBQUN4QyxhQUFBLFFBQVEsQ0FBQyxDQUFPLEtBQUssS0FBSSxTQUFBLENBQUEsSUFBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLEtBQUEsQ0FBQSxFQUFBLGFBQUE7WUFDdEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQztBQUN2QyxZQUFBLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxZQUFZLEVBQUUsQ0FBQztBQUVqQyxZQUFBLElBQUksS0FBSyxFQUFFO0FBQ1AsZ0JBQUEsSUFBSUosZUFBTSxDQUFDLDZDQUE2QyxFQUFFLElBQUksQ0FBQyxDQUFDO0FBQ25FLGFBQUE7QUFBTSxpQkFBQTtBQUNILGdCQUFBLElBQUlBLGVBQU0sQ0FBQyxxQkFBcUIsRUFBRSxJQUFJLENBQUMsQ0FBQztBQUMzQyxhQUFBO1NBQ0osQ0FBQSxDQUFDLENBQUMsQ0FBQzs7UUFHWixJQUFJSSxnQkFBTyxDQUFDLFdBQVcsQ0FBQzthQUNuQixPQUFPLENBQUMsYUFBYSxDQUFDO2FBQ3RCLE9BQU8sQ0FBQyxnQ0FBZ0MsQ0FBQztBQUN6QyxhQUFBLFNBQVMsQ0FBQyxNQUFNLElBQUksTUFBTTthQUN0QixhQUFhLENBQUMsVUFBVSxDQUFDO2FBQ3pCLE9BQU8sQ0FBQyxNQUFLO0FBQ1YsWUFBQSxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1NBQ3pCLENBQUMsQ0FBQyxDQUFDOztRQUdaLFdBQVcsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEVBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFDLENBQUMsQ0FBQztBQUUvRCxRQUFBLFdBQVcsQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFO0FBQ3RCLFlBQUEsSUFBSSxFQUFFLDZGQUE2RjtBQUN0RyxTQUFBLENBQUMsQ0FBQzs7UUFHSCxXQUFXLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxFQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBQyxDQUFDLENBQUM7UUFFdEQsTUFBTSxJQUFJLEdBQUcsV0FBVyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUV4QyxRQUFBLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFO0FBQ2hCLFlBQUEsSUFBSSxFQUFFLDREQUE0RDtBQUNyRSxTQUFBLENBQUMsQ0FBQztBQUVILFFBQUEsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUU7QUFDaEIsWUFBQSxJQUFJLEVBQUUsNENBQTRDO0FBQ3JELFNBQUEsQ0FBQyxDQUFDO0FBRUgsUUFBQSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRTtBQUNoQixZQUFBLElBQUksRUFBRSwrQ0FBK0M7QUFDeEQsU0FBQSxDQUFDLENBQUM7S0FDTjtBQUNGOzs7OyJ9
