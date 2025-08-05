import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  View,
  WorkspaceLeaf,
  stringifyYaml
} from 'obsidian';

// Extended interfaces for Obsidian internal properties
interface ExtendedWorkspaceLeaf extends WorkspaceLeaf {
  containerEl?: HTMLElement;
  view: ExtendedView;
}

interface ExtendedView extends View {
  contentEl?: HTMLElement;
}

interface KanbanStatusUpdaterSettings {
  statusPropertyName: string;
  showNotifications: boolean;
  debugMode: boolean;
}

const DEFAULT_SETTINGS: KanbanStatusUpdaterSettings = {
  statusPropertyName: 'status',
  showNotifications: false,
  debugMode: false  // Default to false for better performance
}

export default class KanbanStatusUpdaterPlugin extends Plugin {
  settings: KanbanStatusUpdaterSettings;

  // Track active observers to disconnect them when not needed
  private currentObserver: MutationObserver | null = null;
  private isProcessingMutation = false;
  private isProcessingDrag = false;
  private activeKanbanBoard: HTMLElement | null = null;
  private draggedElement: HTMLElement | null = null;

  async onload() {
      console.log('Loading Kanban Status Updater plugin');

      // Load settings
      await this.loadSettings();

      // Display startup notification
      if (this.settings.showNotifications) {
          new Notice('Kanban Status Updater activated');
      }
      this.log('Plugin loaded');

      // Add drag event listeners with proper scoping to avoid tab navigation interference
      this.registerDomEvent(document, 'dragstart', this.onDragStart.bind(this));
      this.registerDomEvent(document, 'dragend', this.onDragEnd.bind(this));
      this.registerDomEvent(document, 'drop', this.onDrop.bind(this));
      console.log('[KSU] Plugin initialized WITH scoped drag listeners for Kanban boards only');
      this.log('Plugin initialized with scoped drag listeners');


      // Always monitor visible Kanban boards with both drag events and mutation observer  
      // Drag events handle real-time drag operations, MutationObserver handles menu-driven changes
      this.app.workspace.onLayoutReady(() => {
          setTimeout(() => {
              this.setupAlwaysOnKanbanMonitoring();
          }, 1000);
      });

      // Add settings tab
      this.addSettingTab(new KanbanStatusUpdaterSettingTab(this.app, this));
  }

  onunload() {
      // Clean up everything to prevent memory leaks
      this.disconnectObservers();
      this.log('Plugin unloaded');
  }

  async loadSettings() {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
      await this.saveData(this.settings);
  }

