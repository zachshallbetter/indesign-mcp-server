/**
 * Generative features: Generative Fill, Generate Image and Harmonize.
 *
 * Each is an Action Manager event (syntheticFill, syntheticTextToImage,
 * syntheticGenHarmonize) that sends the request to Adobe's Firefly service, so
 * it needs Photoshop signed in to an Adobe account with an internet
 * connection, uses generative credits, and is subject to Adobe's content
 * rules. The descriptor keys come from published scripts that run these
 * events, not from Adobe documentation.
 */
import { str, num, enumOf } from 'adobe-mcp-core';
import { script } from '../script.js';
import { run } from '../executor.js';
import { TARGET_SCHEMA, targetSpec } from '../args.js';

const G = 'photoshop.generative.';
const CONTENT_TYPES = ['none', 'photo', 'art'];

/**
 * Helpers shared by the generative scripts: the clio service options with
 * their gi_* keys, the request descriptor, and the layers a call added.
 */
const HELPERS = `
var __s = function (id) { return app.stringIDToTypeID(id); };
var __clio = function (mode, prompt, seed, contentType, workflowName) {
  var c = new ActionDescriptor();
  c.putBoolean(__s("dualCrop"), true);
  if (workflowName) c.putString(__s("gentech_workflow_name"), workflowName);
  c.putString(__s("gi_ADVANCED"), "{\\"enable_mts\\":true}");
  c.putInteger(__s("gi_CONTENT_PRESERVE"), 0);
  c.putBoolean(__s("gi_CROP"), false);
  c.putBoolean(__s("gi_DILATE"), false);
  c.putBoolean(__s("gi_ENABLE_PROMPT_FILTER"), true);
  c.putInteger(__s("gi_GUIDANCE"), 6);
  c.putString(__s("gi_MODE"), mode);
  c.putInteger(__s("gi_NUM_STEPS"), -1);
  c.putString(__s("gi_PROMPT"), prompt);
  c.putInteger(__s("gi_SEED"), seed);
  c.putInteger(__s("gi_SIMILARITY"), 0);
  if (contentType) {
    var styles = new ActionDescriptor(), effects = new ActionList();
    styles.putString(__s("text_to_image_content_type"), contentType);
    styles.putInteger(__s("text_to_image_effects_count"), 0);
    effects.putString("none"); effects.putString("none"); effects.putString("none");
    styles.putList(__s("text_to_image_effects_list"), effects);
    var adv = new ActionDescriptor();
    adv.putObject(__s("text_to_image_styles_options"), __s("null"), styles);
    c.putObject(__s("clio_advanced_options"), __s("null"), adv);
  }
  return c;
};
var __request = function (layerID, prompt, serviceID, services, workflow) {
  var d = new ActionDescriptor(), r = new ActionReference();
  r.putEnumerated(__s("document"), __s("ordinal"), __s("targetEnum"));
  d.putReference(__s("null"), r);
  d.putInteger(__s("documentID"), doc.id);
  d.putInteger(__s("layerID"), layerID);
  d.putString(__s("prompt"), prompt);
  d.putString(__s("serviceID"), serviceID);
  d.putObject(__s("serviceOptionsList"), __s("null"), services);
  d.putString(__s("workflow"), workflow);
  d.putEnumerated(__s("workflowType"), __s("genWorkflow"), __s(workflow));
  return d;
};
var __known = {};
__eachLayer(doc, function (x) { __known["i" + x.id] = true; });
var __added = function () {
  var added = [];
  __eachLayer(doc, function (x) { if (!__known["i" + x.id]) added.push(__layerInfo(x)); });
  return added;
};`;

const PROMPT = { type: 'string', maxLength: 1000, description: 'What to generate, in English' };
const SEED = { type: 'integer', minimum: -1, maximum: 2147483647, description: 'Seed for repeatable results; -1 (default) picks one at random', default: -1 };
const CONTENT = { type: 'string', enum: CONTENT_TYPES, description: 'Content type: none (automatic, default), photo or art', default: 'none' };

/** Check a prompt: a string up to 1000 characters; empty only where allowed. */
function prompt(value, { allowEmpty }) {
    if (value === undefined && allowEmpty) return '""';
    if (typeof value !== 'string') throw new Error("'prompt' is text");
    if (!allowEmpty && !value.trim()) throw new Error("'prompt' is required");
    if (value.length > 1000) throw new Error("'prompt' is at most 1000 characters");
    return str(value);
}

