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
  FrontMatterCache, 
  parseYaml,
  stringifyYaml,
  WorkspaceLeaf
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

  // Process flags to avoid infinite loops
  private processingMutation: boolean = false;
  private pendingCardUpdates: Map<string, {card: HTMLElement, column: HTMLElement}> = new Map();
  private mutationDebounceTimeout: NodeJS.Timeout = null;
  debugLog: (message: string) => void;
  statusBarItem: any;

  async onload() {
      await this.loadSettings();

      // Set up debug logging with rate limiting
      let lastLogTime = Date.now();
      let logCount = 0;
      this.debugLog = (message: string) => {
          if (this.settings.debugMode) {
              // Rate limit logs to prevent console flooding
              const now = Date.now();
              if (now - lastLogTime > 5000) {
                  // Reset counter after 5 seconds
                  logCount = 0;
                  lastLogTime = now;
              }
              
              if (logCount < 50) { // Limit to 50 logs per 5 seconds
                  console.log(`[Kanban Status Updater] ${message}`);
                  logCount++;
                  
                  if (this.statusBarItem) {
                      this.statusBarItem.setText(`[KSU] ${message.substring(0, 40)}${message.length > 40 ? '...' : ''}`);
                      // Reset after 5 seconds
                      setTimeout(() => {
                          if (this.statusBarItem) {
                              this.statusBarItem.setText('Kanban Status Updater Active');
                          }
                      }, 5000);
                  }
              } else if (logCount === 50) {
                  console.log(`[Kanban Status Updater] Too many logs, throttling until ${new Date(lastLogTime + 5000).toLocaleTimeString()}`);
                  logCount++;
              }
          }
      };
      
      // Display startup notification
      new Notice('Kanban Status Updater plugin activated');
      this.debugLog('Plugin loaded and activated');

      // Hook into DOM events to detect Kanban card movements
      this.registerDomEvent(document, 'dragend', this.handleDragEnd.bind(this));
      this.debugLog('Registered drag event listener');
      
      // Register for mutation events to catch non-drag updates - with optimizations
      const observer = new MutationObserver((mutations) => {
          // Skip processing if we're already handling a mutation
          if (this.processingMutation) return;
          
          // Debounce mutation processing to avoid too many updates
          if (this.mutationDebounceTimeout) {
              clearTimeout(this.mutationDebounceTimeout);
          }
          
          this.mutationDebounceTimeout = setTimeout(() => {
              this.handleDOMMutations(mutations);
              this.mutationDebounceTimeout = null;
          }, 500); // Wait 500ms before processing
      });
      
      this.app.workspace.onLayoutReady(() => {
          // Find Kanban board containers to observe more specifically
          const kanbanBoards = document.querySelectorAll('.kanban-plugin__board');
          
          if (kanbanBoards && kanbanBoards.length > 0) {
              // Observe each Kanban board specifically rather than the entire document
              kanbanBoards.forEach(board => {
                  observer.observe(board, { 
                      childList: true, 
                      subtree: true,
                      attributes: false  // Don't need attribute changes, just structure
                  });
              });
              this.debugLog(`MutationObserver attached to ${kanbanBoards.length} Kanban boards`);
          } else {
              // Fallback to a more targeted observation if no boards found
              const workspace = document.querySelector('.workspace');
              if (workspace) {
                  observer.observe(workspace, {
                      childList: true,
                      subtree: true,
                      attributes: false
                  });
                  this.debugLog('MutationObserver attached to workspace (no Kanban boards found yet)');
              } else {
                  // Last resort - observe body with more restrictions
                  observer.observe(document.body, { 
                      childList: true, 
                      subtree: true,
                      attributes: false
                  });
                  this.debugLog('MutationObserver attached to document body (fallback mode)');
              }
          }
          
          // Set up a periodic check for new Kanban boards (in case they're added later)
          setInterval(() => {
              const currentBoards = document.querySelectorAll('.kanban-plugin__board');
              if (currentBoards && currentBoards.length > 0) {
                  currentBoards.forEach(board => {
                      if (!board.hasAttribute('data-ksu-observed')) {
                          observer.observe(board, { 
                              childList: true, 
                              subtree: true,
                              attributes: false
                          });
                          board.setAttribute('data-ksu-observed', 'true');
                          this.debugLog('Added observer to new Kanban board');
                      }
                  });
              }
          }, 10000); // Check every 10 seconds
      });

      // Add settings tab
      this.addSettingTab(new KanbanStatusUpdaterSettingTab(this.app, this));

      // Add a status bar item to show the plugin is active
      this.statusBarItem = this.addStatusBarItem();
      this.statusBarItem.setText('Kanban Status Updater Active');
      this.statusBarItem.addClass('plugin-kanban-status-updater');
      
      // Check if Kanban plugin is loaded - using safer approach
      try {
          // @ts-ignore - Check if kanban plugin exists using app.plugins (may not be in type definitions)
          const kanbanLoaded = this.app.plugins && 
                               // @ts-ignore
                               ((this.app.plugins.plugins && this.app.plugins.plugins['obsidian-kanban']) || 
                                // @ts-ignore
                                (this.app.plugins.enabledPlugins && this.app.plugins.enabledPlugins.has('obsidian-kanban')));
          
          if (!kanbanLoaded) {
              new Notice('⚠️ Warning: Kanban plugin might not be enabled. Kanban Status Updater requires it.', 10000);
              this.debugLog('WARNING: Kanban plugin not detected!');
          } else {
              this.debugLog('Kanban plugin detected');
          }
      } catch (e) {
          // If we can't detect it, just log and continue
          this.debugLog(`Couldn't verify Kanban plugin: ${e.message}`);
      }
  }

  onunload() {
      this.debugLog('Plugin unloaded');
      new Notice('Kanban Status Updater plugin deactivated');
  }

  async loadSettings() {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
      await this.saveData(this.settings);
  }

  handleDragEnd(evt: DragEvent) {
      // Check if this was a Kanban card being dragged
      const target = evt.target as HTMLElement;
      if (!target) {
          this.debugLog('Drag event had no target');
          return;
      }
      
      this.debugLog(`Drag event detected on element: ${target.tagName}${target.className ? ' with class ' + target.className : ''}`);
      
      const kanbanCard = target.closest('.kanban-card');
      if (!kanbanCard) {
          this.debugLog('Element is not or does not contain a Kanban card');
          return;
      }
      
      this.debugLog('Kanban card found in drag event');
      
      // Get the column the card was dropped in
      const column = kanbanCard.closest('.kanban-column');
      if (!column) {
          this.debugLog('Could not find parent Kanban column');
          return;
      }
      
      this.debugLog('Card was moved to a column, processing movement');
      
      // Process the card movement
      this.processCardMovement(kanbanCard as HTMLElement, column as HTMLElement);
  }

  handleDOMMutations(mutations: MutationRecord[]) {
      if (this.processingMutation) {
          this.debugLog('Already processing mutations, skipping');
          return;
      }
      
      // Process only a sample of mutations if there are too many
      const mutationsToProcess = mutations.length > 10 ? 
          mutations.slice(0, 10) : mutations;
          
      this.debugLog(`Processing ${mutationsToProcess.length} mutations (of ${mutations.length} total)`);
      
      // Set flag to prevent recursive processing
      this.processingMutation = true;

      try {
          // Clear the pending updates map
          this.pendingCardUpdates.clear();
          
          // Check for relevant mutations (card being added to a column)
          for (const mutation of mutationsToProcess) {
              if (mutation.type === 'childList') {
                  // Only log if there are actually Kanban-related nodes
                  let foundKanbanElements = false;

                  this.debugLog(`mutation.type === 'childList'`);
                  
                  for (const node of Array.from(mutation.addedNodes)) {
                      if (node instanceof HTMLElement) {
                          // Check if this is or contains Kanban card elements
                          const isKanbanElement = 
                              node.classList.contains('kanban-card') ||
                              node.classList.contains('kanban-column') ||
                              node.querySelector('.kanban-card') !== null;


                          this.debugLog(`node.classList: ${node.classList}`);
                          this.debugLog(`node.tagName: ${node.tagName}`);
                          this.debugLog(`node.className: ${node.className}`);
                          
                          this.debugLog(`isKanbanElement -------------------- ${isKanbanElement}`);

                          if (isKanbanElement) {
                              foundKanbanElements = true;
                              
                              // Only now log details
                              this.debugLog(`Relevant mutation: ${node.tagName}${node.className ? ' with class ' + node.className : ''}`);
                              
                              // Look for Kanban cards
                              const kanbanCards = node.classList.contains('kanban-card') 
                                  ? [node] 
                                  : Array.from(node.querySelectorAll('.kanban-card'));
                              
                              for (const card of kanbanCards) {
                                  const column = card.closest('.kanban-column');
                                  if (column) {
                                      // Create a unique ID for this card to avoid duplicates
                                      const cardText = card.textContent?.trim();
                                      const cardId = cardText?.substring(0, 50) || card.id || 'unknown';
                                      
                                      this.debugLog(`Added card to pendingCardUpdates: ${cardText}`);
                                      this.debugLog(`Column: ${column.textContent}`);

                                      // Add to pending updates map, this way if same card appears in multiple
                                      // mutations, we only process the last one
                                      this.pendingCardUpdates.set(cardId, {
                                          card: card as HTMLElement, 
                                          column: column as HTMLElement
                                      });
                                      
                                      this.debugLog(`Queued card update: ${cardId.substring(0, 20)}...`);
                                  }
                              }
                          }
                      }
                  }
                  
                  // Only log for mutations with Kanban elements
                  if (foundKanbanElements) {
                      this.debugLog(`Processed mutation with ${mutation.addedNodes.length} nodes`);
                  }
              }
          }
          
          // Process all pending updates
          if (this.pendingCardUpdates.size > 0) {
              this.debugLog(`Processing ${this.pendingCardUpdates.size} card updates`);
              
              // Process each card update (with a slight delay between them to avoid overloading)
              let index = 0;
              for (const [cardId, {card, column}] of this.pendingCardUpdates.entries()) {
                  // Stagger processing to avoid too much at once
                  setTimeout(() => {
                      this.processCardMovement(card, column);
                  }, index * 100); // 100ms between each card
                  index++;
              }
          }
      } catch (e) {
          this.debugLog(`Error processing mutations: ${e.message}`);
      } finally {
          // Clear the flag when done
          setTimeout(() => {
              this.processingMutation = false;
              this.debugLog('Mutation processing complete');
          }, 1000); // Ensure a minimum cool-down period between mutation processing
      }
  }

  processCardMovement(card: HTMLElement, column: HTMLElement) {
      // Get the column name (new status)
      const headerElement = column.querySelector('.kanban-column-header');
      if (!headerElement) {
          this.debugLog('Could not find column header element');
          return;
      }
      
      const newStatus = headerElement.textContent.trim();
      this.debugLog(`Column name (new status): "${newStatus}"`);
      
      // Get the card content and look for the first link
      const cardContentElement = card.querySelector('.kanban-card-text, .kanban-card-content');
      if (!cardContentElement) {
          this.debugLog('Could not find card content element');
          return;
      }
      
      const cardContent = cardContentElement.textContent;
      this.debugLog(`Card content: "${cardContent.substring(0, 50)}${cardContent.length > 50 ? '...' : ''}"`);
      
      // Look for wiki-links [[Link]] or [[Link|Display Text]]
      const linkMatch = cardContent.match(/\[\[(.*?)(?:\|.*?)?\]\]/);
      
      if (!linkMatch || !linkMatch[1]) {
          this.debugLog(`No link found in card: ${cardContent}`);
          new Notice('⚠️ No link found in Kanban card', 3000);
          return;
      }
      
      const linkPath = linkMatch[1].trim();
      this.debugLog(`Found link to: "${linkPath}"`);
      
      // Show visual confirmation that we're updating
      new Notice(`Updating ${this.settings.statusPropertyName} to "${newStatus}" for "${linkPath}"...`, 2000);
      
      this.updateLinkedNoteStatus(linkPath, newStatus);
  }

  async updateLinkedNoteStatus(linkPath: string, newStatus: string) {
      // Find the linked file
      const file = this.app.metadataCache.getFirstLinkpathDest(linkPath, '');
      
      if (!file) {
          this.debugLog(`Linked file not found: ${linkPath}`);
          new Notice(`⚠️ Error: File "${linkPath}" not found`, 5000);
          return;
      }
      
      this.debugLog(`Found linked file: ${file.path}`);
      
      try {
          // Read the file content
          const content = await this.app.vault.read(file);
          this.debugLog(`File content loaded (${content.length} chars)`);
          
          // Check if the file has frontmatter
          const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
          const frontmatterMatch = content.match(frontmatterRegex);
          
          let newContent;
          let oldStatus = 'none';
          let action = 'created';
          
          if (frontmatterMatch) {
              this.debugLog('File has frontmatter');
              // File has frontmatter
              const frontmatterText = frontmatterMatch[1];
              let frontmatterObj;
              
              try {
                  // Try to parse the frontmatter
                  frontmatterObj = parseYaml(frontmatterText);
                  this.debugLog('Frontmatter parsed successfully');
                  
                  // Check if status property already exists
                  if (frontmatterObj[this.settings.statusPropertyName]) {
                      oldStatus = frontmatterObj[this.settings.statusPropertyName];
                      action = 'updated';
                  }
                  
              } catch (e) {
                  this.debugLog(`Error parsing frontmatter: ${e.message}`);
                  new Notice(`⚠️ Warning: Invalid frontmatter in ${file.basename}, creating new frontmatter`, 5000);
                  frontmatterObj = {};
              }
              
              // Update the status property
              frontmatterObj[this.settings.statusPropertyName] = newStatus;
              
              // Generate the new frontmatter text
              const newFrontmatterText = stringifyYaml(frontmatterObj);
              this.debugLog('New frontmatter generated');
              
              // Replace the frontmatter in the content
              newContent = content.replace(frontmatterRegex, `---\n${newFrontmatterText}---`);
          } else {
              this.debugLog('File has no frontmatter, creating new frontmatter');
              // File has no frontmatter, create it
              const frontmatterObj = {
                  [this.settings.statusPropertyName]: newStatus
              };
              const frontmatterText = stringifyYaml(frontmatterObj);
              newContent = `---\n${frontmatterText}---\n\n${content}`;
          }
          
          // Save the modified content
          await this.app.vault.modify(file, newContent);
          this.debugLog('File modified successfully');
          
          // Show notification with more details
          const banner = createFragment(el => {
              el.createDiv({ 
                  text: `✅ ${this.settings.statusPropertyName} ${action}:`,
                  cls: 'status-updated-banner-title'
              });
              el.createDiv({
                  cls: 'status-updated-banner-details'
              }, div => {
                  div.createSpan({ text: 'File: ' });
                  div.createSpan({ 
                      text: file.basename,
                      cls: 'status-updated-filename'
                  });
                  div.createEl('br');
                  if (action === 'updated') {
                      div.createSpan({ text: 'Changed from: ' });
                      div.createSpan({ 
                          text: `"${oldStatus}"`,
                          cls: 'status-updated-old-value'
                      });
                      div.createEl('br');
                  }
                  div.createSpan({ text: 'New value: ' });
                  div.createSpan({ 
                      text: `"${newStatus}"`,
                      cls: 'status-updated-new-value'
                  });
              });
          });
          
          // Always show the detailed banner
          new Notice(banner, 5000);
          
          // Update status bar
          this.statusBarItem.setText(`Updated: ${file.basename} → ${newStatus}`);
          setTimeout(() => {
              this.statusBarItem.setText('Kanban Status Updater Active');
          }, 5000);
          
          this.debugLog(`Success: ${this.settings.statusPropertyName} for ${file.basename} ${action} from "${oldStatus}" to "${newStatus}"`);
      } catch (error) {
          this.debugLog(`Error updating note status: ${error.message}`);
          new Notice(`⚠️ Error updating ${this.settings.statusPropertyName} for ${file.basename}: ${error.message}`, 10000);
      }
  }
}

