import {
  App,
  Notice,
  parseYaml,
  Plugin,
  PluginSettingTab,
  Setting,
  stringifyYaml,
  WorkspaceLeaf,
  View
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
  statusBarItem: HTMLElement;
  
  // Track active observers to disconnect them when not needed
  private currentObserver: MutationObserver | null = null;
  private isProcessing = false;
  private activeKanbanBoard: HTMLElement | null = null;
  
  async onload() {
      console.log('Loading Kanban Status Updater plugin');
      
      // Load settings
      await this.loadSettings();
      
      // Add status bar item
      this.statusBarItem = this.addStatusBarItem();
      this.statusBarItem.setText('KSU: Idle');
      this.statusBarItem.addClass('kanban-status-updater-statusbar');
      
      // Display startup notification
      if (this.settings.showNotifications) {
          new Notice('Kanban Status Updater activated');
      }
      this.log('Plugin loaded');
      
      // Register DOM event listener for drag events - but only process if active leaf is Kanban
      this.registerDomEvent(document, 'dragend', this.onDragEnd.bind(this));
      this.log('Registered drag event listener');
      
      // Watch for active leaf changes to only observe the current Kanban board
      this.registerEvent(
          this.app.workspace.on('active-leaf-change', this.onActiveLeafChange.bind(this))
      );
      
      // Initial check for active Kanban board
      this.app.workspace.onLayoutReady(() => {
          this.checkForActiveKanbanBoard();
      });
      
      // Add settings tab
      this.addSettingTab(new KanbanStatusUpdaterSettingTab(this.app, this));
  }
  
  onunload() {
      // Disconnect any active observers to prevent memory leaks
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
          
          // Update status bar
          this.statusBarItem.setText(`KSU: ${message.substring(0, 25)}${message.length > 25 ? '...' : ''}`);
          
          // Reset status bar after 3 seconds if no other logs happen
          setTimeout(() => {
              if (this.activeKanbanBoard) {
                  this.statusBarItem.setText('KSU: Active');
              } else {
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
  onActiveLeafChange(leaf: WorkspaceLeaf) {
      this.checkForActiveKanbanBoard();
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
            this.statusBarItem.setText('KSU: Active');
            
            // Store reference to active board
            this.activeKanbanBoard = kanbanBoard as HTMLElement;
            
            // Set up observer only for this board
            this.setupObserverForBoard(kanbanBoard as HTMLElement);
        } else {
            this.log('Active leaf is not a Kanban board');
            this.statusBarItem.setText('KSU: Idle');
        }
    } catch (error) {
        this.log(`Error detecting Kanban board: ${error.message}`);
        this.statusBarItem.setText('KSU: Error');
    }
  }
  
  setupObserverForBoard(boardElement: HTMLElement) {
      // Create a new observer for this specific board
      this.currentObserver = new MutationObserver((mutations) => {
          if (this.isProcessing) return;
          
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
  
  onDragEnd(event: DragEvent) {
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
          
          const target = event.target as HTMLElement;
          if (!target) return;
          
          this.processElement(target);
      } catch (error) {
          this.log(`Error in onDragEnd: ${error.message}`);
      } finally {
          // Reset processing flag after a delay to debounce
          setTimeout(() => {
              this.isProcessing = false;
          }, 300);
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
          
          // Read the file content
          const content = await this.app.vault.read(file);
          
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
                  frontmatterObj = parseYaml(frontmatterText);
                  
                  // Check if status property already exists
                  if (frontmatterObj[this.settings.statusPropertyName]) {
                      oldStatus = frontmatterObj[this.settings.statusPropertyName];
                  }
                  
              } catch (e) {
                  this.log(`Error parsing frontmatter: ${e.message}`);
                  frontmatterObj = {};
              }
              
              // Only update if status has changed
              if (frontmatterObj[this.settings.statusPropertyName] !== status) {
                  // Update the status property
                  frontmatterObj[this.settings.statusPropertyName] = status;
                  
                  // Generate new frontmatter text
                  const newFrontmatterText = stringifyYaml(frontmatterObj);
                  
                  // Replace the frontmatter in the content
                  newContent = content.replace(frontmatterRegex, `---\n${newFrontmatterText}---`);
                  
                  // Save the modified content
                  await this.app.vault.modify(file, newContent);
                  
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
          } else {
              // File has no frontmatter, create it
              const frontmatterObj = {
                  [this.settings.statusPropertyName]: status
              };
              
              const frontmatterText = stringifyYaml(frontmatterObj);
              newContent = `---\n${frontmatterText}---\n\n${content}`;
              
              // Save the modified content
              await this.app.vault.modify(file, newContent);
              
              // Show notification if enabled
              if (this.settings.showNotifications) {
                  new Notice(`Added ${this.settings.statusPropertyName}: "${status}" to ${file.basename}`, 3000);
              }
              
              this.log(`Added frontmatter with status to ${file.basename}`);
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
      containerEl.createEl('h2', {text: 'Kanban Status Updater Settings'});
      
      new Setting(containerEl)
          .setName('Status Property Name')
          .setDesc('The name of the property to update when a card is moved')
          .addText(text => text
              .setPlaceholder('status')
              .setValue(this.plugin.settings.statusPropertyName)
              .onChange(async (value) => {
                  this.plugin.settings.statusPropertyName = value;
                  await this.plugin.saveSettings();
              }));
      
      new Setting(containerEl)
          .setName('Show Notifications')
          .setDesc('Show a notification when a status is updated')
          .addToggle(toggle => toggle
              .setValue(this.plugin.settings.showNotifications)
              .onChange(async (value) => {
                  this.plugin.settings.showNotifications = value;
                  await this.plugin.saveSettings();
              }));
      
      new Setting(containerEl)
          .setName('Debug Mode')
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
          .setName('Test Plugin')
          .setDesc('Test with current Kanban board')
          .addButton(button => button
              .setButtonText('Run Test')
              .onClick(() => {
                  this.plugin.runTest();
              }));
      
      // Performance info
      containerEl.createEl('h3', {text: 'Performance Optimization'});
      
      containerEl.createEl('p', {
          text: 'This plugin only monitors the currently active Kanban board to minimize performance impact.'
      });
      
      // Troubleshooting section
      containerEl.createEl('h3', {text: 'Troubleshooting'});
      
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
