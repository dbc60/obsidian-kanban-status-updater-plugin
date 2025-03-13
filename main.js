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
    showNotifications: true,
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3RzbGliL3RzbGliLmVzNi5qcyIsIm1haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG5Db3B5cmlnaHQgKGMpIE1pY3Jvc29mdCBDb3Jwb3JhdGlvbi5cclxuXHJcblBlcm1pc3Npb24gdG8gdXNlLCBjb3B5LCBtb2RpZnksIGFuZC9vciBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUgZm9yIGFueVxyXG5wdXJwb3NlIHdpdGggb3Igd2l0aG91dCBmZWUgaXMgaGVyZWJ5IGdyYW50ZWQuXHJcblxyXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiIEFORCBUSEUgQVVUSE9SIERJU0NMQUlNUyBBTEwgV0FSUkFOVElFUyBXSVRIXHJcblJFR0FSRCBUTyBUSElTIFNPRlRXQVJFIElOQ0xVRElORyBBTEwgSU1QTElFRCBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWVxyXG5BTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsXHJcbklORElSRUNULCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgT1IgQU5ZIERBTUFHRVMgV0hBVFNPRVZFUiBSRVNVTFRJTkcgRlJPTVxyXG5MT1NTIE9GIFVTRSwgREFUQSBPUiBQUk9GSVRTLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgTkVHTElHRU5DRSBPUlxyXG5PVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SXHJcblBFUkZPUk1BTkNFIE9GIFRISVMgU09GVFdBUkUuXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqICovXHJcbi8qIGdsb2JhbCBSZWZsZWN0LCBQcm9taXNlLCBTdXBwcmVzc2VkRXJyb3IsIFN5bWJvbCwgSXRlcmF0b3IgKi9cclxuXHJcbnZhciBleHRlbmRTdGF0aWNzID0gZnVuY3Rpb24oZCwgYikge1xyXG4gICAgZXh0ZW5kU3RhdGljcyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fFxyXG4gICAgICAgICh7IF9fcHJvdG9fXzogW10gfSBpbnN0YW5jZW9mIEFycmF5ICYmIGZ1bmN0aW9uIChkLCBiKSB7IGQuX19wcm90b19fID0gYjsgfSkgfHxcclxuICAgICAgICBmdW5jdGlvbiAoZCwgYikgeyBmb3IgKHZhciBwIGluIGIpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYiwgcCkpIGRbcF0gPSBiW3BdOyB9O1xyXG4gICAgcmV0dXJuIGV4dGVuZFN0YXRpY3MoZCwgYik7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHRlbmRzKGQsIGIpIHtcclxuICAgIGlmICh0eXBlb2YgYiAhPT0gXCJmdW5jdGlvblwiICYmIGIgIT09IG51bGwpXHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNsYXNzIGV4dGVuZHMgdmFsdWUgXCIgKyBTdHJpbmcoYikgKyBcIiBpcyBub3QgYSBjb25zdHJ1Y3RvciBvciBudWxsXCIpO1xyXG4gICAgZXh0ZW5kU3RhdGljcyhkLCBiKTtcclxuICAgIGZ1bmN0aW9uIF9fKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gZDsgfVxyXG4gICAgZC5wcm90b3R5cGUgPSBiID09PSBudWxsID8gT2JqZWN0LmNyZWF0ZShiKSA6IChfXy5wcm90b3R5cGUgPSBiLnByb3RvdHlwZSwgbmV3IF9fKCkpO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fYXNzaWduID0gZnVuY3Rpb24oKSB7XHJcbiAgICBfX2Fzc2lnbiA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gX19hc3NpZ24odCkge1xyXG4gICAgICAgIGZvciAodmFyIHMsIGkgPSAxLCBuID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xyXG4gICAgICAgICAgICBzID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkpIHRbcF0gPSBzW3BdO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdDtcclxuICAgIH1cclxuICAgIHJldHVybiBfX2Fzc2lnbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZXN0KHMsIGUpIHtcclxuICAgIHZhciB0ID0ge307XHJcbiAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkgJiYgZS5pbmRleE9mKHApIDwgMClcclxuICAgICAgICB0W3BdID0gc1twXTtcclxuICAgIGlmIChzICE9IG51bGwgJiYgdHlwZW9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocyk7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmIChlLmluZGV4T2YocFtpXSkgPCAwICYmIE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChzLCBwW2ldKSlcclxuICAgICAgICAgICAgICAgIHRbcFtpXV0gPSBzW3BbaV1dO1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiB0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYykge1xyXG4gICAgdmFyIGMgPSBhcmd1bWVudHMubGVuZ3RoLCByID0gYyA8IDMgPyB0YXJnZXQgOiBkZXNjID09PSBudWxsID8gZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodGFyZ2V0LCBrZXkpIDogZGVzYywgZDtcclxuICAgIGlmICh0eXBlb2YgUmVmbGVjdCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgUmVmbGVjdC5kZWNvcmF0ZSA9PT0gXCJmdW5jdGlvblwiKSByID0gUmVmbGVjdC5kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYyk7XHJcbiAgICBlbHNlIGZvciAodmFyIGkgPSBkZWNvcmF0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoZCA9IGRlY29yYXRvcnNbaV0pIHIgPSAoYyA8IDMgPyBkKHIpIDogYyA+IDMgPyBkKHRhcmdldCwga2V5LCByKSA6IGQodGFyZ2V0LCBrZXkpKSB8fCByO1xyXG4gICAgcmV0dXJuIGMgPiAzICYmIHIgJiYgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCByKSwgcjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcGFyYW0ocGFyYW1JbmRleCwgZGVjb3JhdG9yKSB7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldCwga2V5KSB7IGRlY29yYXRvcih0YXJnZXQsIGtleSwgcGFyYW1JbmRleCk7IH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZXNEZWNvcmF0ZShjdG9yLCBkZXNjcmlwdG9ySW4sIGRlY29yYXRvcnMsIGNvbnRleHRJbiwgaW5pdGlhbGl6ZXJzLCBleHRyYUluaXRpYWxpemVycykge1xyXG4gICAgZnVuY3Rpb24gYWNjZXB0KGYpIHsgaWYgKGYgIT09IHZvaWQgMCAmJiB0eXBlb2YgZiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnVuY3Rpb24gZXhwZWN0ZWRcIik7IHJldHVybiBmOyB9XHJcbiAgICB2YXIga2luZCA9IGNvbnRleHRJbi5raW5kLCBrZXkgPSBraW5kID09PSBcImdldHRlclwiID8gXCJnZXRcIiA6IGtpbmQgPT09IFwic2V0dGVyXCIgPyBcInNldFwiIDogXCJ2YWx1ZVwiO1xyXG4gICAgdmFyIHRhcmdldCA9ICFkZXNjcmlwdG9ySW4gJiYgY3RvciA/IGNvbnRleHRJbltcInN0YXRpY1wiXSA/IGN0b3IgOiBjdG9yLnByb3RvdHlwZSA6IG51bGw7XHJcbiAgICB2YXIgZGVzY3JpcHRvciA9IGRlc2NyaXB0b3JJbiB8fCAodGFyZ2V0ID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih0YXJnZXQsIGNvbnRleHRJbi5uYW1lKSA6IHt9KTtcclxuICAgIHZhciBfLCBkb25lID0gZmFsc2U7XHJcbiAgICBmb3IgKHZhciBpID0gZGVjb3JhdG9ycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgIHZhciBjb250ZXh0ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4pIGNvbnRleHRbcF0gPSBwID09PSBcImFjY2Vzc1wiID8ge30gOiBjb250ZXh0SW5bcF07XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4uYWNjZXNzKSBjb250ZXh0LmFjY2Vzc1twXSA9IGNvbnRleHRJbi5hY2Nlc3NbcF07XHJcbiAgICAgICAgY29udGV4dC5hZGRJbml0aWFsaXplciA9IGZ1bmN0aW9uIChmKSB7IGlmIChkb25lKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IGFkZCBpbml0aWFsaXplcnMgYWZ0ZXIgZGVjb3JhdGlvbiBoYXMgY29tcGxldGVkXCIpOyBleHRyYUluaXRpYWxpemVycy5wdXNoKGFjY2VwdChmIHx8IG51bGwpKTsgfTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKDAsIGRlY29yYXRvcnNbaV0pKGtpbmQgPT09IFwiYWNjZXNzb3JcIiA/IHsgZ2V0OiBkZXNjcmlwdG9yLmdldCwgc2V0OiBkZXNjcmlwdG9yLnNldCB9IDogZGVzY3JpcHRvcltrZXldLCBjb250ZXh0KTtcclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJhY2Nlc3NvclwiKSB7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IHZvaWQgMCkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZFwiKTtcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmdldCkpIGRlc2NyaXB0b3IuZ2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LnNldCkpIGRlc2NyaXB0b3Iuc2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmluaXQpKSBpbml0aWFsaXplcnMudW5zaGlmdChfKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoXyA9IGFjY2VwdChyZXN1bHQpKSB7XHJcbiAgICAgICAgICAgIGlmIChraW5kID09PSBcImZpZWxkXCIpIGluaXRpYWxpemVycy51bnNoaWZ0KF8pO1xyXG4gICAgICAgICAgICBlbHNlIGRlc2NyaXB0b3Jba2V5XSA9IF87XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRhcmdldCkgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgY29udGV4dEluLm5hbWUsIGRlc2NyaXB0b3IpO1xyXG4gICAgZG9uZSA9IHRydWU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19ydW5Jbml0aWFsaXplcnModGhpc0FyZywgaW5pdGlhbGl6ZXJzLCB2YWx1ZSkge1xyXG4gICAgdmFyIHVzZVZhbHVlID0gYXJndW1lbnRzLmxlbmd0aCA+IDI7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGluaXRpYWxpemVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhbHVlID0gdXNlVmFsdWUgPyBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnLCB2YWx1ZSkgOiBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1c2VWYWx1ZSA/IHZhbHVlIDogdm9pZCAwO1xyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcHJvcEtleSh4KSB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHggPT09IFwic3ltYm9sXCIgPyB4IDogXCJcIi5jb25jYXQoeCk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zZXRGdW5jdGlvbk5hbWUoZiwgbmFtZSwgcHJlZml4KSB7XHJcbiAgICBpZiAodHlwZW9mIG5hbWUgPT09IFwic3ltYm9sXCIpIG5hbWUgPSBuYW1lLmRlc2NyaXB0aW9uID8gXCJbXCIuY29uY2F0KG5hbWUuZGVzY3JpcHRpb24sIFwiXVwiKSA6IFwiXCI7XHJcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGYsIFwibmFtZVwiLCB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IHByZWZpeCA/IFwiXCIuY29uY2F0KHByZWZpeCwgXCIgXCIsIG5hbWUpIDogbmFtZSB9KTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX21ldGFkYXRhKG1ldGFkYXRhS2V5LCBtZXRhZGF0YVZhbHVlKSB7XHJcbiAgICBpZiAodHlwZW9mIFJlZmxlY3QgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIFJlZmxlY3QubWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFJlZmxlY3QubWV0YWRhdGEobWV0YWRhdGFLZXksIG1ldGFkYXRhVmFsdWUpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikge1xyXG4gICAgZnVuY3Rpb24gYWRvcHQodmFsdWUpIHsgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgUCA/IHZhbHVlIDogbmV3IFAoZnVuY3Rpb24gKHJlc29sdmUpIHsgcmVzb2x2ZSh2YWx1ZSk7IH0pOyB9XHJcbiAgICByZXR1cm4gbmV3IChQIHx8IChQID0gUHJvbWlzZSkpKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gcmVqZWN0ZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3JbXCJ0aHJvd1wiXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gc3RlcChyZXN1bHQpIHsgcmVzdWx0LmRvbmUgPyByZXNvbHZlKHJlc3VsdC52YWx1ZSkgOiBhZG9wdChyZXN1bHQudmFsdWUpLnRoZW4oZnVsZmlsbGVkLCByZWplY3RlZCk7IH1cclxuICAgICAgICBzdGVwKChnZW5lcmF0b3IgPSBnZW5lcmF0b3IuYXBwbHkodGhpc0FyZywgX2FyZ3VtZW50cyB8fCBbXSkpLm5leHQoKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZ2VuZXJhdG9yKHRoaXNBcmcsIGJvZHkpIHtcclxuICAgIHZhciBfID0geyBsYWJlbDogMCwgc2VudDogZnVuY3Rpb24oKSB7IGlmICh0WzBdICYgMSkgdGhyb3cgdFsxXTsgcmV0dXJuIHRbMV07IH0sIHRyeXM6IFtdLCBvcHM6IFtdIH0sIGYsIHksIHQsIGcgPSBPYmplY3QuY3JlYXRlKCh0eXBlb2YgSXRlcmF0b3IgPT09IFwiZnVuY3Rpb25cIiA/IEl0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpO1xyXG4gICAgcmV0dXJuIGcubmV4dCA9IHZlcmIoMCksIGdbXCJ0aHJvd1wiXSA9IHZlcmIoMSksIGdbXCJyZXR1cm5cIl0gPSB2ZXJiKDIpLCB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgKGdbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSksIGc7XHJcbiAgICBmdW5jdGlvbiB2ZXJiKG4pIHsgcmV0dXJuIGZ1bmN0aW9uICh2KSB7IHJldHVybiBzdGVwKFtuLCB2XSk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHN0ZXAob3ApIHtcclxuICAgICAgICBpZiAoZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkdlbmVyYXRvciBpcyBhbHJlYWR5IGV4ZWN1dGluZy5cIik7XHJcbiAgICAgICAgd2hpbGUgKGcgJiYgKGcgPSAwLCBvcFswXSAmJiAoXyA9IDApKSwgXykgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKGYgPSAxLCB5ICYmICh0ID0gb3BbMF0gJiAyID8geVtcInJldHVyblwiXSA6IG9wWzBdID8geVtcInRocm93XCJdIHx8ICgodCA9IHlbXCJyZXR1cm5cIl0pICYmIHQuY2FsbCh5KSwgMCkgOiB5Lm5leHQpICYmICEodCA9IHQuY2FsbCh5LCBvcFsxXSkpLmRvbmUpIHJldHVybiB0O1xyXG4gICAgICAgICAgICBpZiAoeSA9IDAsIHQpIG9wID0gW29wWzBdICYgMiwgdC52YWx1ZV07XHJcbiAgICAgICAgICAgIHN3aXRjaCAob3BbMF0pIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgMDogY2FzZSAxOiB0ID0gb3A7IGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSA0OiBfLmxhYmVsKys7IHJldHVybiB7IHZhbHVlOiBvcFsxXSwgZG9uZTogZmFsc2UgfTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNTogXy5sYWJlbCsrOyB5ID0gb3BbMV07IG9wID0gWzBdOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNzogb3AgPSBfLm9wcy5wb3AoKTsgXy50cnlzLnBvcCgpOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEodCA9IF8udHJ5cywgdCA9IHQubGVuZ3RoID4gMCAmJiB0W3QubGVuZ3RoIC0gMV0pICYmIChvcFswXSA9PT0gNiB8fCBvcFswXSA9PT0gMikpIHsgXyA9IDA7IGNvbnRpbnVlOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wWzBdID09PSAzICYmICghdCB8fCAob3BbMV0gPiB0WzBdICYmIG9wWzFdIDwgdFszXSkpKSB7IF8ubGFiZWwgPSBvcFsxXTsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAob3BbMF0gPT09IDYgJiYgXy5sYWJlbCA8IHRbMV0pIHsgXy5sYWJlbCA9IHRbMV07IHQgPSBvcDsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiBfLmxhYmVsIDwgdFsyXSkgeyBfLmxhYmVsID0gdFsyXTsgXy5vcHMucHVzaChvcCk7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRbMl0pIF8ub3BzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIF8udHJ5cy5wb3AoKTsgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3AgPSBib2R5LmNhbGwodGhpc0FyZywgXyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkgeyBvcCA9IFs2LCBlXTsgeSA9IDA7IH0gZmluYWxseSB7IGYgPSB0ID0gMDsgfVxyXG4gICAgICAgIGlmIChvcFswXSAmIDUpIHRocm93IG9wWzFdOyByZXR1cm4geyB2YWx1ZTogb3BbMF0gPyBvcFsxXSA6IHZvaWQgMCwgZG9uZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fY3JlYXRlQmluZGluZyA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgbSwgaywgazIpIHtcclxuICAgIGlmIChrMiA9PT0gdW5kZWZpbmVkKSBrMiA9IGs7XHJcbiAgICB2YXIgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IobSwgayk7XHJcbiAgICBpZiAoIWRlc2MgfHwgKFwiZ2V0XCIgaW4gZGVzYyA/ICFtLl9fZXNNb2R1bGUgOiBkZXNjLndyaXRhYmxlIHx8IGRlc2MuY29uZmlndXJhYmxlKSkge1xyXG4gICAgICAgIGRlc2MgPSB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiBtW2tdOyB9IH07XHJcbiAgICB9XHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgazIsIGRlc2MpO1xyXG59KSA6IChmdW5jdGlvbihvLCBtLCBrLCBrMikge1xyXG4gICAgaWYgKGsyID09PSB1bmRlZmluZWQpIGsyID0gaztcclxuICAgIG9bazJdID0gbVtrXTtcclxufSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHBvcnRTdGFyKG0sIG8pIHtcclxuICAgIGZvciAodmFyIHAgaW4gbSkgaWYgKHAgIT09IFwiZGVmYXVsdFwiICYmICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgcCkpIF9fY3JlYXRlQmluZGluZyhvLCBtLCBwKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fdmFsdWVzKG8pIHtcclxuICAgIHZhciBzID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIFN5bWJvbC5pdGVyYXRvciwgbSA9IHMgJiYgb1tzXSwgaSA9IDA7XHJcbiAgICBpZiAobSkgcmV0dXJuIG0uY2FsbChvKTtcclxuICAgIGlmIChvICYmIHR5cGVvZiBvLmxlbmd0aCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHtcclxuICAgICAgICBuZXh0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChvICYmIGkgPj0gby5sZW5ndGgpIG8gPSB2b2lkIDA7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBvICYmIG9baSsrXSwgZG9uZTogIW8gfTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihzID8gXCJPYmplY3QgaXMgbm90IGl0ZXJhYmxlLlwiIDogXCJTeW1ib2wuaXRlcmF0b3IgaXMgbm90IGRlZmluZWQuXCIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZWFkKG8sIG4pIHtcclxuICAgIHZhciBtID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIG9bU3ltYm9sLml0ZXJhdG9yXTtcclxuICAgIGlmICghbSkgcmV0dXJuIG87XHJcbiAgICB2YXIgaSA9IG0uY2FsbChvKSwgciwgYXIgPSBbXSwgZTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgd2hpbGUgKChuID09PSB2b2lkIDAgfHwgbi0tID4gMCkgJiYgIShyID0gaS5uZXh0KCkpLmRvbmUpIGFyLnB1c2goci52YWx1ZSk7XHJcbiAgICB9XHJcbiAgICBjYXRjaCAoZXJyb3IpIHsgZSA9IHsgZXJyb3I6IGVycm9yIH07IH1cclxuICAgIGZpbmFsbHkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChyICYmICFyLmRvbmUgJiYgKG0gPSBpW1wicmV0dXJuXCJdKSkgbS5jYWxsKGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaW5hbGx5IHsgaWYgKGUpIHRocm93IGUuZXJyb3I7IH1cclxuICAgIH1cclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZCgpIHtcclxuICAgIGZvciAodmFyIGFyID0gW10sIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKVxyXG4gICAgICAgIGFyID0gYXIuY29uY2F0KF9fcmVhZChhcmd1bWVudHNbaV0pKTtcclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZEFycmF5cygpIHtcclxuICAgIGZvciAodmFyIHMgPSAwLCBpID0gMCwgaWwgPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgaWw7IGkrKykgcyArPSBhcmd1bWVudHNbaV0ubGVuZ3RoO1xyXG4gICAgZm9yICh2YXIgciA9IEFycmF5KHMpLCBrID0gMCwgaSA9IDA7IGkgPCBpbDsgaSsrKVxyXG4gICAgICAgIGZvciAodmFyIGEgPSBhcmd1bWVudHNbaV0sIGogPSAwLCBqbCA9IGEubGVuZ3RoOyBqIDwgamw7IGorKywgaysrKVxyXG4gICAgICAgICAgICByW2tdID0gYVtqXTtcclxuICAgIHJldHVybiByO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zcHJlYWRBcnJheSh0bywgZnJvbSwgcGFjaykge1xyXG4gICAgaWYgKHBhY2sgfHwgYXJndW1lbnRzLmxlbmd0aCA9PT0gMikgZm9yICh2YXIgaSA9IDAsIGwgPSBmcm9tLmxlbmd0aCwgYXI7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XHJcbiAgICAgICAgICAgIGlmICghYXIpIGFyID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSwgMCwgaSk7XHJcbiAgICAgICAgICAgIGFyW2ldID0gZnJvbVtpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdG8uY29uY2F0KGFyIHx8IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fYXdhaXQodikge1xyXG4gICAgcmV0dXJuIHRoaXMgaW5zdGFuY2VvZiBfX2F3YWl0ID8gKHRoaXMudiA9IHYsIHRoaXMpIDogbmV3IF9fYXdhaXQodik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jR2VuZXJhdG9yKHRoaXNBcmcsIF9hcmd1bWVudHMsIGdlbmVyYXRvcikge1xyXG4gICAgaWYgKCFTeW1ib2wuYXN5bmNJdGVyYXRvcikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0l0ZXJhdG9yIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgIHZhciBnID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pLCBpLCBxID0gW107XHJcbiAgICByZXR1cm4gaSA9IE9iamVjdC5jcmVhdGUoKHR5cGVvZiBBc3luY0l0ZXJhdG9yID09PSBcImZ1bmN0aW9uXCIgPyBBc3luY0l0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpLCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIsIGF3YWl0UmV0dXJuKSwgaVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0gPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzOyB9LCBpO1xyXG4gICAgZnVuY3Rpb24gYXdhaXRSZXR1cm4oZikgeyByZXR1cm4gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh2KS50aGVuKGYsIHJlamVjdCk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpZiAoZ1tuXSkgeyBpW25dID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChhLCBiKSB7IHEucHVzaChbbiwgdiwgYSwgYl0pID4gMSB8fCByZXN1bWUobiwgdik7IH0pOyB9OyBpZiAoZikgaVtuXSA9IGYoaVtuXSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gcmVzdW1lKG4sIHYpIHsgdHJ5IHsgc3RlcChnW25dKHYpKTsgfSBjYXRjaCAoZSkgeyBzZXR0bGUocVswXVszXSwgZSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gc3RlcChyKSB7IHIudmFsdWUgaW5zdGFuY2VvZiBfX2F3YWl0ID8gUHJvbWlzZS5yZXNvbHZlKHIudmFsdWUudikudGhlbihmdWxmaWxsLCByZWplY3QpIDogc2V0dGxlKHFbMF1bMl0sIHIpOyB9XHJcbiAgICBmdW5jdGlvbiBmdWxmaWxsKHZhbHVlKSB7IHJlc3VtZShcIm5leHRcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiByZWplY3QodmFsdWUpIHsgcmVzdW1lKFwidGhyb3dcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiBzZXR0bGUoZiwgdikgeyBpZiAoZih2KSwgcS5zaGlmdCgpLCBxLmxlbmd0aCkgcmVzdW1lKHFbMF1bMF0sIHFbMF1bMV0pOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jRGVsZWdhdG9yKG8pIHtcclxuICAgIHZhciBpLCBwO1xyXG4gICAgcmV0dXJuIGkgPSB7fSwgdmVyYihcIm5leHRcIiksIHZlcmIoXCJ0aHJvd1wiLCBmdW5jdGlvbiAoZSkgeyB0aHJvdyBlOyB9KSwgdmVyYihcInJldHVyblwiKSwgaVtTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfSwgaTtcclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpW25dID0gb1tuXSA/IGZ1bmN0aW9uICh2KSB7IHJldHVybiAocCA9ICFwKSA/IHsgdmFsdWU6IF9fYXdhaXQob1tuXSh2KSksIGRvbmU6IGZhbHNlIH0gOiBmID8gZih2KSA6IHY7IH0gOiBmOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jVmFsdWVzKG8pIHtcclxuICAgIGlmICghU3ltYm9sLmFzeW5jSXRlcmF0b3IpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNJdGVyYXRvciBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICB2YXIgbSA9IG9bU3ltYm9sLmFzeW5jSXRlcmF0b3JdLCBpO1xyXG4gICAgcmV0dXJuIG0gPyBtLmNhbGwobykgOiAobyA9IHR5cGVvZiBfX3ZhbHVlcyA9PT0gXCJmdW5jdGlvblwiID8gX192YWx1ZXMobykgOiBvW1N5bWJvbC5pdGVyYXRvcl0oKSwgaSA9IHt9LCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIpLCBpW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXM7IH0sIGkpO1xyXG4gICAgZnVuY3Rpb24gdmVyYihuKSB7IGlbbl0gPSBvW25dICYmIGZ1bmN0aW9uICh2KSB7IHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHYgPSBvW25dKHYpLCBzZXR0bGUocmVzb2x2ZSwgcmVqZWN0LCB2LmRvbmUsIHYudmFsdWUpOyB9KTsgfTsgfVxyXG4gICAgZnVuY3Rpb24gc2V0dGxlKHJlc29sdmUsIHJlamVjdCwgZCwgdikgeyBQcm9taXNlLnJlc29sdmUodikudGhlbihmdW5jdGlvbih2KSB7IHJlc29sdmUoeyB2YWx1ZTogdiwgZG9uZTogZCB9KTsgfSwgcmVqZWN0KTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19tYWtlVGVtcGxhdGVPYmplY3QoY29va2VkLCByYXcpIHtcclxuICAgIGlmIChPYmplY3QuZGVmaW5lUHJvcGVydHkpIHsgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvb2tlZCwgXCJyYXdcIiwgeyB2YWx1ZTogcmF3IH0pOyB9IGVsc2UgeyBjb29rZWQucmF3ID0gcmF3OyB9XHJcbiAgICByZXR1cm4gY29va2VkO1xyXG59O1xyXG5cclxudmFyIF9fc2V0TW9kdWxlRGVmYXVsdCA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgdikge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sIFwiZGVmYXVsdFwiLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2IH0pO1xyXG59KSA6IGZ1bmN0aW9uKG8sIHYpIHtcclxuICAgIG9bXCJkZWZhdWx0XCJdID0gdjtcclxufTtcclxuXHJcbnZhciBvd25LZXlzID0gZnVuY3Rpb24obykge1xyXG4gICAgb3duS2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzIHx8IGZ1bmN0aW9uIChvKSB7XHJcbiAgICAgICAgdmFyIGFyID0gW107XHJcbiAgICAgICAgZm9yICh2YXIgayBpbiBvKSBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIGspKSBhclthci5sZW5ndGhdID0gaztcclxuICAgICAgICByZXR1cm4gYXI7XHJcbiAgICB9O1xyXG4gICAgcmV0dXJuIG93bktleXMobyk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19pbXBvcnRTdGFyKG1vZCkge1xyXG4gICAgaWYgKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgcmV0dXJuIG1vZDtcclxuICAgIHZhciByZXN1bHQgPSB7fTtcclxuICAgIGlmIChtb2QgIT0gbnVsbCkgZm9yICh2YXIgayA9IG93bktleXMobW9kKSwgaSA9IDA7IGkgPCBrLmxlbmd0aDsgaSsrKSBpZiAoa1tpXSAhPT0gXCJkZWZhdWx0XCIpIF9fY3JlYXRlQmluZGluZyhyZXN1bHQsIG1vZCwga1tpXSk7XHJcbiAgICBfX3NldE1vZHVsZURlZmF1bHQocmVzdWx0LCBtb2QpO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9faW1wb3J0RGVmYXVsdChtb2QpIHtcclxuICAgIHJldHVybiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSA/IG1vZCA6IHsgZGVmYXVsdDogbW9kIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2NsYXNzUHJpdmF0ZUZpZWxkR2V0KHJlY2VpdmVyLCBzdGF0ZSwga2luZCwgZikge1xyXG4gICAgaWYgKGtpbmQgPT09IFwiYVwiICYmICFmKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBhY2Nlc3NvciB3YXMgZGVmaW5lZCB3aXRob3V0IGEgZ2V0dGVyXCIpO1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gXCJmdW5jdGlvblwiID8gcmVjZWl2ZXIgIT09IHN0YXRlIHx8ICFmIDogIXN0YXRlLmhhcyhyZWNlaXZlcikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgcmVhZCBwcml2YXRlIG1lbWJlciBmcm9tIGFuIG9iamVjdCB3aG9zZSBjbGFzcyBkaWQgbm90IGRlY2xhcmUgaXRcIik7XHJcbiAgICByZXR1cm4ga2luZCA9PT0gXCJtXCIgPyBmIDoga2luZCA9PT0gXCJhXCIgPyBmLmNhbGwocmVjZWl2ZXIpIDogZiA/IGYudmFsdWUgOiBzdGF0ZS5nZXQocmVjZWl2ZXIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZFNldChyZWNlaXZlciwgc3RhdGUsIHZhbHVlLCBraW5kLCBmKSB7XHJcbiAgICBpZiAoa2luZCA9PT0gXCJtXCIpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQcml2YXRlIG1ldGhvZCBpcyBub3Qgd3JpdGFibGVcIik7XHJcbiAgICBpZiAoa2luZCA9PT0gXCJhXCIgJiYgIWYpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQcml2YXRlIGFjY2Vzc29yIHdhcyBkZWZpbmVkIHdpdGhvdXQgYSBzZXR0ZXJcIik7XHJcbiAgICBpZiAodHlwZW9mIHN0YXRlID09PSBcImZ1bmN0aW9uXCIgPyByZWNlaXZlciAhPT0gc3RhdGUgfHwgIWYgOiAhc3RhdGUuaGFzKHJlY2VpdmVyKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCB3cml0ZSBwcml2YXRlIG1lbWJlciB0byBhbiBvYmplY3Qgd2hvc2UgY2xhc3MgZGlkIG5vdCBkZWNsYXJlIGl0XCIpO1xyXG4gICAgcmV0dXJuIChraW5kID09PSBcImFcIiA/IGYuY2FsbChyZWNlaXZlciwgdmFsdWUpIDogZiA/IGYudmFsdWUgPSB2YWx1ZSA6IHN0YXRlLnNldChyZWNlaXZlciwgdmFsdWUpKSwgdmFsdWU7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2NsYXNzUHJpdmF0ZUZpZWxkSW4oc3RhdGUsIHJlY2VpdmVyKSB7XHJcbiAgICBpZiAocmVjZWl2ZXIgPT09IG51bGwgfHwgKHR5cGVvZiByZWNlaXZlciAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgcmVjZWl2ZXIgIT09IFwiZnVuY3Rpb25cIikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgdXNlICdpbicgb3BlcmF0b3Igb24gbm9uLW9iamVjdFwiKTtcclxuICAgIHJldHVybiB0eXBlb2Ygc3RhdGUgPT09IFwiZnVuY3Rpb25cIiA/IHJlY2VpdmVyID09PSBzdGF0ZSA6IHN0YXRlLmhhcyhyZWNlaXZlcik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZShlbnYsIHZhbHVlLCBhc3luYykge1xyXG4gICAgaWYgKHZhbHVlICE9PSBudWxsICYmIHZhbHVlICE9PSB2b2lkIDApIHtcclxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0IGV4cGVjdGVkLlwiKTtcclxuICAgICAgICB2YXIgZGlzcG9zZSwgaW5uZXI7XHJcbiAgICAgICAgaWYgKGFzeW5jKSB7XHJcbiAgICAgICAgICAgIGlmICghU3ltYm9sLmFzeW5jRGlzcG9zZSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0Rpc3Bvc2UgaXMgbm90IGRlZmluZWQuXCIpO1xyXG4gICAgICAgICAgICBkaXNwb3NlID0gdmFsdWVbU3ltYm9sLmFzeW5jRGlzcG9zZV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkaXNwb3NlID09PSB2b2lkIDApIHtcclxuICAgICAgICAgICAgaWYgKCFTeW1ib2wuZGlzcG9zZSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5kaXNwb3NlIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgICAgICAgICAgZGlzcG9zZSA9IHZhbHVlW1N5bWJvbC5kaXNwb3NlXTtcclxuICAgICAgICAgICAgaWYgKGFzeW5jKSBpbm5lciA9IGRpc3Bvc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh0eXBlb2YgZGlzcG9zZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0IG5vdCBkaXNwb3NhYmxlLlwiKTtcclxuICAgICAgICBpZiAoaW5uZXIpIGRpc3Bvc2UgPSBmdW5jdGlvbigpIHsgdHJ5IHsgaW5uZXIuY2FsbCh0aGlzKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gUHJvbWlzZS5yZWplY3QoZSk7IH0gfTtcclxuICAgICAgICBlbnYuc3RhY2sucHVzaCh7IHZhbHVlOiB2YWx1ZSwgZGlzcG9zZTogZGlzcG9zZSwgYXN5bmM6IGFzeW5jIH0pO1xyXG4gICAgfVxyXG4gICAgZWxzZSBpZiAoYXN5bmMpIHtcclxuICAgICAgICBlbnYuc3RhY2sucHVzaCh7IGFzeW5jOiB0cnVlIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG5cclxufVxyXG5cclxudmFyIF9TdXBwcmVzc2VkRXJyb3IgPSB0eXBlb2YgU3VwcHJlc3NlZEVycm9yID09PSBcImZ1bmN0aW9uXCIgPyBTdXBwcmVzc2VkRXJyb3IgOiBmdW5jdGlvbiAoZXJyb3IsIHN1cHByZXNzZWQsIG1lc3NhZ2UpIHtcclxuICAgIHZhciBlID0gbmV3IEVycm9yKG1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIGUubmFtZSA9IFwiU3VwcHJlc3NlZEVycm9yXCIsIGUuZXJyb3IgPSBlcnJvciwgZS5zdXBwcmVzc2VkID0gc3VwcHJlc3NlZCwgZTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2Rpc3Bvc2VSZXNvdXJjZXMoZW52KSB7XHJcbiAgICBmdW5jdGlvbiBmYWlsKGUpIHtcclxuICAgICAgICBlbnYuZXJyb3IgPSBlbnYuaGFzRXJyb3IgPyBuZXcgX1N1cHByZXNzZWRFcnJvcihlLCBlbnYuZXJyb3IsIFwiQW4gZXJyb3Igd2FzIHN1cHByZXNzZWQgZHVyaW5nIGRpc3Bvc2FsLlwiKSA6IGU7XHJcbiAgICAgICAgZW52Lmhhc0Vycm9yID0gdHJ1ZTtcclxuICAgIH1cclxuICAgIHZhciByLCBzID0gMDtcclxuICAgIGZ1bmN0aW9uIG5leHQoKSB7XHJcbiAgICAgICAgd2hpbGUgKHIgPSBlbnYuc3RhY2sucG9wKCkpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGlmICghci5hc3luYyAmJiBzID09PSAxKSByZXR1cm4gcyA9IDAsIGVudi5zdGFjay5wdXNoKHIpLCBQcm9taXNlLnJlc29sdmUoKS50aGVuKG5leHQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHIuZGlzcG9zZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSByLmRpc3Bvc2UuY2FsbChyLnZhbHVlKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoci5hc3luYykgcmV0dXJuIHMgfD0gMiwgUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCkudGhlbihuZXh0LCBmdW5jdGlvbihlKSB7IGZhaWwoZSk7IHJldHVybiBuZXh0KCk7IH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSBzIHw9IDE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgIGZhaWwoZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHMgPT09IDEpIHJldHVybiBlbnYuaGFzRXJyb3IgPyBQcm9taXNlLnJlamVjdChlbnYuZXJyb3IpIDogUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICAgICAgaWYgKGVudi5oYXNFcnJvcikgdGhyb3cgZW52LmVycm9yO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5leHQoKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uKHBhdGgsIHByZXNlcnZlSnN4KSB7XHJcbiAgICBpZiAodHlwZW9mIHBhdGggPT09IFwic3RyaW5nXCIgJiYgL15cXC5cXC4/XFwvLy50ZXN0KHBhdGgpKSB7XHJcbiAgICAgICAgcmV0dXJuIHBhdGgucmVwbGFjZSgvXFwuKHRzeCkkfCgoPzpcXC5kKT8pKCg/OlxcLlteLi9dKz8pPylcXC4oW2NtXT8pdHMkL2ksIGZ1bmN0aW9uIChtLCB0c3gsIGQsIGV4dCwgY20pIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRzeCA/IHByZXNlcnZlSnN4ID8gXCIuanN4XCIgOiBcIi5qc1wiIDogZCAmJiAoIWV4dCB8fCAhY20pID8gbSA6IChkICsgZXh0ICsgXCIuXCIgKyBjbS50b0xvd2VyQ2FzZSgpICsgXCJqc1wiKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXRoO1xyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCB7XHJcbiAgICBfX2V4dGVuZHM6IF9fZXh0ZW5kcyxcclxuICAgIF9fYXNzaWduOiBfX2Fzc2lnbixcclxuICAgIF9fcmVzdDogX19yZXN0LFxyXG4gICAgX19kZWNvcmF0ZTogX19kZWNvcmF0ZSxcclxuICAgIF9fcGFyYW06IF9fcGFyYW0sXHJcbiAgICBfX2VzRGVjb3JhdGU6IF9fZXNEZWNvcmF0ZSxcclxuICAgIF9fcnVuSW5pdGlhbGl6ZXJzOiBfX3J1bkluaXRpYWxpemVycyxcclxuICAgIF9fcHJvcEtleTogX19wcm9wS2V5LFxyXG4gICAgX19zZXRGdW5jdGlvbk5hbWU6IF9fc2V0RnVuY3Rpb25OYW1lLFxyXG4gICAgX19tZXRhZGF0YTogX19tZXRhZGF0YSxcclxuICAgIF9fYXdhaXRlcjogX19hd2FpdGVyLFxyXG4gICAgX19nZW5lcmF0b3I6IF9fZ2VuZXJhdG9yLFxyXG4gICAgX19jcmVhdGVCaW5kaW5nOiBfX2NyZWF0ZUJpbmRpbmcsXHJcbiAgICBfX2V4cG9ydFN0YXI6IF9fZXhwb3J0U3RhcixcclxuICAgIF9fdmFsdWVzOiBfX3ZhbHVlcyxcclxuICAgIF9fcmVhZDogX19yZWFkLFxyXG4gICAgX19zcHJlYWQ6IF9fc3ByZWFkLFxyXG4gICAgX19zcHJlYWRBcnJheXM6IF9fc3ByZWFkQXJyYXlzLFxyXG4gICAgX19zcHJlYWRBcnJheTogX19zcHJlYWRBcnJheSxcclxuICAgIF9fYXdhaXQ6IF9fYXdhaXQsXHJcbiAgICBfX2FzeW5jR2VuZXJhdG9yOiBfX2FzeW5jR2VuZXJhdG9yLFxyXG4gICAgX19hc3luY0RlbGVnYXRvcjogX19hc3luY0RlbGVnYXRvcixcclxuICAgIF9fYXN5bmNWYWx1ZXM6IF9fYXN5bmNWYWx1ZXMsXHJcbiAgICBfX21ha2VUZW1wbGF0ZU9iamVjdDogX19tYWtlVGVtcGxhdGVPYmplY3QsXHJcbiAgICBfX2ltcG9ydFN0YXI6IF9faW1wb3J0U3RhcixcclxuICAgIF9faW1wb3J0RGVmYXVsdDogX19pbXBvcnREZWZhdWx0LFxyXG4gICAgX19jbGFzc1ByaXZhdGVGaWVsZEdldDogX19jbGFzc1ByaXZhdGVGaWVsZEdldCxcclxuICAgIF9fY2xhc3NQcml2YXRlRmllbGRTZXQ6IF9fY2xhc3NQcml2YXRlRmllbGRTZXQsXHJcbiAgICBfX2NsYXNzUHJpdmF0ZUZpZWxkSW46IF9fY2xhc3NQcml2YXRlRmllbGRJbixcclxuICAgIF9fYWRkRGlzcG9zYWJsZVJlc291cmNlOiBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZSxcclxuICAgIF9fZGlzcG9zZVJlc291cmNlczogX19kaXNwb3NlUmVzb3VyY2VzLFxyXG4gICAgX19yZXdyaXRlUmVsYXRpdmVJbXBvcnRFeHRlbnNpb246IF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uLFxyXG59O1xyXG4iLCJpbXBvcnQge1xuICBBcHAsXG4gIE5vdGljZSxcbiAgcGFyc2VZYW1sLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIHN0cmluZ2lmeVlhbWwsXG4gIFdvcmtzcGFjZUxlYWZcbn0gZnJvbSAnb2JzaWRpYW4nO1xuXG5pbnRlcmZhY2UgS2FuYmFuU3RhdHVzVXBkYXRlclNldHRpbmdzIHtcbiAgc3RhdHVzUHJvcGVydHlOYW1lOiBzdHJpbmc7XG4gIHNob3dOb3RpZmljYXRpb25zOiBib29sZWFuO1xuICBkZWJ1Z01vZGU6IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IEthbmJhblN0YXR1c1VwZGF0ZXJTZXR0aW5ncyA9IHtcbiAgc3RhdHVzUHJvcGVydHlOYW1lOiAnc3RhdHVzJyxcbiAgc2hvd05vdGlmaWNhdGlvbnM6IHRydWUsXG4gIGRlYnVnTW9kZTogZmFsc2UgIC8vIERlZmF1bHQgdG8gZmFsc2UgZm9yIGJldHRlciBwZXJmb3JtYW5jZVxufVxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBLYW5iYW5TdGF0dXNVcGRhdGVyUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IEthbmJhblN0YXR1c1VwZGF0ZXJTZXR0aW5ncztcbiAgc3RhdHVzQmFySXRlbTogSFRNTEVsZW1lbnQ7XG4gIFxuICAvLyBUcmFjayBhY3RpdmUgb2JzZXJ2ZXJzIHRvIGRpc2Nvbm5lY3QgdGhlbSB3aGVuIG5vdCBuZWVkZWRcbiAgcHJpdmF0ZSBjdXJyZW50T2JzZXJ2ZXI6IE11dGF0aW9uT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBpc1Byb2Nlc3NpbmcgPSBmYWxzZTtcbiAgcHJpdmF0ZSBhY3RpdmVLYW5iYW5Cb2FyZDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICAgIGNvbnNvbGUubG9nKCdMb2FkaW5nIEthbmJhbiBTdGF0dXMgVXBkYXRlciBwbHVnaW4nKTtcbiAgICAgIFxuICAgICAgLy8gTG9hZCBzZXR0aW5nc1xuICAgICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICAgIFxuICAgICAgLy8gQWRkIHN0YXR1cyBiYXIgaXRlbVxuICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gdGhpcy5hZGRTdGF0dXNCYXJJdGVtKCk7XG4gICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uc2V0VGV4dCgnS1NVOiBJZGxlJyk7XG4gICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uYWRkQ2xhc3MoJ2thbmJhbi1zdGF0dXMtdXBkYXRlci1zdGF0dXNiYXInKTtcbiAgICAgIFxuICAgICAgLy8gRGlzcGxheSBzdGFydHVwIG5vdGlmaWNhdGlvblxuICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd05vdGlmaWNhdGlvbnMpIHtcbiAgICAgICAgICBuZXcgTm90aWNlKCdLYW5iYW4gU3RhdHVzIFVwZGF0ZXIgYWN0aXZhdGVkJyk7XG4gICAgICB9XG4gICAgICB0aGlzLmxvZygnUGx1Z2luIGxvYWRlZCcpO1xuICAgICAgXG4gICAgICAvLyBSZWdpc3RlciBET00gZXZlbnQgbGlzdGVuZXIgZm9yIGRyYWcgZXZlbnRzIC0gYnV0IG9ubHkgcHJvY2VzcyBpZiBhY3RpdmUgbGVhZiBpcyBLYW5iYW5cbiAgICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgJ2RyYWdlbmQnLCB0aGlzLm9uRHJhZ0VuZC5iaW5kKHRoaXMpKTtcbiAgICAgIHRoaXMubG9nKCdSZWdpc3RlcmVkIGRyYWcgZXZlbnQgbGlzdGVuZXInKTtcbiAgICAgIFxuICAgICAgLy8gV2F0Y2ggZm9yIGFjdGl2ZSBsZWFmIGNoYW5nZXMgdG8gb25seSBvYnNlcnZlIHRoZSBjdXJyZW50IEthbmJhbiBib2FyZFxuICAgICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbignYWN0aXZlLWxlYWYtY2hhbmdlJywgdGhpcy5vbkFjdGl2ZUxlYWZDaGFuZ2UuYmluZCh0aGlzKSlcbiAgICAgICk7XG4gICAgICBcbiAgICAgIC8vIEluaXRpYWwgY2hlY2sgZm9yIGFjdGl2ZSBLYW5iYW4gYm9hcmRcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICAgICAgICB0aGlzLmNoZWNrRm9yQWN0aXZlS2FuYmFuQm9hcmQoKTtcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICAvLyBBZGQgc2V0dGluZ3MgdGFiXG4gICAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IEthbmJhblN0YXR1c1VwZGF0ZXJTZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gIH1cbiAgXG4gIG9udW5sb2FkKCkge1xuICAgICAgLy8gRGlzY29ubmVjdCBhbnkgYWN0aXZlIG9ic2VydmVycyB0byBwcmV2ZW50IG1lbW9yeSBsZWFrc1xuICAgICAgdGhpcy5kaXNjb25uZWN0T2JzZXJ2ZXJzKCk7XG4gICAgICB0aGlzLmxvZygnUGx1Z2luIHVubG9hZGVkJyk7XG4gIH1cbiAgXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcbiAgICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICB9XG4gIFxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICB9XG4gIFxuICAvLyBMb2cgaGVscGVyIHdpdGggZGVidWcgbW9kZSBjaGVja1xuICBsb2cobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy5kZWJ1Z01vZGUpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyhgW0tTVV0gJHttZXNzYWdlfWApO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFVwZGF0ZSBzdGF0dXMgYmFyXG4gICAgICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLnNldFRleHQoYEtTVTogJHttZXNzYWdlLnN1YnN0cmluZygwLCAyNSl9JHttZXNzYWdlLmxlbmd0aCA+IDI1ID8gJy4uLicgOiAnJ31gKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBSZXNldCBzdGF0dXMgYmFyIGFmdGVyIDMgc2Vjb25kcyBpZiBubyBvdGhlciBsb2dzIGhhcHBlblxuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICBpZiAodGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCkge1xuICAgICAgICAgICAgICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLnNldFRleHQoJ0tTVTogQWN0aXZlJyk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uc2V0VGV4dCgnS1NVOiBJZGxlJyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9LCAzMDAwKTtcbiAgICAgIH1cbiAgfVxuICBcbiAgLy8gQ2xlYW4gdXAgb2JzZXJ2ZXJzIHdoZW4gc3dpdGNoaW5nIGF3YXkgZnJvbSBhIEthbmJhbiBib2FyZFxuICBkaXNjb25uZWN0T2JzZXJ2ZXJzKCkge1xuICAgICAgaWYgKHRoaXMuY3VycmVudE9ic2VydmVyKSB7XG4gICAgICAgICAgdGhpcy5sb2coJ0Rpc2Nvbm5lY3Rpbmcgb2JzZXJ2ZXIgZm9yIHBlcmZvcm1hbmNlJyk7XG4gICAgICAgICAgdGhpcy5jdXJyZW50T2JzZXJ2ZXIuZGlzY29ubmVjdCgpO1xuICAgICAgICAgIHRoaXMuY3VycmVudE9ic2VydmVyID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIHRoaXMuYWN0aXZlS2FuYmFuQm9hcmQgPSBudWxsO1xuICB9XG4gIFxuICAvLyBDaGVjayBpZiB0aGUgYWN0aXZlIGxlYWYgaXMgYSBLYW5iYW4gYm9hcmRcbiAgb25BY3RpdmVMZWFmQ2hhbmdlKGxlYWY6IFdvcmtzcGFjZUxlYWYpIHtcbiAgICAgIHRoaXMuY2hlY2tGb3JBY3RpdmVLYW5iYW5Cb2FyZCgpO1xuICB9XG4gIFxuICBjaGVja0ZvckFjdGl2ZUthbmJhbkJvYXJkKCkge1xuICAgIC8vIEZpcnN0IGRpc2Nvbm5lY3QgYW55IGV4aXN0aW5nIG9ic2VydmVyc1xuICAgIHRoaXMuZGlzY29ubmVjdE9ic2VydmVycygpO1xuICAgIFxuICAgIC8vIEdldCB0aGUgYWN0aXZlIGxlYWZcbiAgICBjb25zdCBhY3RpdmVMZWFmID0gdGhpcy5hcHAud29ya3NwYWNlLmFjdGl2ZUxlYWY7XG4gICAgaWYgKCFhY3RpdmVMZWFmKSByZXR1cm47XG4gICAgXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gRmluZCB0aGUgY29udGVudCBlbGVtZW50IHNhZmVseVxuICAgICAgICBsZXQgY29udGVudEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICAgICAgICBcbiAgICAgICAgLy8gVXNlIHR5cGUgYXNzZXJ0aW9ucyB0byBhdm9pZCBUeXBlU2NyaXB0IGVycm9yc1xuICAgICAgICBpZiAoYWN0aXZlTGVhZi52aWV3KSB7XG4gICAgICAgICAgICAvLyBUcnkgdG8gYWNjZXNzIHRoZSBjb250ZW50RWwgcHJvcGVydHkgdXNpbmcgdHlwZSBhc3NlcnRpb25cbiAgICAgICAgICAgIC8vIEB0cy1pZ25vcmUgLSBjb250ZW50RWwgZXhpc3RzIGJ1dCBtaWdodCBub3QgYmUgaW4gdHlwZSBkZWZpbml0aW9uc1xuICAgICAgICAgICAgY29udGVudEVsID0gYWN0aXZlTGVhZi52aWV3LmNvbnRlbnRFbDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgLy8gSWYgdGhhdCBkaWRuJ3Qgd29yaywgdHJ5IGFub3RoZXIgYXBwcm9hY2hcbiAgICAgICAgaWYgKCFjb250ZW50RWwpIHtcbiAgICAgICAgICAgIC8vIFRyeSB0byBnZXQgdGhlIEthbmJhbiBib2FyZCBkaXJlY3RseSBmcm9tIHRoZSBET01cbiAgICAgICAgICAgIC8vIExlYWYgY29udGFpbmVycyBoYXZlICd2aWV3LWNvbnRlbnQnIGVsZW1lbnRzIHRoYXQgY29udGFpbiB0aGUgYWN0dWFsIHZpZXdcbiAgICAgICAgICAgIGNvbnN0IHZpZXdDb250ZW50ID0gKGFjdGl2ZUxlYWYgYXMgYW55KS5jb250YWluZXJFbD8ucXVlcnlTZWxlY3RvcignLnZpZXctY29udGVudCcpO1xuICAgICAgICAgICAgaWYgKHZpZXdDb250ZW50KSB7XG4gICAgICAgICAgICAgICAgY29udGVudEVsID0gdmlld0NvbnRlbnQ7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIExhc3QgcmVzb3J0IC0gbG9vayBmb3IgS2FuYmFuIGJvYXJkcyBhbnl3aGVyZSBpbiB0aGUgd29ya3NwYWNlXG4gICAgICAgICAgICAgICAgY29udGVudEVsID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLndvcmtzcGFjZS1sZWFmLm1vZC1hY3RpdmUgLnZpZXctY29udGVudCcpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBpZiAoIWNvbnRlbnRFbCkge1xuICAgICAgICAgICAgdGhpcy5sb2coJ0NvdWxkIG5vdCBhY2Nlc3MgY29udGVudCBlbGVtZW50IGZvciBhY3RpdmUgbGVhZicpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgS2FuYmFuIGJvYXJkXG4gICAgICAgIGNvbnN0IGthbmJhbkJvYXJkID0gY29udGVudEVsLnF1ZXJ5U2VsZWN0b3IoJy5rYW5iYW4tcGx1Z2luX19ib2FyZCcpO1xuICAgICAgICBpZiAoa2FuYmFuQm9hcmQpIHtcbiAgICAgICAgICAgIHRoaXMubG9nKCdGb3VuZCBhY3RpdmUgS2FuYmFuIGJvYXJkLCBzZXR0aW5nIHVwIG9ic2VydmVyJyk7XG4gICAgICAgICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uc2V0VGV4dCgnS1NVOiBBY3RpdmUnKTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgLy8gU3RvcmUgcmVmZXJlbmNlIHRvIGFjdGl2ZSBib2FyZFxuICAgICAgICAgICAgdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCA9IGthbmJhbkJvYXJkIGFzIEhUTUxFbGVtZW50O1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTZXQgdXAgb2JzZXJ2ZXIgb25seSBmb3IgdGhpcyBib2FyZFxuICAgICAgICAgICAgdGhpcy5zZXR1cE9ic2VydmVyRm9yQm9hcmQoa2FuYmFuQm9hcmQgYXMgSFRNTEVsZW1lbnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2coJ0FjdGl2ZSBsZWFmIGlzIG5vdCBhIEthbmJhbiBib2FyZCcpO1xuICAgICAgICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLnNldFRleHQoJ0tTVTogSWRsZScpO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5sb2coYEVycm9yIGRldGVjdGluZyBLYW5iYW4gYm9hcmQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgdGhpcy5zdGF0dXNCYXJJdGVtLnNldFRleHQoJ0tTVTogRXJyb3InKTtcbiAgICB9XG4gIH1cbiAgXG4gIHNldHVwT2JzZXJ2ZXJGb3JCb2FyZChib2FyZEVsZW1lbnQ6IEhUTUxFbGVtZW50KSB7XG4gICAgICAvLyBDcmVhdGUgYSBuZXcgb2JzZXJ2ZXIgZm9yIHRoaXMgc3BlY2lmaWMgYm9hcmRcbiAgICAgIHRoaXMuY3VycmVudE9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIoKG11dGF0aW9ucykgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLmlzUHJvY2Vzc2luZykgcmV0dXJuO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFNpbXBsZSBkZWJvdW5jZSB0byBwcmV2ZW50IHJhcGlkLWZpcmUgcHJvY2Vzc2luZ1xuICAgICAgICAgIHRoaXMuaXNQcm9jZXNzaW5nID0gdHJ1ZTtcbiAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5oYW5kbGVNdXRhdGlvbnMobXV0YXRpb25zKTtcbiAgICAgICAgICAgICAgdGhpcy5pc1Byb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICAgICAgICB9LCAzMDApO1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIC8vIE9ic2VydmUgb25seSB0aGlzIGJvYXJkIHdpdGggbWluaW1hbCBvcHRpb25zIG5lZWRlZFxuICAgICAgdGhpcy5jdXJyZW50T2JzZXJ2ZXIub2JzZXJ2ZShib2FyZEVsZW1lbnQsIHtcbiAgICAgICAgICBjaGlsZExpc3Q6IHRydWUsXG4gICAgICAgICAgc3VidHJlZTogdHJ1ZSxcbiAgICAgICAgICBhdHRyaWJ1dGVzOiBmYWxzZSAvLyBEb24ndCBuZWVkIGF0dHJpYnV0ZSBjaGFuZ2VzIGZvciBwZXJmb3JtYW5jZVxuICAgICAgfSk7XG4gICAgICBcbiAgICAgIHRoaXMubG9nKCdPYnNlcnZlciBzZXQgdXAgZm9yIGFjdGl2ZSBLYW5iYW4gYm9hcmQnKTtcbiAgfVxuICBcbiAgaGFuZGxlTXV0YXRpb25zKG11dGF0aW9uczogTXV0YXRpb25SZWNvcmRbXSkge1xuICAgIGlmICghdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCkgcmV0dXJuO1xuICAgIFxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1heF9tdXRhdGlvbnMgPSAxMDtcbiAgICAgICAgLy8gT25seSBwcm9jZXNzIGEgc2FtcGxlIG9mIG11dGF0aW9ucyBmb3IgcGVyZm9ybWFuY2VcbiAgICAgICAgY29uc3QgbXV0YXRpb25zVG9Qcm9jZXNzID0gbXV0YXRpb25zLmxlbmd0aCA+IG1heF9tdXRhdGlvbnMgPyBcbiAgICAgICAgICAgIG11dGF0aW9ucy5zbGljZSgwLCBtYXhfbXV0YXRpb25zKSA6IG11dGF0aW9ucztcbiAgICAgICAgICAgIFxuICAgICAgICB0aGlzLmxvZyhgR290ICR7bXV0YXRpb25zVG9Qcm9jZXNzLmxlbmd0aH0gbXV0YXRpb25zIG9mICR7bXV0YXRpb25zLmxlbmd0aH1gKTtcbiAgICAgICAgXG4gICAgICAgIC8vIExvb2sgZm9yIEthbmJhbiBpdGVtcyBpbiBtdXRhdGlvblxuICAgICAgICBsZXQgaSA9IDA7XG4gICAgICAgIGZvciAoY29uc3QgbXV0YXRpb24gb2YgbXV0YXRpb25zVG9Qcm9jZXNzKSB7XG4gICAgICAgICAgICB0aGlzLmxvZyhgTXV0YXRpb24gIyR7KytpfSAtIFR5cGU6ICR7bXV0YXRpb24udHlwZX1gKTtcbiAgICAgICAgICAgIGlmIChtdXRhdGlvbi50eXBlID09PSAnY2hpbGRMaXN0Jykge1xuICAgICAgICAgICAgICAgIC8vIENoZWNrIGFkZGVkIG5vZGVzIGZvciBLYW5iYW4gaXRlbXNcbiAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IG5vZGUgb2YgQXJyYXkuZnJvbShtdXRhdGlvbi5hZGRlZE5vZGVzKSkge1xuICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgbm9kZSBpcyBhbnkga2luZCBvZiBFbGVtZW50IChIVE1MIG9yIFNWRylcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgRWxlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nKGBQcm9jZXNzaW5nIEVsZW1lbnQgb2YgdHlwZTogJHtub2RlLnRhZ05hbWV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gSGFuZGxlIHRoZSBub2RlIGFjY29yZGluZyB0byBpdHMgdHlwZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChub2RlIGluc3RhbmNlb2YgSFRNTEVsZW1lbnQgfHwgbm9kZSBpbnN0YW5jZW9mIEhUTUxEaXZFbGVtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIERpcmVjdCBwcm9jZXNzaW5nIGZvciBIVE1MIGVsZW1lbnRzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nKGBGb3VuZCBIVE1MIGVsZW1lbnQgb2YgdHlwZSAke25vZGUuY2xhc3NOYW1lfWApO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NFbGVtZW50KG5vZGUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobm9kZSBpbnN0YW5jZW9mIFNWR0VsZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIFNWRyBlbGVtZW50cywgbG9vayBmb3IgcGFyZW50IEhUTUwgZWxlbWVudFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBwYXJlbnRFbGVtZW50ID0gbm9kZS5jbG9zZXN0KCcua2FuYmFuLXBsdWdpbl9faXRlbScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocGFyZW50RWxlbWVudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2coJ0ZvdW5kIEthbmJhbiBpdGVtIHBhcmVudCBvZiBTVkcgZWxlbWVudCcpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzRWxlbWVudChwYXJlbnRFbGVtZW50IGFzIEhUTUxFbGVtZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIExvb2sgZm9yIGFueSBrYW5iYW4gaXRlbXMgaW4gdGhlIGRvY3VtZW50IHRoYXQgbWlnaHQgaGF2ZSBjaGFuZ2VkXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBUaGlzIGlzIGZvciBjYXNlcyB3aGVyZSB0aGUgU1ZHIHVwZGF0ZSBpcyByZWxhdGVkIHRvIGEgY2FyZCBtb3ZlbWVudFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaXRlbXMgPSB0aGlzLmFjdGl2ZUthbmJhbkJvYXJkLnF1ZXJ5U2VsZWN0b3JBbGwoJy5rYW5iYW4tcGx1Z2luX19pdGVtJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXRlbXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByb2Nlc3Mgb25seSB0aGUgbW9zdCByZWNlbnRseSBtb2RpZmllZCBpdGVtXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVjZW50SXRlbXMgPSBBcnJheS5mcm9tKGl0ZW1zKS5zbGljZSgtMSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIHJlY2VudEl0ZW1zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubG9nKCdQcm9jZXNzaW5nIHJlY2VudCBpdGVtIGFmdGVyIFNWRyBjaGFuZ2UnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzRWxlbWVudChpdGVtIGFzIEhUTUxFbGVtZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG5vZGUubm9kZVR5cGUgPT09IE5vZGUuVEVYVF9OT0RFKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIHRleHQgbm9kZXMsIGNoZWNrIHRoZSBwYXJlbnQgZWxlbWVudFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudEVsZW1lbnQgPSBub2RlLnBhcmVudEVsZW1lbnQ7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBhcmVudEVsZW1lbnQgJiYgKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRFbGVtZW50LmNsYXNzTGlzdC5jb250YWlucygna2FuYmFuLXBsdWdpbl9faXRlbS10aXRsZScpIHx8XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcmVudEVsZW1lbnQuY2xvc2VzdCgnLmthbmJhbi1wbHVnaW5fX2l0ZW0nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2coJ0ZvdW5kIHRleHQgY2hhbmdlIGluIEthbmJhbiBpdGVtJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGl0ZW1FbGVtZW50ID0gcGFyZW50RWxlbWVudC5jbG9zZXN0KCcua2FuYmFuLXBsdWdpbl9faXRlbScpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoaXRlbUVsZW1lbnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc0VsZW1lbnQoaXRlbUVsZW1lbnQgYXMgSFRNTEVsZW1lbnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmxvZyhgU2tpcHBpbmcgbm9kZSB0eXBlOiAke25vZGUubm9kZVR5cGV9YCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKG5vZGVFcnJvcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2coYEVycm9yIHByb2Nlc3Npbmcgbm9kZTogJHtub2RlRXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggbmV4dCBub2RlIGV2ZW4gaWYgdGhpcyBvbmUgZmFpbHNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5sb2coJ0lnbm9yaW5nIG11dGF0aW9uIHR5cGU6ICcgKyBtdXRhdGlvbi50eXBlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMubG9nKGBFcnJvciBpbiBoYW5kbGVNdXRhdGlvbnM6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH1cbiAgXG4gIG9uRHJhZ0VuZChldmVudDogRHJhZ0V2ZW50KSB7XG4gICAgICAvLyBPbmx5IHByb2Nlc3MgaWYgd2UgaGF2ZSBhbiBhY3RpdmUgS2FuYmFuIGJvYXJkXG4gICAgICBpZiAoIXRoaXMuYWN0aXZlS2FuYmFuQm9hcmQgfHwgdGhpcy5pc1Byb2Nlc3NpbmcpIHtcbiAgICAgICAgdGhpcy5sb2coJ0RyYWcgZW5kIGRldGVjdGVkIGJ1dCBubyBhY3RpdmUgS2FuYmFuIGJvYXJkIG9yIGFscmVhZHkgcHJvY2Vzc2luZycpO1xuICAgICAgICB0aGlzLmxvZygnYWN0aXZlS2FuYmFuQm9hcmQ6ICcgKyAodGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCA/ICdZZXMnIDogJ05vJykpO1xuICAgICAgICB0aGlzLmxvZygnaXNQcm9jZXNzaW5nOiAnICsgKHRoaXMuaXNQcm9jZXNzaW5nID8gJ1llcycgOiAnTm8nKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgdHJ5IHtcbiAgICAgICAgICB0aGlzLmxvZygnRHJhZyBlbmQgZGV0ZWN0ZWQnKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBTZXQgcHJvY2Vzc2luZyBmbGFnIHRvIHByZXZlbnQgbXVsdGlwbGUgcHJvY2Vzc2luZ1xuICAgICAgICAgIHRoaXMuaXNQcm9jZXNzaW5nID0gdHJ1ZTtcbiAgICAgICAgICBcbiAgICAgICAgICBjb25zdCB0YXJnZXQgPSBldmVudC50YXJnZXQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgaWYgKCF0YXJnZXQpIHJldHVybjtcbiAgICAgICAgICBcbiAgICAgICAgICB0aGlzLnByb2Nlc3NFbGVtZW50KHRhcmdldCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nKGBFcnJvciBpbiBvbkRyYWdFbmQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgLy8gUmVzZXQgcHJvY2Vzc2luZyBmbGFnIGFmdGVyIGEgZGVsYXkgdG8gZGVib3VuY2VcbiAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5pc1Byb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICAgICAgICB9LCAzMDApO1xuICAgICAgfVxuICB9XG4gIFxuICBwcm9jZXNzRWxlbWVudChlbGVtZW50OiBIVE1MRWxlbWVudCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBPbmx5IHByb2Nlc3MgaWYgaW5zaWRlIG91ciBhY3RpdmUgS2FuYmFuIGJvYXJkXG4gICAgICAgICAgaWYgKCF0aGlzLmFjdGl2ZUthbmJhbkJvYXJkIHx8ICFlbGVtZW50LmNsb3Nlc3QoJy5rYW5iYW4tcGx1Z2luX19ib2FyZCcpKSB7XG4gICAgICAgICAgICAgIHRoaXMubG9nKCdFbGVtZW50IE5PVCBpbiBhY3RpdmUgS2FuYmFuIGJvYXJkLiBTa2lwcGluZy4nKTtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICAvLyBVc2UgZGlmZmVyZW50IHN0cmF0ZWdpZXMgdG8gZmluZCB0aGUgS2FuYmFuIGl0ZW1cbiAgICAgICAgICB0aGlzLmxvZyhcIvCfkYAgTG9va2luZyBmb3IgS2FuYmFuIGl0ZW0gZWxlbWVudFwiKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBDaGVjayBpZiBlbGVtZW50IGlzIGEgS2FuYmFuIGl0ZW0gb3IgY29udGFpbnMgb25lXG4gICAgICAgICAgY29uc3Qga2FuYmFuSXRlbSA9IGVsZW1lbnQuY2xhc3NMaXN0LmNvbnRhaW5zKCdrYW5iYW4tcGx1Z2luX19pdGVtJykgXG4gICAgICAgICAgICAgID8gZWxlbWVudFxuICAgICAgICAgICAgICA6IGVsZW1lbnQucXVlcnlTZWxlY3RvcignLmthbmJhbi1wbHVnaW5fX2l0ZW0nKTtcbiAgICAgICAgICAgICAgXG4gICAgICAgICAgaWYgKGthbmJhbkl0ZW0pIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2coYOKchSBGb3VuZCBLYW5iYW4gaXRlbTogJHtrYW5iYW5JdGVtfWApO1xuICAgICAgICAgICAgICB0aGlzLmxvZygnY2xhc3NMaXN0IG9mIGthbmJhbkl0ZW06ICcgKyBrYW5iYW5JdGVtLmNsYXNzTGlzdCk7XG4gICAgICAgICAgICAgIHRoaXMucHJvY2Vzc0thbmJhbkl0ZW0oa2FuYmFuSXRlbSBhcyBIVE1MRWxlbWVudCk7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5sb2coJ05vdCBhIEthbmJhbiBpdGVtLCBjaGVja2luZyBmb3IgcGFyZW50Jyk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gSWYgZWxlbWVudCBpcyBpbnNpZGUgYSBLYW5iYW4gaXRlbSwgZmluZCB0aGUgcGFyZW50XG4gICAgICAgICAgY29uc3QgcGFyZW50SXRlbSA9IGVsZW1lbnQuY2xvc2VzdCgnLmthbmJhbi1wbHVnaW5fX2l0ZW0nKSBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICB0aGlzLmxvZyhgUGFyZW50IGl0ZW06ICR7cGFyZW50SXRlbSA/IHBhcmVudEl0ZW0gOiAnTm90IGZvdW5kJ31gKTtcbiAgICAgICAgICBpZiAocGFyZW50SXRlbSkge1xuICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NLYW5iYW5JdGVtKHBhcmVudEl0ZW0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZyhgRXJyb3IgaW4gcHJvY2Vzc0VsZW1lbnQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgfVxuICBcbiAgcHJvY2Vzc0thbmJhbkl0ZW0oaXRlbUVsZW1lbnQ6IEhUTUxFbGVtZW50KSB7IC8vIGl0ZW1FbGVtZW50IHdpbGwgYmUgb2YgY2xhc3MgYGthbmJhbi1wbHVnaW5fX2l0ZW1gXG4gICAgICB0cnkge1xuXG4gICAgICAgICAgLy8gVE9ETzogU2VsZWN0IHRoZSB0aXRsZVxuICAgICAgICAgIGNvbnN0IGludGVybmFsTGluayA9IGl0ZW1FbGVtZW50LnF1ZXJ5U2VsZWN0b3IoJy5rYW5iYW4tcGx1Z2luX19pdGVtLXRpdGxlIC5rYW5iYW4tcGx1Z2luX19pdGVtLW1hcmtkb3duIGEuaW50ZXJuYWwtbGluaycpO1xuICAgICAgICAgIFxuICAgICAgICAgIGlmICghaW50ZXJuYWxMaW5rKSB7XG4gICAgICAgICAgICB0aGlzLmxvZygn8J+aqyBObyBpbnRlcm5hbCBsaW5rIGZvdW5kIGluIGl0ZW0nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5sb2coYEZvdW5kIGludGVybmFsIGxpbms6ICR7aW50ZXJuYWxMaW5rLnRleHRDb250ZW50fWApO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIEdldCB0aGUgbGluayBwYXRoIGZyb20gZGF0YS1ocmVmIG9yIGhyZWYgYXR0cmlidXRlXG4gICAgICAgICAgY29uc3QgbGlua1BhdGggPSBpbnRlcm5hbExpbmsuZ2V0QXR0cmlidXRlKCdkYXRhLWhyZWYnKSB8fCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgaW50ZXJuYWxMaW5rLmdldEF0dHJpYnV0ZSgnaHJlZicpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICBpZiAoIWxpbmtQYXRoKSByZXR1cm47XG4gICAgICAgICAgdGhpcy5sb2coYPCflJcgTGluayBwYXRoOiAke2xpbmtQYXRofWApO1xuXG4gICAgICAgICAgLy8gRmluZCB0aGUgbGFuZSAoY29sdW1uKSB0aGlzIGl0ZW0gaXMgaW5cbiAgICAgICAgICBjb25zdCBsYW5lID0gaXRlbUVsZW1lbnQuY2xvc2VzdCgnLmthbmJhbi1wbHVnaW5fX2xhbmUnKTtcbiAgICAgICAgICBpZiAoIWxhbmUpIHsgXG4gICAgICAgICAgICB0aGlzLmxvZygn8J+aqyBObyBsYW5lIGZvdW5kIGZvciBpdGVtJyk7XG4gICAgICAgICAgICByZXR1cm47IFxuICAgICAgICAgIH1cbiAgICAgICAgICBcbiAgICAgICAgICAvLyBHZXQgY29sdW1uIG5hbWUgZnJvbSB0aGUgbGFuZSBoZWFkZXJcbiAgICAgICAgICBjb25zdCBsYW5lSGVhZGVyID0gbGFuZS5xdWVyeVNlbGVjdG9yKCcua2FuYmFuLXBsdWdpbl9fbGFuZS1oZWFkZXItd3JhcHBlciAua2FuYmFuLXBsdWdpbl9fbGFuZS10aXRsZScpO1xuICAgICAgICAgIGlmICghbGFuZUhlYWRlcikgeyBcbiAgICAgICAgICAgIHRoaXMubG9nKCfwn5qrIE5vIGxhbmVIZWFkZXIgZm91bmQgZm9yIGl0ZW0nKTtcbiAgICAgICAgICAgIHJldHVybjsgXG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBsYW5lSGVhZGVyLnRleHRDb250ZW50LnRyaW0oKTtcbiAgICAgICAgICB0aGlzLmxvZyhg4pyFIEdvdCBsYW5lIG5hbWU6ICR7Y29sdW1uTmFtZX1gKTtcbiAgICAgICAgICBcbiAgICAgICAgICB0aGlzLmxvZyhgUHJvY2Vzc2luZyBjYXJkIHdpdGggbGluayB0byBcIiR7bGlua1BhdGh9XCIgaW4gY29sdW1uIFwiJHtjb2x1bW5OYW1lfVwiYCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVXBkYXRlIHRoZSBsaW5rZWQgbm90ZSdzIHN0YXR1c1xuICAgICAgICAgIHRoaXMudXBkYXRlTm90ZVN0YXR1cyhsaW5rUGF0aCwgY29sdW1uTmFtZSk7XG4gICAgICAgICAgXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIHRoaXMubG9nKGBFcnJvciBpbiBwcm9jZXNzS2FuYmFuSXRlbTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICB9XG4gIFxuICBhc3luYyB1cGRhdGVOb3RlU3RhdHVzKG5vdGVQYXRoOiBzdHJpbmcsIHN0YXR1czogc3RyaW5nKSB7XG4gICAgICB0cnkge1xuICAgICAgICAgIC8vIEZpbmQgdGhlIGxpbmtlZCBmaWxlXG4gICAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3Qobm90ZVBhdGgsICcnKTtcbiAgICAgICAgICBcbiAgICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd05vdGlmaWNhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoYOKaoO+4jyBOb3RlIFwiJHtub3RlUGF0aH1cIiBub3QgZm91bmRgLCAzMDAwKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIC8vIFJlYWQgdGhlIGZpbGUgY29udGVudFxuICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIENoZWNrIGZvciBleGlzdGluZyBmcm9udG1hdHRlclxuICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyUmVnZXggPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLS87XG4gICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJNYXRjaCA9IGNvbnRlbnQubWF0Y2goZnJvbnRtYXR0ZXJSZWdleCk7XG4gICAgICAgICAgXG4gICAgICAgICAgbGV0IG5ld0NvbnRlbnQ7XG4gICAgICAgICAgbGV0IG9sZFN0YXR1cyA9IG51bGw7XG4gICAgICAgICAgXG4gICAgICAgICAgaWYgKGZyb250bWF0dGVyTWF0Y2gpIHtcbiAgICAgICAgICAgICAgLy8gRmlsZSBoYXMgZnJvbnRtYXR0ZXJcbiAgICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJUZXh0ID0gZnJvbnRtYXR0ZXJNYXRjaFsxXTtcbiAgICAgICAgICAgICAgbGV0IGZyb250bWF0dGVyT2JqO1xuICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIC8vIFRyeSB0byBwYXJzZSB0aGUgZnJvbnRtYXR0ZXJcbiAgICAgICAgICAgICAgICAgIGZyb250bWF0dGVyT2JqID0gcGFyc2VZYW1sKGZyb250bWF0dGVyVGV4dCk7XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHN0YXR1cyBwcm9wZXJ0eSBhbHJlYWR5IGV4aXN0c1xuICAgICAgICAgICAgICAgICAgaWYgKGZyb250bWF0dGVyT2JqW3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lXSkge1xuICAgICAgICAgICAgICAgICAgICAgIG9sZFN0YXR1cyA9IGZyb250bWF0dGVyT2JqW3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lXTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICB0aGlzLmxvZyhgRXJyb3IgcGFyc2luZyBmcm9udG1hdHRlcjogJHtlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgICAgICAgICBmcm9udG1hdHRlck9iaiA9IHt9O1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAvLyBPbmx5IHVwZGF0ZSBpZiBzdGF0dXMgaGFzIGNoYW5nZWRcbiAgICAgICAgICAgICAgaWYgKGZyb250bWF0dGVyT2JqW3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lXSAhPT0gc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAvLyBVcGRhdGUgdGhlIHN0YXR1cyBwcm9wZXJ0eVxuICAgICAgICAgICAgICAgICAgZnJvbnRtYXR0ZXJPYmpbdGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWVdID0gc3RhdHVzO1xuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAvLyBHZW5lcmF0ZSBuZXcgZnJvbnRtYXR0ZXIgdGV4dFxuICAgICAgICAgICAgICAgICAgY29uc3QgbmV3RnJvbnRtYXR0ZXJUZXh0ID0gc3RyaW5naWZ5WWFtbChmcm9udG1hdHRlck9iaik7XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgIC8vIFJlcGxhY2UgdGhlIGZyb250bWF0dGVyIGluIHRoZSBjb250ZW50XG4gICAgICAgICAgICAgICAgICBuZXdDb250ZW50ID0gY29udGVudC5yZXBsYWNlKGZyb250bWF0dGVyUmVnZXgsIGAtLS1cXG4ke25ld0Zyb250bWF0dGVyVGV4dH0tLS1gKTtcbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgLy8gU2F2ZSB0aGUgbW9kaWZpZWQgY29udGVudFxuICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIG5ld0NvbnRlbnQpO1xuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAvLyBTaG93IG5vdGlmaWNhdGlvbiBpZiBlbmFibGVkXG4gICAgICAgICAgICAgICAgICBpZiAodGhpcy5zZXR0aW5ncy5zaG93Tm90aWZpY2F0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgIGlmIChvbGRTdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZShgVXBkYXRlZCAke3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lfTogXCIke29sZFN0YXR1c31cIiDihpIgXCIke3N0YXR1c31cIiBmb3IgJHtmaWxlLmJhc2VuYW1lfWAsIDMwMDApO1xuICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoYFNldCAke3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lfTogXCIke3N0YXR1c31cIiBmb3IgJHtmaWxlLmJhc2VuYW1lfWAsIDMwMDApO1xuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgdGhpcy5sb2coYFVwZGF0ZWQgc3RhdHVzIGZvciAke2ZpbGUuYmFzZW5hbWV9IHRvIFwiJHtzdGF0dXN9XCJgKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMubG9nKGBTdGF0dXMgYWxyZWFkeSBzZXQgdG8gXCIke3N0YXR1c31cIiBmb3IgJHtmaWxlLmJhc2VuYW1lfSwgc2tpcHBpbmcgdXBkYXRlYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAvLyBGaWxlIGhhcyBubyBmcm9udG1hdHRlciwgY3JlYXRlIGl0XG4gICAgICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyT2JqID0ge1xuICAgICAgICAgICAgICAgICAgW3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lXTogc3RhdHVzXG4gICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgIFxuICAgICAgICAgICAgICBjb25zdCBmcm9udG1hdHRlclRleHQgPSBzdHJpbmdpZnlZYW1sKGZyb250bWF0dGVyT2JqKTtcbiAgICAgICAgICAgICAgbmV3Q29udGVudCA9IGAtLS1cXG4ke2Zyb250bWF0dGVyVGV4dH0tLS1cXG5cXG4ke2NvbnRlbnR9YDtcbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIC8vIFNhdmUgdGhlIG1vZGlmaWVkIGNvbnRlbnRcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIG5ld0NvbnRlbnQpO1xuICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgLy8gU2hvdyBub3RpZmljYXRpb24gaWYgZW5hYmxlZFxuICAgICAgICAgICAgICBpZiAodGhpcy5zZXR0aW5ncy5zaG93Tm90aWZpY2F0aW9ucykge1xuICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZShgQWRkZWQgJHt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZX06IFwiJHtzdGF0dXN9XCIgdG8gJHtmaWxlLmJhc2VuYW1lfWAsIDMwMDApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIFxuICAgICAgICAgICAgICB0aGlzLmxvZyhgQWRkZWQgZnJvbnRtYXR0ZXIgd2l0aCBzdGF0dXMgdG8gJHtmaWxlLmJhc2VuYW1lfWApO1xuICAgICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2coYEVycm9yIHVwZGF0aW5nIG5vdGUgc3RhdHVzOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgaWYgKHRoaXMuc2V0dGluZ3Muc2hvd05vdGlmaWNhdGlvbnMpIHtcbiAgICAgICAgICAgICAgbmV3IE5vdGljZShg4pqg77iPIEVycm9yIHVwZGF0aW5nIHN0YXR1czogJHtlcnJvci5tZXNzYWdlfWAsIDMwMDApO1xuICAgICAgICAgIH1cbiAgICAgIH1cbiAgfVxuICBcbiAgLy8gTWV0aG9kIGZvciB0aGUgdGVzdCBidXR0b24gdG8gdXNlXG4gIHJ1blRlc3QoKSB7XG4gICAgICB0aGlzLmxvZygnUnVubmluZyB0ZXN0Li4uJyk7XG4gICAgICBcbiAgICAgIC8vIE1ha2Ugc3VyZSB3ZSdyZSB1c2luZyB0aGUgY3VycmVudCBhY3RpdmUgYm9hcmRcbiAgICAgIHRoaXMuY2hlY2tGb3JBY3RpdmVLYW5iYW5Cb2FyZCgpO1xuICAgICAgXG4gICAgICBpZiAoIXRoaXMuYWN0aXZlS2FuYmFuQm9hcmQpIHtcbiAgICAgICAgICBuZXcgTm90aWNlKCfimqDvuI8gTm8gYWN0aXZlIEthbmJhbiBib2FyZCBmb3VuZCAtIG9wZW4gYSBLYW5iYW4gYm9hcmQgZmlyc3QnLCA1MDAwKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIEZpbmQgaXRlbXMgaW4gdGhlIGFjdGl2ZSBib2FyZFxuICAgICAgY29uc3QgaXRlbXMgPSB0aGlzLmFjdGl2ZUthbmJhbkJvYXJkLnF1ZXJ5U2VsZWN0b3JBbGwoJy5rYW5iYW4tcGx1Z2luX19pdGVtJyk7XG4gICAgICBjb25zdCBjb3VudCA9IGl0ZW1zLmxlbmd0aDtcbiAgICAgIFxuICAgICAgbmV3IE5vdGljZShgRm91bmQgJHtjb3VudH0gY2FyZHMgaW4gYWN0aXZlIEthbmJhbiBib2FyZGAsIDMwMDApO1xuICAgICAgXG4gICAgICBpZiAoY291bnQgPiAwKSB7XG4gICAgICAgICAgLy8gUHJvY2VzcyB0aGUgZmlyc3QgaXRlbSB3aXRoIGEgbGlua1xuICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY291bnQ7IGkrKykge1xuICAgICAgICAgICAgICBjb25zdCBpdGVtID0gaXRlbXNbaV0gYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgICAgIGlmIChpdGVtLnF1ZXJ5U2VsZWN0b3IoJ2EuaW50ZXJuYWwtbGluaycpKSB7XG4gICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKGBUZXN0aW5nIHdpdGggY2FyZDogXCIke2l0ZW0udGV4dENvbnRlbnQuc3Vic3RyaW5nKDAsIDIwKX0uLi5cImAsIDMwMDApO1xuICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzS2FuYmFuSXRlbShpdGVtKTtcbiAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgfVxuICB9XG59XG5cbmNsYXNzIEthbmJhblN0YXR1c1VwZGF0ZXJTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogS2FuYmFuU3RhdHVzVXBkYXRlclBsdWdpbjtcbiAgXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IEthbmJhblN0YXR1c1VwZGF0ZXJQbHVnaW4pIHtcbiAgICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG4gIFxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgICAgY29uc3Qge2NvbnRhaW5lckVsfSA9IHRoaXM7XG4gICAgICBcbiAgICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbCgnaDInLCB7dGV4dDogJ0thbmJhbiBTdGF0dXMgVXBkYXRlciBTZXR0aW5ncyd9KTtcbiAgICAgIFxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgICAgLnNldE5hbWUoJ1N0YXR1cyBQcm9wZXJ0eSBOYW1lJylcbiAgICAgICAgICAuc2V0RGVzYygnVGhlIG5hbWUgb2YgdGhlIHByb3BlcnR5IHRvIHVwZGF0ZSB3aGVuIGEgY2FyZCBpcyBtb3ZlZCcpXG4gICAgICAgICAgLmFkZFRleHQodGV4dCA9PiB0ZXh0XG4gICAgICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignc3RhdHVzJylcbiAgICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZSlcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgfSkpO1xuICAgICAgXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgICAuc2V0TmFtZSgnU2hvdyBOb3RpZmljYXRpb25zJylcbiAgICAgICAgICAuc2V0RGVzYygnU2hvdyBhIG5vdGlmaWNhdGlvbiB3aGVuIGEgc3RhdHVzIGlzIHVwZGF0ZWQnKVxuICAgICAgICAgIC5hZGRUb2dnbGUodG9nZ2xlID0+IHRvZ2dsZVxuICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd05vdGlmaWNhdGlvbnMpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNob3dOb3RpZmljYXRpb25zID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgfSkpO1xuICAgICAgXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgICAuc2V0TmFtZSgnRGVidWcgTW9kZScpXG4gICAgICAgICAgLnNldERlc2MoJ0VuYWJsZSBkZXRhaWxlZCBsb2dnaW5nIChyZWR1Y2VzIHBlcmZvcm1hbmNlKScpXG4gICAgICAgICAgLmFkZFRvZ2dsZSh0b2dnbGUgPT4gdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZWJ1Z01vZGUpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmRlYnVnTW9kZSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoJ0RlYnVnIG1vZGUgZW5hYmxlZCAtIGNoZWNrIGNvbnNvbGUgZm9yIGxvZ3MnLCAzMDAwKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZSgnRGVidWcgbW9kZSBkaXNhYmxlZCcsIDMwMDApO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KSk7XG4gICAgICBcbiAgICAgIC8vIEFkZCBhIHRlc3QgYnV0dG9uXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgICAuc2V0TmFtZSgnVGVzdCBQbHVnaW4nKVxuICAgICAgICAgIC5zZXREZXNjKCdUZXN0IHdpdGggY3VycmVudCBLYW5iYW4gYm9hcmQnKVxuICAgICAgICAgIC5hZGRCdXR0b24oYnV0dG9uID0+IGJ1dHRvblxuICAgICAgICAgICAgICAuc2V0QnV0dG9uVGV4dCgnUnVuIFRlc3QnKVxuICAgICAgICAgICAgICAub25DbGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5ydW5UZXN0KCk7XG4gICAgICAgICAgICAgIH0pKTtcbiAgICAgIFxuICAgICAgLy8gUGVyZm9ybWFuY2UgaW5mb1xuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ2gzJywge3RleHQ6ICdQZXJmb3JtYW5jZSBPcHRpbWl6YXRpb24nfSk7XG4gICAgICBcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKCdwJywge1xuICAgICAgICAgIHRleHQ6ICdUaGlzIHBsdWdpbiBvbmx5IG1vbml0b3JzIHRoZSBjdXJyZW50bHkgYWN0aXZlIEthbmJhbiBib2FyZCB0byBtaW5pbWl6ZSBwZXJmb3JtYW5jZSBpbXBhY3QuJ1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIC8vIFRyb3VibGVzaG9vdGluZyBzZWN0aW9uXG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbCgnaDMnLCB7dGV4dDogJ1Ryb3VibGVzaG9vdGluZyd9KTtcbiAgICAgIFxuICAgICAgY29uc3QgbGlzdCA9IGNvbnRhaW5lckVsLmNyZWF0ZUVsKCd1bCcpO1xuICAgICAgXG4gICAgICBsaXN0LmNyZWF0ZUVsKCdsaScsIHtcbiAgICAgICAgICB0ZXh0OiAnVGhlIHBsdWdpbiBvbmx5IHdvcmtzIHdpdGggdGhlIGN1cnJlbnRseSBvcGVuIEthbmJhbiBib2FyZCdcbiAgICAgIH0pO1xuICAgICAgXG4gICAgICBsaXN0LmNyZWF0ZUVsKCdsaScsIHtcbiAgICAgICAgICB0ZXh0OiAnQ2FyZHMgbXVzdCBjb250YWluIGludGVybmFsIGxpbmtzIHRvIG5vdGVzJ1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGxpc3QuY3JlYXRlRWwoJ2xpJywge1xuICAgICAgICAgIHRleHQ6ICdLZWVwIERlYnVnIE1vZGUgZGlzYWJsZWQgZm9yIGJlc3QgcGVyZm9ybWFuY2UnXG4gICAgICB9KTtcbiAgfVxufSJdLCJuYW1lcyI6WyJQbHVnaW4iLCJOb3RpY2UiLCJwYXJzZVlhbWwiLCJzdHJpbmdpZnlZYW1sIiwiUGx1Z2luU2V0dGluZ1RhYiIsIlNldHRpbmciXSwibWFwcGluZ3MiOiI7Ozs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBb0dBO0FBQ08sU0FBUyxTQUFTLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxDQUFDLEVBQUUsU0FBUyxFQUFFO0FBQzdELElBQUksU0FBUyxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsT0FBTyxLQUFLLFlBQVksQ0FBQyxHQUFHLEtBQUssR0FBRyxJQUFJLENBQUMsQ0FBQyxVQUFVLE9BQU8sRUFBRSxFQUFFLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFO0FBQ2hILElBQUksT0FBTyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsT0FBTyxDQUFDLEVBQUUsVUFBVSxPQUFPLEVBQUUsTUFBTSxFQUFFO0FBQy9ELFFBQVEsU0FBUyxTQUFTLENBQUMsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRTtBQUNuRyxRQUFRLFNBQVMsUUFBUSxDQUFDLEtBQUssRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxD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
