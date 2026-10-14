/**
 * Group management handlers
 *
 * Groups are addressed by their index in page.allPageItems (as reported by
 * list_groups / list_page_items). Members of a group are addressed by their
 * index in group.pageItems (direct members, as reported by get_group_info).
 * InDesign has no API to add/remove a single member of an existing group, so
 * those tools ungroup and regroup (member IDs are preserved; the group gets a
 * new ID and keeps its name).
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, str, index, bool } from '../utils/stringUtils.js';
import { jsxProgram, jsxPage, jsxItemAt, JSX_HELPERS } from './pageItemHandlers.js';

const has = (v) => v !== undefined && v !== null && v !== '';

/** Resolve `group` = page.allPageItems[groupIndex], requiring a Group. */
function jsxGroupAt(groupIndex) {
    return [
        'var __items = page.allPageItems;',
        ...jsxItemAt('group', '__items', groupIndex, 'Group index'),
        `if (group.constructor.name !== "Group") { return "Invalid group index ${index(groupIndex, { name: 'groupIndex' })}: item is a " + group.constructor.name + ", not a Group"; }`,
    ];
}

/** True when `o` sits directly on a spread (not nested in a group/frame). */
const JSX_TOP_LEVEL = [
    'function __topLevel(o) {',
    '  var t = o.parent.constructor.name;',
    '  return t === "Spread" || t === "MasterSpread";',
    '}',
];

