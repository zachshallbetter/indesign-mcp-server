/**
 * Text frame handlers
 */
import { ScriptExecutor } from '../core/scriptExecutor.js';
import { formatResponse, formatErrorResponse, escapeJsxString } from '../utils/stringUtils.js';
import { sessionManager } from '../core/sessionManager.js';

export class TextHandlers {
    /**
     * Create a text frame on the active page
     */
    static async createTextFrame(args) {
        const {
            content,
            x,
            y,
            width,
            height,
            fontSize = 12,
            fontName = 'Arial\\tRegular',
            textColor = 'Black',
            alignment = 'LEFT',
            paragraphStyle = null,
            characterStyle = null
        } = args;

        // Use session manager for positioning if coordinates not provided
        const positioning = sessionManager.getCalculatedPositioning({ x, y, width, height });

        // Validate positioning before creating content
        const validation = sessionManager.validatePositioning(positioning.x, positioning.y, positioning.width, positioning.height);
        if (!validation.valid) {
            // Apply suggested corrections if available, otherwise use safe defaults
            if (validation.suggested) {
                Object.assign(positioning, validation.suggested);
            } else {
                // Fallback to safe positioning
                const safePos = sessionManager.getCalculatedPositioning({});
                Object.assign(positioning, safePos);
            }
        }

        const escapedContent = escapeJsxString(content);
        const escapedFontName = escapeJsxString(fontName);
        const escapedParagraphStyle = paragraphStyle ? escapeJsxString(paragraphStyle) : '';
        const escapedCharacterStyle = characterStyle ? escapeJsxString(characterStyle) : '';

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var page = doc.pages[0];',
            '  var textFrame;',
            '  var styleMessage = "";',
            '',
            '  try {',
            '    // Create text frame',
            `    textFrame = page.textFrames.add();`,
            `    textFrame.geometricBounds = [${positioning.y}, ${positioning.x}, ${positioning.y + positioning.height}, ${positioning.x + positioning.width}];`,
            `    textFrame.contents = "${escapedContent}";`,
            '',
            '    // Apply paragraph style if specified',
            `    if ("${escapedParagraphStyle}" !== "") {`,
            '      try {',
            `        var paragraphStyle = doc.paragraphStyles.itemByName("${escapedParagraphStyle}");`,
            '        if (paragraphStyle.isValid) {',
            '          textFrame.paragraphs[0].appliedParagraphStyle = paragraphStyle;',
            `          styleMessage += "Paragraph style '${escapedParagraphStyle}' applied. ";`,
            '        } else {',
            `          styleMessage += "Paragraph style '${escapedParagraphStyle}' not found. ";`,
            '        }',
            '      } catch (styleError) {',
            `        styleMessage += "Error applying paragraph style: " + styleError.message + ". ";`,
            '      }',
            '    }',
            '',
            '    // Apply character style if specified',
            `    if ("${escapedCharacterStyle}" !== "") {`,
            '      try {',
            `        var characterStyle = doc.characterStyles.itemByName("${escapedCharacterStyle}");`,
            '        if (characterStyle.isValid) {',
            '          textFrame.texts[0].appliedCharacterStyle = characterStyle;',
            `          styleMessage += "Character style '${escapedCharacterStyle}' applied. ";`,
            '        } else {',
            `          styleMessage += "Character style '${escapedCharacterStyle}' not found. ";`,
            '        }',
            '      } catch (styleError) {',
            `        styleMessage += "Error applying character style: " + styleError.message + ". ";`,
            '      }',
            '    }',
            '',
            '    // Apply direct formatting only if no styles were applied',
            `    if ("${escapedParagraphStyle}" === "" && "${escapedCharacterStyle}" === "") {`,
            '      // Apply text formatting',
            '      try {',
            `        textFrame.texts[0].appliedFont = app.fonts.itemByName("${escapedFontName}");`,
            '      } catch (fontError) {',
            '        // Fallback to a default font if the specified font is not available',
            '        textFrame.texts[0].appliedFont = app.fonts.itemByName("Arial\\tRegular");',
            '      }',
            `      textFrame.texts[0].pointSize = ${fontSize};`,
            '',
            '      // Apply color',
            `      if ("${textColor}" !== "Black") {`,
            '        try {',
            `          textFrame.texts[0].fillColor = app.colors.itemByName("${textColor}");`,
            '        } catch (colorError) {',
            '          // Use default color if specified color not found',
            '        }',
            '      }',
            '',
            '      // Apply alignment',
            `      if ("${alignment}" === "CENTER") {`,
            '        textFrame.texts[0].justification = Justification.CENTER_ALIGN;',
            `      } else if ("${alignment}" === "RIGHT") {`,
            '        textFrame.texts[0].justification = Justification.RIGHT_ALIGN;',
            `      } else if ("${alignment}" === "JUSTIFY") {`,
            '        textFrame.texts[0].justification = Justification.FULLY_JUSTIFIED;',
            '      } else {',
            '        textFrame.texts[0].justification = Justification.LEFT_ALIGN;',
            '      }',
            '    }',
            '',
            '    "Text frame created successfully. " + styleMessage;',
            '  } catch (error) {',
            '    "Error creating text frame: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);

        // Check if the operation was successful
        const isSuccess = result.includes("Text frame created successfully");

        if (isSuccess) {
            // Store the created item info in session
            sessionManager.setLastCreatedItem({
                type: 'textFrame',
                content: content,
                position: positioning,
                fontSize: fontSize,
                fontName: fontName,
                paragraphStyle: paragraphStyle,
                characterStyle: characterStyle
            });
        }

        return isSuccess ?
            formatResponse(result, "Create Text Frame") :
            formatErrorResponse(result, "Create Text Frame");
    }

