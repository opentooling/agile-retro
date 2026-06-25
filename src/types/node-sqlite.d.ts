// Minimal ambient declaration for Node's built-in `node:sqlite` module.
// Kept local so the project does not depend on a specific @types/node version
// (node:sqlite types only ship with @types/node >= 22).
declare module "node:sqlite" {
  type SQLInputValue = string | number | bigint | null | Uint8Array;

  interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  class StatementSync {
    run(...params: SQLInputValue[]): StatementResultingChanges;
    get<T = Record<string, unknown>>(...params: SQLInputValue[]): T | undefined;
    all<T = Record<string, unknown>>(...params: SQLInputValue[]): T[];
  }

  interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