const seed = (v) => num(v ?? -1, { min: -1, max: 2147483647, name: 'seed' });

export const tools = [
    {
        name: 'generative_fill',
        description: 'Generative Fill (Edit > Generative Fill) inside the current selection: generate content from a prompt, or with an empty prompt remove what is selected and fill from the surroundings. Results go to a new Generative Layer. Needs a selection, Photoshop signed in to an Adobe account and an internet connection; uses generative credits',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { ...PROMPT, description: 'What to generate in the selection; empty or omitted to remove the selected content' },
                contentType: CONTENT,
                seed: SEED,
            },
        },
        hints: { openWorld: true },
        features: [`${G}generative_fill`],
        handler: (a) => {
            const text = prompt(a.prompt, { allowEmpty: true });
            const type = enumOf(a.contentType ?? 'none', CONTENT_TYPES, { name: 'contentType' });
            return run('Generative fill', script(`${HELPERS}
try { doc.selection.bounds; } catch (e) { throw new Error("Generative Fill needs a selection: use select_area first"); }
var services = new ActionDescriptor();
services.putObject(__s("clio"), __s("clio"), __clio("tinp", ${text}, ${seed(a.seed)}, ${str(type)}, ""));
var d = __request(doc.activeLayer.id, ${text}, "clio", services, "in_painting");
d.putString(__s("serviceVersion"), "clio3");
app.executeAction(__s("syntheticFill"), d, DialogModes.NO);
__result__ = { prompt: ${text}, added: __added(), activeLayer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'generate_image',
        description: 'Generate Image (Edit > Generate Image): create an image from a text prompt as a new layer filling the active document. Needs Photoshop signed in to an Adobe account and an internet connection; uses generative credits',
        inputSchema: { type: 'object', properties: { prompt: PROMPT, contentType: CONTENT, seed: SEED }, required: ['prompt'] },
        hints: { openWorld: true },
        features: [`${G}generate_image`],
        handler: (a) => {
            const text = prompt(a.prompt, { allowEmpty: false });
            const type = enumOf(a.contentType ?? 'none', CONTENT_TYPES, { name: 'contentType' });
            return run('Generate image', script(`${HELPERS}
doc.selection.selectAll();
var services = new ActionDescriptor();
services.putObject(__s("clio"), __s("clio"), __clio("ginp", ${text}, ${seed(a.seed)}, ${str(type)}, "text_to_image"));
app.executeAction(__s("syntheticTextToImage"), __request(0, ${text}, "clio", services, "text_to_image"), DialogModes.NO);
__result__ = { prompt: ${text}, added: __added(), activeLayer: __layerInfo(doc.activeLayer) };`));
        },
    },
    {
        name: 'harmonize_layer',
        description: 'Harmonize a layer with the image beneath it (the Properties panel\'s Harmonize): match its light, colour and shadows to the background. Results go to a new layer. Needs Photoshop signed in to an Adobe account and an internet connection; uses generative credits',
        inputSchema: { type: 'object', properties: { target: { ...TARGET_SCHEMA, description: 'The layer to harmonize (the first one given). Default the active layer' }, seed: SEED } },
        hints: { openWorld: true },
        features: [`${G}harmonize`],
        handler: (a) => run('Harmonize', script(`${HELPERS}
var l = __targets(doc, ${targetSpec(a.target ?? { active: true })})[0];
doc.activeLayer = l;
var h = new ActionDescriptor();
h.putBoolean(__s("dualCrop"), true);
h.putInteger(__s("gi_SEED"), ${seed(a.seed)});
var services = new ActionDescriptor();
services.putObject(__s("clio"), __s("clio"), __clio("ginp", "", -1, "", ""));
services.putObject(__s("gen_harmonize"), __s("gen_harmonize"), h);
app.executeAction(__s("syntheticGenHarmonize"), __request(l.id, "", "gen_harmonize", services, "gen_harmonize"), DialogModes.NO);
__result__ = { layer: l.name, added: __added(), activeLayer: __layerInfo(doc.activeLayer) };`)),
    },
];
