import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";

interface CodyPromptPusherConfig {
  delayBetweenFiles: number;
  maxFilesAtOnce: number;
  showNotifications: boolean;
  excludePatterns: string[];
}

async function getAllFiles(folderPath: string, excludePatterns: string[]): Promise<string[]> {
  const files: string[] = [];

  async function traverse(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      // Check if path matches any exclude pattern
      if (excludePatterns.some((pattern) => fullPath.includes(pattern))) {
        continue;
      }

      if (entry.isDirectory()) {
        await traverse(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  await traverse(folderPath);
  return files;
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "codyPromptPusher.addToCody",
    async (uri: vscode.Uri, uris: vscode.Uri[]) => {
      const config = getConfiguration();
      let filesToProcess: vscode.Uri[] = [];

      // Show initial progress while collecting files
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Collecting files...",
          cancellable: false,
        },
        async (progress) => {
          try {
            // Handle multiple selection case
            const selectedItems = uris && uris.length > 0 ? uris : [uri];

            for (const item of selectedItems) {
              const stat = await vscode.workspace.fs.stat(item);

              if (stat.type === vscode.FileType.Directory) {
                // If it's a directory, get all files recursively
                const filesInFolder = await getAllFiles(item.fsPath, config.excludePatterns);
                filesToProcess.push(...filesInFolder.map((f) => vscode.Uri.file(f)));
              } else {
                // If it's a file, add it directly
                filesToProcess.push(item);
              }
            }
          } catch (error) {
            handleError(error);
            return;
          }
        }
      );

      // Check if we have any files to process
      if (filesToProcess.length === 0) {
        vscode.window.showInformationMessage("No files found to process.");
        return;
      }

      // Check max files limit
      if (filesToProcess.length > config.maxFilesAtOnce) {
        const proceed = await vscode.window.showWarningMessage(
          `Found ${filesToProcess.length} files. This exceeds the maximum of ${config.maxFilesAtOnce} files. Would you like to proceed with the first ${config.maxFilesAtOnce} files?`,
          "Yes",
          "No"
        );
        if (proceed !== "Yes") {
          return;
        }
        filesToProcess = filesToProcess.slice(0, config.maxFilesAtOnce);
      }

      // Process the files
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Adding files to Cody Chat",
            cancellable: true,
          },
          async (progress, token) => {
            token.onCancellationRequested(() => {
              throw new Error("Operation cancelled by user");
            });

            for (let i = 0; i < filesToProcess.length; i++) {
              const file = filesToProcess[i];

              try {
                const relativePath = vscode.workspace.asRelativePath(file);
                progress.report({
                  message: `Adding file ${i + 1}/${filesToProcess.length}: ${relativePath}`,
                  increment: 100 / filesToProcess.length,
                });

                await vscode.commands.executeCommand("cody.mention.file", file);

                if (config.showNotifications) {
                  vscode.window.showInformationMessage(`Added ${relativePath} to Cody Chat`);
                }

                if (i < filesToProcess.length - 1) {
                  await delay(config.delayBetweenFiles);
                }
              } catch (error) {
                throw new Error(`Failed to process ${file.fsPath}: ${error}`);
              }
            }
          }
        );
      } catch (error) {
        handleError(error);
      }
    }
  );

  context.subscriptions.push(disposable);
}

function getConfiguration(): CodyPromptPusherConfig {
  const config = vscode.workspace.getConfiguration("codyPromptPusher");
  return {
    delayBetweenFiles: config.get("delayBetweenFiles", 500),
    maxFilesAtOnce: config.get("maxFilesAtOnce", 10),
    showNotifications: config.get("showNotifications", true),
    excludePatterns: config.get("excludePatterns", ["node_modules", ".git", "dist", "build", ".next", ".vscode"]),
  };
}

function handleError(error: any) {
  const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
  vscode.window.showErrorMessage(`CodyPromptPusher Error: ${errorMessage}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function deactivate() {}