    /**
     * Edit an existing text frame
     */
    static async editTextFrame(args) {
        const {
            frameIndex,
            content,
            fontSize,
            fontName,
            textColor,
            alignment
        } = args;

        const escapedContent = content ? escapeJsxString(content) : '';
        const escapedFontName = fontName ? escapeJsxString(fontName) : '';

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var page = doc.pages[0];',
            '',
            '  try {',
            `    if (${frameIndex} >= page.textFrames.length) {`,
            '      "Text frame index out of range";',
            '    } else {',
            `      var textFrame = page.textFrames[${frameIndex}];`,
            '',
            `      if ("${escapedContent}" !== "") {`,
            `        textFrame.contents = "${escapedContent}";`,
            '      }',
            '',
            `      if (${fontSize}) {`,
            `        textFrame.texts[0].pointSize = ${fontSize};`,
            '      }',
            '',
            `      if ("${escapedFontName}" !== "") {`,
            `        textFrame.texts[0].appliedFont = app.fonts.itemByName("${escapedFontName}");`,
            '      }',
            '',
            `      if ("${textColor}" !== "") {`,
            '      try {',
            `        textFrame.texts[0].fillColor = app.colors.itemByName("${textColor}");`,
            '      } catch (colorError) {',
            '        // Use default color if specified color not found',
            '      }',
            '      }',
            '',
            `      if ("${alignment}" !== "") {`,
            `        if ("${alignment}" === "CENTER") {`,
            '          textFrame.texts[0].justification = Justification.CENTER_ALIGN;',
            `        } else if ("${alignment}" === "RIGHT") {`,
            '          textFrame.texts[0].justification = Justification.RIGHT_ALIGN;',
            `        } else if ("${alignment}" === "JUSTIFY") {`,
            '          textFrame.texts[0].justification = Justification.FULLY_JUSTIFIED;',
            '        } else {',
            '          textFrame.texts[0].justification = Justification.LEFT_ALIGN;',
            '        }',
            '      }',
            '',
            '      "Text frame updated successfully";',
            '    }',
            '  } catch (error) {',
            '    "Error updating text frame: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Edit Text Frame");
    }

