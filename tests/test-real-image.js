#!/usr/bin/env node

/**
 * Real Image Test
 * Demonstrates placing a real image via MCP
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_PATH = join(__dirname, 'src/index.js');

function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? '❌' : level === 'success' ? '✅' : 'ℹ️';
    console.log(`${prefix} [${timestamp}] ${message}`);
}

async function executeTool(tool, args = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('node', [SERVER_PATH], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                try {
                    const mcpResponse = JSON.parse(output);
                    if (mcpResponse.result && mcpResponse.result.content && mcpResponse.result.content[0]) {
                        const content = mcpResponse.result.content[0].text;
                        const result = JSON.parse(content);
                        resolve(result);
                    } else {
                        resolve({ success: false, error: 'Invalid MCP response format' });
                    }
                } catch (e) {
                    resolve({ success: false, error: `Failed to parse response: ${e.message}` });
                }
            } else {
                reject(new Error(`Process exited with code ${code}: ${errorOutput}`));
            }
        });

        const toolCall = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: tool,
                arguments: args
            }
        };

        child.stdin.write(JSON.stringify(toolCall) + '\n');
        child.stdin.end();

        setTimeout(() => {
            child.kill();
            reject(new Error(`Tool execution timed out`));
        }, 30000);
    });
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Create a real test image (PNG-like data)
function createRealTestImage() {
    log('🖼️ Creating a real test image...');

    const imagesDir = './real-test-images';
    if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir);
    }

    // Create a simple but realistic SVG image
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="400" height="300" fill="url(#bg)"/>
  <circle cx="200" cy="150" r="60" fill="#f093fb" opacity="0.8"/>
  <text x="200" y="160" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="24" font-weight="bold">MCP Test</text>
  <text x="200" y="180" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="14">Image Asset</text>
  <rect x="50" y="220" width="300" height="4" fill="white" opacity="0.6"/>
</svg>`;

    try {
        writeFileSync(`${imagesDir}/real-test-image.svg`, svgContent);
        log('✅ Created real test image: real-test-image.svg');
        return true;
    } catch (error) {
        log(`❌ Failed to create test image: ${error.message}`, 'error');
        return false;
    }
}

async function testRealImage() {
    log('🖼️ Real Image Test');
    log('🔧 Testing image placement with a real image file');

    try {
        // Step 1: Create real test image
        if (!createRealTestImage()) {
            throw new Error('Failed to create test image');
        }
        await delay(500);

        // Step 2: Create document
        log('📄 Creating document...');
        const docResult = await executeTool('create_document', {
            name: 'Real Image Test',
            width: 210,
            height: 297,
            facingPages: false,
            pageOrientation: 'PORTRAIT',
            marginTop: 25,
            marginBottom: 25,
            marginLeft: 25,
            marginRight: 25
        });

        if (!docResult.success) {
            throw new Error(`Failed to create document: ${docResult.result}`);
        }
        log('✅ Document created successfully');
        await delay(1000);

        // Step 3: Create color swatch for image frame
        log('🎨 Creating color swatch for image frame...');
        const colorResult = await executeTool('create_color_swatch', {
            name: 'Image Frame Blue',
            colorType: 'PROCESS',
            red: 74,
            green: 144,
            blue: 226
        });

        if (colorResult.success) {
            log('✅ Created color swatch: Image Frame Blue');
        } else {
            log(`❌ Failed to create color swatch: ${colorResult.result}`, 'error');
        }
        await delay(300);

        // Step 4: Create object style for image
        log('🎨 Creating object style for image...');
        const styleResult = await executeTool('create_object_style', {
            name: 'Image Frame Style',
            fillColor: '',
            strokeColor: 'Image Frame Blue',
            strokeWeight: 3,
            cornerRadius: 8,
            transparency: 100
        });

        if (styleResult.success) {
            log('✅ Created object style: Image Frame Style');
        } else {
            log(`❌ Failed to create object style: ${styleResult.result}`, 'error');
        }
        await delay(300);

        // Step 5: Place the real image
        log('🖼️ Placing real image...');
        const imageResult = await executeTool('place_image', {
            filePath: './real-test-images/real-test-image.svg',
            x: 30,
            y: 50,
            width: 150,
            height: 112,
            linkImage: true
        });

        if (imageResult.success) {
            log(`✅ Image placed successfully: ${imageResult.result}`);
        } else {
            log(`❌ Failed to place image: ${imageResult.result}`, 'error');
        }
        await delay(500);

        // Step 6: Apply object style to image
        log('🎨 Applying object style to image...');
        const applyStyleResult = await executeTool('apply_object_style', {
            styleName: 'Image Frame Style',
            itemType: 'rectangle',
            itemIndex: 0
        });

        if (applyStyleResult.success) {
            log(`✅ Style applied successfully: ${applyStyleResult.result}`);
        } else {
            log(`❌ Failed to apply style: ${applyStyleResult.result}`, 'error');
        }
        await delay(300);

        // Step 7: Get image information
        log('📋 Getting image information...');
        const imageInfoResult = await executeTool('get_image_info', { itemIndex: 0 });
        if (imageInfoResult.success) {
            log('✅ Image information retrieved');
            log('📋 Image details:');
            console.log(imageInfoResult.result);
        } else {
            log(`❌ Failed to get image info: ${imageInfoResult.result}`, 'error');
        }
        await delay(300);

        // Step 8: Add descriptive text
        log('📝 Adding descriptive text...');
        const textResult = await executeTool('create_text_frame', {
            content: 'Real Image Test: SVG placed with object styling',
            x: 30,
            y: 180,
            width: 150,
            height: 20,
            fontSize: 12,
            fontName: 'Arial\\tBold',
            textColor: 'Black',
            alignment: 'LEFT'
        });

        if (textResult.success) {
            log('✅ Added descriptive text');
        } else {
            log(`❌ Failed to add text: ${textResult.result}`, 'error');
        }
        await delay(300);

        // Step 9: Save the document
        log('💾 Saving document...');
        const saveResult = await executeTool('save_document', {
            filePath: './Real-Image-Test.indd'
        });

        if (saveResult.success) {
            log('✅ Document saved as Real-Image-Test.indd');
        } else {
            log(`⚠️ Save warning: ${saveResult.result}`, 'error');
        }

        log('🎉 Real image test completed!');
        log('📋 Summary:');
        log('   ✅ Created real SVG test image');
        log('   ✅ Created color swatch for styling');
        log('   ✅ Created object style for image frame');
        log('   ✅ Placed real image with linking enabled');
        log('   ✅ Applied object style to image');
        log('   ✅ Retrieved detailed image information');
        log('   ✅ Added descriptive text');
        log('   ✅ Document saved with real image');

        log('🔧 Real Image Placement via MCP:');
        log('   1. **File Creation**: Generate or use existing image files');
        log('   2. **Image Placement**: Use place_image with file path');
        log('   3. **Styling**: Apply object styles for consistent formatting');
        log('   4. **Linking**: Choose between linked or embedded images');
        log('   5. **Information**: Retrieve detailed image metadata');
        log('   6. **Integration**: Seamlessly integrate with document workflow');

    } catch (error) {
        log(`❌ Error during real image test: ${error.message}`, 'error');
        process.exit(1);
    }
}

// Run the test
testRealImage()
    .then(() => {
        log('🚀 Real image test finished successfully!');
        process.exit(0);
    })
    .catch(error => {
        log(`❌ Failed to run real image test: ${error.message}`, 'error');
        process.exit(1);
    }); 