// Settings Tab
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
          .setDesc('Enable detailed logging to console and status bar updates')
          .addToggle(toggle => toggle
              .setValue(this.plugin.settings.debugMode)
              .onChange(async (value) => {
                  this.plugin.settings.debugMode = value;
                  await this.plugin.saveSettings();
                  new Notice(`Debug mode ${value ? 'enabled' : 'disabled'}`);
              }));
              
      // Add a button to trigger a test update
      new Setting(containerEl)
          .setName('Test Plugin')
          .setDesc('Run a test to verify plugin functionality')
          .addButton(button => button
              .setButtonText('Run Test')
              .onClick(() => {
                  new Notice('Test function running - check console for logs');
                  this.plugin.debugLog('Test function triggered from settings');
                  
                  // Show an example of what a successful update would look like
                  const banner = createFragment(el => {
                      el.createDiv({ 
                          text: `✅ ${this.plugin.settings.statusPropertyName} updated:`,
                          cls: 'status-updated-banner-title'
                      });
                      el.createDiv({
                          cls: 'status-updated-banner-details'
                      }, div => {
                          div.createSpan({ text: 'File: ' });
                          div.createSpan({ 
                              text: 'Example Note',
                              cls: 'status-updated-filename'
                          });
                          div.createEl('br');
                          div.createSpan({ text: 'Changed from: ' });
                          div.createSpan({ 
                              text: '"In Progress"',
                              cls: 'status-updated-old-value'
                          });
                          div.createEl('br');
                          div.createSpan({ text: 'New value: ' });
                          div.createSpan({ 
                              text: '"Completed"',
                              cls: 'status-updated-new-value'
                          });
                      });
                  });
                  
                  new Notice(banner, 5000);
              }));
              
      containerEl.createEl('h3', {text: 'Troubleshooting'});
      
      containerEl.createEl('p', {
          text: 'If the plugin is not working, check the following:'
      });
      
      const troubleshootingList = containerEl.createEl('ul');
      
      troubleshootingList.createEl('li', {
          text: 'Ensure the Kanban plugin is installed and enabled'
      });
      
      troubleshootingList.createEl('li', {
          text: 'Verify your Kanban cards contain wiki-links (e.g., [[Note Title]])'
      });
      
      troubleshootingList.createEl('li', {
          text: 'Try enabling Debug Mode to see detailed logs in the developer console (Ctrl+Shift+I)'
      });
  }
}