    /**
     * Create a table on the active page
     */
    static async createTable(args) {
        const {
            rows = 3,
            columns = 3,
            x,
            y,
            width,
            height,
            headerRows = 1,
            headerColumns = 0
        } = args;

        // Use session manager for positioning if coordinates not provided
        const positioning = sessionManager.getCalculatedPositioning({ x, y, width, height });

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var page = doc.pages[0];',
            '  var table;',
            '',
            '  try {',
            '    // Create text frame for table',
            '    var textFrame = page.textFrames.add();',
            `    textFrame.geometricBounds = [${positioning.y}, ${positioning.x}, ${positioning.y + positioning.height}, ${positioning.x + positioning.width}];`,
            '',
            '    // Create table',
            `    table = textFrame.insertionPoints[0].tables.add({bodyRowCount: ${rows}, bodyColumnCount: ${columns}});`,
            '',
            '    // Set header rows and columns',
            `    table.headerRowCount = ${headerRows};`,
            `    table.headerColumnCount = ${headerColumns};`,
            '',
            '    "Table created successfully";',
            '  } catch (error) {',
            '    "Error creating table: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);

        // Store the created item info in session
        sessionManager.setLastCreatedItem({
            type: 'table',
            rows: rows,
            columns: columns,
            position: positioning,
            headerRows: headerRows,
            headerColumns: headerColumns
        });

        return formatResponse(result, "Create Table");
    }

    /**
     * Populate a table with data
     */
    static async populateTable(args) {
        const {
            tableIndex = 0,
            data,
            startRow = 0,
            startColumn = 0
        } = args;

        if (!data || !Array.isArray(data)) {
            return formatResponse("Invalid data provided. Expected array of arrays.", "Populate Table");
        }

        const escapedData = data.map(row =>
            row.map(cell => escapeJsxString(cell.toString()))
        );

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var page = doc.pages[0];',
            '',
            '  try {',
            '    // Find table in text frames',
            '    var table = null;',
            '    var tableCount = 0;',
            '',
            '    for (var i = 0; i < page.textFrames.length; i++) {',
            '      var textFrame = page.textFrames[i];',
            '      if (textFrame.tables.length > 0) {',
            `        if (tableCount === ${tableIndex}) {`,
            '          table = textFrame.tables[0];',
            '          break;',
            '        }',
            '        tableCount++;',
            '      }',
            '    }',
            '',
            '    if (!table) {',
            `      "Table index ${tableIndex} not found";`,
            '    } else {',
            '      // Populate table with data',
            `      var data = ${JSON.stringify(escapedData)};`,
            `      var startRow = ${startRow};`,
            `      var startColumn = ${startColumn};`,
            '',
            '      for (var row = 0; row < data.length; row++) {',
            '        for (var col = 0; col < data[row].length; col++) {',
            '          var cellRow = startRow + row;',
            '          var cellCol = startColumn + col;',
            '',
            '          if (cellRow < table.rows.length && cellCol < table.columns.length) {',
            '            var cell = table.cells.item(cellRow, cellCol);',
            '            cell.contents = data[row][col];',
            '          }',
            '        }',
            '      }',
            '',
            '      "Table populated successfully";',
            '    }',
            '  } catch (error) {',
            '    "Error populating table: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Populate Table");
    }

    /**
     * Find and replace text in the document
     */
    static async findReplaceText(args) {
        const {
            findText,
            replaceText,
            caseSensitive = false,
            wholeWord = false
        } = args;

        const escapedFindText = escapeJsxString(findText);
        const escapedReplaceText = escapeJsxString(replaceText);

        const script = [
            'if (app.documents.length === 0) {',
            '  "No document open";',
            '} else {',
            '  var doc = app.activeDocument;',
            '  var findGrepPreferences = app.findGrepPreferences;',
            '  var changeGrepPreferences = app.changeGrepPreferences;',
            '',
            '  try {',
            '    // Clear previous preferences',
            '    findGrepPreferences.clear();',
            '    changeGrepPreferences.clear();',
            '',
            '    // Set find preferences',
            `    findGrepPreferences.findWhat = "${escapedFindText}";`,
            `    findGrepPreferences.caseSensitive = ${caseSensitive};`,
            `    findGrepPreferences.wholeWord = ${wholeWord};`,
            '',
            '    // Set change preferences',
            `    changeGrepPreferences.changeTo = "${escapedReplaceText}";`,
            '',
            '    // Perform find and replace',
            '    var foundItems = doc.changeGrep();',
            '',
            '    "Find and replace completed. Items changed: " + foundItems.length;',
            '  } catch (error) {',
            '    "Error during find and replace: " + error.message;',
            '  }',
            '}'
        ].join('\n');

        const result = await ScriptExecutor.executeInDesignScript(script);
        return formatResponse(result, "Find Replace Text");
    }
} 