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
                        if (node instanceof HTMLElement) {
                            this.processElement(node);
                        }
                        else {
                            this.log('Added node is not an HTMLElement but a ' + typeof node);
                            const htmlElement = node;
                            this.log('Casted to HTMLElement: ' + htmlElement);
                            this.processElement(htmlElement);
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
        if (!this.activeKanbanBoard || this.isProcessing)
            return;
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
            // Check if element is a Kanban item or contains one
            const kanbanItem = element.classList.contains('kanban-plugin__item')
                ? element
                : element.querySelector('.kanban-plugin__item');
            if (kanbanItem) {
                this.processKanbanItem(kanbanItem);
                return;
            }
            // If element is inside a Kanban item, find the parent
            const parentItem = element.closest('.kanban-plugin__item');
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
            // Find the lane (column) this item is in
            const lane = itemElement.closest('.kanban-plugin__lane');
            if (!lane)
                return;
            // Get column name from the lane header
            const laneHeader = lane.querySelector('.kanban-plugin__lane-header-title');
            if (!laneHeader)
                return;
            const columnName = laneHeader.textContent.trim();
            // Find the link inside the item
            const internalLink = itemElement.querySelector('a.internal-link');
            if (!internalLink)
                return;
            // Get the link path from data-href or href attribute
            const linkPath = internalLink.getAttribute('data-href') ||
                internalLink.getAttribute('href');
            if (!linkPath)
                return;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZXMiOlsibm9kZV9tb2R1bGVzL3RzbGliL3RzbGliLmVzNi5qcyIsIm1haW4udHMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG5Db3B5cmlnaHQgKGMpIE1pY3Jvc29mdCBDb3Jwb3JhdGlvbi5cclxuXHJcblBlcm1pc3Npb24gdG8gdXNlLCBjb3B5LCBtb2RpZnksIGFuZC9vciBkaXN0cmlidXRlIHRoaXMgc29mdHdhcmUgZm9yIGFueVxyXG5wdXJwb3NlIHdpdGggb3Igd2l0aG91dCBmZWUgaXMgaGVyZWJ5IGdyYW50ZWQuXHJcblxyXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiIEFORCBUSEUgQVVUSE9SIERJU0NMQUlNUyBBTEwgV0FSUkFOVElFUyBXSVRIXHJcblJFR0FSRCBUTyBUSElTIFNPRlRXQVJFIElOQ0xVRElORyBBTEwgSU1QTElFRCBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWVxyXG5BTkQgRklUTkVTUy4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUiBCRSBMSUFCTEUgRk9SIEFOWSBTUEVDSUFMLCBESVJFQ1QsXHJcbklORElSRUNULCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgT1IgQU5ZIERBTUFHRVMgV0hBVFNPRVZFUiBSRVNVTFRJTkcgRlJPTVxyXG5MT1NTIE9GIFVTRSwgREFUQSBPUiBQUk9GSVRTLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgTkVHTElHRU5DRSBPUlxyXG5PVEhFUiBUT1JUSU9VUyBBQ1RJT04sIEFSSVNJTkcgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgVVNFIE9SXHJcblBFUkZPUk1BTkNFIE9GIFRISVMgU09GVFdBUkUuXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqICovXHJcbi8qIGdsb2JhbCBSZWZsZWN0LCBQcm9taXNlLCBTdXBwcmVzc2VkRXJyb3IsIFN5bWJvbCwgSXRlcmF0b3IgKi9cclxuXHJcbnZhciBleHRlbmRTdGF0aWNzID0gZnVuY3Rpb24oZCwgYikge1xyXG4gICAgZXh0ZW5kU3RhdGljcyA9IE9iamVjdC5zZXRQcm90b3R5cGVPZiB8fFxyXG4gICAgICAgICh7IF9fcHJvdG9fXzogW10gfSBpbnN0YW5jZW9mIEFycmF5ICYmIGZ1bmN0aW9uIChkLCBiKSB7IGQuX19wcm90b19fID0gYjsgfSkgfHxcclxuICAgICAgICBmdW5jdGlvbiAoZCwgYikgeyBmb3IgKHZhciBwIGluIGIpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoYiwgcCkpIGRbcF0gPSBiW3BdOyB9O1xyXG4gICAgcmV0dXJuIGV4dGVuZFN0YXRpY3MoZCwgYik7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHRlbmRzKGQsIGIpIHtcclxuICAgIGlmICh0eXBlb2YgYiAhPT0gXCJmdW5jdGlvblwiICYmIGIgIT09IG51bGwpXHJcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNsYXNzIGV4dGVuZHMgdmFsdWUgXCIgKyBTdHJpbmcoYikgKyBcIiBpcyBub3QgYSBjb25zdHJ1Y3RvciBvciBudWxsXCIpO1xyXG4gICAgZXh0ZW5kU3RhdGljcyhkLCBiKTtcclxuICAgIGZ1bmN0aW9uIF9fKCkgeyB0aGlzLmNvbnN0cnVjdG9yID0gZDsgfVxyXG4gICAgZC5wcm90b3R5cGUgPSBiID09PSBudWxsID8gT2JqZWN0LmNyZWF0ZShiKSA6IChfXy5wcm90b3R5cGUgPSBiLnByb3RvdHlwZSwgbmV3IF9fKCkpO1xyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fYXNzaWduID0gZnVuY3Rpb24oKSB7XHJcbiAgICBfX2Fzc2lnbiA9IE9iamVjdC5hc3NpZ24gfHwgZnVuY3Rpb24gX19hc3NpZ24odCkge1xyXG4gICAgICAgIGZvciAodmFyIHMsIGkgPSAxLCBuID0gYXJndW1lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xyXG4gICAgICAgICAgICBzID0gYXJndW1lbnRzW2ldO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkpIHRbcF0gPSBzW3BdO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gdDtcclxuICAgIH1cclxuICAgIHJldHVybiBfX2Fzc2lnbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZXN0KHMsIGUpIHtcclxuICAgIHZhciB0ID0ge307XHJcbiAgICBmb3IgKHZhciBwIGluIHMpIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwocywgcCkgJiYgZS5pbmRleE9mKHApIDwgMClcclxuICAgICAgICB0W3BdID0gc1twXTtcclxuICAgIGlmIChzICE9IG51bGwgJiYgdHlwZW9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMgPT09IFwiZnVuY3Rpb25cIilcclxuICAgICAgICBmb3IgKHZhciBpID0gMCwgcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocyk7IGkgPCBwLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgIGlmIChlLmluZGV4T2YocFtpXSkgPCAwICYmIE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChzLCBwW2ldKSlcclxuICAgICAgICAgICAgICAgIHRbcFtpXV0gPSBzW3BbaV1dO1xyXG4gICAgICAgIH1cclxuICAgIHJldHVybiB0O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYykge1xyXG4gICAgdmFyIGMgPSBhcmd1bWVudHMubGVuZ3RoLCByID0gYyA8IDMgPyB0YXJnZXQgOiBkZXNjID09PSBudWxsID8gZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IodGFyZ2V0LCBrZXkpIDogZGVzYywgZDtcclxuICAgIGlmICh0eXBlb2YgUmVmbGVjdCA9PT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgUmVmbGVjdC5kZWNvcmF0ZSA9PT0gXCJmdW5jdGlvblwiKSByID0gUmVmbGVjdC5kZWNvcmF0ZShkZWNvcmF0b3JzLCB0YXJnZXQsIGtleSwgZGVzYyk7XHJcbiAgICBlbHNlIGZvciAodmFyIGkgPSBkZWNvcmF0b3JzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSBpZiAoZCA9IGRlY29yYXRvcnNbaV0pIHIgPSAoYyA8IDMgPyBkKHIpIDogYyA+IDMgPyBkKHRhcmdldCwga2V5LCByKSA6IGQodGFyZ2V0LCBrZXkpKSB8fCByO1xyXG4gICAgcmV0dXJuIGMgPiAzICYmIHIgJiYgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwga2V5LCByKSwgcjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcGFyYW0ocGFyYW1JbmRleCwgZGVjb3JhdG9yKSB7XHJcbiAgICByZXR1cm4gZnVuY3Rpb24gKHRhcmdldCwga2V5KSB7IGRlY29yYXRvcih0YXJnZXQsIGtleSwgcGFyYW1JbmRleCk7IH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZXNEZWNvcmF0ZShjdG9yLCBkZXNjcmlwdG9ySW4sIGRlY29yYXRvcnMsIGNvbnRleHRJbiwgaW5pdGlhbGl6ZXJzLCBleHRyYUluaXRpYWxpemVycykge1xyXG4gICAgZnVuY3Rpb24gYWNjZXB0KGYpIHsgaWYgKGYgIT09IHZvaWQgMCAmJiB0eXBlb2YgZiAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiRnVuY3Rpb24gZXhwZWN0ZWRcIik7IHJldHVybiBmOyB9XHJcbiAgICB2YXIga2luZCA9IGNvbnRleHRJbi5raW5kLCBrZXkgPSBraW5kID09PSBcImdldHRlclwiID8gXCJnZXRcIiA6IGtpbmQgPT09IFwic2V0dGVyXCIgPyBcInNldFwiIDogXCJ2YWx1ZVwiO1xyXG4gICAgdmFyIHRhcmdldCA9ICFkZXNjcmlwdG9ySW4gJiYgY3RvciA/IGNvbnRleHRJbltcInN0YXRpY1wiXSA/IGN0b3IgOiBjdG9yLnByb3RvdHlwZSA6IG51bGw7XHJcbiAgICB2YXIgZGVzY3JpcHRvciA9IGRlc2NyaXB0b3JJbiB8fCAodGFyZ2V0ID8gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcih0YXJnZXQsIGNvbnRleHRJbi5uYW1lKSA6IHt9KTtcclxuICAgIHZhciBfLCBkb25lID0gZmFsc2U7XHJcbiAgICBmb3IgKHZhciBpID0gZGVjb3JhdG9ycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgIHZhciBjb250ZXh0ID0ge307XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4pIGNvbnRleHRbcF0gPSBwID09PSBcImFjY2Vzc1wiID8ge30gOiBjb250ZXh0SW5bcF07XHJcbiAgICAgICAgZm9yICh2YXIgcCBpbiBjb250ZXh0SW4uYWNjZXNzKSBjb250ZXh0LmFjY2Vzc1twXSA9IGNvbnRleHRJbi5hY2Nlc3NbcF07XHJcbiAgICAgICAgY29udGV4dC5hZGRJbml0aWFsaXplciA9IGZ1bmN0aW9uIChmKSB7IGlmIChkb25lKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiQ2Fubm90IGFkZCBpbml0aWFsaXplcnMgYWZ0ZXIgZGVjb3JhdGlvbiBoYXMgY29tcGxldGVkXCIpOyBleHRyYUluaXRpYWxpemVycy5wdXNoKGFjY2VwdChmIHx8IG51bGwpKTsgfTtcclxuICAgICAgICB2YXIgcmVzdWx0ID0gKDAsIGRlY29yYXRvcnNbaV0pKGtpbmQgPT09IFwiYWNjZXNzb3JcIiA/IHsgZ2V0OiBkZXNjcmlwdG9yLmdldCwgc2V0OiBkZXNjcmlwdG9yLnNldCB9IDogZGVzY3JpcHRvcltrZXldLCBjb250ZXh0KTtcclxuICAgICAgICBpZiAoa2luZCA9PT0gXCJhY2Nlc3NvclwiKSB7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IHZvaWQgMCkgY29udGludWU7XHJcbiAgICAgICAgICAgIGlmIChyZXN1bHQgPT09IG51bGwgfHwgdHlwZW9mIHJlc3VsdCAhPT0gXCJvYmplY3RcIikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIk9iamVjdCBleHBlY3RlZFwiKTtcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmdldCkpIGRlc2NyaXB0b3IuZ2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LnNldCkpIGRlc2NyaXB0b3Iuc2V0ID0gXztcclxuICAgICAgICAgICAgaWYgKF8gPSBhY2NlcHQocmVzdWx0LmluaXQpKSBpbml0aWFsaXplcnMudW5zaGlmdChfKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoXyA9IGFjY2VwdChyZXN1bHQpKSB7XHJcbiAgICAgICAgICAgIGlmIChraW5kID09PSBcImZpZWxkXCIpIGluaXRpYWxpemVycy51bnNoaWZ0KF8pO1xyXG4gICAgICAgICAgICBlbHNlIGRlc2NyaXB0b3Jba2V5XSA9IF87XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRhcmdldCkgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRhcmdldCwgY29udGV4dEluLm5hbWUsIGRlc2NyaXB0b3IpO1xyXG4gICAgZG9uZSA9IHRydWU7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19ydW5Jbml0aWFsaXplcnModGhpc0FyZywgaW5pdGlhbGl6ZXJzLCB2YWx1ZSkge1xyXG4gICAgdmFyIHVzZVZhbHVlID0gYXJndW1lbnRzLmxlbmd0aCA+IDI7XHJcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGluaXRpYWxpemVycy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIHZhbHVlID0gdXNlVmFsdWUgPyBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnLCB2YWx1ZSkgOiBpbml0aWFsaXplcnNbaV0uY2FsbCh0aGlzQXJnKTtcclxuICAgIH1cclxuICAgIHJldHVybiB1c2VWYWx1ZSA/IHZhbHVlIDogdm9pZCAwO1xyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcHJvcEtleSh4KSB7XHJcbiAgICByZXR1cm4gdHlwZW9mIHggPT09IFwic3ltYm9sXCIgPyB4IDogXCJcIi5jb25jYXQoeCk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zZXRGdW5jdGlvbk5hbWUoZiwgbmFtZSwgcHJlZml4KSB7XHJcbiAgICBpZiAodHlwZW9mIG5hbWUgPT09IFwic3ltYm9sXCIpIG5hbWUgPSBuYW1lLmRlc2NyaXB0aW9uID8gXCJbXCIuY29uY2F0KG5hbWUuZGVzY3JpcHRpb24sIFwiXVwiKSA6IFwiXCI7XHJcbiAgICByZXR1cm4gT2JqZWN0LmRlZmluZVByb3BlcnR5KGYsIFwibmFtZVwiLCB7IGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IHByZWZpeCA/IFwiXCIuY29uY2F0KHByZWZpeCwgXCIgXCIsIG5hbWUpIDogbmFtZSB9KTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX21ldGFkYXRhKG1ldGFkYXRhS2V5LCBtZXRhZGF0YVZhbHVlKSB7XHJcbiAgICBpZiAodHlwZW9mIFJlZmxlY3QgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIFJlZmxlY3QubWV0YWRhdGEgPT09IFwiZnVuY3Rpb25cIikgcmV0dXJuIFJlZmxlY3QubWV0YWRhdGEobWV0YWRhdGFLZXksIG1ldGFkYXRhVmFsdWUpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19hd2FpdGVyKHRoaXNBcmcsIF9hcmd1bWVudHMsIFAsIGdlbmVyYXRvcikge1xyXG4gICAgZnVuY3Rpb24gYWRvcHQodmFsdWUpIHsgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgUCA/IHZhbHVlIDogbmV3IFAoZnVuY3Rpb24gKHJlc29sdmUpIHsgcmVzb2x2ZSh2YWx1ZSk7IH0pOyB9XHJcbiAgICByZXR1cm4gbmV3IChQIHx8IChQID0gUHJvbWlzZSkpKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcclxuICAgICAgICBmdW5jdGlvbiBmdWxmaWxsZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3IubmV4dCh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gcmVqZWN0ZWQodmFsdWUpIHsgdHJ5IHsgc3RlcChnZW5lcmF0b3JbXCJ0aHJvd1wiXSh2YWx1ZSkpOyB9IGNhdGNoIChlKSB7IHJlamVjdChlKTsgfSB9XHJcbiAgICAgICAgZnVuY3Rpb24gc3RlcChyZXN1bHQpIHsgcmVzdWx0LmRvbmUgPyByZXNvbHZlKHJlc3VsdC52YWx1ZSkgOiBhZG9wdChyZXN1bHQudmFsdWUpLnRoZW4oZnVsZmlsbGVkLCByZWplY3RlZCk7IH1cclxuICAgICAgICBzdGVwKChnZW5lcmF0b3IgPSBnZW5lcmF0b3IuYXBwbHkodGhpc0FyZywgX2FyZ3VtZW50cyB8fCBbXSkpLm5leHQoKSk7XHJcbiAgICB9KTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fZ2VuZXJhdG9yKHRoaXNBcmcsIGJvZHkpIHtcclxuICAgIHZhciBfID0geyBsYWJlbDogMCwgc2VudDogZnVuY3Rpb24oKSB7IGlmICh0WzBdICYgMSkgdGhyb3cgdFsxXTsgcmV0dXJuIHRbMV07IH0sIHRyeXM6IFtdLCBvcHM6IFtdIH0sIGYsIHksIHQsIGcgPSBPYmplY3QuY3JlYXRlKCh0eXBlb2YgSXRlcmF0b3IgPT09IFwiZnVuY3Rpb25cIiA/IEl0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpO1xyXG4gICAgcmV0dXJuIGcubmV4dCA9IHZlcmIoMCksIGdbXCJ0aHJvd1wiXSA9IHZlcmIoMSksIGdbXCJyZXR1cm5cIl0gPSB2ZXJiKDIpLCB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgKGdbU3ltYm9sLml0ZXJhdG9yXSA9IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSksIGc7XHJcbiAgICBmdW5jdGlvbiB2ZXJiKG4pIHsgcmV0dXJuIGZ1bmN0aW9uICh2KSB7IHJldHVybiBzdGVwKFtuLCB2XSk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHN0ZXAob3ApIHtcclxuICAgICAgICBpZiAoZikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkdlbmVyYXRvciBpcyBhbHJlYWR5IGV4ZWN1dGluZy5cIik7XHJcbiAgICAgICAgd2hpbGUgKGcgJiYgKGcgPSAwLCBvcFswXSAmJiAoXyA9IDApKSwgXykgdHJ5IHtcclxuICAgICAgICAgICAgaWYgKGYgPSAxLCB5ICYmICh0ID0gb3BbMF0gJiAyID8geVtcInJldHVyblwiXSA6IG9wWzBdID8geVtcInRocm93XCJdIHx8ICgodCA9IHlbXCJyZXR1cm5cIl0pICYmIHQuY2FsbCh5KSwgMCkgOiB5Lm5leHQpICYmICEodCA9IHQuY2FsbCh5LCBvcFsxXSkpLmRvbmUpIHJldHVybiB0O1xyXG4gICAgICAgICAgICBpZiAoeSA9IDAsIHQpIG9wID0gW29wWzBdICYgMiwgdC52YWx1ZV07XHJcbiAgICAgICAgICAgIHN3aXRjaCAob3BbMF0pIHtcclxuICAgICAgICAgICAgICAgIGNhc2UgMDogY2FzZSAxOiB0ID0gb3A7IGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgY2FzZSA0OiBfLmxhYmVsKys7IHJldHVybiB7IHZhbHVlOiBvcFsxXSwgZG9uZTogZmFsc2UgfTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNTogXy5sYWJlbCsrOyB5ID0gb3BbMV07IG9wID0gWzBdOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGNhc2UgNzogb3AgPSBfLm9wcy5wb3AoKTsgXy50cnlzLnBvcCgpOyBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCEodCA9IF8udHJ5cywgdCA9IHQubGVuZ3RoID4gMCAmJiB0W3QubGVuZ3RoIC0gMV0pICYmIChvcFswXSA9PT0gNiB8fCBvcFswXSA9PT0gMikpIHsgXyA9IDA7IGNvbnRpbnVlOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9wWzBdID09PSAzICYmICghdCB8fCAob3BbMV0gPiB0WzBdICYmIG9wWzFdIDwgdFszXSkpKSB7IF8ubGFiZWwgPSBvcFsxXTsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAob3BbMF0gPT09IDYgJiYgXy5sYWJlbCA8IHRbMV0pIHsgXy5sYWJlbCA9IHRbMV07IHQgPSBvcDsgYnJlYWs7IH1cclxuICAgICAgICAgICAgICAgICAgICBpZiAodCAmJiBfLmxhYmVsIDwgdFsyXSkgeyBfLmxhYmVsID0gdFsyXTsgXy5vcHMucHVzaChvcCk7IGJyZWFrOyB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRbMl0pIF8ub3BzLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIF8udHJ5cy5wb3AoKTsgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgb3AgPSBib2R5LmNhbGwodGhpc0FyZywgXyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZSkgeyBvcCA9IFs2LCBlXTsgeSA9IDA7IH0gZmluYWxseSB7IGYgPSB0ID0gMDsgfVxyXG4gICAgICAgIGlmIChvcFswXSAmIDUpIHRocm93IG9wWzFdOyByZXR1cm4geyB2YWx1ZTogb3BbMF0gPyBvcFsxXSA6IHZvaWQgMCwgZG9uZTogdHJ1ZSB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgdmFyIF9fY3JlYXRlQmluZGluZyA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgbSwgaywgazIpIHtcclxuICAgIGlmIChrMiA9PT0gdW5kZWZpbmVkKSBrMiA9IGs7XHJcbiAgICB2YXIgZGVzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IobSwgayk7XHJcbiAgICBpZiAoIWRlc2MgfHwgKFwiZ2V0XCIgaW4gZGVzYyA/ICFtLl9fZXNNb2R1bGUgOiBkZXNjLndyaXRhYmxlIHx8IGRlc2MuY29uZmlndXJhYmxlKSkge1xyXG4gICAgICAgIGRlc2MgPSB7IGVudW1lcmFibGU6IHRydWUsIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiBtW2tdOyB9IH07XHJcbiAgICB9XHJcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgazIsIGRlc2MpO1xyXG59KSA6IChmdW5jdGlvbihvLCBtLCBrLCBrMikge1xyXG4gICAgaWYgKGsyID09PSB1bmRlZmluZWQpIGsyID0gaztcclxuICAgIG9bazJdID0gbVtrXTtcclxufSk7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19leHBvcnRTdGFyKG0sIG8pIHtcclxuICAgIGZvciAodmFyIHAgaW4gbSkgaWYgKHAgIT09IFwiZGVmYXVsdFwiICYmICFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobywgcCkpIF9fY3JlYXRlQmluZGluZyhvLCBtLCBwKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fdmFsdWVzKG8pIHtcclxuICAgIHZhciBzID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIFN5bWJvbC5pdGVyYXRvciwgbSA9IHMgJiYgb1tzXSwgaSA9IDA7XHJcbiAgICBpZiAobSkgcmV0dXJuIG0uY2FsbChvKTtcclxuICAgIGlmIChvICYmIHR5cGVvZiBvLmxlbmd0aCA9PT0gXCJudW1iZXJcIikgcmV0dXJuIHtcclxuICAgICAgICBuZXh0OiBmdW5jdGlvbiAoKSB7XHJcbiAgICAgICAgICAgIGlmIChvICYmIGkgPj0gby5sZW5ndGgpIG8gPSB2b2lkIDA7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbHVlOiBvICYmIG9baSsrXSwgZG9uZTogIW8gfTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihzID8gXCJPYmplY3QgaXMgbm90IGl0ZXJhYmxlLlwiIDogXCJTeW1ib2wuaXRlcmF0b3IgaXMgbm90IGRlZmluZWQuXCIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19yZWFkKG8sIG4pIHtcclxuICAgIHZhciBtID0gdHlwZW9mIFN5bWJvbCA9PT0gXCJmdW5jdGlvblwiICYmIG9bU3ltYm9sLml0ZXJhdG9yXTtcclxuICAgIGlmICghbSkgcmV0dXJuIG87XHJcbiAgICB2YXIgaSA9IG0uY2FsbChvKSwgciwgYXIgPSBbXSwgZTtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgd2hpbGUgKChuID09PSB2b2lkIDAgfHwgbi0tID4gMCkgJiYgIShyID0gaS5uZXh0KCkpLmRvbmUpIGFyLnB1c2goci52YWx1ZSk7XHJcbiAgICB9XHJcbiAgICBjYXRjaCAoZXJyb3IpIHsgZSA9IHsgZXJyb3I6IGVycm9yIH07IH1cclxuICAgIGZpbmFsbHkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmIChyICYmICFyLmRvbmUgJiYgKG0gPSBpW1wicmV0dXJuXCJdKSkgbS5jYWxsKGkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBmaW5hbGx5IHsgaWYgKGUpIHRocm93IGUuZXJyb3I7IH1cclxuICAgIH1cclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZCgpIHtcclxuICAgIGZvciAodmFyIGFyID0gW10sIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKVxyXG4gICAgICAgIGFyID0gYXIuY29uY2F0KF9fcmVhZChhcmd1bWVudHNbaV0pKTtcclxuICAgIHJldHVybiBhcjtcclxufVxyXG5cclxuLyoqIEBkZXByZWNhdGVkICovXHJcbmV4cG9ydCBmdW5jdGlvbiBfX3NwcmVhZEFycmF5cygpIHtcclxuICAgIGZvciAodmFyIHMgPSAwLCBpID0gMCwgaWwgPSBhcmd1bWVudHMubGVuZ3RoOyBpIDwgaWw7IGkrKykgcyArPSBhcmd1bWVudHNbaV0ubGVuZ3RoO1xyXG4gICAgZm9yICh2YXIgciA9IEFycmF5KHMpLCBrID0gMCwgaSA9IDA7IGkgPCBpbDsgaSsrKVxyXG4gICAgICAgIGZvciAodmFyIGEgPSBhcmd1bWVudHNbaV0sIGogPSAwLCBqbCA9IGEubGVuZ3RoOyBqIDwgamw7IGorKywgaysrKVxyXG4gICAgICAgICAgICByW2tdID0gYVtqXTtcclxuICAgIHJldHVybiByO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19zcHJlYWRBcnJheSh0bywgZnJvbSwgcGFjaykge1xyXG4gICAgaWYgKHBhY2sgfHwgYXJndW1lbnRzLmxlbmd0aCA9PT0gMikgZm9yICh2YXIgaSA9IDAsIGwgPSBmcm9tLmxlbmd0aCwgYXI7IGkgPCBsOyBpKyspIHtcclxuICAgICAgICBpZiAoYXIgfHwgIShpIGluIGZyb20pKSB7XHJcbiAgICAgICAgICAgIGlmICghYXIpIGFyID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoZnJvbSwgMCwgaSk7XHJcbiAgICAgICAgICAgIGFyW2ldID0gZnJvbVtpXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gdG8uY29uY2F0KGFyIHx8IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGZyb20pKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fYXdhaXQodikge1xyXG4gICAgcmV0dXJuIHRoaXMgaW5zdGFuY2VvZiBfX2F3YWl0ID8gKHRoaXMudiA9IHYsIHRoaXMpIDogbmV3IF9fYXdhaXQodik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jR2VuZXJhdG9yKHRoaXNBcmcsIF9hcmd1bWVudHMsIGdlbmVyYXRvcikge1xyXG4gICAgaWYgKCFTeW1ib2wuYXN5bmNJdGVyYXRvcikgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0l0ZXJhdG9yIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgIHZhciBnID0gZ2VuZXJhdG9yLmFwcGx5KHRoaXNBcmcsIF9hcmd1bWVudHMgfHwgW10pLCBpLCBxID0gW107XHJcbiAgICByZXR1cm4gaSA9IE9iamVjdC5jcmVhdGUoKHR5cGVvZiBBc3luY0l0ZXJhdG9yID09PSBcImZ1bmN0aW9uXCIgPyBBc3luY0l0ZXJhdG9yIDogT2JqZWN0KS5wcm90b3R5cGUpLCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIsIGF3YWl0UmV0dXJuKSwgaVtTeW1ib2wuYXN5bmNJdGVyYXRvcl0gPSBmdW5jdGlvbiAoKSB7IHJldHVybiB0aGlzOyB9LCBpO1xyXG4gICAgZnVuY3Rpb24gYXdhaXRSZXR1cm4oZikgeyByZXR1cm4gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh2KS50aGVuKGYsIHJlamVjdCk7IH07IH1cclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpZiAoZ1tuXSkgeyBpW25dID0gZnVuY3Rpb24gKHYpIHsgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uIChhLCBiKSB7IHEucHVzaChbbiwgdiwgYSwgYl0pID4gMSB8fCByZXN1bWUobiwgdik7IH0pOyB9OyBpZiAoZikgaVtuXSA9IGYoaVtuXSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gcmVzdW1lKG4sIHYpIHsgdHJ5IHsgc3RlcChnW25dKHYpKTsgfSBjYXRjaCAoZSkgeyBzZXR0bGUocVswXVszXSwgZSk7IH0gfVxyXG4gICAgZnVuY3Rpb24gc3RlcChyKSB7IHIudmFsdWUgaW5zdGFuY2VvZiBfX2F3YWl0ID8gUHJvbWlzZS5yZXNvbHZlKHIudmFsdWUudikudGhlbihmdWxmaWxsLCByZWplY3QpIDogc2V0dGxlKHFbMF1bMl0sIHIpOyB9XHJcbiAgICBmdW5jdGlvbiBmdWxmaWxsKHZhbHVlKSB7IHJlc3VtZShcIm5leHRcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiByZWplY3QodmFsdWUpIHsgcmVzdW1lKFwidGhyb3dcIiwgdmFsdWUpOyB9XHJcbiAgICBmdW5jdGlvbiBzZXR0bGUoZiwgdikgeyBpZiAoZih2KSwgcS5zaGlmdCgpLCBxLmxlbmd0aCkgcmVzdW1lKHFbMF1bMF0sIHFbMF1bMV0pOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jRGVsZWdhdG9yKG8pIHtcclxuICAgIHZhciBpLCBwO1xyXG4gICAgcmV0dXJuIGkgPSB7fSwgdmVyYihcIm5leHRcIiksIHZlcmIoXCJ0aHJvd1wiLCBmdW5jdGlvbiAoZSkgeyB0aHJvdyBlOyB9KSwgdmVyYihcInJldHVyblwiKSwgaVtTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gdGhpczsgfSwgaTtcclxuICAgIGZ1bmN0aW9uIHZlcmIobiwgZikgeyBpW25dID0gb1tuXSA/IGZ1bmN0aW9uICh2KSB7IHJldHVybiAocCA9ICFwKSA/IHsgdmFsdWU6IF9fYXdhaXQob1tuXSh2KSksIGRvbmU6IGZhbHNlIH0gOiBmID8gZih2KSA6IHY7IH0gOiBmOyB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FzeW5jVmFsdWVzKG8pIHtcclxuICAgIGlmICghU3ltYm9sLmFzeW5jSXRlcmF0b3IpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJTeW1ib2wuYXN5bmNJdGVyYXRvciBpcyBub3QgZGVmaW5lZC5cIik7XHJcbiAgICB2YXIgbSA9IG9bU3ltYm9sLmFzeW5jSXRlcmF0b3JdLCBpO1xyXG4gICAgcmV0dXJuIG0gPyBtLmNhbGwobykgOiAobyA9IHR5cGVvZiBfX3ZhbHVlcyA9PT0gXCJmdW5jdGlvblwiID8gX192YWx1ZXMobykgOiBvW1N5bWJvbC5pdGVyYXRvcl0oKSwgaSA9IHt9LCB2ZXJiKFwibmV4dFwiKSwgdmVyYihcInRocm93XCIpLCB2ZXJiKFwicmV0dXJuXCIpLCBpW1N5bWJvbC5hc3luY0l0ZXJhdG9yXSA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHRoaXM7IH0sIGkpO1xyXG4gICAgZnVuY3Rpb24gdmVyYihuKSB7IGlbbl0gPSBvW25dICYmIGZ1bmN0aW9uICh2KSB7IHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7IHYgPSBvW25dKHYpLCBzZXR0bGUocmVzb2x2ZSwgcmVqZWN0LCB2LmRvbmUsIHYudmFsdWUpOyB9KTsgfTsgfVxyXG4gICAgZnVuY3Rpb24gc2V0dGxlKHJlc29sdmUsIHJlamVjdCwgZCwgdikgeyBQcm9taXNlLnJlc29sdmUodikudGhlbihmdW5jdGlvbih2KSB7IHJlc29sdmUoeyB2YWx1ZTogdiwgZG9uZTogZCB9KTsgfSwgcmVqZWN0KTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19tYWtlVGVtcGxhdGVPYmplY3QoY29va2VkLCByYXcpIHtcclxuICAgIGlmIChPYmplY3QuZGVmaW5lUHJvcGVydHkpIHsgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvb2tlZCwgXCJyYXdcIiwgeyB2YWx1ZTogcmF3IH0pOyB9IGVsc2UgeyBjb29rZWQucmF3ID0gcmF3OyB9XHJcbiAgICByZXR1cm4gY29va2VkO1xyXG59O1xyXG5cclxudmFyIF9fc2V0TW9kdWxlRGVmYXVsdCA9IE9iamVjdC5jcmVhdGUgPyAoZnVuY3Rpb24obywgdikge1xyXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG8sIFwiZGVmYXVsdFwiLCB7IGVudW1lcmFibGU6IHRydWUsIHZhbHVlOiB2IH0pO1xyXG59KSA6IGZ1bmN0aW9uKG8sIHYpIHtcclxuICAgIG9bXCJkZWZhdWx0XCJdID0gdjtcclxufTtcclxuXHJcbnZhciBvd25LZXlzID0gZnVuY3Rpb24obykge1xyXG4gICAgb3duS2V5cyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzIHx8IGZ1bmN0aW9uIChvKSB7XHJcbiAgICAgICAgdmFyIGFyID0gW107XHJcbiAgICAgICAgZm9yICh2YXIgayBpbiBvKSBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG8sIGspKSBhclthci5sZW5ndGhdID0gaztcclxuICAgICAgICByZXR1cm4gYXI7XHJcbiAgICB9O1xyXG4gICAgcmV0dXJuIG93bktleXMobyk7XHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19pbXBvcnRTdGFyKG1vZCkge1xyXG4gICAgaWYgKG1vZCAmJiBtb2QuX19lc01vZHVsZSkgcmV0dXJuIG1vZDtcclxuICAgIHZhciByZXN1bHQgPSB7fTtcclxuICAgIGlmIChtb2QgIT0gbnVsbCkgZm9yICh2YXIgayA9IG93bktleXMobW9kKSwgaSA9IDA7IGkgPCBrLmxlbmd0aDsgaSsrKSBpZiAoa1tpXSAhPT0gXCJkZWZhdWx0XCIpIF9fY3JlYXRlQmluZGluZyhyZXN1bHQsIG1vZCwga1tpXSk7XHJcbiAgICBfX3NldE1vZHVsZURlZmF1bHQocmVzdWx0LCBtb2QpO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9faW1wb3J0RGVmYXVsdChtb2QpIHtcclxuICAgIHJldHVybiAobW9kICYmIG1vZC5fX2VzTW9kdWxlKSA/IG1vZCA6IHsgZGVmYXVsdDogbW9kIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2NsYXNzUHJpdmF0ZUZpZWxkR2V0KHJlY2VpdmVyLCBzdGF0ZSwga2luZCwgZikge1xyXG4gICAgaWYgKGtpbmQgPT09IFwiYVwiICYmICFmKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUHJpdmF0ZSBhY2Nlc3NvciB3YXMgZGVmaW5lZCB3aXRob3V0IGEgZ2V0dGVyXCIpO1xyXG4gICAgaWYgKHR5cGVvZiBzdGF0ZSA9PT0gXCJmdW5jdGlvblwiID8gcmVjZWl2ZXIgIT09IHN0YXRlIHx8ICFmIDogIXN0YXRlLmhhcyhyZWNlaXZlcikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgcmVhZCBwcml2YXRlIG1lbWJlciBmcm9tIGFuIG9iamVjdCB3aG9zZSBjbGFzcyBkaWQgbm90IGRlY2xhcmUgaXRcIik7XHJcbiAgICByZXR1cm4ga2luZCA9PT0gXCJtXCIgPyBmIDoga2luZCA9PT0gXCJhXCIgPyBmLmNhbGwocmVjZWl2ZXIpIDogZiA/IGYudmFsdWUgOiBzdGF0ZS5nZXQocmVjZWl2ZXIpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gX19jbGFzc1ByaXZhdGVGaWVsZFNldChyZWNlaXZlciwgc3RhdGUsIHZhbHVlLCBraW5kLCBmKSB7XHJcbiAgICBpZiAoa2luZCA9PT0gXCJtXCIpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQcml2YXRlIG1ldGhvZCBpcyBub3Qgd3JpdGFibGVcIik7XHJcbiAgICBpZiAoa2luZCA9PT0gXCJhXCIgJiYgIWYpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJQcml2YXRlIGFjY2Vzc29yIHdhcyBkZWZpbmVkIHdpdGhvdXQgYSBzZXR0ZXJcIik7XHJcbiAgICBpZiAodHlwZW9mIHN0YXRlID09PSBcImZ1bmN0aW9uXCIgPyByZWNlaXZlciAhPT0gc3RhdGUgfHwgIWYgOiAhc3RhdGUuaGFzKHJlY2VpdmVyKSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIkNhbm5vdCB3cml0ZSBwcml2YXRlIG1lbWJlciB0byBhbiBvYmplY3Qgd2hvc2UgY2xhc3MgZGlkIG5vdCBkZWNsYXJlIGl0XCIpO1xyXG4gICAgcmV0dXJuIChraW5kID09PSBcImFcIiA/IGYuY2FsbChyZWNlaXZlciwgdmFsdWUpIDogZiA/IGYudmFsdWUgPSB2YWx1ZSA6IHN0YXRlLnNldChyZWNlaXZlciwgdmFsdWUpKSwgdmFsdWU7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2NsYXNzUHJpdmF0ZUZpZWxkSW4oc3RhdGUsIHJlY2VpdmVyKSB7XHJcbiAgICBpZiAocmVjZWl2ZXIgPT09IG51bGwgfHwgKHR5cGVvZiByZWNlaXZlciAhPT0gXCJvYmplY3RcIiAmJiB0eXBlb2YgcmVjZWl2ZXIgIT09IFwiZnVuY3Rpb25cIikpIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW5ub3QgdXNlICdpbicgb3BlcmF0b3Igb24gbm9uLW9iamVjdFwiKTtcclxuICAgIHJldHVybiB0eXBlb2Ygc3RhdGUgPT09IFwiZnVuY3Rpb25cIiA/IHJlY2VpdmVyID09PSBzdGF0ZSA6IHN0YXRlLmhhcyhyZWNlaXZlcik7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZShlbnYsIHZhbHVlLCBhc3luYykge1xyXG4gICAgaWYgKHZhbHVlICE9PSBudWxsICYmIHZhbHVlICE9PSB2b2lkIDApIHtcclxuICAgICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0IGV4cGVjdGVkLlwiKTtcclxuICAgICAgICB2YXIgZGlzcG9zZSwgaW5uZXI7XHJcbiAgICAgICAgaWYgKGFzeW5jKSB7XHJcbiAgICAgICAgICAgIGlmICghU3ltYm9sLmFzeW5jRGlzcG9zZSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5hc3luY0Rpc3Bvc2UgaXMgbm90IGRlZmluZWQuXCIpO1xyXG4gICAgICAgICAgICBkaXNwb3NlID0gdmFsdWVbU3ltYm9sLmFzeW5jRGlzcG9zZV07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChkaXNwb3NlID09PSB2b2lkIDApIHtcclxuICAgICAgICAgICAgaWYgKCFTeW1ib2wuZGlzcG9zZSkgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlN5bWJvbC5kaXNwb3NlIGlzIG5vdCBkZWZpbmVkLlwiKTtcclxuICAgICAgICAgICAgZGlzcG9zZSA9IHZhbHVlW1N5bWJvbC5kaXNwb3NlXTtcclxuICAgICAgICAgICAgaWYgKGFzeW5jKSBpbm5lciA9IGRpc3Bvc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmICh0eXBlb2YgZGlzcG9zZSAhPT0gXCJmdW5jdGlvblwiKSB0aHJvdyBuZXcgVHlwZUVycm9yKFwiT2JqZWN0IG5vdCBkaXNwb3NhYmxlLlwiKTtcclxuICAgICAgICBpZiAoaW5uZXIpIGRpc3Bvc2UgPSBmdW5jdGlvbigpIHsgdHJ5IHsgaW5uZXIuY2FsbCh0aGlzKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gUHJvbWlzZS5yZWplY3QoZSk7IH0gfTtcclxuICAgICAgICBlbnYuc3RhY2sucHVzaCh7IHZhbHVlOiB2YWx1ZSwgZGlzcG9zZTogZGlzcG9zZSwgYXN5bmM6IGFzeW5jIH0pO1xyXG4gICAgfVxyXG4gICAgZWxzZSBpZiAoYXN5bmMpIHtcclxuICAgICAgICBlbnYuc3RhY2sucHVzaCh7IGFzeW5jOiB0cnVlIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHZhbHVlO1xyXG5cclxufVxyXG5cclxudmFyIF9TdXBwcmVzc2VkRXJyb3IgPSB0eXBlb2YgU3VwcHJlc3NlZEVycm9yID09PSBcImZ1bmN0aW9uXCIgPyBTdXBwcmVzc2VkRXJyb3IgOiBmdW5jdGlvbiAoZXJyb3IsIHN1cHByZXNzZWQsIG1lc3NhZ2UpIHtcclxuICAgIHZhciBlID0gbmV3IEVycm9yKG1lc3NhZ2UpO1xyXG4gICAgcmV0dXJuIGUubmFtZSA9IFwiU3VwcHJlc3NlZEVycm9yXCIsIGUuZXJyb3IgPSBlcnJvciwgZS5zdXBwcmVzc2VkID0gc3VwcHJlc3NlZCwgZTtcclxufTtcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBfX2Rpc3Bvc2VSZXNvdXJjZXMoZW52KSB7XHJcbiAgICBmdW5jdGlvbiBmYWlsKGUpIHtcclxuICAgICAgICBlbnYuZXJyb3IgPSBlbnYuaGFzRXJyb3IgPyBuZXcgX1N1cHByZXNzZWRFcnJvcihlLCBlbnYuZXJyb3IsIFwiQW4gZXJyb3Igd2FzIHN1cHByZXNzZWQgZHVyaW5nIGRpc3Bvc2FsLlwiKSA6IGU7XHJcbiAgICAgICAgZW52Lmhhc0Vycm9yID0gdHJ1ZTtcclxuICAgIH1cclxuICAgIHZhciByLCBzID0gMDtcclxuICAgIGZ1bmN0aW9uIG5leHQoKSB7XHJcbiAgICAgICAgd2hpbGUgKHIgPSBlbnYuc3RhY2sucG9wKCkpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGlmICghci5hc3luYyAmJiBzID09PSAxKSByZXR1cm4gcyA9IDAsIGVudi5zdGFjay5wdXNoKHIpLCBQcm9taXNlLnJlc29sdmUoKS50aGVuKG5leHQpO1xyXG4gICAgICAgICAgICAgICAgaWYgKHIuZGlzcG9zZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHZhciByZXN1bHQgPSByLmRpc3Bvc2UuY2FsbChyLnZhbHVlKTtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoci5hc3luYykgcmV0dXJuIHMgfD0gMiwgUHJvbWlzZS5yZXNvbHZlKHJlc3VsdCkudGhlbihuZXh0LCBmdW5jdGlvbihlKSB7IGZhaWwoZSk7IHJldHVybiBuZXh0KCk7IH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgZWxzZSBzIHw9IDE7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2F0Y2ggKGUpIHtcclxuICAgICAgICAgICAgICAgIGZhaWwoZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHMgPT09IDEpIHJldHVybiBlbnYuaGFzRXJyb3IgPyBQcm9taXNlLnJlamVjdChlbnYuZXJyb3IpIDogUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICAgICAgaWYgKGVudi5oYXNFcnJvcikgdGhyb3cgZW52LmVycm9yO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG5leHQoKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uKHBhdGgsIHByZXNlcnZlSnN4KSB7XHJcbiAgICBpZiAodHlwZW9mIHBhdGggPT09IFwic3RyaW5nXCIgJiYgL15cXC5cXC4/XFwvLy50ZXN0KHBhdGgpKSB7XHJcbiAgICAgICAgcmV0dXJuIHBhdGgucmVwbGFjZSgvXFwuKHRzeCkkfCgoPzpcXC5kKT8pKCg/OlxcLlteLi9dKz8pPylcXC4oW2NtXT8pdHMkL2ksIGZ1bmN0aW9uIChtLCB0c3gsIGQsIGV4dCwgY20pIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRzeCA/IHByZXNlcnZlSnN4ID8gXCIuanN4XCIgOiBcIi5qc1wiIDogZCAmJiAoIWV4dCB8fCAhY20pID8gbSA6IChkICsgZXh0ICsgXCIuXCIgKyBjbS50b0xvd2VyQ2FzZSgpICsgXCJqc1wiKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiBwYXRoO1xyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCB7XHJcbiAgICBfX2V4dGVuZHM6IF9fZXh0ZW5kcyxcclxuICAgIF9fYXNzaWduOiBfX2Fzc2lnbixcclxuICAgIF9fcmVzdDogX19yZXN0LFxyXG4gICAgX19kZWNvcmF0ZTogX19kZWNvcmF0ZSxcclxuICAgIF9fcGFyYW06IF9fcGFyYW0sXHJcbiAgICBfX2VzRGVjb3JhdGU6IF9fZXNEZWNvcmF0ZSxcclxuICAgIF9fcnVuSW5pdGlhbGl6ZXJzOiBfX3J1bkluaXRpYWxpemVycyxcclxuICAgIF9fcHJvcEtleTogX19wcm9wS2V5LFxyXG4gICAgX19zZXRGdW5jdGlvbk5hbWU6IF9fc2V0RnVuY3Rpb25OYW1lLFxyXG4gICAgX19tZXRhZGF0YTogX19tZXRhZGF0YSxcclxuICAgIF9fYXdhaXRlcjogX19hd2FpdGVyLFxyXG4gICAgX19nZW5lcmF0b3I6IF9fZ2VuZXJhdG9yLFxyXG4gICAgX19jcmVhdGVCaW5kaW5nOiBfX2NyZWF0ZUJpbmRpbmcsXHJcbiAgICBfX2V4cG9ydFN0YXI6IF9fZXhwb3J0U3RhcixcclxuICAgIF9fdmFsdWVzOiBfX3ZhbHVlcyxcclxuICAgIF9fcmVhZDogX19yZWFkLFxyXG4gICAgX19zcHJlYWQ6IF9fc3ByZWFkLFxyXG4gICAgX19zcHJlYWRBcnJheXM6IF9fc3ByZWFkQXJyYXlzLFxyXG4gICAgX19zcHJlYWRBcnJheTogX19zcHJlYWRBcnJheSxcclxuICAgIF9fYXdhaXQ6IF9fYXdhaXQsXHJcbiAgICBfX2FzeW5jR2VuZXJhdG9yOiBfX2FzeW5jR2VuZXJhdG9yLFxyXG4gICAgX19hc3luY0RlbGVnYXRvcjogX19hc3luY0RlbGVnYXRvcixcclxuICAgIF9fYXN5bmNWYWx1ZXM6IF9fYXN5bmNWYWx1ZXMsXHJcbiAgICBfX21ha2VUZW1wbGF0ZU9iamVjdDogX19tYWtlVGVtcGxhdGVPYmplY3QsXHJcbiAgICBfX2ltcG9ydFN0YXI6IF9faW1wb3J0U3RhcixcclxuICAgIF9faW1wb3J0RGVmYXVsdDogX19pbXBvcnREZWZhdWx0LFxyXG4gICAgX19jbGFzc1ByaXZhdGVGaWVsZEdldDogX19jbGFzc1ByaXZhdGVGaWVsZEdldCxcclxuICAgIF9fY2xhc3NQcml2YXRlRmllbGRTZXQ6IF9fY2xhc3NQcml2YXRlRmllbGRTZXQsXHJcbiAgICBfX2NsYXNzUHJpdmF0ZUZpZWxkSW46IF9fY2xhc3NQcml2YXRlRmllbGRJbixcclxuICAgIF9fYWRkRGlzcG9zYWJsZVJlc291cmNlOiBfX2FkZERpc3Bvc2FibGVSZXNvdXJjZSxcclxuICAgIF9fZGlzcG9zZVJlc291cmNlczogX19kaXNwb3NlUmVzb3VyY2VzLFxyXG4gICAgX19yZXdyaXRlUmVsYXRpdmVJbXBvcnRFeHRlbnNpb246IF9fcmV3cml0ZVJlbGF0aXZlSW1wb3J0RXh0ZW5zaW9uLFxyXG59O1xyXG4iLCJpbXBvcnQgeyBcbiAgQXBwLCBcbiAgRWRpdG9yLCBcbiAgTWFya2Rvd25WaWV3LCBcbiAgTm90aWNlLCBcbiAgUGx1Z2luLCBcbiAgUGx1Z2luU2V0dGluZ1RhYixcbiAgU2V0dGluZyxcbiAgVEZpbGUsXG4gIHBhcnNlWWFtbCxcbiAgc3RyaW5naWZ5WWFtbCxcbiAgV29ya3NwYWNlTGVhZlxufSBmcm9tICdvYnNpZGlhbic7XG5cbmludGVyZmFjZSBLYW5iYW5TdGF0dXNVcGRhdGVyU2V0dGluZ3Mge1xuICBzdGF0dXNQcm9wZXJ0eU5hbWU6IHN0cmluZztcbiAgc2hvd05vdGlmaWNhdGlvbnM6IGJvb2xlYW47XG4gIGRlYnVnTW9kZTogYm9vbGVhbjtcbn1cblxuY29uc3QgREVGQVVMVF9TRVRUSU5HUzogS2FuYmFuU3RhdHVzVXBkYXRlclNldHRpbmdzID0ge1xuICBzdGF0dXNQcm9wZXJ0eU5hbWU6ICdzdGF0dXMnLFxuICBzaG93Tm90aWZpY2F0aW9uczogdHJ1ZSxcbiAgZGVidWdNb2RlOiBmYWxzZSAgLy8gRGVmYXVsdCB0byBmYWxzZSBmb3IgYmV0dGVyIHBlcmZvcm1hbmNlXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEthbmJhblN0YXR1c1VwZGF0ZXJQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBzZXR0aW5nczogS2FuYmFuU3RhdHVzVXBkYXRlclNldHRpbmdzO1xuICBzdGF0dXNCYXJJdGVtOiBIVE1MRWxlbWVudDtcbiAgXG4gIC8vIFRyYWNrIGFjdGl2ZSBvYnNlcnZlcnMgdG8gZGlzY29ubmVjdCB0aGVtIHdoZW4gbm90IG5lZWRlZFxuICBwcml2YXRlIGN1cnJlbnRPYnNlcnZlcjogTXV0YXRpb25PYnNlcnZlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGlzUHJvY2Vzc2luZyA9IGZhbHNlO1xuICBwcml2YXRlIGFjdGl2ZUthbmJhbkJvYXJkOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBcbiAgYXN5bmMgb25sb2FkKCkge1xuICAgICAgY29uc29sZS5sb2coJ0xvYWRpbmcgS2FuYmFuIFN0YXR1cyBVcGRhdGVyIHBsdWdpbicpO1xuICAgICAgXG4gICAgICAvLyBMb2FkIHNldHRpbmdzXG4gICAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuICAgICAgXG4gICAgICAvLyBBZGQgc3RhdHVzIGJhciBpdGVtXG4gICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5zZXRUZXh0KCdLU1U6IElkbGUnKTtcbiAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5hZGRDbGFzcygna2FuYmFuLXN0YXR1cy11cGRhdGVyLXN0YXR1c2JhcicpO1xuICAgICAgXG4gICAgICAvLyBEaXNwbGF5IHN0YXJ0dXAgbm90aWZpY2F0aW9uXG4gICAgICBpZiAodGhpcy5zZXR0aW5ncy5zaG93Tm90aWZpY2F0aW9ucykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoJ0thbmJhbiBTdGF0dXMgVXBkYXRlciBhY3RpdmF0ZWQnKTtcbiAgICAgIH1cbiAgICAgIHRoaXMubG9nKCdQbHVnaW4gbG9hZGVkJyk7XG4gICAgICBcbiAgICAgIC8vIFJlZ2lzdGVyIERPTSBldmVudCBsaXN0ZW5lciBmb3IgZHJhZyBldmVudHMgLSBidXQgb25seSBwcm9jZXNzIGlmIGFjdGl2ZSBsZWFmIGlzIEthbmJhblxuICAgICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KGRvY3VtZW50LCAnZHJhZ2VuZCcsIHRoaXMub25EcmFnRW5kLmJpbmQodGhpcykpO1xuICAgICAgdGhpcy5sb2coJ1JlZ2lzdGVyZWQgZHJhZyBldmVudCBsaXN0ZW5lcicpO1xuICAgICAgXG4gICAgICAvLyBXYXRjaCBmb3IgYWN0aXZlIGxlYWYgY2hhbmdlcyB0byBvbmx5IG9ic2VydmUgdGhlIGN1cnJlbnQgS2FuYmFuIGJvYXJkXG4gICAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXG4gICAgICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKCdhY3RpdmUtbGVhZi1jaGFuZ2UnLCB0aGlzLm9uQWN0aXZlTGVhZkNoYW5nZS5iaW5kKHRoaXMpKVxuICAgICAgKTtcbiAgICAgIFxuICAgICAgLy8gSW5pdGlhbCBjaGVjayBmb3IgYWN0aXZlIEthbmJhbiBib2FyZFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2hlY2tGb3JBY3RpdmVLYW5iYW5Cb2FyZCgpO1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIC8vIEFkZCBzZXR0aW5ncyB0YWJcbiAgICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgS2FuYmFuU3RhdHVzVXBkYXRlclNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgfVxuICBcbiAgb251bmxvYWQoKSB7XG4gICAgICAvLyBEaXNjb25uZWN0IGFueSBhY3RpdmUgb2JzZXJ2ZXJzIHRvIHByZXZlbnQgbWVtb3J5IGxlYWtzXG4gICAgICB0aGlzLmRpc2Nvbm5lY3RPYnNlcnZlcnMoKTtcbiAgICAgIHRoaXMubG9nKCdQbHVnaW4gdW5sb2FkZWQnKTtcbiAgfVxuICBcbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gIH1cbiAgXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gIH1cbiAgXG4gIC8vIExvZyBoZWxwZXIgd2l0aCBkZWJ1ZyBtb2RlIGNoZWNrXG4gIGxvZyhtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICAgIGlmICh0aGlzLnNldHRpbmdzLmRlYnVnTW9kZSkge1xuICAgICAgICAgIGNvbnNvbGUubG9nKGBbS1NVXSAke21lc3NhZ2V9YCk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVXBkYXRlIHN0YXR1cyBiYXJcbiAgICAgICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uc2V0VGV4dChgS1NVOiAke21lc3NhZ2Uuc3Vic3RyaW5nKDAsIDI1KX0ke21lc3NhZ2UubGVuZ3RoID4gMjUgPyAnLi4uJyA6ICcnfWApO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIFJlc2V0IHN0YXR1cyBiYXIgYWZ0ZXIgMyBzZWNvbmRzIGlmIG5vIG90aGVyIGxvZ3MgaGFwcGVuXG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgIGlmICh0aGlzLmFjdGl2ZUthbmJhbkJvYXJkKSB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uc2V0VGV4dCgnS1NVOiBBY3RpdmUnKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5zZXRUZXh0KCdLU1U6IElkbGUnKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgIH0sIDMwMDApO1xuICAgICAgfVxuICB9XG4gIFxuICAvLyBDbGVhbiB1cCBvYnNlcnZlcnMgd2hlbiBzd2l0Y2hpbmcgYXdheSBmcm9tIGEgS2FuYmFuIGJvYXJkXG4gIGRpc2Nvbm5lY3RPYnNlcnZlcnMoKSB7XG4gICAgICBpZiAodGhpcy5jdXJyZW50T2JzZXJ2ZXIpIHtcbiAgICAgICAgICB0aGlzLmxvZygnRGlzY29ubmVjdGluZyBvYnNlcnZlciBmb3IgcGVyZm9ybWFuY2UnKTtcbiAgICAgICAgICB0aGlzLmN1cnJlbnRPYnNlcnZlci5kaXNjb25uZWN0KCk7XG4gICAgICAgICAgdGhpcy5jdXJyZW50T2JzZXJ2ZXIgPSBudWxsO1xuICAgICAgfVxuICAgICAgdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCA9IG51bGw7XG4gIH1cbiAgXG4gIC8vIENoZWNrIGlmIHRoZSBhY3RpdmUgbGVhZiBpcyBhIEthbmJhbiBib2FyZFxuICBvbkFjdGl2ZUxlYWZDaGFuZ2UobGVhZjogV29ya3NwYWNlTGVhZikge1xuICAgICAgdGhpcy5jaGVja0ZvckFjdGl2ZUthbmJhbkJvYXJkKCk7XG4gIH1cbiAgXG4gIGNoZWNrRm9yQWN0aXZlS2FuYmFuQm9hcmQoKSB7XG4gICAgLy8gRmlyc3QgZGlzY29ubmVjdCBhbnkgZXhpc3Rpbmcgb2JzZXJ2ZXJzXG4gICAgdGhpcy5kaXNjb25uZWN0T2JzZXJ2ZXJzKCk7XG4gICAgXG4gICAgLy8gR2V0IHRoZSBhY3RpdmUgbGVhZlxuICAgIGNvbnN0IGFjdGl2ZUxlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuYWN0aXZlTGVhZjtcbiAgICBpZiAoIWFjdGl2ZUxlYWYpIHJldHVybjtcbiAgICBcbiAgICB0cnkge1xuICAgICAgICAvLyBGaW5kIHRoZSBjb250ZW50IGVsZW1lbnQgc2FmZWx5XG4gICAgICAgIGxldCBjb250ZW50RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gICAgICAgIFxuICAgICAgICAvLyBVc2UgdHlwZSBhc3NlcnRpb25zIHRvIGF2b2lkIFR5cGVTY3JpcHQgZXJyb3JzXG4gICAgICAgIGlmIChhY3RpdmVMZWFmLnZpZXcpIHtcbiAgICAgICAgICAgIC8vIFRyeSB0byBhY2Nlc3MgdGhlIGNvbnRlbnRFbCBwcm9wZXJ0eSB1c2luZyB0eXBlIGFzc2VydGlvblxuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSAtIGNvbnRlbnRFbCBleGlzdHMgYnV0IG1pZ2h0IG5vdCBiZSBpbiB0eXBlIGRlZmluaXRpb25zXG4gICAgICAgICAgICBjb250ZW50RWwgPSBhY3RpdmVMZWFmLnZpZXcuY29udGVudEVsO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBJZiB0aGF0IGRpZG4ndCB3b3JrLCB0cnkgYW5vdGhlciBhcHByb2FjaFxuICAgICAgICBpZiAoIWNvbnRlbnRFbCkge1xuICAgICAgICAgICAgLy8gVHJ5IHRvIGdldCB0aGUgS2FuYmFuIGJvYXJkIGRpcmVjdGx5IGZyb20gdGhlIERPTVxuICAgICAgICAgICAgLy8gTGVhZiBjb250YWluZXJzIGhhdmUgJ3ZpZXctY29udGVudCcgZWxlbWVudHMgdGhhdCBjb250YWluIHRoZSBhY3R1YWwgdmlld1xuICAgICAgICAgICAgY29uc3Qgdmlld0NvbnRlbnQgPSAoYWN0aXZlTGVhZiBhcyBhbnkpLmNvbnRhaW5lckVsPy5xdWVyeVNlbGVjdG9yKCcudmlldy1jb250ZW50Jyk7XG4gICAgICAgICAgICBpZiAodmlld0NvbnRlbnQpIHtcbiAgICAgICAgICAgICAgICBjb250ZW50RWwgPSB2aWV3Q29udGVudDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gTGFzdCByZXNvcnQgLSBsb29rIGZvciBLYW5iYW4gYm9hcmRzIGFueXdoZXJlIGluIHRoZSB3b3Jrc3BhY2VcbiAgICAgICAgICAgICAgICBjb250ZW50RWwgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcud29ya3NwYWNlLWxlYWYubW9kLWFjdGl2ZSAudmlldy1jb250ZW50Jyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGlmICghY29udGVudEVsKSB7XG4gICAgICAgICAgICB0aGlzLmxvZygnQ291bGQgbm90IGFjY2VzcyBjb250ZW50IGVsZW1lbnQgZm9yIGFjdGl2ZSBsZWFmJyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIENoZWNrIGlmIHRoaXMgaXMgYSBLYW5iYW4gYm9hcmRcbiAgICAgICAgY29uc3Qga2FuYmFuQm9hcmQgPSBjb250ZW50RWwucXVlcnlTZWxlY3RvcignLmthbmJhbi1wbHVnaW5fX2JvYXJkJyk7XG4gICAgICAgIGlmIChrYW5iYW5Cb2FyZCkge1xuICAgICAgICAgICAgdGhpcy5sb2coJ0ZvdW5kIGFjdGl2ZSBLYW5iYW4gYm9hcmQsIHNldHRpbmcgdXAgb2JzZXJ2ZXInKTtcbiAgICAgICAgICAgIHRoaXMuc3RhdHVzQmFySXRlbS5zZXRUZXh0KCdLU1U6IEFjdGl2ZScpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICAvLyBTdG9yZSByZWZlcmVuY2UgdG8gYWN0aXZlIGJvYXJkXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUthbmJhbkJvYXJkID0ga2FuYmFuQm9hcmQgYXMgSFRNTEVsZW1lbnQ7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIC8vIFNldCB1cCBvYnNlcnZlciBvbmx5IGZvciB0aGlzIGJvYXJkXG4gICAgICAgICAgICB0aGlzLnNldHVwT2JzZXJ2ZXJGb3JCb2FyZChrYW5iYW5Cb2FyZCBhcyBIVE1MRWxlbWVudCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZygnQWN0aXZlIGxlYWYgaXMgbm90IGEgS2FuYmFuIGJvYXJkJyk7XG4gICAgICAgICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uc2V0VGV4dCgnS1NVOiBJZGxlJyk7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmxvZyhgRXJyb3IgZGV0ZWN0aW5nIEthbmJhbiBib2FyZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICB0aGlzLnN0YXR1c0Jhckl0ZW0uc2V0VGV4dCgnS1NVOiBFcnJvcicpO1xuICAgIH1cbiAgfVxuICBcbiAgc2V0dXBPYnNlcnZlckZvckJvYXJkKGJvYXJkRWxlbWVudDogSFRNTEVsZW1lbnQpIHtcbiAgICAgIC8vIENyZWF0ZSBhIG5ldyBvYnNlcnZlciBmb3IgdGhpcyBzcGVjaWZpYyBib2FyZFxuICAgICAgdGhpcy5jdXJyZW50T2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcigobXV0YXRpb25zKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuaXNQcm9jZXNzaW5nKSByZXR1cm47XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2ltcGxlIGRlYm91bmNlIHRvIHByZXZlbnQgcmFwaWQtZmlyZSBwcm9jZXNzaW5nXG4gICAgICAgICAgdGhpcy5pc1Byb2Nlc3NpbmcgPSB0cnVlO1xuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmhhbmRsZU11dGF0aW9ucyhtdXRhdGlvbnMpO1xuICAgICAgICAgICAgICB0aGlzLmlzUHJvY2Vzc2luZyA9IGZhbHNlO1xuICAgICAgICAgIH0sIDMwMCk7XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgLy8gT2JzZXJ2ZSBvbmx5IHRoaXMgYm9hcmQgd2l0aCBtaW5pbWFsIG9wdGlvbnMgbmVlZGVkXG4gICAgICB0aGlzLmN1cnJlbnRPYnNlcnZlci5vYnNlcnZlKGJvYXJkRWxlbWVudCwge1xuICAgICAgICAgIGNoaWxkTGlzdDogdHJ1ZSxcbiAgICAgICAgICBzdWJ0cmVlOiB0cnVlLFxuICAgICAgICAgIGF0dHJpYnV0ZXM6IGZhbHNlIC8vIERvbid0IG5lZWQgYXR0cmlidXRlIGNoYW5nZXMgZm9yIHBlcmZvcm1hbmNlXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgdGhpcy5sb2coJ09ic2VydmVyIHNldCB1cCBmb3IgYWN0aXZlIEthbmJhbiBib2FyZCcpO1xuICB9XG4gIFxuICBoYW5kbGVNdXRhdGlvbnMobXV0YXRpb25zOiBNdXRhdGlvblJlY29yZFtdKSB7XG4gICAgICBpZiAoIXRoaXMuYWN0aXZlS2FuYmFuQm9hcmQpIHJldHVybjtcbiAgICAgIFxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbWF4X211dGF0aW9ucyA9IDEwO1xuICAgICAgICAgIC8vIE9ubHkgcHJvY2VzcyBhIHNhbXBsZSBvZiBtdXRhdGlvbnMgZm9yIHBlcmZvcm1hbmNlXG4gICAgICAgICAgY29uc3QgbXV0YXRpb25zVG9Qcm9jZXNzID0gbXV0YXRpb25zLmxlbmd0aCA+IG1heF9tdXRhdGlvbnMgPyBcbiAgICAgICAgICAgICAgbXV0YXRpb25zLnNsaWNlKDAsIG1heF9tdXRhdGlvbnMpIDogbXV0YXRpb25zO1xuICAgICAgICAgICAgICBcbiAgICAgICAgICB0aGlzLmxvZyhgR290ICR7bXV0YXRpb25zVG9Qcm9jZXNzLmxlbmd0aH0gbXV0YXRpb25zIG9mICR7bXV0YXRpb25zLmxlbmd0aH1gKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBMb29rIGZvciBLYW5iYW4gaXRlbXMgaW4gbXV0YXRpb25cbiAgICAgICAgICBsZXQgaSA9IDA7XG4gICAgICAgICAgZm9yIChjb25zdCBtdXRhdGlvbiBvZiBtdXRhdGlvbnNUb1Byb2Nlc3MpIHtcbiAgICAgICAgICAgICAgdGhpcy5sb2coYE11dGF0aW9uICMkeysraX0gLSBUeXBlOiAke211dGF0aW9uLnR5cGV9YCk7XG4gICAgICAgICAgICAgIGlmIChtdXRhdGlvbi50eXBlID09PSAnY2hpbGRMaXN0Jykge1xuICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgYWRkZWQgbm9kZXMgZm9yIEthbmJhbiBpdGVtc1xuICAgICAgICAgICAgICAgICAgZm9yIChjb25zdCBub2RlIG9mIEFycmF5LmZyb20obXV0YXRpb24uYWRkZWROb2RlcykpIHtcbiAgICAgICAgICAgICAgICAgICAgICBpZiAobm9kZSBpbnN0YW5jZW9mIEhUTUxFbGVtZW50KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc0VsZW1lbnQobm9kZSk7XG4gICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2coJ0FkZGVkIG5vZGUgaXMgbm90IGFuIEhUTUxFbGVtZW50IGJ1dCBhICcgKyB0eXBlb2Ygbm9kZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGh0bWxFbGVtZW50ID0gbm9kZSBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5sb2coJ0Nhc3RlZCB0byBIVE1MRWxlbWVudDogJyArIGh0bWxFbGVtZW50KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzRWxlbWVudChodG1sRWxlbWVudCk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgdGhpcy5sb2coJ0lnbm9yaW5nIG11dGF0aW9uIHR5cGU6ICcgKyBtdXRhdGlvbi50eXBlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2coYEVycm9yIGluIGhhbmRsZU11dGF0aW9uczogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICB9XG4gIFxuICBvbkRyYWdFbmQoZXZlbnQ6IERyYWdFdmVudCkge1xuICAgICAgLy8gT25seSBwcm9jZXNzIGlmIHdlIGhhdmUgYW4gYWN0aXZlIEthbmJhbiBib2FyZFxuICAgICAgaWYgKCF0aGlzLmFjdGl2ZUthbmJhbkJvYXJkIHx8IHRoaXMuaXNQcm9jZXNzaW5nKSByZXR1cm47XG4gICAgICBcbiAgICAgIHRyeSB7XG4gICAgICAgICAgdGhpcy5sb2coJ0RyYWcgZW5kIGRldGVjdGVkJyk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2V0IHByb2Nlc3NpbmcgZmxhZyB0byBwcmV2ZW50IG11bHRpcGxlIHByb2Nlc3NpbmdcbiAgICAgICAgICB0aGlzLmlzUHJvY2Vzc2luZyA9IHRydWU7XG4gICAgICAgICAgXG4gICAgICAgICAgY29uc3QgdGFyZ2V0ID0gZXZlbnQudGFyZ2V0IGFzIEhUTUxFbGVtZW50O1xuICAgICAgICAgIGlmICghdGFyZ2V0KSByZXR1cm47XG4gICAgICAgICAgXG4gICAgICAgICAgdGhpcy5wcm9jZXNzRWxlbWVudCh0YXJnZXQpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZyhgRXJyb3IgaW4gb25EcmFnRW5kOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIC8vIFJlc2V0IHByb2Nlc3NpbmcgZmxhZyBhZnRlciBhIGRlbGF5IHRvIGRlYm91bmNlXG4gICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuaXNQcm9jZXNzaW5nID0gZmFsc2U7XG4gICAgICAgICAgfSwgMzAwKTtcbiAgICAgIH1cbiAgfVxuICBcbiAgcHJvY2Vzc0VsZW1lbnQoZWxlbWVudDogSFRNTEVsZW1lbnQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gT25seSBwcm9jZXNzIGlmIGluc2lkZSBvdXIgYWN0aXZlIEthbmJhbiBib2FyZFxuICAgICAgICAgIGlmICghdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCB8fCAhZWxlbWVudC5jbG9zZXN0KCcua2FuYmFuLXBsdWdpbl9fYm9hcmQnKSkge1xuICAgICAgICAgICAgICB0aGlzLmxvZygnRWxlbWVudCBOT1QgaW4gYWN0aXZlIEthbmJhbiBib2FyZC4gU2tpcHBpbmcuJyk7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVXNlIGRpZmZlcmVudCBzdHJhdGVnaWVzIHRvIGZpbmQgdGhlIEthbmJhbiBpdGVtXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gQ2hlY2sgaWYgZWxlbWVudCBpcyBhIEthbmJhbiBpdGVtIG9yIGNvbnRhaW5zIG9uZVxuICAgICAgICAgIGNvbnN0IGthbmJhbkl0ZW0gPSBlbGVtZW50LmNsYXNzTGlzdC5jb250YWlucygna2FuYmFuLXBsdWdpbl9faXRlbScpIFxuICAgICAgICAgICAgICA/IGVsZW1lbnRcbiAgICAgICAgICAgICAgOiBlbGVtZW50LnF1ZXJ5U2VsZWN0b3IoJy5rYW5iYW4tcGx1Z2luX19pdGVtJyk7XG4gICAgICAgICAgICAgIFxuICAgICAgICAgIGlmIChrYW5iYW5JdGVtKSB7XG4gICAgICAgICAgICAgIHRoaXMucHJvY2Vzc0thbmJhbkl0ZW0oa2FuYmFuSXRlbSBhcyBIVE1MRWxlbWVudCk7XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gSWYgZWxlbWVudCBpcyBpbnNpZGUgYSBLYW5iYW4gaXRlbSwgZmluZCB0aGUgcGFyZW50XG4gICAgICAgICAgY29uc3QgcGFyZW50SXRlbSA9IGVsZW1lbnQuY2xvc2VzdCgnLmthbmJhbi1wbHVnaW5fX2l0ZW0nKSBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICBpZiAocGFyZW50SXRlbSkge1xuICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NLYW5iYW5JdGVtKHBhcmVudEl0ZW0pO1xuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZyhgRXJyb3IgaW4gcHJvY2Vzc0VsZW1lbnQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgfVxuICBcbiAgcHJvY2Vzc0thbmJhbkl0ZW0oaXRlbUVsZW1lbnQ6IEhUTUxFbGVtZW50KSB7XG4gICAgICB0cnkge1xuICAgICAgICAgIC8vIEZpbmQgdGhlIGxhbmUgKGNvbHVtbikgdGhpcyBpdGVtIGlzIGluXG4gICAgICAgICAgY29uc3QgbGFuZSA9IGl0ZW1FbGVtZW50LmNsb3Nlc3QoJy5rYW5iYW4tcGx1Z2luX19sYW5lJyk7XG4gICAgICAgICAgaWYgKCFsYW5lKSByZXR1cm47XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gR2V0IGNvbHVtbiBuYW1lIGZyb20gdGhlIGxhbmUgaGVhZGVyXG4gICAgICAgICAgY29uc3QgbGFuZUhlYWRlciA9IGxhbmUucXVlcnlTZWxlY3RvcignLmthbmJhbi1wbHVnaW5fX2xhbmUtaGVhZGVyLXRpdGxlJyk7XG4gICAgICAgICAgaWYgKCFsYW5lSGVhZGVyKSByZXR1cm47XG4gICAgICAgICAgXG4gICAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IGxhbmVIZWFkZXIudGV4dENvbnRlbnQudHJpbSgpO1xuICAgICAgICAgIFxuICAgICAgICAgIC8vIEZpbmQgdGhlIGxpbmsgaW5zaWRlIHRoZSBpdGVtXG4gICAgICAgICAgY29uc3QgaW50ZXJuYWxMaW5rID0gaXRlbUVsZW1lbnQucXVlcnlTZWxlY3RvcignYS5pbnRlcm5hbC1saW5rJyk7XG4gICAgICAgICAgaWYgKCFpbnRlcm5hbExpbmspIHJldHVybjtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBHZXQgdGhlIGxpbmsgcGF0aCBmcm9tIGRhdGEtaHJlZiBvciBocmVmIGF0dHJpYnV0ZVxuICAgICAgICAgIGNvbnN0IGxpbmtQYXRoID0gaW50ZXJuYWxMaW5rLmdldEF0dHJpYnV0ZSgnZGF0YS1ocmVmJykgfHwgXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGludGVybmFsTGluay5nZXRBdHRyaWJ1dGUoJ2hyZWYnKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgaWYgKCFsaW5rUGF0aCkgcmV0dXJuO1xuICAgICAgICAgIFxuICAgICAgICAgIHRoaXMubG9nKGBQcm9jZXNzaW5nIGNhcmQgd2l0aCBsaW5rIHRvIFwiJHtsaW5rUGF0aH1cIiBpbiBjb2x1bW4gXCIke2NvbHVtbk5hbWV9XCJgKTtcbiAgICAgICAgICBcbiAgICAgICAgICAvLyBVcGRhdGUgdGhlIGxpbmtlZCBub3RlJ3Mgc3RhdHVzXG4gICAgICAgICAgdGhpcy51cGRhdGVOb3RlU3RhdHVzKGxpbmtQYXRoLCBjb2x1bW5OYW1lKTtcbiAgICAgICAgICBcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgdGhpcy5sb2coYEVycm9yIGluIHByb2Nlc3NLYW5iYW5JdGVtOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICB9XG4gIH1cbiAgXG4gIGFzeW5jIHVwZGF0ZU5vdGVTdGF0dXMobm90ZVBhdGg6IHN0cmluZywgc3RhdHVzOiBzdHJpbmcpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gRmluZCB0aGUgbGlua2VkIGZpbGVcbiAgICAgICAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChub3RlUGF0aCwgJycpO1xuICAgICAgICAgIFxuICAgICAgICAgIGlmICghZmlsZSkge1xuICAgICAgICAgICAgICBpZiAodGhpcy5zZXR0aW5ncy5zaG93Tm90aWZpY2F0aW9ucykge1xuICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZShg4pqg77iPIE5vdGUgXCIke25vdGVQYXRofVwiIG5vdCBmb3VuZGAsIDMwMDApO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gUmVhZCB0aGUgZmlsZSBjb250ZW50XG4gICAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gQ2hlY2sgZm9yIGV4aXN0aW5nIGZyb250bWF0dGVyXG4gICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJSZWdleCA9IC9eLS0tXFxuKFtcXHNcXFNdKj8pXFxuLS0tLztcbiAgICAgICAgICBjb25zdCBmcm9udG1hdHRlck1hdGNoID0gY29udGVudC5tYXRjaChmcm9udG1hdHRlclJlZ2V4KTtcbiAgICAgICAgICBcbiAgICAgICAgICBsZXQgbmV3Q29udGVudDtcbiAgICAgICAgICBsZXQgb2xkU3RhdHVzID0gbnVsbDtcbiAgICAgICAgICBcbiAgICAgICAgICBpZiAoZnJvbnRtYXR0ZXJNYXRjaCkge1xuICAgICAgICAgICAgICAvLyBGaWxlIGhhcyBmcm9udG1hdHRlclxuICAgICAgICAgICAgICBjb25zdCBmcm9udG1hdHRlclRleHQgPSBmcm9udG1hdHRlck1hdGNoWzFdO1xuICAgICAgICAgICAgICBsZXQgZnJvbnRtYXR0ZXJPYmo7XG4gICAgICAgICAgICAgIFxuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgLy8gVHJ5IHRvIHBhcnNlIHRoZSBmcm9udG1hdHRlclxuICAgICAgICAgICAgICAgICAgZnJvbnRtYXR0ZXJPYmogPSBwYXJzZVlhbWwoZnJvbnRtYXR0ZXJUZXh0KTtcbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgc3RhdHVzIHByb3BlcnR5IGFscmVhZHkgZXhpc3RzXG4gICAgICAgICAgICAgICAgICBpZiAoZnJvbnRtYXR0ZXJPYmpbdGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWVdKSB7XG4gICAgICAgICAgICAgICAgICAgICAgb2xkU3RhdHVzID0gZnJvbnRtYXR0ZXJPYmpbdGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWVdO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgIHRoaXMubG9nKGBFcnJvciBwYXJzaW5nIGZyb250bWF0dGVyOiAke2UubWVzc2FnZX1gKTtcbiAgICAgICAgICAgICAgICAgIGZyb250bWF0dGVyT2JqID0ge307XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIC8vIE9ubHkgdXBkYXRlIGlmIHN0YXR1cyBoYXMgY2hhbmdlZFxuICAgICAgICAgICAgICBpZiAoZnJvbnRtYXR0ZXJPYmpbdGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWVdICE9PSBzdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSB0aGUgc3RhdHVzIHByb3BlcnR5XG4gICAgICAgICAgICAgICAgICBmcm9udG1hdHRlck9ialt0aGlzLnNldHRpbmdzLnN0YXR1c1Byb3BlcnR5TmFtZV0gPSBzdGF0dXM7XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIG5ldyBmcm9udG1hdHRlciB0ZXh0XG4gICAgICAgICAgICAgICAgICBjb25zdCBuZXdGcm9udG1hdHRlclRleHQgPSBzdHJpbmdpZnlZYW1sKGZyb250bWF0dGVyT2JqKTtcbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgLy8gUmVwbGFjZSB0aGUgZnJvbnRtYXR0ZXIgaW4gdGhlIGNvbnRlbnRcbiAgICAgICAgICAgICAgICAgIG5ld0NvbnRlbnQgPSBjb250ZW50LnJlcGxhY2UoZnJvbnRtYXR0ZXJSZWdleCwgYC0tLVxcbiR7bmV3RnJvbnRtYXR0ZXJUZXh0fS0tLWApO1xuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICAvLyBTYXZlIHRoZSBtb2RpZmllZCBjb250ZW50XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgbmV3Q29udGVudCk7XG4gICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgIC8vIFNob3cgbm90aWZpY2F0aW9uIGlmIGVuYWJsZWRcbiAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnNldHRpbmdzLnNob3dOb3RpZmljYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgICAgaWYgKG9sZFN0YXR1cykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKGBVcGRhdGVkICR7dGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWV9OiBcIiR7b2xkU3RhdHVzfVwiIOKGkiBcIiR7c3RhdHVzfVwiIGZvciAke2ZpbGUuYmFzZW5hbWV9YCwgMzAwMCk7XG4gICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZShgU2V0ICR7dGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWV9OiBcIiR7c3RhdHVzfVwiIGZvciAke2ZpbGUuYmFzZW5hbWV9YCwgMzAwMCk7XG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgICB0aGlzLmxvZyhgVXBkYXRlZCBzdGF0dXMgZm9yICR7ZmlsZS5iYXNlbmFtZX0gdG8gXCIke3N0YXR1c31cImApO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgdGhpcy5sb2coYFN0YXR1cyBhbHJlYWR5IHNldCB0byBcIiR7c3RhdHVzfVwiIGZvciAke2ZpbGUuYmFzZW5hbWV9LCBza2lwcGluZyB1cGRhdGVgKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIC8vIEZpbGUgaGFzIG5vIGZyb250bWF0dGVyLCBjcmVhdGUgaXRcbiAgICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXJPYmogPSB7XG4gICAgICAgICAgICAgICAgICBbdGhpcy5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWVdOiBzdGF0dXNcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIGNvbnN0IGZyb250bWF0dGVyVGV4dCA9IHN0cmluZ2lmeVlhbWwoZnJvbnRtYXR0ZXJPYmopO1xuICAgICAgICAgICAgICBuZXdDb250ZW50ID0gYC0tLVxcbiR7ZnJvbnRtYXR0ZXJUZXh0fS0tLVxcblxcbiR7Y29udGVudH1gO1xuICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgLy8gU2F2ZSB0aGUgbW9kaWZpZWQgY29udGVudFxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgbmV3Q29udGVudCk7XG4gICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAvLyBTaG93IG5vdGlmaWNhdGlvbiBpZiBlbmFibGVkXG4gICAgICAgICAgICAgIGlmICh0aGlzLnNldHRpbmdzLnNob3dOb3RpZmljYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKGBBZGRlZCAke3RoaXMuc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lfTogXCIke3N0YXR1c31cIiB0byAke2ZpbGUuYmFzZW5hbWV9YCwgMzAwMCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgIHRoaXMubG9nKGBBZGRlZCBmcm9udG1hdHRlciB3aXRoIHN0YXR1cyB0byAke2ZpbGUuYmFzZW5hbWV9YCk7XG4gICAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICB0aGlzLmxvZyhgRXJyb3IgdXBkYXRpbmcgbm90ZSBzdGF0dXM6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgICBpZiAodGhpcy5zZXR0aW5ncy5zaG93Tm90aWZpY2F0aW9ucykge1xuICAgICAgICAgICAgICBuZXcgTm90aWNlKGDimqDvuI8gRXJyb3IgdXBkYXRpbmcgc3RhdHVzOiAke2Vycm9yLm1lc3NhZ2V9YCwgMzAwMCk7XG4gICAgICAgICAgfVxuICAgICAgfVxuICB9XG4gIFxuICAvLyBNZXRob2QgZm9yIHRoZSB0ZXN0IGJ1dHRvbiB0byB1c2VcbiAgcnVuVGVzdCgpIHtcbiAgICAgIHRoaXMubG9nKCdSdW5uaW5nIHRlc3QuLi4nKTtcbiAgICAgIFxuICAgICAgLy8gTWFrZSBzdXJlIHdlJ3JlIHVzaW5nIHRoZSBjdXJyZW50IGFjdGl2ZSBib2FyZFxuICAgICAgdGhpcy5jaGVja0ZvckFjdGl2ZUthbmJhbkJvYXJkKCk7XG4gICAgICBcbiAgICAgIGlmICghdGhpcy5hY3RpdmVLYW5iYW5Cb2FyZCkge1xuICAgICAgICAgIG5ldyBOb3RpY2UoJ+KaoO+4jyBObyBhY3RpdmUgS2FuYmFuIGJvYXJkIGZvdW5kIC0gb3BlbiBhIEthbmJhbiBib2FyZCBmaXJzdCcsIDUwMDApO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gRmluZCBpdGVtcyBpbiB0aGUgYWN0aXZlIGJvYXJkXG4gICAgICBjb25zdCBpdGVtcyA9IHRoaXMuYWN0aXZlS2FuYmFuQm9hcmQucXVlcnlTZWxlY3RvckFsbCgnLmthbmJhbi1wbHVnaW5fX2l0ZW0nKTtcbiAgICAgIGNvbnN0IGNvdW50ID0gaXRlbXMubGVuZ3RoO1xuICAgICAgXG4gICAgICBuZXcgTm90aWNlKGBGb3VuZCAke2NvdW50fSBjYXJkcyBpbiBhY3RpdmUgS2FuYmFuIGJvYXJkYCwgMzAwMCk7XG4gICAgICBcbiAgICAgIGlmIChjb3VudCA+IDApIHtcbiAgICAgICAgICAvLyBQcm9jZXNzIHRoZSBmaXJzdCBpdGVtIHdpdGggYSBsaW5rXG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjb3VudDsgaSsrKSB7XG4gICAgICAgICAgICAgIGNvbnN0IGl0ZW0gPSBpdGVtc1tpXSBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgICAgICAgaWYgKGl0ZW0ucXVlcnlTZWxlY3RvcignYS5pbnRlcm5hbC1saW5rJykpIHtcbiAgICAgICAgICAgICAgICAgIG5ldyBOb3RpY2UoYFRlc3Rpbmcgd2l0aCBjYXJkOiBcIiR7aXRlbS50ZXh0Q29udGVudC5zdWJzdHJpbmcoMCwgMjApfS4uLlwiYCwgMzAwMCk7XG4gICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NLYW5iYW5JdGVtKGl0ZW0pO1xuICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICB9XG4gIH1cbn1cblxuY2xhc3MgS2FuYmFuU3RhdHVzVXBkYXRlclNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcGx1Z2luOiBLYW5iYW5TdGF0dXNVcGRhdGVyUGx1Z2luO1xuICBcbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogS2FuYmFuU3RhdHVzVXBkYXRlclBsdWdpbikge1xuICAgICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cbiAgXG4gIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgICBjb25zdCB7Y29udGFpbmVyRWx9ID0gdGhpcztcbiAgICAgIFxuICAgICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKCdoMicsIHt0ZXh0OiAnS2FuYmFuIFN0YXR1cyBVcGRhdGVyIFNldHRpbmdzJ30pO1xuICAgICAgXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgICAuc2V0TmFtZSgnU3RhdHVzIFByb3BlcnR5IE5hbWUnKVxuICAgICAgICAgIC5zZXREZXNjKCdUaGUgbmFtZSBvZiB0aGUgcHJvcGVydHkgdG8gdXBkYXRlIHdoZW4gYSBjYXJkIGlzIG1vdmVkJylcbiAgICAgICAgICAuYWRkVGV4dCh0ZXh0ID0+IHRleHRcbiAgICAgICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCdzdGF0dXMnKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc3RhdHVzUHJvcGVydHlOYW1lKVxuICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdGF0dXNQcm9wZXJ0eU5hbWUgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICB9KSk7XG4gICAgICBcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAgIC5zZXROYW1lKCdTaG93IE5vdGlmaWNhdGlvbnMnKVxuICAgICAgICAgIC5zZXREZXNjKCdTaG93IGEgbm90aWZpY2F0aW9uIHdoZW4gYSBzdGF0dXMgaXMgdXBkYXRlZCcpXG4gICAgICAgICAgLmFkZFRvZ2dsZSh0b2dnbGUgPT4gdG9nZ2xlXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zaG93Tm90aWZpY2F0aW9ucylcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2hvd05vdGlmaWNhdGlvbnMgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICB9KSk7XG4gICAgICBcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAgIC5zZXROYW1lKCdEZWJ1ZyBNb2RlJylcbiAgICAgICAgICAuc2V0RGVzYygnRW5hYmxlIGRldGFpbGVkIGxvZ2dpbmcgKHJlZHVjZXMgcGVyZm9ybWFuY2UpJylcbiAgICAgICAgICAuYWRkVG9nZ2xlKHRvZ2dsZSA9PiB0b2dnbGVcbiAgICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlYnVnTW9kZSlcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuZGVidWdNb2RlID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgICAgICAgbmV3IE5vdGljZSgnRGVidWcgbW9kZSBlbmFibGVkIC0gY2hlY2sgY29uc29sZSBmb3IgbG9ncycsIDMwMDApO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICBuZXcgTm90aWNlKCdEZWJ1ZyBtb2RlIGRpc2FibGVkJywgMzAwMCk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pKTtcbiAgICAgIFxuICAgICAgLy8gQWRkIGEgdGVzdCBidXR0b25cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAgIC5zZXROYW1lKCdUZXN0IFBsdWdpbicpXG4gICAgICAgICAgLnNldERlc2MoJ1Rlc3Qgd2l0aCBjdXJyZW50IEthbmJhbiBib2FyZCcpXG4gICAgICAgICAgLmFkZEJ1dHRvbihidXR0b24gPT4gYnV0dG9uXG4gICAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KCdSdW4gVGVzdCcpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJ1blRlc3QoKTtcbiAgICAgICAgICAgICAgfSkpO1xuICAgICAgXG4gICAgICAvLyBQZXJmb3JtYW5jZSBpbmZvXG4gICAgICBjb250YWluZXJFbC5jcmVhdGVFbCgnaDMnLCB7dGV4dDogJ1BlcmZvcm1hbmNlIE9wdGltaXphdGlvbid9KTtcbiAgICAgIFxuICAgICAgY29udGFpbmVyRWwuY3JlYXRlRWwoJ3AnLCB7XG4gICAgICAgICAgdGV4dDogJ1RoaXMgcGx1Z2luIG9ubHkgbW9uaXRvcnMgdGhlIGN1cnJlbnRseSBhY3RpdmUgS2FuYmFuIGJvYXJkIHRvIG1pbmltaXplIHBlcmZvcm1hbmNlIGltcGFjdC4nXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgLy8gVHJvdWJsZXNob290aW5nIHNlY3Rpb25cbiAgICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKCdoMycsIHt0ZXh0OiAnVHJvdWJsZXNob290aW5nJ30pO1xuICAgICAgXG4gICAgICBjb25zdCBsaXN0ID0gY29udGFpbmVyRWwuY3JlYXRlRWwoJ3VsJyk7XG4gICAgICBcbiAgICAgIGxpc3QuY3JlYXRlRWwoJ2xpJywge1xuICAgICAgICAgIHRleHQ6ICdUaGUgcGx1Z2luIG9ubHkgd29ya3Mgd2l0aCB0aGUgY3VycmVudGx5IG9wZW4gS2FuYmFuIGJvYXJkJ1xuICAgICAgfSk7XG4gICAgICBcbiAgICAgIGxpc3QuY3JlYXRlRWwoJ2xpJywge1xuICAgICAgICAgIHRleHQ6ICdDYXJkcyBtdXN0IGNvbnRhaW4gaW50ZXJuYWwgbGlua3MgdG8gbm90ZXMnXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgbGlzdC5jcmVhdGVFbCgnbGknLCB7XG4gICAgICAgICAgdGV4dDogJ0tlZXAgRGVidWcgTW9kZSBkaXNhYmxlZCBmb3IgYmVzdCBwZXJmb3JtYW5jZSdcbiAgICAgIH0pO1xuICB9XG59Il0sIm5hbWVzIjpbIlBsdWdpbiIsIk5vdGljZSIsInBhcnNlWWFtbCIsInN0cmluZ2lmeVlhbWwiLCJQbHVnaW5TZXR0aW5nVGFiIiwiU2V0dGluZyJdLCJtYXBwaW5ncyI6Ijs7OztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFvR0E7QUFDTyxTQUFTLFNBQVMsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLENBQUMsRUFBRSxTQUFTLEVBQUU7QUFDN0QsSUFBSSxT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
