/**
 * PageItem and Group tool definitions
 *
 * Items are addressed by their index in page.allPageItems (the order shown by
 * list_page_items). Positions and sizes are in millimetres relative to the
 * page's top-left corner.
 */
export const pageItemGroupToolDefinitions = [
    // PageItem Management Tools
    {
        name: 'get_page_item_info',
        description: 'Get detailed information about a specific page item',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the item'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the page item to get info for'
                }
            },
            required: ['pageIndex', 'itemIndex']
        }
    },
    {
        name: 'select_page_item',
        description: 'Select a page item (by index from list_page_items) in the document window',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the item'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the page item to select'
                },
                existingSelection: {
                    type: 'string',
                    enum: ['REPLACE_WITH', 'ADD_TO', 'REMOVE_FROM'],
                    description: 'How to handle existing selection',
                    default: 'REPLACE_WITH'
                }
            },
            required: ['pageIndex', 'itemIndex']
        }
    },
    {
        name: 'move_page_item',
        description: 'Move a page item so its top-left corner (geometric bounds) is at x, y mm on the page',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the item'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the page item to move'
                },
                x: {
                    type: 'number',
                    description: 'New X of the item\'s top-left corner, in mm from the page left edge'
                },
                y: {
                    type: 'number',
                    description: 'New Y of the item\'s top-left corner, in mm from the page top edge'
                }
            },
            required: ['pageIndex', 'itemIndex', 'x', 'y']
        }
    },
    {
        name: 'resize_page_item',
        description: 'Resize a page item to width x height mm around an anchor point',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the item'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the page item to resize'
                },
                width: {
                    type: 'number',
                    description: 'New width in mm'
                },
                height: {
                    type: 'number',
                    description: 'New height in mm'
                },
                anchorPoint: {
                    type: 'string',
                    enum: ['CENTER_ANCHOR', 'TOP_LEFT_ANCHOR', 'TOP_CENTER_ANCHOR', 'TOP_RIGHT_ANCHOR', 'LEFT_CENTER_ANCHOR', 'RIGHT_CENTER_ANCHOR', 'BOTTOM_LEFT_ANCHOR', 'BOTTOM_CENTER_ANCHOR', 'BOTTOM_RIGHT_ANCHOR'],
                    description: 'Anchor point for resizing',
                    default: 'CENTER_ANCHOR'
                }
            },
            required: ['pageIndex', 'itemIndex', 'width', 'height']
        }
    },
    {
        name: 'set_page_item_properties',
        description: 'Set fill, stroke, visibility and lock state of a page item (only the properties you pass are changed)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the item'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the page item to modify'
                },
                fillColor: {
                    type: 'string',
                    description: 'Fill swatch name (e.g. "Black", "None") or "#RRGGBB"'
                },
                strokeColor: {
                    type: 'string',
                    description: 'Stroke swatch name or "#RRGGBB"'
                },
                strokeWeight: {
                    type: 'number',
                    description: 'Stroke weight in points'
                },
                visible: {
                    type: 'boolean',
                    description: 'Whether the item is visible'
                },
                locked: {
                    type: 'boolean',
                    description: 'Whether the item is locked'
                }
            },
            required: ['pageIndex', 'itemIndex']
        }
    },
    {
        name: 'duplicate_page_item',
        description: 'Duplicate a page item on the same page, optionally placing the copy at x/y; returns the copy ID',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the item'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the page item to duplicate'
                },
                x: {
                    type: 'number',
                    description: 'X of the duplicate\'s top-left corner, in mm from the page left edge'
                },
                y: {
                    type: 'number',
                    description: 'Y of the duplicate\'s top-left corner, in mm from the page top edge'
                }
            },
            required: ['pageIndex', 'itemIndex', 'x', 'y']
        }
    },
    {
        name: 'delete_page_item',
        description: 'Delete a page item (by index from list_page_items) from a page',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the item'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the page item to delete'
                }
            },
            required: ['pageIndex', 'itemIndex']
        }
    },
    {
        name: 'list_page_items',
        description: 'List all page items on a specific page',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page to list items from'
                }
            },
            required: ['pageIndex']
        }
    },

    // Group Management Tools
    {
        name: 'create_group',
        description: 'Group the page items currently selected in InDesign (at least 2)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page where the group will be created'
                }
            },
            required: ['pageIndex']
        }
    },
    {
        name: 'create_group_from_items',
        description: 'Create a group from specific page items by their indices',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the items'
                },
                itemIndices: {
                    type: 'array',
                    items: {
                        type: 'integer'
                    },
                    description: 'Indices (from list_page_items) of top-level items to group together',
                    minItems: 2
                }
            },
            required: ['pageIndex', 'itemIndices']
        }
    },
    {
        name: 'ungroup',
        description: 'Ungroup a group, releasing all its items',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the group'
                },
                groupIndex: {
                    type: 'integer',
                    description: 'Index of the group to ungroup'
                }
            },
            required: ['pageIndex', 'groupIndex']
        }
    },
    {
        name: 'get_group_info',
        description: 'Get information about a group, including its direct members and their indices',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the group'
                },
                groupIndex: {
                    type: 'integer',
                    description: 'Index of the group to get info for'
                }
            },
            required: ['pageIndex', 'groupIndex']
        }
    },
    {
        name: 'add_item_to_group',
        description: 'Add a top-level page item to an existing group (the group is rebuilt: it keeps its name but gets a new ID and index)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the group and item'
                },
                groupIndex: {
                    type: 'integer',
                    description: 'Index of the group to add the item to'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index (from list_page_items) of the page item to add to the group'
                }
            },
            required: ['pageIndex', 'groupIndex', 'itemIndex']
        }
    },
    {
        name: 'remove_item_from_group',
        description: 'Remove a member from a group (the group is rebuilt with the remaining members, or dissolved if fewer than 2 remain)',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the group'
                },
                groupIndex: {
                    type: 'integer',
                    description: 'Index of the group (from list_groups) to remove the item from'
                },
                itemIndex: {
                    type: 'integer',
                    description: 'Index of the member within the group, as listed by get_group_info'
                }
            },
            required: ['pageIndex', 'groupIndex', 'itemIndex']
        }
    },
    {
        name: 'list_groups',
        description: 'List the groups on a page with their index, name, item count and bounds',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page to list groups from'
                }
            },
            required: ['pageIndex']
        }
    },
    {
        name: 'set_group_properties',
        description: 'Set a group\'s name, visibility and locked state',
        inputSchema: {
            type: 'object',
            properties: {
                pageIndex: {
                    type: 'integer',
                    description: 'Index of the page containing the group'
                },
                groupIndex: {
                    type: 'integer',
                    description: 'Index of the group to modify'
                },
                visible: {
                    type: 'boolean',
                    description: 'Whether the group is visible'
                },
                locked: {
                    type: 'boolean',
                    description: 'Whether the group is locked'
                },
                name: {
                    type: 'string',
                    description: 'Name for the group'
                }
            },
            required: ['pageIndex', 'groupIndex']
        }
    }
]; 