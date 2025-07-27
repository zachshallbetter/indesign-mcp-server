/**
 * Group management handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, escapeJsxString } from '../utils/stringUtils.js';

export class GroupHandlers {
    /**
     * Create a group from selected items
     */
    static async createGroup(args) {
        const { pageIndex } = args;

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            '    var selection = app.selection;',
            '',
            '    if (selection.length < 2) {',
            '      "Select at least 2 items to create a group";',
            '    } else {',
            '      var group = selection[0].group();',
            '      "Group created successfully with " + group.allPageItems.length + " items";',
            '    }',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Group");
    }

    /**
     * Create a group from specific page items
     */
    static async createGroupFromItems(args) {
        const { pageIndex, itemIndices } = args;

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            `    var indices = [${itemIndices.join(', ')}];`,
            '',
            '    if (indices.length < 2) {',
            '      "Need at least 2 items to create a group";',
            '    } else {',
            '      var items = [];',
            '      for (var i = 0; i < indices.length; i++) {',
            '        if (indices[i] < page.allPageItems.length) {',
            '          items.push(page.allPageItems[indices[i]]);',
            '        }',
            '      }',
            '',
            '      if (items.length < 2) {',
            '        "Not enough valid items to create a group";',
            '      } else {',
            '        // Select the items first',
            '        for (var j = 0; j < items.length; j++) {',
            '          if (j === 0) {',
            '            items[j].select();',
            '          } else {',
            '            items[j].select(SelectionOptions.ADD_TO);',
            '          }',
            '        }',
            '',
            '        var group = items[0].group();',
            '        "Group created successfully with " + group.allPageItems.length + " items";',
            '      }',
            '    }',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Group From Items");
    }

    /**
     * Ungroup a group
     */
    static async ungroup(args) {
        const { pageIndex, groupIndex } = args;

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            `    if (${groupIndex} >= page.allPageItems.length) {`,
            '      "Group index out of range";',
            '    } else {',
            `      var item = page.allPageItems[${groupIndex}];`,
            '',
            '      if (item.constructor.name !== "Group") {',
            '        "Selected item is not a group";',
            '      } else {',
            '        var itemCount = item.allPageItems.length;',
            '        item.ungroup();',
            '        "Group ungrouped successfully. " + itemCount + " items released";',
            '      }',
            '    }',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Ungroup");
    }

    /**
     * Get group information
     */
    static async getGroupInfo(args) {
        const { pageIndex, groupIndex } = args;

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            `    if (${groupIndex} >= page.allPageItems.length) {`,
            '      "Group index out of range";',
            '    } else {',
            `      var item = page.allPageItems[${groupIndex}];`,
            '',
            '      if (item.constructor.name !== "Group") {',
            '        "Selected item is not a group";',
            '      } else {',
            '        var info = "=== GROUP INFO ===\\n";',
            '        info += "Name: " + (item.name || "Unnamed") + "\\n";',
            '        info += "ID: " + item.id + "\\n";',
            '        info += "Visible: " + item.visible + "\\n";',
            '        info += "Locked: " + item.locked + "\\n";',
            '        info += "Bounds: " + item.geometricBounds.join(", ") + "\\n";',
            '        info += "Item Count: " + item.allPageItems.length + "\\n\\n";',
            '',
            '        info += "=== GROUP CONTENTS ===\\n";',
            '        for (var i = 0; i < item.allPageItems.length; i++) {',
            '          var groupItem = item.allPageItems[i];',
            '          info += "Item " + i + ": " + groupItem.constructor.name + " (ID: " + groupItem.id + ")\\n";',
            '        }',
            '',
            '        info;',
            '      }',
            '    }',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Get Group Info");
    }

    /**
     * Add item to group
     */
    static async addItemToGroup(args) {
        const { pageIndex, groupIndex, itemIndex } = args;

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            `    if (${groupIndex} >= page.allPageItems.length) {`,
            '      "Group index out of range";',
            '    } else {',
            `      var group = page.allPageItems[${groupIndex}];`,
            '',
            '      if (group.constructor.name !== "Group") {',
            '        "Selected item is not a group";',
            '      } else {',
            `        if (${itemIndex} >= page.allPageItems.length) {`,
            '          "Item index out of range";',
            '        } else {',
            `          var item = page.allPageItems[${itemIndex}];`,
            '          group.add(item);',
            '          "Item added to group successfully";',
            '        }',
            '      }',
            '    }',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Add Item to Group");
    }

    /**
     * Remove item from group
     */
    static async removeItemFromGroup(args) {
        const { pageIndex, groupIndex, itemIndex } = args;

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            `    if (${groupIndex} >= page.allPageItems.length) {`,
            '      "Group index out of range";',
            '    } else {',
            `      var group = page.allPageItems[${groupIndex}];`,
            '',
            '      if (group.constructor.name !== "Group") {',
            '        "Selected item is not a group";',
            '      } else {',
            `        if (${itemIndex} >= group.allPageItems.length) {`,
            '          "Item index out of range in group";',
            '        } else {',
            `          var item = group.allPageItems[${itemIndex}];`,
            '          group.remove(item);',
            '          "Item removed from group successfully";',
            '        }',
            '      }',
            '    }',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Remove Item from Group");
    }

    /**
     * List all groups on a page
     */
    static async listGroups(args) {
        const { pageIndex } = args;

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            '    var items = page.allPageItems;',
            '    var result = "=== GROUPS ===\\n";',
            '    var groupCount = 0;',
            '',
            '    for (var i = 0; i < items.length; i++) {',
            '      var item = items[i];',
            '      if (item.constructor.name === "Group") {',
            '        result += "Group Index: " + i + "\\n";',
            '        result += "Name: " + (item.name || "Unnamed") + "\\n";',
            '        result += "ID: " + item.id + "\\n";',
            '        result += "Visible: " + item.visible + "\\n";',
            '        result += "Locked: " + item.locked + "\\n";',
            '        result += "Item Count: " + item.allPageItems.length + "\\n";',
            '        result += "Bounds: " + item.geometricBounds.join(", ") + "\\n";',
            '        result += "---\\n";',
            '        groupCount++;',
            '      }',
            '    }',
            '',
            '    if (groupCount === 0) {',
            '      result += "No groups found on this page";',
            '    }',
            '',
            '    result;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "List Groups");
    }

    /**
     * Set group properties
     */
    static async setGroupProperties(args) {
        const { pageIndex, groupIndex, visible, locked, name } = args;

        const escapedName = name ? escapeJsxString(name) : '';

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            `  if (${pageIndex} >= doc.pages.length) {`,
            '    "Page index out of range";',
            '  } else {',
            `    var page = doc.pages[${pageIndex}];`,
            `    if (${groupIndex} >= page.allPageItems.length) {`,
            '      "Group index out of range";',
            '    } else {',
            `      var group = page.allPageItems[${groupIndex}];`,
            '',
            '      if (group.constructor.name !== "Group") {',
            '        "Selected item is not a group";',
            '      } else {',
            `        if (${visible} !== undefined) {`,
            `          group.visible = ${visible};`,
            '        }',
            '',
            `        if (${locked} !== undefined) {`,
            `          group.locked = ${locked};`,
            '        }',
            '',
            `        if ("${escapedName}" !== "") {`,
            `          group.name = "${escapedName}";`,
            '        }',
            '',
            '        "Group properties updated successfully";',
            '      }',
            '    }',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Set Group Properties");
    }
} 