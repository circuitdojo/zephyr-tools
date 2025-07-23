/**
 * @author Jared Wolff <jared@circuitdojo.org>
 * @copyright Circuit Dojo LLC
 * @license Apache 2.0
 */

import * as vscode from "vscode";
import * as yaml from "yaml";

interface BoardYamlSoc {
  name: string;
  variants?: Array<{ name: string }>;
}

interface BoardYamlBoard {
  name: string;
  socs: BoardYamlSoc[];
  revision?: {
    default?: string;
    revisions?: Array<{ name: string }>;
  };
}

interface BoardYamlRoot {
  board?: BoardYamlBoard;
  boards?: BoardYamlBoard[];
}

export class YamlParser {
  static async parseBoardYaml(file: string): Promise<string[]> {
    const boards: string[] = [];

    try {
      const contents = await vscode.workspace.openTextDocument(file).then(document => {
        return document.getText();
      });

      const parsed: BoardYamlRoot = yaml.parse(contents);
      let parsedBoards: BoardYamlBoard[] = [];

      // Handle both single board and multiple boards format
      if (parsed.boards !== undefined) {
        parsedBoards = parsed.boards;
      } else if (parsed.board !== undefined) {
        parsedBoards.push(parsed.board);
      }

      for (const board of parsedBoards) {
        // Check if socs has entries
        if (board.socs.length === 0) {
          continue;
        }

        const soc = board.socs[0];

        // Add basic board entry
        boards.push(`${board.name}/${soc.name}`);

        // Add all variants
        if (soc.variants !== undefined) {
          for (const variant of soc.variants) {
            boards.push(`${board.name}/${soc.name}/${variant.name}`);
          }
        }

        // Iterate all revisions if revision exists
        if (board.revision !== undefined && board.revision.revisions !== undefined) {
          for (const revision of board.revision.revisions) {
            // Check if default and continue
            if (board.revision.default === revision.name) {
              continue;
            }

            // Add board revision entry
            boards.push(`${board.name}@${revision.name}/${soc.name}`);

            // Add all variants for this revision
            if (soc.variants !== undefined) {
              for (const variant of soc.variants) {
                boards.push(`${board.name}@${revision.name}/${soc.name}/${variant.name}`);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error parsing board YAML file ${file}:`, error);
    }

    return boards;
  }

  static async parseGenericYaml<T = any>(file: string): Promise<T | null> {
    try {
      const contents = await vscode.workspace.openTextDocument(file).then(document => {
        return document.getText();
      });

      return yaml.parse(contents) as T;
    } catch (error) {
      console.error(`Error parsing YAML file ${file}:`, error);
      return null;
    }
  }

  static parseYamlString<T = any>(yamlString: string): T | null {
    try {
      return yaml.parse(yamlString) as T;
    } catch (error) {
      console.error("Error parsing YAML string:", error);
      return null;
    }
  }

  static stringifyYaml(obj: any, options?: yaml.ToStringOptions): string {
    try {
      return yaml.stringify(obj, options);
    } catch (error) {
      console.error("Error stringifying object to YAML:", error);
      return "";
    }
  }

  static validateYamlFile(file: string): Promise<boolean> {
    return new Promise(async (resolve) => {
      try {
        await this.parseGenericYaml(file);
        resolve(true);
      } catch (error) {
        console.error(`YAML validation failed for ${file}:`, error);
        resolve(false);
      }
    });
  }

  static async extractBoardArchitecture(file: string): Promise<string | null> {
    try {
      const parsed = await this.parseGenericYaml<BoardYamlRoot>(file);
      if (!parsed) return null;

      const board = parsed.board || (parsed.boards && parsed.boards[0]);
      if (board && board.socs && board.socs.length > 0) {
        // This is a simplified approach - in reality, you'd need to cross-reference
        // with SoC definitions to get the actual architecture
        return board.socs[0].name; // Return SoC name as a proxy for architecture
      }
    } catch (error) {
      console.error(`Error extracting architecture from ${file}:`, error);
    }

    return null;
  }

  static async getBoardMetadata(file: string): Promise<{
    name: string;
    soc: string;
    arch?: string;
    variants?: string[];
    revisions?: string[];
  } | null> {
    try {
      const parsed = await this.parseGenericYaml<BoardYamlRoot>(file);
      if (!parsed) return null;

      const board = parsed.board || (parsed.boards && parsed.boards[0]);
      if (!board || !board.socs || board.socs.length === 0) return null;

      const soc = board.socs[0];
      
      return {
        name: board.name,
        soc: soc.name,
        variants: soc.variants?.map(v => v.name) || [],
        revisions: board.revision?.revisions?.map(r => r.name) || []
      };
    } catch (error) {
      console.error(`Error extracting board metadata from ${file}:`, error);
      return null;
    }
  }
}