export class GroupHandlers {
    /**
     * Create a group from selected items
     */
    static async createGroup(args) {
        const { pageIndex } = args;

        const script = jsxProgram([
            ...jsxPage(pageIndex),
            'var sel = app.selection;',
            'var items = [];',
            'for (var i = 0; i < sel.length; i++) {',
            '  var gb = null;',
            '  try { gb = sel[i].geometricBounds; } catch (__ge) { gb = null; }',
            '  if (gb) { items.push(sel[i]); }',
            '}',
            'if (items.length < 2) { return "Cannot create group: select at least 2 page items (" + items.length + " selected)"; }',
            'var group = page.groups.add(items);',
            'return "Group created with " + group.pageItems.length + " items (ID " + group.id + ")";',
        ], { errorPrefix: 'Error creating group' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Group");
    }

    /**
     * Create a group from specific page items
     */
    static async createGroupFromItems(args) {
        const { pageIndex, itemIndices } = args;
        if (!Array.isArray(itemIndices)) {
            return formatResponse('Invalid itemIndices: expected an array of integers', 'Create Group From Items');
        }
        const indices = [...new Set(itemIndices.map((i) => index(i, { name: 'itemIndices[]' })))];
        if (indices.length < 2) {
            return formatResponse('Invalid itemIndices: need at least 2 distinct item indices', 'Create Group From Items');
        }

        const script = jsxProgram([
            ...JSX_TOP_LEVEL,
            ...jsxPage(pageIndex),
            'var all = page.allPageItems;',
            `var indices = [${indices.join(', ')}];`,
            'var items = [];',
            'for (var i = 0; i < indices.length; i++) {',
            '  if (indices[i] >= all.length) { return "Page item index " + indices[i] + " out of range (" + all.length + " available)"; }',
            '  var it = all[indices[i]];',
            '  if (!__topLevel(it)) { return "Cannot group item " + indices[i] + ": it is nested inside a " + it.parent.constructor.name; }',
            '  items.push(it);',
            '}',
            'var group = page.groups.add(items);',
            'return "Group created with " + group.pageItems.length + " items (ID " + group.id + ")";',
        ], { errorPrefix: 'Error creating group' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Create Group From Items");
    }

    /**
     * Ungroup a group
     */
    static async ungroup(args) {
        const { pageIndex, groupIndex } = args;

        const script = jsxProgram([
            ...jsxPage(pageIndex),
            ...jsxGroupAt(groupIndex),
            'if (group.locked) { return "Cannot ungroup: group is locked"; }',
            'var itemCount = group.pageItems.length;',
            'group.ungroup();',
            'return "Group ungrouped; " + itemCount + " items released";',
        ], { errorPrefix: 'Error ungrouping' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Ungroup");
    }

    /**
     * Get group information
     */
    static async getGroupInfo(args) {
        const { pageIndex, groupIndex } = args;

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            ...jsxGroupAt(groupIndex),
            'var pb = page.bounds;',
            'var gb = group.geometricBounds;',
            'var members = group.pageItems.everyItem().getElements();',
            'var info = "=== GROUP INFO ===\\n";',
            'info += "Name: " + (group.name || "Unnamed") + "\\n";',
            'info += "ID: " + group.id + "\\n";',
            'info += "Visible: " + group.visible + "\\n";',
            'info += "Locked: " + group.locked + "\\n";',
            'info += "Position (mm from page top-left): x=" + __mm(gb[1] - pb[1]) + ", y=" + __mm(gb[0] - pb[0]) + "\\n";',
            'info += "Size (mm): " + __mm(gb[3] - gb[1]) + " x " + __mm(gb[2] - gb[0]) + "\\n";',
            'info += "Direct members: " + members.length + " (all nested items: " + group.allPageItems.length + ")\\n\\n";',
            'info += "=== GROUP MEMBERS (index for remove_item_from_group) ===\\n";',
            'for (var i = 0; i < members.length; i++) {',
            '  info += "Item " + i + ": " + members[i].constructor.name + " (ID: " + members[i].id + ")\\n";',
            '}',
            'return info;',
        ], { errorPrefix: 'Error getting group info' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Get Group Info");
    }

    /**
     * Add item to group (ungroup + regroup with the extra item)
     */
    static async addItemToGroup(args) {
        const { pageIndex, groupIndex, itemIndex } = args;

        const script = jsxProgram([
            ...JSX_TOP_LEVEL,
            ...jsxPage(pageIndex),
            ...jsxGroupAt(groupIndex),
            ...jsxItemAt('item', '__items', itemIndex, 'Item index'),
            'if (item.id === group.id) { return "Cannot add a group to itself"; }',
            'if (!__topLevel(group)) { return "Cannot modify a nested group; ungroup its parent first"; }',
            'if (!__topLevel(item)) { return "Cannot add item: it is nested inside a " + item.parent.constructor.name; }',
            'if (group.locked || item.locked) { return "Cannot add item: the group or the item is locked"; }',
            'var groupName = group.name;',
            'var members = group.pageItems.everyItem().getElements();',
            'members.push(item);',
            'group.ungroup();',
            'var newGroup = page.groups.add(members);',
            'if (groupName) { newGroup.name = groupName; }',
            'return "Item added to group; group now has " + newGroup.pageItems.length + " items (new group ID " + newGroup.id + ")";',
        ], { errorPrefix: 'Error adding item to group' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Add Item to Group");
    }

    /**
     * Remove item from group (ungroup + regroup the remaining members)
     */
    static async removeItemFromGroup(args) {
        const { pageIndex, groupIndex, itemIndex } = args;

        const script = jsxProgram([
            ...JSX_TOP_LEVEL,
            ...jsxPage(pageIndex),
            ...jsxGroupAt(groupIndex),
            'if (!__topLevel(group)) { return "Cannot modify a nested group; ungroup its parent first"; }',
            'if (group.locked) { return "Cannot remove item: group is locked"; }',
            'var members = group.pageItems.everyItem().getElements();',
            ...jsxItemAt('removed', 'members', itemIndex, 'Group member index'),
            'var rest = [];',
            'for (var i = 0; i < members.length; i++) { if (members[i].id !== removed.id) { rest.push(members[i]); } }',
            'var groupName = group.name;',
            'group.ungroup();',
            'if (rest.length < 2) { return "Item removed; group dissolved because only " + rest.length + " item remained"; }',
            'var newGroup = page.groups.add(rest);',
            'if (groupName) { newGroup.name = groupName; }',
            'return "Item removed from group; group now has " + newGroup.pageItems.length + " items (new group ID " + newGroup.id + ")";',
        ], { errorPrefix: 'Error removing item from group' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Remove Item from Group");
    }

    /**
     * List all groups on a page
     */
    static async listGroups(args) {
        const { pageIndex } = args;

        const script = jsxProgram([
            ...JSX_HELPERS,
            ...jsxPage(pageIndex),
            'var pb = page.bounds;',
            'var items = page.allPageItems;',
            'var out = "=== GROUPS (page " + page.name + ") ===\\n";',
            'var groupCount = 0;',
            'for (var i = 0; i < items.length; i++) {',
            '  var item = items[i];',
            '  if (item.constructor.name === "Group") {',
            '    var gb = item.geometricBounds;',
            '    out += "Group Index: " + i + "\\n";',
            '    out += "Name: " + (item.name || "Unnamed") + "\\n";',
            '    out += "ID: " + item.id + "\\n";',
            '    out += "Visible: " + item.visible + "\\n";',
            '    out += "Locked: " + item.locked + "\\n";',
            '    out += "Members: " + item.pageItems.length + "\\n";',
            '    out += "Position (mm): x=" + __mm(gb[1] - pb[1]) + ", y=" + __mm(gb[0] - pb[0]) + "; size " + __mm(gb[3] - gb[1]) + " x " + __mm(gb[2] - gb[0]) + "\\n";',
            '    out += "---\\n";',
            '    groupCount++;',
            '  }',
            '}',
            'if (groupCount === 0) { out += "(no groups on this page)\\n"; }',
            'return out;',
        ], { errorPrefix: 'Error listing groups' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "List Groups");
    }

    /**
     * Set group properties
     */
    static async setGroupProperties(args) {
        const { pageIndex, groupIndex, visible, locked, name } = args;

        const lines = [];
        const changed = [];
        if (locked === false) { lines.push('group.locked = false;'); changed.push('locked=false'); }
        if (has(name)) { lines.push(`group.name = ${str(name)};`); changed.push('name'); }
        if (typeof visible === 'boolean') { lines.push(`group.visible = ${bool(visible)};`); changed.push(`visible=${visible}`); }
        if (locked === true) { lines.push('group.locked = true;'); changed.push('locked=true'); }
        if (!changed.length) {
            return formatResponse('Invalid request: no properties to set', 'Set Group Properties');
        }

        const script = jsxProgram([
            ...jsxPage(pageIndex),
            ...jsxGroupAt(groupIndex),
            ...(locked === false ? [] : ['if (group.locked) { return "Cannot modify: group is locked (pass locked=false to unlock)"; }']),
            ...lines,
            `return ${str(`Group properties updated: ${changed.join(', ')}`)};`,
        ], { errorPrefix: 'Error setting group properties' });

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Set Group Properties");
    }
}
