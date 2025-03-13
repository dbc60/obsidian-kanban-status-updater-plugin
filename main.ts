import { 
  App, 
  Editor, 
  MarkdownView, 
  Modal, 
  Notice, 
  Plugin, 
  PluginSettingTab,
  Setting,
  TFile,
  parseYaml,
  stringifyYaml
} from 'obsidian';

interface KanbanStatusUpdaterSettings {
  statusPropertyName: string;
  showNotifications: boolean;
  debugMode: boolean;
}

const DEFAULT_SETTINGS: KanbanStatusUpdaterSettings = {
  statusPropertyName: 'status',
  showNotifications: true,
  debugMode: true
}

export default class KanbanStatusUpdaterPlugin extends Plugin {
  settings: KanbanStatusUpdaterSettings;
  statusBarItem: HTMLElement;
  
  // Track processing state to avoid redundant operations
  private isProcessing = false;
  
  async onload() {
      console.log('Loading Kanban Status Updater plugin');
      
      // Load settings
      await this.loadSettings();
      
      // Add status bar item
      this.statusBarItem = this.addStatusBarItem();
      this.statusBarItem.setText('Kanban Status Updater');
      this.statusBarItem.addClass('kanban-status-updater-statusbar');
      
      // Display startup notification
      new Notice('Kanban Status Updater activated');
      this.log('Plugin loaded');
      
      // Register DOM event listener for drag events
      this.registerDomEvent(document, 'dragend', this.onDragEnd.bind(this));
      this.log('Registered drag event listener');
      
      // Set up mutation observer to catch card movements
      this.setupMutationObserver();
      
      // Add settings tab
      this.addSettingTab(new KanbanStatusUpdaterSettingTab(this.app, this));
  }
  