  // Log helper with debug mode check
  log(message: string) {
      if (this.settings.debugMode) {
          console.log(`[KSU] ${message}`);
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

  // Setup purely click-driven Kanban monitoring to avoid ALL automatic interference
  setupAlwaysOnKanbanMonitoring() {
      this.log('Setting up purely click-driven Kanban monitoring');

      // NO initial check - wait for user interaction
      // NO periodic checking - purely reactive

      // Only listen for clicks that might indicate Kanban interaction
      this.registerDomEvent(document, 'click', this.onDocumentClick.bind(this));

      this.log('Click-driven Kanban monitoring active (no automatic checks)');
  }

  // Handle document clicks - ensure observers are active when interacting with Kanban
  onDocumentClick(event: MouseEvent) {
      try {
          const target = event.target as HTMLElement;
          if (this.isKanbanInteraction(target)) {
              this.log('Detected Kanban interaction via click - ensuring observers are active');
              // Ensure we have active observers for menu-driven changes
              setTimeout(() => {
                  this.checkForActiveKanbanBoard();
              }, 100);
          }
      } catch (error) {
          this.log(`Error in document click handler: ${error.message}`);
      }
  }

  // Check if an element represents Kanban interaction
  isKanbanInteraction(element: HTMLElement): boolean {
      if (!element) return false;

      // Check if element is within a Kanban board
      const kanbanBoard = element.closest('.kanban-plugin__board');
      if (kanbanBoard) {
          this.log('Element is within Kanban board');
          return true;
      }

      // Check if element is a Kanban-related class
      const kanbanClasses = [
          'kanban-plugin__item',
          'kanban-plugin__lane',
          'kanban-plugin__lane-header',
          'kanban-plugin__item-title'
      ];

      for (const className of kanbanClasses) {
          if (element.classList?.contains(className) || element.closest(`.${className}`)) {
              this.log(`Element matches Kanban class: ${className}`);
              return true;
          }
      }

      return false;
  }

  checkForActiveKanbanBoard() {
    // First disconnect any existing observers
    this.disconnectObservers();

    // Get the active leaf using the non-deprecated API
    const activeLeaf = this.app.workspace.getLeaf(false);
    if (!activeLeaf) return;

    try {
        // Find the content element safely
        let contentEl: HTMLElement | null = null;

        // Use type assertions to avoid TypeScript errors
        if (activeLeaf.view) {
            // Try to access the contentEl property using type assertion
            contentEl = (activeLeaf as ExtendedWorkspaceLeaf).view.contentEl || null;
        }

        // If that didn't work, try another approach
        if (!contentEl) {
            // Try to get the Kanban board directly from the DOM
            // Leaf containers have 'view-content' elements that contain the actual view
            const viewContent = (activeLeaf as ExtendedWorkspaceLeaf).containerEl?.querySelector('.view-content');
            if (viewContent) {
                contentEl = viewContent as HTMLElement;
            } else {
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

            // Store reference to active board
            this.activeKanbanBoard = kanbanBoard as HTMLElement;

            // Set up observer only for this board
            this.setupObserverForBoard(kanbanBoard as HTMLElement);
        } else {
            this.log('Active leaf is not a Kanban board');
        }
    } catch (error) {
        this.log(`Error detecting Kanban board: ${error.message}`);
    }
  }

  setupObserverForBoard(boardElement: HTMLElement) {
      // Create observer focused on detecting menu-driven card movements
      this.currentObserver = new MutationObserver((mutations) => {
          if (this.isProcessingMutation || this.isProcessingDrag) return;

          // Look for any mutations that could indicate card movements
          const relevantMutations = mutations.filter(mutation => {
              if (mutation.type !== 'childList') return false;

              // Check for added or removed nodes that might be Kanban items
              const hasKanbanChanges =
                  Array.from(mutation.addedNodes).some(node =>
                      node instanceof HTMLElement && (
                          node.classList?.contains('kanban-plugin__item') ||
                          node.querySelector?.('.kanban-plugin__item')
                      )
                  ) ||
                  Array.from(mutation.removedNodes).some(node =>
                      node instanceof HTMLElement && (
                          node.classList?.contains('kanban-plugin__item') ||
                          node.querySelector?.('.kanban-plugin__item')
                      )
                  );

              return hasKanbanChanges;
          });

          if (relevantMutations.length === 0) return;

          this.log(`Detected ${relevantMutations.length} relevant mutations (menu-driven changes)`);

          // Process with moderate delay for menu-driven changes
          this.isProcessingMutation = true;
          setTimeout(() => {
              this.handleMutations(relevantMutations);
              this.isProcessingMutation = false;
          }, 500); // Moderate delay for menu actions
      });

      // Watch for both direct and nested changes to catch menu movements
      this.currentObserver.observe(boardElement, {
          childList: true,
          subtree: true, // Need subtree to catch lane changes
          attributes: false
      });

      this.log('Menu-focused observer set up for active Kanban board');
  }

  handleMutations(mutations: MutationRecord[]) {
    if (!this.activeKanbanBoard) return;

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
                            } else if (node instanceof SVGElement) {
                                // For SVG elements, look for parent HTML element
                                const parentElement = node.closest('.kanban-plugin__item');
                                if (parentElement) {
                                    this.log('Found Kanban item parent of SVG element');
                                    this.processElement(parentElement as HTMLElement);
                                } else {
                                    // Look for any kanban items in the document that might have changed
                                    // This is for cases where the SVG update is related to a card movement
                                    const items = this.activeKanbanBoard.querySelectorAll('.kanban-plugin__item');
                                    if (items.length > 0) {
                                        // Process only the most recently modified item
                                        const recentItems = Array.from(items).slice(-1);
                                        for (const item of recentItems) {
                                            this.log('Processing recent item after SVG change');
                                            this.processElement(item as HTMLElement);
                                        }
                                    }
                                }
                            }
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            // For text nodes, check the parent element
                            const parentElement = node.parentElement;
                            if (parentElement && (
                                parentElement.classList.contains('kanban-plugin__item-title') ||
                                parentElement.closest('.kanban-plugin__item')
                            )) {
                                this.log('Found text change in Kanban item');
                                const itemElement = parentElement.closest('.kanban-plugin__item');
                                if (itemElement) {
                                    this.processElement(itemElement as HTMLElement);
                                }
                            }
                        } else {
                            this.log(`Skipping node type: ${node.nodeType}`);
                        }
                    } catch (nodeError) {
                        this.log(`Error processing node: ${nodeError.message}`);
                        // Continue with next node even if this one fails
                    }
                }
            } else {
                this.log('Ignoring mutation type: ' + mutation.type);
            }
        }
    } catch (error) {
        this.log(`Error in handleMutations: ${error.message}`);
    }
  }

  onDragStart(event: DragEvent) {
      try {
          const target = event.target as HTMLElement;
          if (!target || !this.activeKanbanBoard) return;

          // Check if this is a Kanban item being dragged
          const kanbanItem = target.closest('.kanban-plugin__item');
          if (kanbanItem) {
              const kanbanBoard = kanbanItem.closest('.kanban-plugin__board');
              if (kanbanBoard && kanbanBoard.isSameNode(this.activeKanbanBoard)) {
                  this.draggedElement = kanbanItem as HTMLElement;
                  const linkElement = kanbanItem.querySelector('a.internal-link');
                  const linkText = linkElement?.textContent || 'No link';
                  this.log(`Drag started: ${linkText}`);
              }
          }
      } catch (error) {
          this.log(`Error in onDragStart: ${error.message}`);
      }
  }

  onDragEnd(event: DragEvent) {
      try {
          if (!this.draggedElement || !this.activeKanbanBoard || this.isProcessingDrag) {
              return;
          }

          const linkElement = this.draggedElement.querySelector('a.internal-link');
          const linkText = linkElement?.textContent || 'No link';
          this.log(`Drag ended: ${linkText}`);

          this.isProcessingDrag = true;

          // Process with a delay to allow DOM to settle after drag
          setTimeout(() => {
              if (this.draggedElement) {
                  this.processKanbanItem(this.draggedElement);
              }
              this.draggedElement = null;
              this.isProcessingDrag = false;
          }, 300);

      } catch (error) {
          this.log(`Error in onDragEnd: ${error.message}`);
          this.draggedElement = null;
          this.isProcessingDrag = false;
      }
  }

  onDrop(event: DragEvent) {
      try {
          const target = event.target as HTMLElement;
          if (!target) return;

          // Check if drop happened in a Kanban lane
          const lane = target.closest('.kanban-plugin__lane');
          if (!lane || !this.draggedElement || !this.activeKanbanBoard || this.isProcessingDrag) {
              return;
          }

          const linkElement = this.draggedElement.querySelector('a.internal-link');
          const linkText = linkElement?.textContent || 'No link';
          this.log(`Card dropped: ${linkText}`);
          
          this.isProcessingDrag = true;
          
          // Process with extra delay to ensure DOM is fully updated after drop
          setTimeout(() => {
              if (this.draggedElement) {
                  this.processKanbanItem(this.draggedElement);
              }
              this.draggedElement = null;
              this.isProcessingDrag = false;
          }, 500);
      } catch (error) {
          this.log(`Error in onDrop: ${error.message}`);
      }
  }

  processElement(element: HTMLElement) {
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
              this.processKanbanItem(kanbanItem as HTMLElement);
              return;
          }
          this.log('Not a Kanban item, checking for parent');

          // If element is inside a Kanban item, find the parent
          const parentItem = element.closest('.kanban-plugin__item') as HTMLElement;
          this.log(`Parent item: ${parentItem ? parentItem : 'Not found'}`);
          if (parentItem) {
              this.processKanbanItem(parentItem);
              return;
          }
      } catch (error) {
          this.log(`Error in processElement: ${error.message}`);
      }
  }

  processKanbanItem(itemElement: HTMLElement) { // itemElement will be of class `kanban-plugin__item`
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

          if (!linkPath) return;
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

      } catch (error) {
          this.log(`Error in processKanbanItem: ${error.message}`);
      }
  }

  async updateNoteStatus(notePath: string, status: string) {
      try {
          // Find the linked file
          const file = this.app.metadataCache.getFirstLinkpathDest(notePath, '');

          if (!file) {
              if (this.settings.showNotifications) {
                  new Notice(`⚠️ Note "${notePath}" not found`, 3000);
              }
              return;
          }

          // Get current status if it exists
          const metadata = this.app.metadataCache.getFileCache(file);
          let oldStatus = null;

          if (metadata?.frontmatter && metadata.frontmatter[this.settings.statusPropertyName]) {
              oldStatus = metadata.frontmatter[this.settings.statusPropertyName];
          }

          // Only update if status has changed
          if (oldStatus !== status) {
              // Use the processFrontMatter API to update the frontmatter
              await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                  // Set the status property
                  frontmatter[this.settings.statusPropertyName] = status;
              });

              // Show notification if enabled
              if (this.settings.showNotifications) {
                  if (oldStatus) {
                      new Notice(`Updated ${this.settings.statusPropertyName}: "${oldStatus}" → "${status}" for ${file.basename}`, 3000);
                  } else {
                      new Notice(`Set ${this.settings.statusPropertyName}: "${status}" for ${file.basename}`, 3000);
                  }
              }

              this.log(`Updated status for ${file.basename} to "${status}"`);
          } else {
              this.log(`Status already set to "${status}" for ${file.basename}, skipping update`);
          }
      } catch (error) {
          this.log(`Error updating note status: ${error.message}`);
          if (this.settings.showNotifications) {
              new Notice(`⚠️ Error updating status: ${error.message}`, 3000);
          }
      }
  }

  // Method for the test button to use
  runTest() {
      this.log('Running test...');

      // Make sure we're using the current active board
      this.checkForActiveKanbanBoard();

      if (!this.activeKanbanBoard) {
          new Notice('⚠️ No active Kanban board found - open a Kanban board first', 5000);
          return;
      }

      // Find items in the active board
      const items = this.activeKanbanBoard.querySelectorAll('.kanban-plugin__item');
      const count = items.length;

      new Notice(`Found ${count} cards in active Kanban board`, 3000);

      if (count > 0) {
          // Process the first item with a link
          for (let i = 0; i < count; i++) {
              const item = items[i] as HTMLElement;
              if (item.querySelector('a.internal-link')) {
                  new Notice(`Testing with card: "${item.textContent.substring(0, 20)}..."`, 3000);
                  this.processKanbanItem(item);
                  break;
              }
          }
      }
  }
}

