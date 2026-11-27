# Library folders

Teachers organise their topics, books and presentations in folders, like Google Drive, but kept simple.

## What the teacher sees

- **One set of folders for all three tabs.** "Grade 3 › Unit 1" is made once. Topics, Books and PowerPoint each show only their own kind inside it.
- **Inside a tab:**
  - a breadcrumb (🏠 My library › Grade 3 › Unit 1) to go back up;
  - Newest / A–Z sort, remembered on the device;
  - 📁 New folder;
  - the folders of the current folder, then the items.
- **A folder** has a name, one of 8 colours and an optional emoji. Its card shows "3 topics · 1 folder".
  - It is faded when it holds nothing of this tab's kind, for example on the PowerPoint tab when it has no presentations.
  - Its tools (show on hover, always on touch screens): edit, Move to…, delete.
- **Moving** is done with the **Move to…** icon on each card, or the "Move to… (n)" button for ticked topics or books. Nothing is dragged. Folders can be moved too, but never into themselves.
- **Deleting a folder deletes nothing inside.** Its folders and items move up one level.
- **Search** looks in every folder. Each result shows its folder path (📁 Grade 3 › Unit 1).
- **New things go into the folder being looked at:**
  - new, combined and imported topics;
  - new and imported books;
  - added, blank and link presentations.
- **Copies and book topics:**
  - a copy goes next to its original;
  - a topic made while reading a book goes to the top.

## Where it is stored

- **Dexie v14**:
  - `folders` (id, name, parentId, where `''` means the top, color, emoji);
  - `folderPlacements` (`book:<id>` / `ppt:<id>` → folderId; no row means the top).
- **Topics** keep `folderId` and `folderMovedAt` on the topic.
- **Exports:**
  - A topic export carries `folder`: the path of names, colours and emoji from the top down.
  - Import finds the folders again by name, or makes them.
  - So **Export All** and the **Google Drive backup** bring the organisation back.
  - The Drive backup sends a topic again when it changes folder, or when its folder is renamed or moved (`folderMovedAt`).
- **Book and presentation placements stay on the device.** A book export does not carry its folder.
- **Code:**
  - `core/folders.ts` (FolderService, `folderPathOf`, `ensureFolderPath`, `currentFolderId`);
  - `shared/library-folders.*` (bar, cards and dialogs);
  - the tabs: `topics-list`, `presentation-library`.