  onunload() {
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
          console.log(`[Kanban Status Updater] ${message}`);
          
          // Update status bar
          this.statusBarItem.setText(`KSU: ${message.substring(0, 30)}${message.length > 30 ? '...' : ''}`);
          
          // Reset status bar after 3 seconds
          setTimeout(() => {
              this.statusBarItem.setText('Kanban Status Updater');
          }, 3000);
      }
  }
  
  setupMutationObserver() {
      // Create a mutation observer to monitor DOM changes
      const observer = new MutationObserver((mutations) => {
          if (this.isProcessing) return;
          
          // Debounce to prevent repeated processing
          setTimeout(() => {
              this.handleMutations(mutations);
          }, 500);
      });
      
      // Start observing once the layout is ready
      this.app.workspace.onLayoutReady(() => {
          // First try to observe specific Kanban elements
          const kanbanBoards = document.querySelectorAll('.kanban-plugin__board');
          
          if (kanbanBoards.length > 0) {
              this.log(`Found ${kanbanBoards.length} Kanban boards`);
              
              // Observe each board for changes
              kanbanBoards.forEach(board => {
                  observer.observe(board, {
                      childList: true,
                      subtree: true
                  });
              });
          } else {
              // Fall back to observing the entire workspace
              const workspaceContainer = document.querySelector('.workspace-split');
              if (workspaceContainer) {
                  this.log('Observing workspace for Kanban boards');
                  observer.observe(workspaceContainer, {
                      childList: true,
                      subtree: true
                  });
              } else {
                  // Last resort - observe document body
                  this.log('Falling back to observing document body');
                  observer.observe(document.body, {
                      childList: true,
                      subtree: true
                  });
              }
          }
          
          // Check for existing Kanban items
          this.scanForKanbanItems();
      });
  }
  
  scanForKanbanItems() {
      this.log('Scanning for existing Kanban items');
      const items = document.querySelectorAll('.kanban-plugin__item');
      this.log(`Found ${items.length} Kanban items`);
  }
  
  handleMutations(mutations: MutationRecord[]) {
      this.isProcessing = true;
      this.log(`Processing ${mutations.length} mutations`);
      
      try {
          // Look for Kanban card movements
          for (const mutation of mutations) {
              if (mutation.type === 'childList') {
                  // Check for Kanban items being added (which happens when cards move)
                  for (const node of Array.from(mutation.addedNodes)) {
                      if (node instanceof HTMLElement) {
                          // Check if this element is or contains a Kanban item
                          this.processElement(node);
                      }
                  }
              }
          }
      } catch (error) {
          this.log(`Error processing mutations: ${error.message}`);
      } finally {
          // Reset processing flag after a delay
          setTimeout(() => {
              this.isProcessing = false;
          }, 1000);
      }
  }
  
  onDragEnd(event: DragEvent) {
      this.log('Drag end event detected');
      
      if (this.isProcessing) {
          this.log('Already processing, ignoring drag event');
          return;
      }
      
      this.isProcessing = true;
      
      try {
          const target = event.target as HTMLElement;
          if (!target) return;
          
          this.log(`Drag ended on element: ${target.tagName}${target.className ? ' with class ' + target.className : ''}`);
          
          // Process the dragged element
          this.processElement(target);
          
      } catch (error) {
          this.log(`Error processing drag event: ${error.message}`);
      } finally {
          // Reset processing flag after a delay
          setTimeout(() => {
              this.isProcessing = false;
          }, 1000);
      }
  }
  
  processElement(element: HTMLElement) {
      try {
          // Try different strategies to find the Kanban item
          
          // 1. Check if the element itself is a Kanban item
          if (element.classList.contains('kanban-plugin__item')) {
              this.log('Element is a Kanban item');
              this.processKanbanItem(element);
              return;
          }
          
          // 2. Check if the element is an item title
          if (element.classList.contains('kanban-plugin__item-title')) {
              this.log('Element is a Kanban item title');
              const itemElement = element.closest('.kanban-plugin__item') as HTMLElement;
              if (itemElement) {
                  this.processKanbanItem(itemElement);
                  return;
              }
          }
          
          // 3. Look for Kanban items inside this element
          const items = element.querySelectorAll('.kanban-plugin__item');
          if (items.length > 0) {
              this.log(`Found ${items.length} Kanban items inside element`);
              // Process the last item (most likely the one that was moved)
              this.processKanbanItem(items[items.length - 1] as HTMLElement);
              return;
          }
          
          // 4. Check if element is inside a Kanban item
          const parentItem = element.closest('.kanban-plugin__item') as HTMLElement;
          if (parentItem) {
              this.log('Element is inside a Kanban item');
              this.processKanbanItem(parentItem);
              return;
          }
          
          this.log('No Kanban items found related to this element');
          
      } catch (error) {
          this.log(`Error in processElement: ${error.message}`);
      }
  }
  
  processKanbanItem(itemElement: HTMLElement) {
      try {
          this.log(`Processing Kanban item: ${itemElement.textContent.substring(0, 30)}...`);
          
          // 1. Find the column (lane) this item is in
          const lane = itemElement.closest('.kanban-plugin__lane');
          if (!lane) {
              this.log('Could not find lane/column for this item');
              return;
          }
          
          // 2. Get the column name from the lane header
          const laneHeader = lane.querySelector('.kanban-plugin__lane-title');
          if (!laneHeader) {
              this.log('Could not find lane header');
              return;
          }

          this.log(`laneHeader.textContent: ${laneHeader.textContent}`);
          
          const columnName = laneHeader.textContent.trim();
          this.log(`Item is in column: "${columnName}"`);
          
          // 3. Find the link in the item
          const titleElement = itemElement.querySelector('.kanban-plugin__item-title');
          if (!titleElement) {
              this.log('Could not find item title element');
              return;
          }
          
          // Look for an internal link in the markdown content
          const internalLink = titleElement.querySelector('a.internal-link');
          if (!internalLink) {
              this.log('No internal link found in item');
              return;
          }
          
          // Get the link target (note path)
          const linkPath = internalLink.getAttribute('data-href') || 
                          internalLink.getAttribute('href');
          
          if (!linkPath) {
              this.log('Link has no href or data-href attribute');
              return;
          }
          
          this.log(`Found link to note: "${linkPath}"`);
          
          // Update the linked note's status property
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
              this.log(`Could not find note: ${notePath}`);
              new Notice(`⚠️ Error: Note "${notePath}" not found`, 3000);
              return;
          }
          
          this.log(`Found file: ${file.path}`);
          
          // Read the file content
          const content = await this.app.vault.read(file);
          
          // Check if file already has frontmatter
          const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
          const frontmatterMatch = content.match(frontmatterRegex);
          
          let newContent;
          let oldStatus = null;
          
          if (frontmatterMatch) {
              // File has frontmatter
              const frontmatterText = frontmatterMatch[1];
              let frontmatterObj;
              
              try {
                  // Parse the frontmatter
                  frontmatterObj = parseYaml(frontmatterText);
                  
                  // Check for existing status property
                  if (frontmatterObj[this.settings.statusPropertyName]) {
                      oldStatus = frontmatterObj[this.settings.statusPropertyName];
                  }
                  
              } catch (e) {
                  this.log(`Error parsing frontmatter: ${e.message}`);
                  frontmatterObj = {};
              }
              
              // Update the status property
              frontmatterObj[this.settings.statusPropertyName] = status;
              
              // Generate new frontmatter text
              const newFrontmatterText = stringifyYaml(frontmatterObj);
              
              // Replace the frontmatter in the content
              newContent = content.replace(frontmatterRegex, `---\n${newFrontmatterText}---`);
              
          } else {
              // File has no frontmatter, create it
              const frontmatterObj = {
                  [this.settings.statusPropertyName]: status
              };
              
              const frontmatterText = stringifyYaml(frontmatterObj);
              newContent = `---\n${frontmatterText}---\n\n${content}`;
          }
          
          // Save the modified content
          await this.app.vault.modify(file, newContent);
          
          // Show notification
          if (this.settings.showNotifications) {
              if (oldStatus) {
                  new Notice(`Updated ${this.settings.statusPropertyName}: "${oldStatus}" → "${status}" for ${file.basename}`, 3000);
              } else {
                  new Notice(`Set ${this.settings.statusPropertyName}: "${status}" for ${file.basename}`, 3000);
              }
          }
          
          this.log(`Successfully updated status for ${file.basename}`);
          
      } catch (error) {
          this.log(`Error updating note status: ${error.message}`);
          new Notice(`⚠️ Error updating status: ${error.message}`, 3000);
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
          .setDesc('Enable detailed logging to console')
          .addToggle(toggle => toggle
              .setValue(this.plugin.settings.debugMode)
              .onChange(async (value) => {
                  this.plugin.settings.debugMode = value;
                  await this.plugin.saveSettings();
                  new Notice(`Debug mode ${value ? 'enabled' : 'disabled'}`);
              }));
      
      // Add a test button
      new Setting(containerEl)
          .setName('Test Plugin')
          .setDesc('Scan for Kanban items to verify plugin is working')
          .addButton(button => button
              .setButtonText('Run Test')
              .onClick(() => {
                  new Notice('Looking for Kanban items...');
                  const items = document.querySelectorAll('.kanban-plugin__item');
                  new Notice(`Found ${items.length} Kanban items`);
                  
                  if (items.length > 0) {
                      this.plugin.processKanbanItem(items[0] as HTMLElement);
                  }
              }));
      
      // Add troubleshooting section
      containerEl.createEl('h3', {text: 'Troubleshooting'});
      
      containerEl.createEl('p', {
          text: 'If the plugin is not working:'
      });
      
      const list = containerEl.createEl('ul');
      
      list.createEl('li', {
          text: 'Ensure the Kanban plugin is installed and enabled'
      });
      
      list.createEl('li', {
          text: 'Make sure your Kanban cards contain internal links to notes'
      });
      
      list.createEl('li', {
          text: 'Try enabling Debug Mode and check the developer console (Ctrl+Shift+I)'
      });
  }
}