class KanbanStatusUpdaterSettingTab extends PluginSettingTab {
  plugin: KanbanStatusUpdaterPlugin;

  constructor(app: App, plugin: KanbanStatusUpdaterPlugin) {
      super(app, plugin);
      this.plugin = plugin;
  }

  display(): void {
      const {containerEl} = this;

      containerEl.empty();

      new Setting(containerEl)
          .setName('Status property name')
          .setDesc('The name of the property to update when a card is moved')
          .addText(text => text
              .setPlaceholder('status')
              .setValue(this.plugin.settings.statusPropertyName)
              .onChange(async (value) => {
                  this.plugin.settings.statusPropertyName = value;
                  await this.plugin.saveSettings();
              }));

      new Setting(containerEl)
          .setName('Show notifications')
          .setDesc('Show a notification when a status is updated')
          .addToggle(toggle => toggle
              .setValue(this.plugin.settings.showNotifications)
              .onChange(async (value) => {
                  this.plugin.settings.showNotifications = value;
                  await this.plugin.saveSettings();
              }));

      new Setting(containerEl)
          .setName('Debug mode')
          .setDesc('Enable detailed logging (reduces performance)')
          .addToggle(toggle => toggle
              .setValue(this.plugin.settings.debugMode)
              .onChange(async (value) => {
                  this.plugin.settings.debugMode = value;
                  await this.plugin.saveSettings();

                  if (value) {
                      new Notice('Debug mode enabled - check console for logs', 3000);
                  } else {
                      new Notice('Debug mode disabled', 3000);
                  }
              }));

      // Add a test button
      new Setting(containerEl)
          .setName('Test plugin')
          .setDesc('Test with current Kanban board')
          .addButton(button => button
              .setButtonText('Run Test')
              .onClick(() => {
                  this.plugin.runTest();
              }));
  }
}
