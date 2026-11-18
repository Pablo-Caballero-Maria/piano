/** Undo / redo of snapshots: push the state before each change; undo and redo swap states. */
export class UndoHistory<T> {
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  constructor(private readonly max = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Remember `before` (the state before a change); a new change forgets what could be redone. */
  push(before: T): void {
    this.undoStack.push(before);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack = [];
  }

  /** The state to go back to (current is kept for redo), or undefined if there's none. */
  undo(current: T): T | undefined {
    const before = this.undoStack.pop();
    if (before !== undefined) this.redoStack.push(current);
    return before;
  }

  /** The state to go forward to (current is kept for undo), or undefined if there's none. */
  redo(current: T): T | undefined {
    const after = this.redoStack.pop();
    if (after !== undefined) this.undoStack.push(current);
    return after;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
